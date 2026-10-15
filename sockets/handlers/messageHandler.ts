import { Server as SocketIOServer } from 'socket.io';
import { AuthenticatedSocket } from '../socketAuth.js';
import { saveMessage, markMessageAsRead, isParticipant, resolveConversationId } from '../../services/chatService.js';
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

        const { error, value } = sendMessageSchema.validate(payload);
        if (error) {
          logger.warn('Socket message validation failed', { error: error.details[0].message, payload });
          if (callback) callback(formatErrorResponse('INVALID_PAYLOAD', error.details[0].message));
          return;
        }

        const conversationId = value.conversationId;
        const clientMessageId = value.clientMessageId;
        const rawContent = (typeof value.content === 'string' ? value.content : '') || value.caption || '';
        const fileUrl = value.fileUrl || value.url;
        const fileType = value.fileType || value.type;
        const fileName = value.fileName || value.name;
        const fileSize = typeof value.fileSize === 'number' ? value.fileSize : (typeof value.size === 'number' ? value.size : undefined);

        const { message, participants, isDuplicate } = await saveMessage(
          senderId,
          conversationId,
          rawContent.trim(),
          fileUrl,
          fileType,
          clientMessageId,
          fileName,
          fileSize
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
        sendPushToOfflineUsers(
          recipientUserIds,
          `New message from ${message.sender.name}`,
          rawContent || 'Sent an attachment',
          { conversationId: message.conversationId, messageId: message.id }
        ).catch((err) => {
          logger.error('Background FCM notification dispatch error', { error: err.message });
        });

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

        const { error, value } = readMessageSchema.validate(payload);
        if (error) {
          if (callback) callback(formatErrorResponse('INVALID_PAYLOAD', error.details[0].message));
          return;
        }

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
};
