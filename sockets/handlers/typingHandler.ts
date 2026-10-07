import { Server as SocketIOServer } from 'socket.io';
import { AuthenticatedSocket } from '../socketAuth.js';
import { isParticipant } from '../../services/chatService.js';
import { typingSchema } from '../../validators/chatValidators.js';
import { CHAT_EVENTS } from '../../utils/constants.js';

interface TypingPayload {
  conversationId: string;
}

export const registerTypingHandler = (io: SocketIOServer, socket: AuthenticatedSocket) => {
  const handleTypingEvent = async (event: string, payload: TypingPayload) => {
    try {
      const userId = socket.data.user?.id;
      if (!userId) return;

      const { error, value } = typingSchema.validate(payload);
      if (error) return;

      const { conversationId } = value;
      const room = `conversation:${conversationId}`;

      if (!socket.rooms.has(room)) {
        const validParticipant = await isParticipant(userId, conversationId);
        if (!validParticipant) return;
        socket.join(room);
      }

      socket.to(room).emit(event, {
        conversationId,
        userId
      });
    } catch (err) {}
  };

  socket.on(CHAT_EVENTS.TYPING_START, (payload: TypingPayload) => {
    handleTypingEvent(CHAT_EVENTS.TYPING_START, payload);
  });

  socket.on(CHAT_EVENTS.TYPING_STOP, (payload: TypingPayload) => {
    handleTypingEvent(CHAT_EVENTS.TYPING_STOP, payload);
  });
};

