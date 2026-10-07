import { Request, Response, NextFunction } from 'express';
import { getConversationMessages } from '../services/chatService.js';
import { ApiError } from '../utils/ApiError.js';

export const getConversationMessagesController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const rawId = req.params.id;
    const conversationId = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!conversationId) {
      throw new ApiError(400, 'conversationId is required');
    }

    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 20;

    const result = await getConversationMessages(userId, conversationId, cursor, limit);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};
