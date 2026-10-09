import { Server as SocketIOServer } from 'socket.io';
import { AuthenticatedSocket } from '../socketAuth.js';
import { saveMessage, markMessageAsRead, isParticipant } from '../../services/chatService.js';
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
  fileUrl?: string;
  fileType?: string;
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
        if (!userId) {
          if (callback) callback(formatErrorResponse('UNAUTHORIZED', 'Unauthorized socket'));
          return;
        }

        if (!payload?.conversationId) {
          if (callback) callback(formatErrorResponse('INVALID_PAYLOAD', 'conversationId is required'));
          return;
        }

        const valid = await isParticipant(userId, payload.conversationId);
        if (!valid) {
          if (callback) callback(formatErrorResponse('NOT_PARTICIPANT', 'User is not a participant in this conversation'));
          return;
        }

        socket.join(`conversation:${payload.conversationId}`);
        if (callback) callback({ success: true });
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
    (
      payload: { conversationId: string },
      callback?: (response: SocketCallbackResponse) => void
    ) => {
      try {
        if (payload?.conversationId) {
          socket.leave(`conversation:${payload.conversationId}`);
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
        if (!senderId) {
          if (callback) callback(formatErrorResponse('UNAUTHORIZED', 'Unauthorized socket'));
          return;
        }

        const allowed = await checkSocketMessageRateLimit(senderId);
        if (!allowed) {
          if (callback) callback(formatErrorResponse('RATE_LIMITED', 'Rate limit exceeded. Please wait before sending more messages.'));
          return;
        }

        const { error, value } = sendMessageSchema.validate(payload);
        if (error) {
          if (callback) callback(formatErrorResponse('INVALID_PAYLOAD', error.details[0].message));
          return;
        }

        const { conversationId, clientMessageId, content, fileUrl, fileType } = value;

        const { message, participants, isDuplicate } = await saveMessage(
          senderId,
          conversationId,
          content ? content.trim() : '',
          fileUrl,
          fileType,
          clientMessageId
        );

        if (isDuplicate) {
          if (callback) {
            callback({ success: true, data: message });
          }
          return;
        }

        io.to(`conversation:${conversationId}`).emit(CHAT_EVENTS.MESSAGE_NEW, message);

        participants.forEach((p) => {
          io.to(`user:${p.userId}`).emit(CHAT_EVENTS.CONVERSATION_UPDATE, {
            conversationId,
            lastMessage: message
          });
        });

        const recipientUserIds = participants.map((p) => p.userId).filter((id) => id !== senderId);
        sendPushToOfflineUsers(
          recipientUserIds,
          `New message from ${message.sender.name}`,
          content || 'Sent an attachment',
          { conversationId, messageId: message.id }
        ).catch((err) => {
          logger.error('Background FCM notification dispatch error', { error: err.message });
        });

        if (callback) {
          callback({ success: true, data: message });
        }
      } catch (err: any) {
        logger.error('Error sending message via socket', { error: err.message });
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
          io.to(`conversation:${conversationId}`).emit(CHAT_EVENTS.MESSAGE_READ, {
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
