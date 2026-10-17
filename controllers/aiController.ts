import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/ApiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import {
  askAiAssistant,
  searchWorkspaceWithAi,
  getProjectAssistance,
  generateQuickResponses,
  generateProjectStatusUpdate
} from '../services/aiChatService.js';
import { summarizeConversationChat } from '../services/aiSummaryService.js';

export const chatController = asyncHandler(async (req: Request, res: Response) => {
  const { prompt, context } = req.body;
  const result = await askAiAssistant(prompt, context);
  return sendSuccess(res, 200, 'AI response generated successfully', result);
});

export const summarizeChatController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const conversationId = String(req.params.conversationId);
  const { limit, focus } = req.body || {};

  const result = await summarizeConversationChat(userId, conversationId, {
    limit: limit ? Number(limit) : undefined,
    focus: typeof focus === 'string' ? focus : undefined
  });

  return sendSuccess(res, 200, 'Conversation summarized successfully', result);
});

export const searchWorkspaceController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const { query, limit } = req.body;
  const result = await searchWorkspaceWithAi(userId, query, {
    limit: limit ? Number(limit) : undefined
  });

  return sendSuccess(res, 200, 'Workspace search completed successfully', result);
});

export const projectAssistanceController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const { prompt, organizationId, teamId, communityId } = req.body;
  const result = await getProjectAssistance(userId, prompt, {
    organizationId,
    teamId,
    communityId
  });

  return sendSuccess(res, 200, 'Project assistance generated successfully', result);
});

export const quickRepliesController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const { mode, message, conversationId, tone } = req.body;
  const result = await generateQuickResponses(userId, {
    mode,
    message,
    conversationId,
    tone
  });

  return sendSuccess(res, 200, 'Quick response suggestions generated successfully', result);
});

export const projectUpdateController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const { organizationId, teamId, communityId, timeframe } = req.body;
  const result = await generateProjectStatusUpdate(userId, {
    organizationId,
    teamId,
    communityId,
    timeframe
  });

  return sendSuccess(res, 200, 'Project update generated successfully', result);
});
