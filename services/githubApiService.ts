import prisma from '../config/prisma.js';
import redis from '../config/redis.js';
import { ApiError } from '../utils/ApiError.js';
import { getFreshGithubAccessToken } from './githubOAuthService.js';
import logger from '../utils/logger.js';

const GITHUB_API_BASE = 'https://api.github.com';
const HTTP_TIMEOUT_MS = 10000;
const CACHE_TTL_SECONDS = 30;

async function callGithubApi<T>(
  endpoint: string,
  accessToken: string,
  options: RequestInit = {}
): Promise<T> {
  const url = endpoint.startsWith('http') ? endpoint : `${GITHUB_API_BASE}${endpoint}`;

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Quorum-App',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(options.headers || {}),
  };

  const response = await fetch(url, {
    ...options,
    headers,
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  }).catch((err) => {
    logger.error(`GitHub API call failed (${endpoint}):`, err);
    throw new ApiError(504, 'GitHub API request timed out');
  });

  if (response.status === 403 || response.status === 429) {
    const resetHeader = response.headers.get('x-ratelimit-reset');
    const resetTime = resetHeader ? new Date(parseInt(resetHeader, 10) * 1000).toLocaleTimeString() : 'shortly';
    throw new ApiError(429, `GitHub rate limit reached. Please try again after ${resetTime}.`);
  }

  if (response.status === 404) {
    throw new ApiError(404, 'Requested GitHub resource not found or access denied');
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    logger.error(`GitHub API error ${response.status} (${endpoint}): ${errorBody}`);
    throw new ApiError(response.status, `GitHub API error: ${response.statusText}`);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return (await response.json()) as T;
}

async function getEffectiveToken(userId: string, teamId: string): Promise<string> {
  try {
    return await getFreshGithubAccessToken(userId);
  } catch {
    const link = await prisma.githubRepoLink.findFirst({
      where: { teamId },
      select: { linkedById: true },
    });

    if (link?.linkedById) {
      return await getFreshGithubAccessToken(link.linkedById);
    }

    throw new ApiError(401, 'Please connect your GitHub account to perform this action');
  }
}

async function assertTeamAccess(userId: string, teamId: string): Promise<void> {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true, organizationId: true },
  });

  if (!team) {
    throw new ApiError(404, 'Team not found');
  }

  const isMember = await prisma.teamMember.findUnique({
    where: {
      teamId_userId: { teamId, userId },
    },
  });

  if (isMember) return;

  const isOrgAdmin = await prisma.organizationMember.findFirst({
    where: {
      organizationId: team.organizationId,
      userId,
      role: 'ORG_ADMIN',
    },
  });

  if (!isOrgAdmin) {
    throw new ApiError(403, 'You must be a team member or Org Admin to access this team');
  }
}


export async function getUserRepositories(userId: string, page = 1, perPage = 30) {
  const token = await getFreshGithubAccessToken(userId);
  const safePerPage = Math.min(Math.max(perPage, 1), 100);

  return await callGithubApi<any[]>(
    `/user/repos?sort=updated&per_page=${safePerPage}&page=${page}`,
    token
  );
}

export async function linkTeamRepository(
  userId: string,
  teamId: string,
  repoFullName: string
) {
  await assertTeamAccess(userId, teamId);
  const token = await getFreshGithubAccessToken(userId);

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true, organizationId: true },
  });

  if (!team) {
    throw new ApiError(404, 'Team not found');
  }

  const repo = await callGithubApi<any>(`/repos/${repoFullName}`, token);

  if (!repo.permissions || (!repo.permissions.admin && !repo.permissions.push)) {
    throw new ApiError(403, 'You do not have administrative or push access to link this GitHub repository');
  }

  const repoLink = await prisma.githubRepoLink.upsert({
    where: {
      teamId_repoFullName: {
        teamId,
        repoFullName: repo.full_name,
      },
    },
    create: {
      teamId,
      repoId: String(repo.id),
      repoFullName: repo.full_name,
      repoOwner: repo.owner.login,
      repoName: repo.name,
      defaultBranch: repo.default_branch || 'main',
      isPrivate: repo.private,
      linkedById: userId,
    },
    update: {
      repoId: String(repo.id),
      defaultBranch: repo.default_branch || 'main',
      isPrivate: repo.private,
      linkedById: userId,
    },
  });

  logger.info(`User ${userId} linked repository ${repo.full_name} to team ${teamId}`);
  return repoLink;
}

export async function getTeamRepository(teamId: string) {
  const link = await prisma.githubRepoLink.findFirst({
    where: { teamId },
    include: {
      linkedBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  if (!link) {
    return { linked: false };
  }

  return {
    linked: true,
    repository: link,
  };
}

export async function unlinkTeamRepository(userId: string, teamId: string, repoFullName: string) {
  await assertTeamAccess(userId, teamId);
  const existing = await prisma.githubRepoLink.findUnique({
    where: {
      teamId_repoFullName: {
        teamId,
        repoFullName,
      },
    },
  });

  if (!existing) {
    throw new ApiError(404, 'Repository is not linked to this team');
  }

  await prisma.githubRepoLink.delete({
    where: {
      teamId_repoFullName: {
        teamId,
        repoFullName,
      },
    },
  });

  const cachePattern = `gh:cache:${teamId}:*`;
  const keys = await redis.keys(cachePattern).catch(() => []);
  if (keys.length > 0) {
    await redis.del(...keys).catch(() => { });
  }

  logger.info(`User ${userId} unlinked repository ${repoFullName} from team ${teamId}`);
  return { unlinked: true };
}

export async function getTeamIssues(
  userId: string,
  teamId: string,
  options: { state?: 'open' | 'closed' | 'all'; page?: number; perPage?: number } = {}
) {
  await assertTeamAccess(userId, teamId);
  const { state = 'open', page = 1, perPage = 20 } = options;
  const safePerPage = Math.min(Math.max(perPage, 1), 100);

  const repoLink = await prisma.githubRepoLink.findFirst({ where: { teamId } });
  if (!repoLink) {
    throw new ApiError(404, 'No GitHub repository is linked to this team');
  }

  const cacheKey = `gh:cache:${teamId}:issues:${state}:${page}:${safePerPage}`;
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) {
    return JSON.parse(cached);
  }

  const token = await getEffectiveToken(userId, teamId);
  const issues = await callGithubApi<any[]>(
    `/repos/${repoLink.repoFullName}/issues?state=${state}&page=${page}&per_page=${safePerPage}`,
    token
  );

  const pureIssues = issues.filter((item) => !item.pull_request);

  await redis.set(cacheKey, JSON.stringify(pureIssues), 'EX', CACHE_TTL_SECONDS).catch(() => { });
  return pureIssues;
}

export async function createTeamIssue(
  userId: string,
  teamId: string,
  data: { title: string; body?: string; assignees?: string[]; labels?: string[] }
) {
  await assertTeamAccess(userId, teamId);
  if (!data.title || !data.title.trim()) {
    throw new ApiError(400, 'Issue title is required');
  }

  const repoLink = await prisma.githubRepoLink.findFirst({ where: { teamId } });
  if (!repoLink) {
    throw new ApiError(404, 'No GitHub repository is linked to this team');
  }

  const token = await getFreshGithubAccessToken(userId);

  const issue = await callGithubApi<any>(
    `/repos/${repoLink.repoFullName}/issues`,
    token,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: data.title.trim(),
        body: data.body || '',
        assignees: data.assignees || [],
        labels: data.labels || [],
      }),
    }
  );

  const keys = await redis.keys(`gh:cache:${teamId}:issues:*`).catch(() => []);
  if (keys.length > 0) {
    await redis.del(...keys).catch(() => { });
  }

  logger.info(`User ${userId} created issue #${issue.number} in ${repoLink.repoFullName}`);
  return issue;
}

export async function updateTeamIssueStatus(
  userId: string,
  teamId: string,
  issueNumber: number,
  state: 'open' | 'closed'
) {
  await assertTeamAccess(userId, teamId);
  const repoLink = await prisma.githubRepoLink.findFirst({ where: { teamId } });
  if (!repoLink) {
    throw new ApiError(404, 'No GitHub repository is linked to this team');
  }

  const token = await getFreshGithubAccessToken(userId);

  const updated = await callGithubApi<any>(
    `/repos/${repoLink.repoFullName}/issues/${issueNumber}`,
    token,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    }
  );

  const keys = await redis.keys(`gh:cache:${teamId}:issues:*`).catch(() => []);
  if (keys.length > 0) {
    await redis.del(...keys).catch(() => { });
  }

  return updated;
}

export async function getTeamPullRequests(
  userId: string,
  teamId: string,
  options: { state?: 'open' | 'closed' | 'all'; page?: number; perPage?: number } = {}
) {
  await assertTeamAccess(userId, teamId);
  const { state = 'open', page = 1, perPage = 20 } = options;
  const safePerPage = Math.min(Math.max(perPage, 1), 100);

  const repoLink = await prisma.githubRepoLink.findFirst({ where: { teamId } });
  if (!repoLink) {
    throw new ApiError(404, 'No GitHub repository is linked to this team');
  }

  const cacheKey = `gh:cache:${teamId}:pulls:${state}:${page}:${safePerPage}`;
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) {
    return JSON.parse(cached);
  }

  const token = await getEffectiveToken(userId, teamId);
  const pulls = await callGithubApi<any[]>(
    `/repos/${repoLink.repoFullName}/pulls?state=${state}&page=${page}&per_page=${safePerPage}`,
    token
  );

  await redis.set(cacheKey, JSON.stringify(pulls), 'EX', CACHE_TTL_SECONDS).catch(() => { });
  return pulls;
}

export async function getTeamCommits(
  userId: string,
  teamId: string,
  options: { branch?: string; page?: number; perPage?: number } = {}
) {
  await assertTeamAccess(userId, teamId);
  const { branch, page = 1, perPage = 20 } = options;
  const safePerPage = Math.min(Math.max(perPage, 1), 100);

  const repoLink = await prisma.githubRepoLink.findFirst({ where: { teamId } });
  if (!repoLink) {
    throw new ApiError(404, 'No GitHub repository is linked to this team');
  }

  const branchParam = branch ? `&sha=${encodeURIComponent(branch)}` : '';
  const cacheKey = `gh:cache:${teamId}:commits:${branch || 'default'}:${page}:${safePerPage}`;
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) {
    return JSON.parse(cached);
  }

  const token = await getEffectiveToken(userId, teamId);
  const commits = await callGithubApi<any[]>(
    `/repos/${repoLink.repoFullName}/commits?page=${page}&per_page=${safePerPage}${branchParam}`,
    token
  );

  await redis.set(cacheKey, JSON.stringify(commits), 'EX', CACHE_TTL_SECONDS).catch(() => { });
  return commits;
}

export async function getTeamBranches(userId: string, teamId: string) {
  await assertTeamAccess(userId, teamId);
  const repoLink = await prisma.githubRepoLink.findFirst({ where: { teamId } });
  if (!repoLink) {
    throw new ApiError(404, 'No GitHub repository is linked to this team');
  }

  const cacheKey = `gh:cache:${teamId}:branches`;
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) {
    return JSON.parse(cached);
  }

  const token = await getEffectiveToken(userId, teamId);
  const branches = await callGithubApi<any[]>(
    `/repos/${repoLink.repoFullName}/branches?per_page=100`,
    token
  );

  await redis.set(cacheKey, JSON.stringify(branches), 'EX', CACHE_TTL_SECONDS).catch(() => { });
  return branches;
}

export async function getTeamCollaborators(userId: string, teamId: string) {
  await assertTeamAccess(userId, teamId);
  const repoLink = await prisma.githubRepoLink.findFirst({ where: { teamId } });
  if (!repoLink) {
    throw new ApiError(404, 'No GitHub repository is linked to this team');
  }

  const token = await getEffectiveToken(userId, teamId);
  return await callGithubApi<any[]>(
    `/repos/${repoLink.repoFullName}/collaborators?per_page=100`,
    token
  );
}
