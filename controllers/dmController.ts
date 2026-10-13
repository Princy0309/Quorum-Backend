import { Request, Response, NextFunction } from 'express';
import { getOrCreateDirectConversation } from '../services/chatService.js';
import { ApiError } from '../utils/ApiError.js';

export const createOrGetDMController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const { targetUserId } = req.body;
    if (!targetUserId || typeof targetUserId !== 'string') {
      throw new ApiError(400, 'targetUserId string is required');
    }

    const conversation = await getOrCreateDirectConversation(userId, targetUserId);
    res.status(200).json({
      success: true,
      data: conversation
    });
  } catch (err) {
    next(err);
  }
};
