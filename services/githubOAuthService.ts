import env from '../config/env.js';
import prisma from '../config/prisma.js';
import redis from '../config/redis.js';
import { ApiError } from '../utils/ApiError.js';
import {
  generateSignedState,
  verifySignedState,
  encryptGithubToken,
  decryptGithubToken,
} from '../utils/githubCrypto.js';
import logger from '../utils/logger.js';

const GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';
const GITHUB_EMAILS_URL = 'https://api.github.com/user/emails';
const HTTP_TIMEOUT_MS = 10000;

const GITHUB_SCOPES = ['repo', 'read:user', 'user:email'].join(' ');

export function getAuthorizeUrl(userId: string): { authorizeUrl: string } {
  if (!userId) {
    throw new ApiError(400, 'User ID is required to generate GitHub authorize URL');
  }

  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_REDIRECT_URI) {
    throw new ApiError(500, 'GitHub OAuth is not configured on the server');
  }

  const { state } = generateSignedState(userId);

  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: env.GITHUB_REDIRECT_URI,
    scope: GITHUB_SCOPES,
    state,
  });

  return {
    authorizeUrl: `${GITHUB_AUTH_URL}?${params.toString()}`,
  };
}
export async function handleOAuthCallback(code: string, stateToken: string): Promise<string> {
  const verification = verifySignedState(stateToken);
  if (!verification.valid) {
    throw new ApiError(400, `Invalid OAuth state: ${verification.reason}`);
  }

  const { userId, nonce } = verification;

  const redisNonceKey = `gh:oauth_state:${nonce}`;
  const wasFirstConsumer = await redis.set(redisNonceKey, '1', 'EX', 600, 'NX');
  if (!wasFirstConsumer) {
    logger.warn(`Potential GitHub OAuth replay attack detected for nonce ${nonce}`);
    throw new ApiError(400, 'OAuth state already consumed (replay attack prevention)');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!user) {
    throw new ApiError(401, 'User no longer exists');
  }

  const tokenResponse = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: env.GITHUB_REDIRECT_URI,
    }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  }).catch((err) => {
    logger.error('GitHub token exchange network error:', err);
    throw new ApiError(504, 'GitHub token exchange timed out');
  });

  if (!tokenResponse.ok) {
    throw new ApiError(tokenResponse.status, 'Failed to exchange GitHub authorization code');
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_token_expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (tokenData.error || !tokenData.access_token) {
    logger.error(`GitHub token exchange error: ${tokenData.error} - ${tokenData.error_description}`);
    throw new ApiError(400, tokenData.error_description || 'GitHub OAuth authorization failed');
  }

  const userResponse = await fetch(GITHUB_USER_URL, {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Quorum-App',
    },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  }).catch((err) => {
    logger.error('GitHub user fetch network error:', err);
    throw new ApiError(504, 'GitHub user profile fetch timed out');
  });

  if (!userResponse.ok) {
    throw new ApiError(userResponse.status, 'Failed to fetch GitHub user details');
  }

  const userData = (await userResponse.json()) as {
    id: number;
    login: string;
    email?: string | null;
    avatar_url?: string;
  };

  let primaryEmail = userData.email || null;
  if (!primaryEmail) {
    try {
      const emailsRes = await fetch(GITHUB_EMAILS_URL, {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Quorum-App',
        },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });

      if (emailsRes.ok) {
        const emails = (await emailsRes.json()) as Array<{
          email: string;
          primary: boolean;
          verified: boolean;
        }>;
        const primary = emails.find((e) => e.primary && e.verified) || emails[0];
        if (primary) {
          primaryEmail = primary.email;
        }
      }
    } catch (e: any) {
      logger.warn(`Could not fetch primary email for GitHub user ${userData.login}: ${e.message}`);
    }
  }

  const encryptedAccessToken = encryptGithubToken(tokenData.access_token);
  const encryptedRefreshToken = tokenData.refresh_token
    ? encryptGithubToken(tokenData.refresh_token)
    : null;
  const tokenExpiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000)
    : null;

  await prisma.userGithubLink.upsert({
    where: { userId },
    create: {
      userId,
      githubUserId: String(userData.id),
      githubUsername: userData.login,
      githubEmail: primaryEmail,
      encryptedAccessToken,
      encryptedRefreshToken,
      tokenExpiresAt,
      scope: tokenData.scope || GITHUB_SCOPES,
    },
    update: {
      githubUserId: String(userData.id),
      githubUsername: userData.login,
      githubEmail: primaryEmail,
      encryptedAccessToken,
      encryptedRefreshToken,
      tokenExpiresAt,
      scope: tokenData.scope || GITHUB_SCOPES,
    },
  });

  logger.info(`User ${userId} successfully linked GitHub account (@${userData.login})`);

  return `${env.CLIENT_URL}/settings/integrations/github?status=success`;
}
export async function getFreshGithubAccessToken(userId: string): Promise<string> {
  const link = await prisma.userGithubLink.findUnique({
    where: { userId },
  });

  if (!link) {
    throw new ApiError(404, 'No GitHub account connected for this user');
  }

  const bufferMs = 5 * 60 * 1000;
  if (!link.tokenExpiresAt || link.tokenExpiresAt.getTime() > Date.now() + bufferMs) {
    return decryptGithubToken(link.encryptedAccessToken);
  }

  if (!link.encryptedRefreshToken) {
    return decryptGithubToken(link.encryptedAccessToken);
  }

  const lockKey = `gh_refresh_lock:${userId}`;
  const acquiredLock = await redis.set(lockKey, '1', 'EX', 10, 'NX');

  if (!acquiredLock) {
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const updated = await prisma.userGithubLink.findUnique({ where: { userId } });
      if (updated && updated.tokenExpiresAt && updated.tokenExpiresAt.getTime() > Date.now() + bufferMs) {
        return decryptGithubToken(updated.encryptedAccessToken);
      }
    }
    throw new ApiError(409, 'GitHub token refresh timed out waiting for concurrency lock');
  }

  try {
    const current = await prisma.userGithubLink.findUnique({ where: { userId } });
    if (!current) {
      throw new ApiError(404, 'GitHub connection removed');
    }

    if (current.tokenExpiresAt && current.tokenExpiresAt.getTime() > Date.now() + bufferMs) {
      return decryptGithubToken(current.encryptedAccessToken);
    }

    if (!current.encryptedRefreshToken) {
      return decryptGithubToken(current.encryptedAccessToken);
    }

    const refreshToken = decryptGithubToken(current.encryptedRefreshToken);

    const response = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    }).catch((err) => {
      logger.error('GitHub token refresh network error:', err);
      throw new ApiError(504, 'GitHub token refresh timed out');
    });

    if (response.status === 400 || response.status === 401) {
      await prisma.userGithubLink.delete({ where: { userId } }).catch(() => {});
      throw new ApiError(401, 'GitHub access token expired, please reconnect your account');
    }

    if (!response.ok) {
      throw new ApiError(response.status, 'Failed to refresh GitHub access token');
    }

    const newTokens = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };

    const encryptedAccessToken = encryptGithubToken(newTokens.access_token);
    const encryptedRefreshToken = newTokens.refresh_token
      ? encryptGithubToken(newTokens.refresh_token)
      : current.encryptedRefreshToken;
    const tokenExpiresAt = newTokens.expires_in
      ? new Date(Date.now() + newTokens.expires_in * 1000)
      : null;

    await prisma.userGithubLink.update({
      where: { userId },
      data: {
        encryptedAccessToken,
        encryptedRefreshToken,
        tokenExpiresAt,
        scope: newTokens.scope || current.scope,
      },
    });

    logger.info(`Successfully rotated GitHub tokens for user ${userId}`);
    return newTokens.access_token;
  } finally {
    await redis.del(lockKey).catch(() => {});
  }
}

export async function disconnectUser(userId: string): Promise<{ disconnected: boolean }> {
  const link = await prisma.userGithubLink.findUnique({
    where: { userId },
  });

  if (!link) {
    return { disconnected: true };
  }

  await prisma.userGithubLink.delete({
    where: { userId },
  });

  logger.info(`User ${userId} disconnected GitHub`);
  return { disconnected: true };
}

export async function getUserConnectionStatus(userId: string) {
  const link = await prisma.userGithubLink.findUnique({
    where: { userId },
    select: {
      githubUsername: true,
      githubEmail: true,
      createdAt: true,
      tokenExpiresAt: true,
    },
  });

  if (!link) {
    return { connected: false };
  }

  return {
    connected: true,
    githubUsername: link.githubUsername,
    githubEmail: link.githubEmail,
    connectedAt: link.createdAt,
    expiresAt: link.tokenExpiresAt,
  };
}
