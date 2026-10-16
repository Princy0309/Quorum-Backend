import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/ApiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { askAiAssistant } from '../services/aiChatService.js';
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
