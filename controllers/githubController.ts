import { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/ApiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import env from '../config/env.js';
import logger from '../utils/logger.js';
import {
  getAuthorizeUrl,
  handleOAuthCallback,
  disconnectUser,
  getUserConnectionStatus,
} from '../services/githubOAuthService.js';
import {
  getUserRepositories,
  linkTeamRepository,
  getTeamRepository,
  unlinkTeamRepository,
  getTeamIssues,
  createTeamIssue,
  updateTeamIssueStatus,
  getTeamPullRequests,
  getTeamCommits,
  getTeamBranches,
  getTeamCollaborators,
} from '../services/githubApiService.js';

const callbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

export const getAuthorizeUrlController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const result = getAuthorizeUrl(userId);
  return sendSuccess(res, 200, 'GitHub authorize URL generated', result);
});

export const handleOAuthCallbackController = asyncHandler(async (req: Request, res: Response) => {
  const parsed = callbackQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    const errorUrl = `${env.CLIENT_URL}/settings/integrations/github?status=error&message=${encodeURIComponent('Invalid callback query parameters')}`;
    return res.redirect(errorUrl);
  }

  const { code, state, error, error_description } = parsed.data;

  if (error) {
    const message = error_description || error;
    const errorUrl = `${env.CLIENT_URL}/settings/integrations/github?status=error&message=${encodeURIComponent(message)}`;
    return res.redirect(errorUrl);
  }

  if (!code || !state) {
    const errorUrl = `${env.CLIENT_URL}/settings/integrations/github?status=error&message=${encodeURIComponent('Missing code or state')}`;
    return res.redirect(errorUrl);
  }

  try {
    const redirectUrl = await handleOAuthCallback(code, state);
    return res.redirect(redirectUrl);
  } catch (err: any) {
    logger.error(`GitHub OAuth callback failed: ${err.message}`);
    const safeMessage = err instanceof ApiError ? err.message : 'GitHub connection failed. Please try again.';
    const errorUrl = `${env.CLIENT_URL}/settings/integrations/github?status=error&message=${encodeURIComponent(safeMessage)}`;
    return res.redirect(errorUrl);
  }
});

export const getGithubStatusController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const status = await getUserConnectionStatus(userId);
  return sendSuccess(res, 200, 'GitHub status retrieved', status);
});

export const disconnectGithubController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const result = await disconnectUser(userId);
  return sendSuccess(res, 200, 'GitHub account disconnected successfully', result);
});

export const getUserRepositoriesController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const page = parseInt(req.query.page as string, 10) || 1;
  const perPage = parseInt(req.query.per_page as string, 10) || 30;

  const repos = await getUserRepositories(userId, page, perPage);
  return sendSuccess(res, 200, 'Repositories fetched successfully', repos);
});

export const linkTeamRepoController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const teamId = req.params.teamId as string;
  const { repoFullName } = req.body;

  if (!repoFullName || typeof repoFullName !== 'string') {
    throw new ApiError(400, 'repoFullName (e.g. owner/repo) is required');
  }

  const linked = await linkTeamRepository(userId, teamId, repoFullName.trim());
  return sendSuccess(res, 201, 'Repository linked to team successfully', linked);
});

export const getTeamRepoController = asyncHandler(async (req: Request, res: Response) => {
  const teamId = req.params.teamId as string;
  const repo = await getTeamRepository(teamId);
  return sendSuccess(res, 200, 'Team repository details retrieved', repo);
});

export const unlinkTeamRepoController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const teamId = req.params.teamId as string;
  const repoFullName = (req.body.repoFullName || req.query.repoFullName) as string;

  if (!repoFullName) {
    throw new ApiError(400, 'repoFullName is required to unlink repository');
  }

  const result = await unlinkTeamRepository(userId, teamId, repoFullName);
  return sendSuccess(res, 200, 'Repository unlinked successfully', result);
});

export const getTeamIssuesController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const teamId = req.params.teamId as string;
  const state = (req.query.state as 'open' | 'closed' | 'all') || 'open';
  const page = parseInt(req.query.page as string, 10) || 1;
  const perPage = parseInt(req.query.per_page as string, 10) || 20;

  const issues = await getTeamIssues(userId, teamId, { state, page, perPage });
  return sendSuccess(res, 200, 'Team issues retrieved', issues);
});

export const createTeamIssueController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const teamId = req.params.teamId as string;
  const { title, body, assignees, labels } = req.body;

  const issue = await createTeamIssue(userId, teamId, { title, body, assignees, labels });
  return sendSuccess(res, 201, 'Issue created successfully', issue);
});

export const updateTeamIssueStatusController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const teamId = req.params.teamId as string;
  const issueNumber = parseInt(req.params.issueNumber as string, 10);
  const { state } = req.body;

  if (state !== 'open' && state !== 'closed') {
    throw new ApiError(400, 'State must be either "open" or "closed"');
  }

  const updated = await updateTeamIssueStatus(userId, teamId, issueNumber, state);
  return sendSuccess(res, 200, 'Issue status updated successfully', updated);
});

export const getTeamPullRequestsController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const teamId = req.params.teamId as string;
  const state = (req.query.state as 'open' | 'closed' | 'all') || 'open';
  const page = parseInt(req.query.page as string, 10) || 1;
  const perPage = parseInt(req.query.per_page as string, 10) || 20;

  const pulls = await getTeamPullRequests(userId, teamId, { state, page, perPage });
  return sendSuccess(res, 200, 'Team pull requests retrieved', pulls);
});

export const getTeamCommitsController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const teamId = req.params.teamId as string;
  const branch = req.query.branch as string | undefined;
  const page = parseInt(req.query.page as string, 10) || 1;
  const perPage = parseInt(req.query.per_page as string, 10) || 20;

  const commits = await getTeamCommits(userId, teamId, { branch, page, perPage });
  return sendSuccess(res, 200, 'Team commits retrieved', commits);
});

export const getTeamBranchesController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const teamId = req.params.teamId as string;
  const branches = await getTeamBranches(userId, teamId);
  return sendSuccess(res, 200, 'Team branches retrieved', branches);
});

export const getTeamCollaboratorsController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const teamId = req.params.teamId as string;
  const collaborators = await getTeamCollaborators(userId, teamId);
  return sendSuccess(res, 200, 'Team collaborators retrieved', collaborators);
});
