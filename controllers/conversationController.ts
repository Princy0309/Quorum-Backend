import { Request, Response, NextFunction } from 'express';
import {
  getConversationMessages,
  getUserConversations,
  searchConversationMessages,
  createGroupConversation,
  addGroupParticipants,
  removeGroupParticipant,
  updateGroupConversation,
  getConversationById,
  makeGroupAdmin,
  dismissGroupAdmin,
  editMessage,
  deleteMessage
} from '../services/chatService.js';
import { getMultipleUserPresences } from '../services/presenceService.js';
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

    const rawQuery = req.query.q ?? req.query.search ?? req.query.query;
    const query = typeof rawQuery === 'string' ? rawQuery.trim() : undefined;

    const conversations = await getUserConversations(userId, query);
    res.status(200).json({
      success: true,
      data: conversations,
      conversations: conversations
    });
  } catch (err) {
    next(err);
  }
};

export const getUnreadConversationsCountController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const conversations = await getUserConversations(userId);
    const unreadCount = conversations.reduce((acc: number, conv: any) => acc + (conv.unreadCount || 0), 0);

    res.status(200).json({
      success: true,
      data: { unreadCount },
      unreadCount
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

    const { name, avatar } = req.body;
    const participantIds = req.body.participantIds || req.body.userIds || req.body.members || req.body.memberIds || [];
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

    const participantIds = req.body.participantIds || req.body.userIds || req.body.members || req.body.memberIds || [];
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

    const actualTargetUserId = targetUserId.trim().toLowerCase() === 'me' ? userId : targetUserId.trim();
    const result = await removeGroupParticipant(userId, conversationId, actualTargetUserId);

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

export const leaveGroupConversationController = async (req: Request, res: Response, next: NextFunction) => {
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

    const result = await removeGroupParticipant(userId, conversationId, userId);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const getConversationDetailsController = async (req: Request, res: Response, next: NextFunction) => {
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

    const conversation = await getConversationById(userId, conversationId);
    res.status(200).json({
      success: true,
      data: conversation,
      conversation
    });
  } catch (err) {
    next(err);
  }
};

export const makeGroupAdminController = async (req: Request, res: Response, next: NextFunction) => {
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
    const targetUserId = req.params.userId || req.body?.userId || req.body?.memberId || req.body?.targetUserId;

    if (!targetUserId || typeof targetUserId !== 'string') {
      throw new ApiError(400, 'userId is required');
    }

    const conversation = await makeGroupAdmin(userId, conversationId, targetUserId.trim());
    res.status(200).json({
      success: true,
      data: conversation
    });
  } catch (err) {
    next(err);
  }
};

export const dismissGroupAdminController = async (req: Request, res: Response, next: NextFunction) => {
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
    const targetUserId = req.params.userId || req.body?.userId || req.body?.memberId || req.body?.targetUserId;

    if (!targetUserId || typeof targetUserId !== 'string') {
      throw new ApiError(400, 'userId is required');
    }

    const conversation = await dismissGroupAdmin(userId, conversationId, targetUserId.trim());
    res.status(200).json({
      success: true,
      data: conversation
    });
  } catch (err) {
    next(err);
  }
};

export const editMessageController = async (req: Request, res: Response, next: NextFunction) => {
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

    const rawMsgId = req.params.messageId;
    const messageId = Array.isArray(rawMsgId) ? rawMsgId[0] : rawMsgId;
    if (!messageId) {
      throw new ApiError(400, 'messageId is required');
    }

    const { content } = req.body;
    const updated = await editMessage(userId, conversationId, messageId, content);

    res.status(200).json({
      success: true,
      data: updated
    });
  } catch (err) {
    next(err);
  }
};

export const deleteMessageController = async (req: Request, res: Response, next: NextFunction) => {
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

    const rawMsgId = req.params.messageId;
    const messageId = Array.isArray(rawMsgId) ? rawMsgId[0] : rawMsgId;
    if (!messageId) {
      throw new ApiError(400, 'messageId is required');
    }

    const result = await deleteMessage(userId, conversationId, messageId);

    res.status(200).json({
      success: true,
      message: 'Message deleted successfully',
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const getConversationPresenceController = async (req: Request, res: Response, next: NextFunction) => {
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

    const conversation = await getConversationById(userId, conversationId);
    const participantUserIds = conversation.participants
      .map((p) => p.userId)
      .filter((id) => id !== userId);

    const presenceMap = await getMultipleUserPresences(participantUserIds);
    const presencesObj: Record<string, { isOnline: boolean; lastSeen: Date | null }> = {};

    presenceMap.forEach((val, pUserId) => {
      presencesObj[pUserId] = {
        isOnline: val.isOnline,
        lastSeen: val.lastSeen || null
      };
    });

    res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Conversation presence retrieved successfully',
      data: {
        conversationId: conversation.id,
        presences: presencesObj
      }
    });
  } catch (err) {
    next(err);
  }
};
