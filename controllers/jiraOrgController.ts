import { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/ApiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import {
  setupOrgJiraIntegration,
  getOrgJiraIntegration,
  disconnectOrgJiraIntegration,
} from '../services/jiraOrgService.js';

const setupOrgJiraSchema = z.object({
  projectKey: z.string().min(1, 'projectKey is required (e.g. "DEV")'),
});

export const setupOrgJiraController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  // Support both /:id and /:organizationId route parameter styles
  const organizationId = (req.params.id || req.params.organizationId) as string;
  if (!organizationId) {
    throw new ApiError(400, 'Organization ID is required in URL parameters');
  }

  const parsed = setupOrgJiraSchema.safeParse(req.body);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues.map((i) => i.message).join(', ');
    throw new ApiError(400, errorMsg);
  }

  const result = await setupOrgJiraIntegration(userId, organizationId, parsed.data.projectKey);
  return sendSuccess(res, 200, 'Organization Jira integration configured successfully', result);
});

export const getOrgJiraStatusController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  // Support both /:id and /:organizationId route parameter styles
  const organizationId = (req.params.id || req.params.organizationId) as string;
  if (!organizationId) {
    throw new ApiError(400, 'Organization ID is required in URL parameters');
  }

  const result = await getOrgJiraIntegration(userId, organizationId);
  return sendSuccess(res, 200, 'Organization Jira integration status retrieved', result);
});

export const disconnectOrgJiraController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  // Support both /:id and /:organizationId route parameter styles
  const organizationId = (req.params.id || req.params.organizationId) as string;
  if (!organizationId) {
    throw new ApiError(400, 'Organization ID is required in URL parameters');
  }

  const result = await disconnectOrgJiraIntegration(userId, organizationId);
  return sendSuccess(res, 200, 'Organization Jira integration disconnected successfully', result);
});
