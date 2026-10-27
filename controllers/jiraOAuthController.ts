import { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/ApiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import {
  getAuthorizeUrl,
  handleOAuthCallback,
  disconnectUser,
  getJiraStatus,
} from '../services/jiraOAuthService.js';
import env from '../config/env.js';

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
  return sendSuccess(res, 200, 'Jira authorize URL generated', result);
});

export const handleOAuthCallbackController = asyncHandler(async (req: Request, res: Response) => {
  const parsed = callbackQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    const errorUrl = `${env.CLIENT_URL}/settings/integrations/jira?status=error&message=${encodeURIComponent('Invalid callback query parameters')}`;
    return res.redirect(errorUrl);
  }

  const { code, state, error, error_description } = parsed.data;

  if (error) {
    const message = error_description || error;
    const errorUrl = `${env.CLIENT_URL}/settings/integrations/jira?status=error&message=${encodeURIComponent(message)}`;
    return res.redirect(errorUrl);
  }

  if (!code || !state) {
    const errorUrl = `${env.CLIENT_URL}/settings/integrations/jira?status=error&message=${encodeURIComponent('Missing code or state')}`;
    return res.redirect(errorUrl);
  }

  try {
    const redirectUrl = await handleOAuthCallback(code, state);
    return res.redirect(redirectUrl);
  } catch (err: any) {
    const errorUrl = `${env.CLIENT_URL}/settings/integrations/jira?status=error&message=${encodeURIComponent(err.message || 'OAuth connection failed')}`;
    return res.redirect(errorUrl);
  }
});

export const disconnectJiraController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const result = await disconnectUser(userId);
  return sendSuccess(res, 200, 'Jira disconnected successfully', result);
});

export const getJiraStatusController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const result = await getJiraStatus(userId);
  return sendSuccess(res, 200, 'Jira status retrieved', result);
});
