import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/ApiResponse.js';
import { askAiAssistant } from '../services/aiChatService.js';

export const chatController = asyncHandler(async (req: Request, res: Response) => {
  const { prompt, context } = req.body;
  const result = await askAiAssistant(prompt, context);
  return sendSuccess(res, 200, 'AI response generated successfully', result);
});
