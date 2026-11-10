import { Request, Response, NextFunction } from 'express';
import {
  getConversationMessages,
  getUserConversations,
  searchConversationMessages,
  createGroupConversation,
  addGroupParticipants,
  removeGroupParticipant,
  updateGroupConversation,
  getGroupProfilePicture,
  updateGroupProfilePicture,
  deleteGroupProfilePicture,
  getConversationById,
  makeGroupAdmin,
  dismissGroupAdmin,
  editMessage,
  deleteMessage,
  toggleMessageReaction,
  getMessageReactions,
  forwardMessages,
  saveMessage,
  votePoll,
  pinMessage,
  unpinMessage,
  getPinnedMessages
} from '../services/chatService.js';
import { getMultipleUserPresences } from '../services/presenceService.js';
import { ApiError } from '../utils/ApiError.js';
import { getIO } from '../sockets/socketServer.js';
import { CHAT_EVENTS } from '../utils/constants.js';
import logger from '../utils/logger.js';

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

    const uploadedFile = (req.files && Array.isArray(req.files) && req.files.length > 0)
      ? req.files[0]
      : ((req as any).file || undefined);

    let avatar = req.body?.avatar || req.body?.profilePicture;
    if (uploadedFile) {
      const isImage = (uploadedFile.mimetype && uploadedFile.mimetype.startsWith('image/')) ||
        /\.(jpg|jpeg|png|gif|webp|svg|heic|avif)$/i.test(uploadedFile.originalname || '');
      if (!isImage) {
        throw new ApiError(400, 'Profile picture must be an image file');
      }
      const picResult = await updateGroupProfilePicture(userId, conversationId, {}, uploadedFile);
      avatar = picResult.avatar;
    }

    const { name } = req.body;
    const conversation = await updateGroupConversation(userId, conversationId, {
      name,
      ...(avatar !== undefined ? { avatar, profilePicture: avatar } : {})
    });

    res.status(200).json({
      success: true,
      data: conversation
    });
  } catch (err) {
    next(err);
  }
};

export const getGroupProfilePictureController = async (req: Request, res: Response, next: NextFunction) => {
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

    const result = await getGroupProfilePicture(userId, conversationId);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const updateGroupProfilePictureController = async (req: Request, res: Response, next: NextFunction) => {
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

    const uploadedFile = (req.files && Array.isArray(req.files) && req.files.length > 0)
      ? req.files[0]
      : ((req as any).file || undefined);

    if (uploadedFile) {
      const isImage = (uploadedFile.mimetype && uploadedFile.mimetype.startsWith('image/')) ||
        /\.(jpg|jpeg|png|gif|webp|svg|heic|avif)$/i.test(uploadedFile.originalname || '');
      if (!isImage) {
        throw new ApiError(400, 'Profile picture must be an image file');
      }
    }

    const { avatar, profilePicture, imageUrl, url } = req.body || {};
    const inputAvatar = avatar !== undefined ? avatar : (profilePicture !== undefined ? profilePicture : (imageUrl !== undefined ? imageUrl : url));

    if (!uploadedFile && inputAvatar === undefined) {
      throw new ApiError(400, 'Either an image file or a valid picture URL must be provided');
    }

    const result = await updateGroupProfilePicture(
      userId,
      conversationId,
      { avatar: inputAvatar },
      uploadedFile
    );

    res.status(200).json({
      success: true,
      message: 'Group profile picture updated successfully',
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const deleteGroupProfilePictureController = async (req: Request, res: Response, next: NextFunction) => {
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

    const result = await deleteGroupProfilePicture(userId, conversationId);

    res.status(200).json({
      success: true,
      message: 'Group profile picture removed successfully',
      data: result
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

    const deleteForEveryone = req.body?.deleteForEveryone !== false;
    const result = await deleteMessage(userId, conversationId, messageId, deleteForEveryone);

    res.status(200).json({
      success: true,
      message: 'Message deleted successfully',
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const toggleMessageReactionController = async (req: Request, res: Response, next: NextFunction) => {
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

    const { emoji } = req.body;
    const result = await toggleMessageReaction(userId, conversationId, messageId, emoji);

    res.status(200).json({
      success: true,
      message: 'Reaction updated successfully',
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const getMessageReactionsController = async (req: Request, res: Response, next: NextFunction) => {
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

    const rawEmoji = req.query.emoji;
    const emoji = typeof rawEmoji === 'string' && rawEmoji.trim() ? rawEmoji.trim() : undefined;

    const result = await getMessageReactions(userId, conversationId, messageId, emoji);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const forwardMessagesController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const { messageIds, targetConversationIds } = req.body;
    const result = await forwardMessages(userId, messageIds, targetConversationIds);

    res.status(200).json({
      success: true,
      message: 'Messages forwarded successfully',
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

export const createPollController = async (req: Request, res: Response, next: NextFunction) => {
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

    const { question, options, allowMultipleAnswers, clientMessageId, replyToId } = req.body;

    const { message, participants, isDuplicate, conversationId: resolvedConversationId } = await saveMessage(
      userId,
      conversationId,
      question.trim(),
      undefined,
      'poll',
      clientMessageId,
      undefined,
      undefined,
      undefined,
      replyToId,
      undefined,
      undefined,
      {
        question: question.trim(),
        options,
        allowMultipleAnswers: Boolean(allowMultipleAnswers)
      }
    );

    if (!isDuplicate) {
      try {
        const io = getIO();
        const conversationRooms = [`conversation:${resolvedConversationId}`];
        if (conversationId !== resolvedConversationId) {
          conversationRooms.push(`conversation:${conversationId}`);
        }
        io.to(conversationRooms).emit(CHAT_EVENTS.MESSAGE_NEW, message);

        participants.forEach((p) => {
          io.to(`user:${p.userId}`).emit(CHAT_EVENTS.CONVERSATION_UPDATE, {
            conversationId: resolvedConversationId,
            lastMessage: message
          });
        });
      } catch (err: any) {
        logger.error('Failed to emit socket events for created poll', { error: err.message });
      }
    }

    res.status(201).json({
      success: true,
      message: 'Poll created successfully',
      data: message
    });
  } catch (err) {
    next(err);
  }
};

export const votePollController = async (req: Request, res: Response, next: NextFunction) => {
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

    const rawPollId = req.params.pollId || req.params.messageId;
    const pollIdOrMessageId = Array.isArray(rawPollId) ? rawPollId[0] : rawPollId;
    if (!pollIdOrMessageId) {
      throw new ApiError(400, 'pollId or messageId is required');
    }

    const { optionIds } = req.body;
    const result = await votePoll(userId, conversationId, pollIdOrMessageId, optionIds);

    res.status(200).json({
      success: true,
      message: 'Vote recorded successfully',
      data: result
    });
  } catch (err) {
    next(err);
  }
};


export const pinMessageController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const rawId = req.params.id;
    const conversationId = Array.isArray(rawId) ? rawId[0] : rawId;
    const rawMessageId = req.params.messageId;
    const messageId = Array.isArray(rawMessageId) ? rawMessageId[0] : rawMessageId;

    if (!conversationId || !messageId) {
      throw new ApiError(400, 'conversationId and messageId are required');
    }

    const result = await pinMessage(userId, conversationId, messageId);

    try {
      const io = getIO();
      io.to(`conversation:${conversationId}`).emit(CHAT_EVENTS.MESSAGE_PINNED, {
        conversationId,
        messageId,
        pinnedBy: userId,
        message: (result as any).message ?? null,
        pinnedAt: new Date().toISOString(),
      });
    } catch (sockErr: any) {
      logger.warn(`[PinMessage] Socket emit failed: ${sockErr?.message}`);
    }

    res.status(200).json({
      success: true,
      message: 'Message pinned successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const unpinMessageController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const rawId = req.params.id;
    const conversationId = Array.isArray(rawId) ? rawId[0] : rawId;
    const rawMessageId = req.params.messageId;
    const messageId = Array.isArray(rawMessageId) ? rawMessageId[0] : rawMessageId;
    if (!conversationId || !messageId) {

      throw new ApiError(400, 'conversationId and messageId are required');
    }

    const result = await unpinMessage(userId, conversationId, messageId);

    try {
      const io = getIO();
      io.to(`conversation:${conversationId}`).emit(CHAT_EVENTS.MESSAGE_UNPINNED, {
        conversationId,
        messageId,
        unpinnedBy: userId,
        unpinnedAt: new Date().toISOString(),
      });
    } catch (sockErr: any) {
      logger.warn(`[UnpinMessage] Socket emit failed: ${sockErr?.message}`);
    }

    res.status(200).json({
      success: true,
      message: 'Message unpinned successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getPinnedMessagesController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const rawId = req.params.id;
    const conversationId = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!conversationId) throw new ApiError(400, 'conversationId is required');


    const result = await getPinnedMessages(userId, conversationId);

    res.status(200).json({
      success: true,
      message: 'Pinned messages retrieved successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};
