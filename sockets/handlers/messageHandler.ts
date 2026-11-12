import { Server as SocketIOServer } from 'socket.io';
import prisma from '../../config/prisma.js';
import { AuthenticatedSocket } from '../socketAuth.js';
import {
  saveMessage,
  markMessageAsRead,
  isParticipant,
  resolveConversationId,
  editMessage,
  deleteMessage,
  toggleMessageReaction,
  getMessageReactions,
  forwardMessages,
  votePoll,
  clearConversationMessages,
  deleteConversationForUser
} from '../../services/chatService.js';
import { sendPushToOfflineUsers } from '../../services/notificationService.js';
import { checkSocketMessageRateLimit } from '../../middlewares/rateLimiter.js';
import { sendMessageSchema, readMessageSchema } from '../../validators/chatValidators.js';
import { CHAT_EVENTS } from '../../utils/constants.js';
import { ApiError } from '../../utils/ApiError.js';
import logger from '../../utils/logger.js';

interface SendMessagePayload {
  conversationId: string;
  clientMessageId?: string;
  content?: string;
  caption?: string;
  fileUrl?: string;
  url?: string;
  fileType?: string;
  type?: string;
  fileName?: string;
  name?: string;
  fileSize?: number;
  size?: number;
  replyToId?: string;
  audioDuration?: number;
  duration?: number;
  audioWaveform?: number[];
  waveform?: number[];
  poll?: {
    question: string;
    options: string[];
    allowMultipleAnswers?: boolean;
  };
}

interface ReadMessagePayload {
  conversationId: string;
  messageId: string;
}

interface SocketCallbackResponse<T = any> {
  success: boolean;
  code?: string;
  message?: string;
  error?: string;
  data?: T;
}

const formatErrorResponse = (code: string, message: string): SocketCallbackResponse => ({
  success: false,
  code,
  message,
  error: message
});

export const registerMessageHandler = (io: SocketIOServer, socket: AuthenticatedSocket) => {
  socket.on(
    CHAT_EVENTS.CONVERSATION_JOIN,
    async (
      payload: { conversationId: string },
      callback?: (response: SocketCallbackResponse) => void
    ) => {
      try {
        const userId = socket.data.user?.id;
        if (!userId || !socket.data.user?.isAuthenticated) {
          if (callback) callback(formatErrorResponse('UNAUTHORIZED', 'Unauthorized socket. Authentication required.'));
          return;
        }

        if (!payload?.conversationId) {
          if (callback) callback(formatErrorResponse('INVALID_PAYLOAD', 'conversationId is required'));
          return;
        }

        const resolvedId = await resolveConversationId(userId, payload.conversationId);
        if (!resolvedId) {
          if (callback) callback(formatErrorResponse('NOT_PARTICIPANT', 'User is not a participant in this conversation'));
          return;
        }

        socket.join(`conversation:${payload.conversationId}`);
        if (resolvedId !== payload.conversationId) {
          socket.join(`conversation:${resolvedId}`);
        }

        try {
          const participants = await prisma.conversationParticipant.findMany({
            where: { conversationId: resolvedId },
            select: {
              userId: true,
              lastReadSeq: true,
              lastReadMessageId: true
            }
          });

          for (const p of participants) {
            if (p.lastReadSeq > 0) {
              socket.emit(CHAT_EVENTS.MESSAGE_READ, {
                conversationId: resolvedId,
                userId: p.userId,
                lastReadSeq: p.lastReadSeq,
                lastReadMessageId: p.lastReadMessageId,
                messageId: p.lastReadMessageId
              });
            }
          }

          if (callback) {
            callback({
              success: true,
              data: {
                conversationId: resolvedId,
                participants
              }
            });
            return;
          }
        } catch (syncErr: any) {
          logger.warn('Failed to sync participant read states on join', syncErr);
        }

        if (callback) callback({ success: true, data: { conversationId: resolvedId } });
      } catch (err: any) {
        logger.error('Error joining conversation room', { error: err.message });
        if (callback) {
          if (err instanceof ApiError) {
            const code = err.statusCode === 403 ? 'NOT_PARTICIPANT' : 'INVALID_PAYLOAD';
            callback(formatErrorResponse(code, err.message));
          } else {
            callback(formatErrorResponse('SERVER_ERROR', 'Failed to join conversation'));
          }
        }
      }
    }
  );

  socket.on(
    CHAT_EVENTS.CONVERSATION_LEAVE,
    async (
      payload: { conversationId: string },
      callback?: (response: SocketCallbackResponse) => void
    ) => {
      try {
        if (payload?.conversationId) {
          socket.leave(`conversation:${payload.conversationId}`);
          const userId = socket.data.user?.id;
          if (userId) {
            const resolvedId = await resolveConversationId(userId, payload.conversationId);
            if (resolvedId && resolvedId !== payload.conversationId) {
              socket.leave(`conversation:${resolvedId}`);
            }
          }
        }
        if (callback) callback({ success: true });
      } catch (err: any) {
        logger.error('Error leaving conversation room', { error: err.message });
        if (callback) callback(formatErrorResponse('SERVER_ERROR', 'Failed to leave conversation'));
      }
    }
  );

  socket.on(
    CHAT_EVENTS.CONVERSATION_CLEAR,
    async (
      payload: { conversationId: string },
      callback?: (response: SocketCallbackResponse) => void
    ) => {
      try {
        const userId = socket.data.user?.id;
        if (!userId) {
          if (callback) callback(formatErrorResponse('UNAUTHORIZED', 'Unauthorized socket'));
          return;
        }

        if (!payload?.conversationId) {
          if (callback) callback(formatErrorResponse('INVALID_PAYLOAD', 'conversationId is required'));
          return;
        }

        const result = await clearConversationMessages(userId, payload.conversationId);
        if (callback) callback({ success: true, data: result });
      } catch (err: any) {
        logger.error('Error clearing conversation via socket', { error: err.message });
        if (callback) {
          const code = err instanceof ApiError && err.statusCode === 404 ? 'NOT_FOUND' : 'SERVER_ERROR';
          callback(formatErrorResponse(code, err.message || 'Failed to clear conversation'));
        }
      }
    }
  );

  socket.on(
    CHAT_EVENTS.CONVERSATION_DELETE,
    async (
      payload: { conversationId: string },
      callback?: (response: SocketCallbackResponse) => void
    ) => {
      try {
        const userId = socket.data.user?.id;
        if (!userId) {
          if (callback) callback(formatErrorResponse('UNAUTHORIZED', 'Unauthorized socket'));
          return;
        }

        if (!payload?.conversationId) {
          if (callback) callback(formatErrorResponse('INVALID_PAYLOAD', 'conversationId is required'));
          return;
        }

        const result = await deleteConversationForUser(userId, payload.conversationId);
        if (callback) callback({ success: true, data: result });
      } catch (err: any) {
        logger.error('Error deleting conversation via socket', { error: err.message });
        if (callback) {
          const code = err instanceof ApiError && err.statusCode === 404 ? 'NOT_FOUND' : 'SERVER_ERROR';
          callback(formatErrorResponse(code, err.message || 'Failed to delete conversation'));
        }
      }
    }
  );

  socket.on(
    CHAT_EVENTS.MESSAGE_SEND,
    async (
      payload: SendMessagePayload,
      callback?: (response: SocketCallbackResponse) => void
    ) => {
      try {
        const senderId = socket.data.user?.id;
        if (!senderId || !socket.data.user?.isAuthenticated) {
          if (callback) callback(formatErrorResponse('UNAUTHORIZED', 'Unauthorized socket. Authentication required.'));
          return;
        }

        const allowed = await checkSocketMessageRateLimit(senderId);
        if (!allowed) {
          if (callback) callback(formatErrorResponse('RATE_LIMITED', 'Rate limit exceeded. Please wait before sending more messages.'));
          return;
        }

        const parsed = sendMessageSchema.safeParse(payload);
        if (!parsed.success) {
          const errMsg = parsed.error.issues[0]?.message || 'Invalid payload';
          logger.warn('Socket message validation failed', { error: errMsg, payload });
          if (callback) callback(formatErrorResponse('INVALID_PAYLOAD', errMsg));
          return;
        }

        const value = parsed.data;

        const conversationId = value.conversationId;
        const clientMessageId = value.clientMessageId;
        const rawContent = (typeof value.content === 'string' ? value.content : '') || value.caption || '';
        const fileUrl = (value.fileUrl || value.url) || undefined;
        const fileType = (value.fileType || value.type) || undefined;
        const fileName = (value.fileName || (value as any).name) || undefined;
        const fileSize = typeof value.fileSize === 'number' ? value.fileSize : (typeof (value as any).size === 'number' ? (value as any).size : undefined);
        const mentions = Array.isArray((value as any).mentions) ? (value as any).mentions : undefined;
        const replyToId = typeof value.replyToId === 'string' ? value.replyToId : (typeof (value as any).replyToId === 'string' ? (value as any).replyToId : undefined);
        const audioDuration = typeof (value as any).audioDuration === 'number'
          ? (value as any).audioDuration
          : (typeof (value as any).duration === 'number' ? (value as any).duration : undefined);
        const audioWaveform = Array.isArray((value as any).audioWaveform)
          ? (value as any).audioWaveform
          : (Array.isArray((value as any).waveform) ? (value as any).waveform : undefined);
        const poll = (value as any).poll;

        const { message, participants, isDuplicate } = await saveMessage(
          senderId,
          conversationId,
          rawContent.trim(),
          fileUrl,
          fileType,
          clientMessageId || undefined,
          fileName,
          fileSize,
          mentions,
          replyToId,
          audioDuration,
          audioWaveform,
          poll
        );

        if (isDuplicate) {
          if (callback) {
            callback({ success: true, data: message });
          }
          return;
        }

        const conversationRooms = [`conversation:${message.conversationId}`];
        if (conversationId !== message.conversationId) {
          conversationRooms.push(`conversation:${conversationId}`);
        }
        io.to(conversationRooms).emit(CHAT_EVENTS.MESSAGE_NEW, message);

        participants.forEach((p) => {
          io.to(`user:${p.userId}`).emit(CHAT_EVENTS.CONVERSATION_UPDATE, {
            conversationId: message.conversationId,
            lastMessage: message
          });
          if (conversationId !== message.conversationId) {
            io.to(`user:${p.userId}`).emit(CHAT_EVENTS.CONVERSATION_UPDATE, {
              conversationId,
              lastMessage: message
            });
          }
        });

        const recipientUserIds = participants.map((p) => p.userId).filter((id) => id !== senderId);
        const mentionedRecipientIds = recipientUserIds.filter((id) =>
          ((message as any).mentionedUserIds || []).includes(id)
        );
        const standardRecipientIds = recipientUserIds.filter(
          (id) => !mentionedRecipientIds.includes(id)
        );

        const senderName = (message as any).sender?.name || 'Someone';
        const senderAvatar = (message as any).sender?.avatar || undefined;

        if (mentionedRecipientIds.length > 0) {
          sendPushToOfflineUsers(
            mentionedRecipientIds,
            `${senderName} mentioned you`,
            rawContent || 'Mentioned you in a message',
            {
              conversationId: message.conversationId,
              messageId: message.id,
              isMention: 'true',
              type: 'MENTION'
            },
            {
              conversationId: message.conversationId,
              category: 'MESSAGE_REPLY',
              imageUrl: senderAvatar,
              channelId: 'quorum_chat_messages',
              sound: 'default'
            }
          ).catch((err) => {
            logger.error('Background FCM mention notification dispatch error', { error: err.message });
          });
        }

        if (standardRecipientIds.length > 0) {
          sendPushToOfflineUsers(
            standardRecipientIds,
            `New message from ${senderName}`,
            rawContent || 'Sent an attachment',
            {
              conversationId: message.conversationId,
              messageId: message.id,
              type: 'CHAT_MESSAGE'
            },
            {
              conversationId: message.conversationId,
              category: 'MESSAGE_REPLY',
              imageUrl: senderAvatar,
              channelId: 'quorum_chat_messages',
              sound: 'default'
            }
          ).catch((err) => {
            logger.error('Background FCM notification dispatch error', { error: err.message });
          });
        }

        if (callback) {
          callback({ success: true, data: message });
        }
      } catch (err: any) {
        logger.error('Error sending message via socket', {
          error: err.message,
          senderId: socket.data.user?.id,
          conversationId: payload?.conversationId
        });
        if (callback) {
          if (err instanceof ApiError) {
            const code = err.statusCode === 403 ? 'NOT_PARTICIPANT' : 'INVALID_PAYLOAD';
            callback(formatErrorResponse(code, err.message));
          } else {
            callback(formatErrorResponse('SERVER_ERROR', 'Failed to send message'));
          }
        }
      }
    }
  );

  socket.on(
    CHAT_EVENTS.MESSAGE_READ,
    async (
      payload: ReadMessagePayload,
      callback?: (response: SocketCallbackResponse) => void
    ) => {
      try {
        const userId = socket.data.user?.id;
        if (!userId) {
          if (callback) callback(formatErrorResponse('UNAUTHORIZED', 'Unauthorized socket'));
          return;
        }

        const parsed = readMessageSchema.safeParse(payload);
        if (!parsed.success) {
          const errMsg = parsed.error.issues[0]?.message || 'Invalid payload';
          if (callback) callback(formatErrorResponse('INVALID_PAYLOAD', errMsg));
          return;
        }

        const value = parsed.data;

        const { conversationId, messageId } = value;

        const result = await markMessageAsRead(userId, conversationId, messageId);

        if (result.updated) {
          const readRooms = [`conversation:${result.conversationId}`];
          if (conversationId !== result.conversationId) {
            readRooms.push(`conversation:${conversationId}`);
          }
          io.to(readRooms).emit(CHAT_EVENTS.MESSAGE_READ, {
            conversationId: result.conversationId,
            userId: result.userId,
            lastReadSeq: result.lastReadSeq,
            lastReadMessageId: result.lastReadMessageId,
            messageId: result.lastReadMessageId
          });
        }

        if (callback) {
          callback({
            success: true,
            data: {
              conversationId: result.conversationId,
              userId: result.userId,
              lastReadSeq: result.lastReadSeq,
              lastReadMessageId: result.lastReadMessageId,
              messageId: result.lastReadMessageId,
              updated: result.updated
            }
          });
        }
      } catch (err: any) {
        logger.error('Error marking message read via socket', { error: err.message });
        if (callback) {
          if (err instanceof ApiError) {
            const code = err.statusCode === 403 ? 'NOT_PARTICIPANT' : 'INVALID_PAYLOAD';
            callback(formatErrorResponse(code, err.message));
          } else {
            callback(formatErrorResponse('SERVER_ERROR', 'Failed to mark message as read'));
          }
        }
      }
    }
  );

  socket.on(
    CHAT_EVENTS.MESSAGE_EDIT,
    async (
      payload: { conversationId: string; messageId: string; content: string },
      callback?: (response: SocketCallbackResponse) => void
    ) => {
      try {
        const userId = socket.data.user?.id;
        if (!userId || !socket.data.user?.isAuthenticated) {
          if (callback) callback(formatErrorResponse('UNAUTHORIZED', 'Unauthorized socket. Authentication required.'));
          return;
        }

        if (!payload?.conversationId || !payload?.messageId || !payload?.content?.trim()) {
          if (callback) callback(formatErrorResponse('INVALID_PAYLOAD', 'conversationId, messageId, and non-empty content are required'));
          return;
        }

        const updated = await editMessage(userId, payload.conversationId, payload.messageId, payload.content);
        if (callback) {
          callback({ success: true, data: updated });
        }
      } catch (err: any) {
        logger.error('Error editing message via socket', { error: err.message });
        if (callback) {
          if (err instanceof ApiError) {
            const code = err.statusCode === 403 ? 'FORBIDDEN' : err.statusCode === 404 ? 'NOT_FOUND' : 'INVALID_PAYLOAD';
            callback(formatErrorResponse(code, err.message));
          } else {
            callback(formatErrorResponse('SERVER_ERROR', 'Failed to edit message'));
          }
        }
      }
    }
  );

  socket.on(
    CHAT_EVENTS.MESSAGE_DELETE,
    async (
      payload: { conversationId: string; messageId: string; deleteForEveryone?: boolean },
      callback?: (response: SocketCallbackResponse) => void
    ) => {
      try {
        const userId = socket.data.user?.id;
        if (!userId || !socket.data.user?.isAuthenticated) {
          if (callback) callback(formatErrorResponse('UNAUTHORIZED', 'Unauthorized socket. Authentication required.'));
          return;
        }

        if (!payload?.conversationId || !payload?.messageId) {
          if (callback) callback(formatErrorResponse('INVALID_PAYLOAD', 'conversationId and messageId are required'));
          return;
        }

        const deleteForEveryone = payload?.deleteForEveryone !== false;
        const result = await deleteMessage(userId, payload.conversationId, payload.messageId, deleteForEveryone);
        if (callback) {
          callback({ success: true, data: result });
        }
      } catch (err: any) {
        logger.error('Error deleting message via socket', { error: err.message });
        if (callback) {
          if (err instanceof ApiError) {
            const code = err.statusCode === 403 ? 'FORBIDDEN' : err.statusCode === 404 ? 'NOT_FOUND' : 'INVALID_PAYLOAD';
            callback(formatErrorResponse(code, err.message));
          } else {
            callback(formatErrorResponse('SERVER_ERROR', 'Failed to delete message'));
          }
        }
      }
    }
  );

  socket.on(
    CHAT_EVENTS.MESSAGE_REACT,
    async (
      payload: { conversationId: string; messageId: string; emoji: string },
      callback?: (response: SocketCallbackResponse) => void
    ) => {
      try {
        const userId = socket.data.user?.id;
        if (!userId || !socket.data.user?.isAuthenticated) {
          if (callback) callback(formatErrorResponse('UNAUTHORIZED', 'Unauthorized socket. Authentication required.'));
          return;
        }

        if (!payload?.conversationId || !payload?.messageId || !payload?.emoji?.trim()) {
          if (callback) callback(formatErrorResponse('INVALID_PAYLOAD', 'conversationId, messageId, and non-empty emoji are required'));
          return;
        }

        const result = await toggleMessageReaction(userId, payload.conversationId, payload.messageId, payload.emoji.trim());
        if (callback) {
          callback({ success: true, data: result });
        }
      } catch (err: any) {
        logger.error('Error toggling reaction via socket', { error: err.message });
        if (callback) {
          if (err instanceof ApiError) {
            const code = err.statusCode === 403 ? 'FORBIDDEN' : err.statusCode === 404 ? 'NOT_FOUND' : 'INVALID_PAYLOAD';
            callback(formatErrorResponse(code, err.message));
          } else {
            callback(formatErrorResponse('SERVER_ERROR', 'Failed to update reaction'));
          }
        }
      }
    }
  );

  socket.on(
    CHAT_EVENTS.MESSAGE_GET_REACTIONS,
    async (
      payload: { conversationId: string; messageId: string; emoji?: string },
      callback?: (response: SocketCallbackResponse) => void
    ) => {
      try {
        const userId = socket.data.user?.id;
        if (!userId || !socket.data.user?.isAuthenticated) {
          if (callback) callback(formatErrorResponse('UNAUTHORIZED', 'Unauthorized socket. Authentication required.'));
          return;
        }

        if (!payload?.conversationId || !payload?.messageId) {
          if (callback) callback(formatErrorResponse('INVALID_PAYLOAD', 'conversationId and messageId are required'));
          return;
        }

        const data = await getMessageReactions(userId, payload.conversationId, payload.messageId, payload.emoji);
        if (callback) {
          callback({ success: true, data });
        }
      } catch (err: any) {
        logger.error('Error fetching message reactions via socket', { error: err.message });
        if (callback) {
          if (err instanceof ApiError) {
            const code = err.statusCode === 403 ? 'FORBIDDEN' : err.statusCode === 404 ? 'NOT_FOUND' : 'INVALID_PAYLOAD';
            callback(formatErrorResponse(code, err.message));
          } else {
            callback(formatErrorResponse('SERVER_ERROR', 'Failed to fetch reactions'));
          }
        }
      }
    }
  );

  socket.on(
    CHAT_EVENTS.MESSAGE_FORWARD,
    async (
      payload: { messageIds: string[]; targetConversationIds: string[] },
      callback?: (response: SocketCallbackResponse) => void
    ) => {
      try {
        const userId = socket.data.user?.id;
        if (!userId || !socket.data.user?.isAuthenticated) {
          if (callback) callback(formatErrorResponse('UNAUTHORIZED', 'Unauthorized socket. Authentication required.'));
          return;
        }

        if (
          !Array.isArray(payload?.messageIds) ||
          payload.messageIds.length === 0 ||
          !Array.isArray(payload?.targetConversationIds) ||
          payload.targetConversationIds.length === 0
        ) {
          if (callback) callback(formatErrorResponse('INVALID_PAYLOAD', 'messageIds and targetConversationIds must be non-empty arrays'));
          return;
        }

        const result = await forwardMessages(userId, payload.messageIds, payload.targetConversationIds);
        if (callback) {
          callback({ success: true, data: result });
        }
      } catch (err: any) {
        logger.error('Error forwarding messages via socket', { error: err.message });
        if (callback) {
          if (err instanceof ApiError) {
            const code = err.statusCode === 403 ? 'FORBIDDEN' : err.statusCode === 404 ? 'NOT_FOUND' : 'INVALID_PAYLOAD';
            callback(formatErrorResponse(code, err.message));
          } else {
            callback(formatErrorResponse('SERVER_ERROR', 'Failed to forward messages'));
          }
        }
      }
    }
  );

  socket.on(
    CHAT_EVENTS.POLL_VOTE,
    async (
      payload: { conversationId: string; messageId?: string; pollId?: string; optionIds: string[] },
      callback?: (response: SocketCallbackResponse) => void
    ) => {
      try {
        const userId = socket.data.user?.id;
        if (!userId || !socket.data.user?.isAuthenticated) {
          if (callback) callback(formatErrorResponse('UNAUTHORIZED', 'Unauthorized socket. Authentication required.'));
          return;
        }

        const pollIdOrMessageId = payload?.pollId || payload?.messageId;
        if (!payload?.conversationId || !pollIdOrMessageId || !Array.isArray(payload?.optionIds) || payload.optionIds.length === 0) {
          if (callback) callback(formatErrorResponse('INVALID_PAYLOAD', 'conversationId, messageId or pollId, and non-empty optionIds array are required'));
          return;
        }

        const result = await votePoll(userId, payload.conversationId, pollIdOrMessageId, payload.optionIds);
        if (callback) {
          callback({ success: true, data: result });
        }
      } catch (err: any) {
        logger.error('Error voting on poll via socket', { error: err.message });
        if (callback) {
          if (err instanceof ApiError) {
            const code = err.statusCode === 403 ? 'FORBIDDEN' : err.statusCode === 404 ? 'NOT_FOUND' : 'INVALID_PAYLOAD';
            callback(formatErrorResponse(code, err.message));
          } else {
            callback(formatErrorResponse('SERVER_ERROR', 'Failed to vote on poll'));
          }
        }
      }
    }
  );
};
