import { Request, Response, NextFunction } from 'express';
import { getOrCreateDirectConversation } from '../services/chatService.js';
import { ApiError } from '../utils/ApiError.js';

export const createOrGetDMController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const rawTarget =
      req.body?.targetUserId ||
      req.body?.userId ||
      req.body?.recipientId ||
      req.body?.participantId ||
      req.params?.targetUserId ||
      req.params?.userId ||
      req.params?.id;

    if (!rawTarget || typeof rawTarget !== 'string' || rawTarget.trim().length === 0) {
      throw new ApiError(400, 'targetUserId string is required');
    }

    const targetUserId = rawTarget.trim();
    const conversation = await getOrCreateDirectConversation(userId, targetUserId);
    res.status(200).json({
      success: true,
      data: conversation,
      conversation
    });
  } catch (err) {
    next(err);
  }
};
