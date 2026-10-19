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
import {
  recordAiInteraction,
  getUserAiHistory,
  deleteUserAiHistory
} from '../services/aiHistoryService.js';

export const chatController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { prompt, context } = req.body;
  const result = await askAiAssistant(prompt, context);

  if (userId) {
    await recordAiInteraction(userId, {
      prompt,
      response: result.answer,
      actionType: 'chat',
      model: result.metadata?.model,
      tokensUsed: result.metadata?.tokenUsage?.totalTokenCount
    });
  }

  return sendSuccess(res, 200, 'AI response generated successfully', result);
});

export const summarizeChatController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const conversationId = String(req.params.conversationId || req.body?.conversationId || '').trim();
  if (!conversationId) {
    throw new ApiError(400, 'conversationId is required in route params or request body');
  }
  const { limit, focus } = req.body || {};

  const result = await summarizeConversationChat(userId, conversationId, {
    limit: limit ? Number(limit) : undefined,
    focus: typeof focus === 'string' ? focus : undefined
  });

  await recordAiInteraction(userId, {
    prompt: `Summarize conversation: ${conversationId}${focus ? ` (focus: ${focus})` : ''}`,
    response: result.summary,
    actionType: 'summary',
    conversationId,
    model: result.metadata?.model,
    tokensUsed: result.metadata?.tokenUsage?.totalTokenCount
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

  await recordAiInteraction(userId, {
    prompt: `Workspace search: ${query}`,
    response: result.answer,
    actionType: 'search',
    model: result.metadata?.model,
    tokensUsed: result.metadata?.tokenUsage?.totalTokenCount
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

  await recordAiInteraction(userId, {
    prompt,
    response: result.answer,
    actionType: 'project_assistance',
    model: result.metadata?.model,
    tokensUsed: result.metadata?.tokenUsage?.totalTokenCount
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

  await recordAiInteraction(userId, {
    prompt: `Quick ${mode}: ${message || conversationId}`,
    response: result.suggestions.join('\n'),
    actionType: 'quick_replies',
    conversationId,
    model: result.metadata?.model,
    tokensUsed: result.metadata?.tokenUsage?.totalTokenCount
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

  await recordAiInteraction(userId, {
    prompt: `Project update (${timeframe}): ${organizationId || teamId || communityId || 'user projects'}`,
    response: result.statusUpdate,
    actionType: 'project_update',
    model: result.metadata?.model,
    tokensUsed: result.metadata?.tokenUsage?.totalTokenCount
  });

  return sendSuccess(res, 200, 'Project update generated successfully', result);
});

export const getHistoryController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const { limit, cursor, actionType, conversationId } = req.query;
  const result = await getUserAiHistory(userId, {
    limit: limit ? Number(limit) : undefined,
    cursor: typeof cursor === 'string' ? cursor : undefined,
    actionType: typeof actionType === 'string' ? actionType : undefined,
    conversationId: typeof conversationId === 'string' ? conversationId : undefined
  });

  return sendSuccess(res, 200, 'AI assistant history retrieved successfully', result);
});

export const deleteHistoryController = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }

  const rawId = req.params.id || req.query.id;
  const interactionId = typeof rawId === 'string' ? rawId : undefined;
  const result = await deleteUserAiHistory(userId, interactionId);

  return sendSuccess(res, 200, 'AI assistant history deleted successfully', result);
});
