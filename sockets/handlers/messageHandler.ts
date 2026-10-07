import { Server as SocketIOServer } from 'socket.io';
import { AuthenticatedSocket } from '../socketAuth.js';
import { saveMessage, markMessageAsRead } from '../../services/chatService.js';
import { sendPushToOfflineUsers } from '../../services/notificationService.js';
import { checkSocketMessageRateLimit } from '../../middlewares/rateLimiter.js';
import { sendMessageSchema, readMessageSchema } from '../../validators/chatValidators.js';
import { CHAT_EVENTS } from '../../utils/constants.js';

interface SendMessagePayload {
  conversationId: string;
  content: string;
  fileUrl?: string;
  fileType?: string;
}

interface ReadMessagePayload {
  conversationId: string;
  messageId: string;
}

export const registerMessageHandler = (io: SocketIOServer, socket: AuthenticatedSocket) => {
  socket.on(
    CHAT_EVENTS.MESSAGE_SEND,
    async (
      payload: SendMessagePayload,
      callback?: (response: { success: boolean; data?: any; error?: string }) => void
    ) => {
      try {
        const senderId = socket.data.user?.id;
        if (!senderId) {
          if (callback) callback({ success: false, error: 'Unauthorized socket' });
          return;
        }

        const allowed = await checkSocketMessageRateLimit(senderId);
        if (!allowed) {
          if (callback) callback({ success: false, error: 'Rate limit exceeded. Please wait before sending more messages.' });
          return;
        }

        const { error, value } = sendMessageSchema.validate(payload);
        if (error) {
          if (callback) callback({ success: false, error: error.details[0].message });
          return;
        }

        const { conversationId, content, fileUrl, fileType } = value;

        const { message, participants } = await saveMessage(
          senderId,
          conversationId,
          content ? content.trim() : '',
          fileUrl,
          fileType
        );

        participants.forEach((p) => {
          io.to(`user:${p.userId}`).emit(CHAT_EVENTS.MESSAGE_NEW, message);
        });

        const recipientUserIds = participants.map((p) => p.userId).filter((id) => id !== senderId);
        sendPushToOfflineUsers(
          recipientUserIds,
          `New message from ${message.sender.name}`,
          content || 'Sent an attachment',
          { conversationId, messageId: message.id }
        ).catch(() => {});

        if (callback) {
          callback({ success: true, data: message });
        }
      } catch (err: any) {
        if (callback) {
          callback({ success: false, error: err.message || 'Failed to send message' });
        }
      }
    }
  );

  socket.on(
    CHAT_EVENTS.MESSAGE_READ,
    async (
      payload: ReadMessagePayload,
      callback?: (response: { success: boolean; data?: any; error?: string }) => void
    ) => {
      try {
        const userId = socket.data.user?.id;
        if (!userId) {
          if (callback) callback({ success: false, error: 'Unauthorized socket' });
          return;
        }

        const { error, value } = readMessageSchema.validate(payload);
        if (error) {
          if (callback) callback({ success: false, error: error.details[0].message });
          return;
        }

        const { conversationId, messageId } = value;

        const result = await markMessageAsRead(userId, conversationId, messageId);

        result.participants.forEach((p) => {
          if (p.userId !== userId) {
            io.to(`user:${p.userId}`).emit(CHAT_EVENTS.MESSAGE_READ, {
              conversationId: result.conversationId,
              userId: result.userId,
              messageId: result.messageId
            });
          }
        });

        if (callback) {
          callback({ success: true, data: { conversationId, messageId } });
        }
      } catch (err: any) {
        if (callback) {
          callback({ success: false, error: err.message || 'Failed to mark message as read' });
        }
      }
    }
  );
};



