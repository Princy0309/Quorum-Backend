import { Server as SocketIOServer } from 'socket.io';
import { AuthenticatedSocket } from '../socketAuth.js';
import { saveMessage } from '../../services/chatService.js';
import { CHAT_EVENTS } from '../../utils/constants.js';

interface SendMessagePayload {
  conversationId: string;
  content: string;
  fileUrl?: string;
  fileType?: string;
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

        const { conversationId, content, fileUrl, fileType } = payload || {};
        if (!conversationId || typeof conversationId !== 'string') {
          if (callback) callback({ success: false, error: 'conversationId string is required' });
          return;
        }

        if ((!content || typeof content !== 'string' || !content.trim()) && !fileUrl) {
          if (callback) callback({ success: false, error: 'Message content or fileUrl is required' });
          return;
        }

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
};
