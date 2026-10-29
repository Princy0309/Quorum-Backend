import env from '../config/env.js';
import prisma from '../config/prisma.js';
import redis from '../config/redis.js';
import { ApiError } from '../utils/ApiError.js';
import {
  generateSignedState,
  verifySignedState,
  encryptJiraToken,
  decryptJiraToken,
} from '../utils/jiraCrypto.js';
import logger from '../utils/logger.js';

const ATLASSIAN_AUTH_URL = 'https://auth.atlassian.com/authorize';
const ATLASSIAN_TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
const ATLASSIAN_ACCESSIBLE_RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources';
const ATLASSIAN_ME_URL = 'https://api.atlassian.com/me';
const ATLASSIAN_REVOKE_URL = 'https://auth.atlassian.com/oauth/token/revoke';
const HTTP_TIMEOUT_MS = 10000;

const JIRA_SCOPES = [
  'read:jira-work',
  'write:jira-work',
  'read:jira-user',
  'manage:jira-project',
  'manage:jira-configuration',
  'read:me',
  'offline_access',
].join(' ');

export function getAuthorizeUrl(userId: string): { authorizeUrl: string } {
  if (!userId) {
    throw new ApiError(400, 'User ID is required to generate Jira authorize URL');
  }

  const { state } = generateSignedState(userId);

  const params = new URLSearchParams({
    audience: 'api.atlassian.com',
    client_id: env.JIRA_CLIENT_ID!,
    scope: JIRA_SCOPES,
    redirect_uri: env.JIRA_REDIRECT_URI!,
    state,
    response_type: 'code',
    prompt: 'consent',
  });

  return {
    authorizeUrl: `${ATLASSIAN_AUTH_URL}?${params.toString()}`,
  };
}

export async function handleOAuthCallback(code: string, stateToken: string): Promise<string> {
  const verification = verifySignedState(stateToken);
  if (!verification.valid) {
    throw new ApiError(400, `Invalid OAuth state: ${verification.reason}`);
  }

  const { userId, nonce } = verification;

  const redisNonceKey = `jira_oauth_state:${nonce}`;
  const wasFirstConsumer = await redis.set(redisNonceKey, '1', 'EX', 600, 'NX');
  if (!wasFirstConsumer) {
    logger.warn(`Potential OAuth replay attack detected for nonce ${nonce}`);
    throw new ApiError(400, 'OAuth state already consumed (replay)');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!user) {
    throw new ApiError(401, 'User no longer exists');
  }

  const tokenResponse = await fetch(ATLASSIAN_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: env.JIRA_CLIENT_ID,
      client_secret: env.JIRA_CLIENT_SECRET,
      code,
      redirect_uri: env.JIRA_REDIRECT_URI,
    }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  }).catch((err) => {
    logger.error('Atlassian token exchange network error:', err);
    throw new ApiError(504, 'Atlassian token exchange timed out');
  });

  if (!tokenResponse.ok) {
    logger.error(`Atlassian token exchange returned status ${tokenResponse.status}`);
    throw new ApiError(400, 'Jira OAuth token exchange failed');
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  };

  if (!tokenData.access_token) {
    throw new ApiError(500, 'Atlassian did not return an access token');
  }
  if (!tokenData.refresh_token) {
    throw new ApiError(500, 'Atlassian did not return a refresh token — offline_access scope may be missing');
  }

  const resourcesResponse = await fetch(ATLASSIAN_ACCESSIBLE_RESOURCES_URL, {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  }).catch((err) => {
    logger.error('Accessible resources fetch failed:', err);
    throw new ApiError(502, 'Failed to discover Jira workspace from Atlassian');
  });

  if (!resourcesResponse.ok) {
    throw new ApiError(502, 'Atlassian accessible-resources returned non-200');
  }

  const resources = (await resourcesResponse.json()) as Array<{ id: string; url: string; name: string }>;
  if (!resources || resources.length === 0) {
    throw new ApiError(400, 'No Jira workspaces accessible by this account');
  }

  const cloudId = resources[0].id;
  const siteUrl: string | null = resources[0].url;

  const meResponse = await fetch(ATLASSIAN_ME_URL, {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  }).catch((err) => {
    logger.error('Failed to fetch Atlassian identity /me:', err);
    throw new ApiError(502, 'Failed to reach Atlassian /me endpoint');
  });

  if (!meResponse.ok) {
    throw new ApiError(502, 'Atlassian /me identity endpoint returned non-200');
  }

  const meData = (await meResponse.json()) as { account_id?: string; email?: string; name?: string };
  if (!meData.account_id) {
    throw new ApiError(500, 'Failed to retrieve Atlassian account identity');
  }

  const accountId = meData.account_id;
  const email = meData.email || null;
  const name = meData.name || null;

  const encryptedAccessToken = encryptJiraToken(tokenData.access_token);
  const encryptedRefreshToken = encryptJiraToken(tokenData.refresh_token);
  const tokenExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

  await prisma.$transaction(async (tx) => {
    return tx.userJiraLink.upsert({
      where: { userId },
      create: {
        userId,
        jiraAccountId: accountId,
        jiraEmail: email,
        jiraDisplayName: name,
        cloudId,
        siteUrl,
        encryptedAccessToken,
        encryptedRefreshToken,
        tokenExpiresAt,
        scope: tokenData.scope,
      },
      update: {
        jiraAccountId: accountId,
        jiraEmail: email,
        jiraDisplayName: name,
        cloudId,
        siteUrl,
        encryptedAccessToken,
        encryptedRefreshToken,
        tokenExpiresAt,
        scope: tokenData.scope,
      },
    });
  });

  logger.info(`User ${userId} successfully linked Jira account (${accountId}) to cloud (${cloudId})`);

  return `${env.CLIENT_URL}/settings/integrations/jira?status=success`;
}

export async function disconnectUser(userId: string): Promise<{ disconnected: boolean }> {
  const link = await prisma.userJiraLink.findUnique({
    where: { userId },
  });

  if (!link) {
    return { disconnected: true };
  }

  try {
    const accessToken = decryptJiraToken(link.encryptedAccessToken);
    const refreshToken = decryptJiraToken(link.encryptedRefreshToken);

    await Promise.allSettled([
      fetch(ATLASSIAN_REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: env.JIRA_CLIENT_ID,
          token: accessToken,
          token_type_hint: 'access_token',
        }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      }),
      fetch(ATLASSIAN_REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: env.JIRA_CLIENT_ID,
          token: refreshToken,
          token_type_hint: 'refresh_token',
        }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      }),
    ]);
  } catch (err: any) {
    logger.warn(`Failed to revoke Atlassian tokens on disconnect for user ${userId}: ${err.message}`);
  }

  await prisma.userJiraLink.delete({
    where: { userId },
  });

  logger.info(`User ${userId} disconnected Jira`);
  return { disconnected: true };
}

export async function getFreshJiraAccessToken(userId: string): Promise<string> {
  const link = await prisma.userJiraLink.findUnique({
    where: { userId },
  });

  if (!link) {
    throw new ApiError(404, 'No Jira account connected for this user');
  }

  const bufferMs = 5 * 60 * 1000;
  if (link.tokenExpiresAt.getTime() > Date.now() + bufferMs) {
    return decryptJiraToken(link.encryptedAccessToken);
  }

  const lockKey = `jira_refresh_lock:${userId}`;
  const acquiredLock = await redis.set(lockKey, '1', 'EX', 10, 'NX');

  if (!acquiredLock) {
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const updated = await prisma.userJiraLink.findUnique({ where: { userId } });
      if (updated && updated.tokenExpiresAt.getTime() > Date.now() + bufferMs) {
        return decryptJiraToken(updated.encryptedAccessToken);
      }
    }
    throw new ApiError(409, 'Jira token refresh timed out waiting for concurrency lock');
  }

  try {
    const current = await prisma.userJiraLink.findUnique({ where: { userId } });
    if (!current) {
      throw new ApiError(404, 'Jira connection removed');
    }
    if (current.tokenExpiresAt.getTime() > Date.now() + bufferMs) {
      return decryptJiraToken(current.encryptedAccessToken);
    }

    const refreshToken = decryptJiraToken(current.encryptedRefreshToken);

    const response = await fetch(ATLASSIAN_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: env.JIRA_CLIENT_ID,
        client_secret: env.JIRA_CLIENT_SECRET,
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    }).catch((err) => {
      logger.error('Token refresh network error:', err);
      throw new ApiError(504, 'Jira token refresh timed out');
    });

    if (response.status === 400 || response.status === 401) {
      await prisma.userJiraLink.delete({ where: { userId } }).catch(() => {});
      throw new ApiError(401, 'Jira access expired, please reconnect');
    }

    if (!response.ok) {
      throw new ApiError(response.status, 'Failed to refresh Jira access token');
    }

    const newTokens = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      scope?: string;
    };

    const newExpiresAt = new Date(Date.now() + newTokens.expires_in * 1000);
    const encryptedAccessToken = encryptJiraToken(newTokens.access_token);
    const encryptedRefreshToken = encryptJiraToken(newTokens.refresh_token);

    await prisma.userJiraLink.update({
      where: { userId },
      data: {
        encryptedAccessToken,
        encryptedRefreshToken,
        tokenExpiresAt: newExpiresAt,
        scope: newTokens.scope || current.scope,
      },
    });

    return newTokens.access_token;
  } finally {
    await redis.del(lockKey).catch(() => {});
  }
}

export async function getJiraStatus(userId: string) {
  const link = await prisma.userJiraLink.findUnique({
    where: { userId },
    select: {
      jiraAccountId: true,
      jiraEmail: true,
      jiraDisplayName: true,
      cloudId: true,
      siteUrl: true,
      tokenExpiresAt: true,
      createdAt: true,
    },
  });

  if (!link) {
    return { isConnected: false };
  }

  return {
    isConnected: true,
    ...link,
  };
}
