import { Request, Response, NextFunction } from 'express';
import {
  getConversationMessages,
  getUserConversations,
  searchConversationMessages,
  createGroupConversation,
  addGroupParticipants,
  removeGroupParticipant,
  updateGroupConversation,
  transferGroupOwnership
} from '../services/chatService.js';
import { ApiError } from '../utils/ApiError.js';

const parseAndValidatePagination = (
  rawCursor: unknown,
  rawLimit: unknown
): { cursor?: string; limit: number } => {
  let cursor: string | undefined;
  if (rawCursor !== undefined) {
    if (typeof rawCursor !== 'string' || rawCursor.trim().length === 0 || rawCursor.length > 100) {
      throw new ApiError(400, 'Invalid cursor parameter');
    }
    cursor = rawCursor.trim();
  }

  let limit = 20;
  if (rawLimit !== undefined) {
    if (typeof rawLimit !== 'string' || !/^\d+$/.test(rawLimit.trim())) {
      throw new ApiError(400, 'Limit must be an integer between 1 and 50');
    }
    const parsed = parseInt(rawLimit.trim(), 10);
    if (parsed < 1 || parsed > 50) {
      throw new ApiError(400, 'Limit must be an integer between 1 and 50');
    }
    limit = parsed;
  }

  return { cursor, limit };
};

export const getUserConversationsController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const conversations = await getUserConversations(userId);
    res.status(200).json({
      success: true,
      data: conversations
    });
  } catch (err) {
    next(err);
  }
};

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

    const { cursor, limit } = parseAndValidatePagination(req.query.cursor, req.query.limit);

    const result = await getConversationMessages(userId, conversationId, cursor, limit);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const searchConversationMessagesController = async (req: Request, res: Response, next: NextFunction) => {
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

    const rawQ = req.query.q;
    if (typeof rawQ !== 'string' || rawQ.trim().length === 0) {
      throw new ApiError(400, 'Search query is required');
    }
    if (rawQ.length > 500) {
      throw new ApiError(400, 'Search query must not exceed 500 characters');
    }
    const q = rawQ.trim();

    const { cursor, limit } = parseAndValidatePagination(req.query.cursor, req.query.limit);

    const result = await searchConversationMessages(userId, conversationId, q, cursor, limit);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const createGroupConversationController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const { name, participantIds, avatar } = req.body;
    const conversation = await createGroupConversation(userId, name, participantIds, avatar);

    res.status(201).json({
      success: true,
      data: conversation
    });
  } catch (err) {
    next(err);
  }
};

export const addGroupParticipantsController = async (req: Request, res: Response, next: NextFunction) => {
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

    const { participantIds } = req.body;
    const conversation = await addGroupParticipants(userId, conversationId, participantIds);

    res.status(200).json({
      success: true,
      data: conversation
    });
  } catch (err) {
    next(err);
  }
};

export const removeGroupParticipantController = async (req: Request, res: Response, next: NextFunction) => {
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

    const rawTargetUserId = req.params.userId;
    const targetUserId = Array.isArray(rawTargetUserId) ? rawTargetUserId[0] : rawTargetUserId;
    if (!targetUserId) {
      throw new ApiError(400, 'targetUserId is required');
    }

    const result = await removeGroupParticipant(userId, conversationId, targetUserId);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const updateGroupConversationController = async (req: Request, res: Response, next: NextFunction) => {
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

    const { name, avatar } = req.body;
    const conversation = await updateGroupConversation(userId, conversationId, { name, avatar });

    res.status(200).json({
      success: true,
      data: conversation
    });
  } catch (err) {
    next(err);
  }
};

export const transferGroupOwnershipController = async (req: Request, res: Response, next: NextFunction) => {
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

    const { newOwnerId } = req.body;
    if (!newOwnerId || typeof newOwnerId !== 'string') {
      throw new ApiError(400, 'newOwnerId is required');
    }

    const conversation = await transferGroupOwnership(userId, conversationId, newOwnerId.trim());

    res.status(200).json({
      success: true,
      data: conversation
    });
  } catch (err) {
    next(err);
  }
};

