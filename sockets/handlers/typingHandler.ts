import { Server as SocketIOServer } from 'socket.io';
import { AuthenticatedSocket } from '../socketAuth.js';
import { isParticipant } from '../../services/chatService.js';
import { CHAT_EVENTS } from '../../utils/constants.js';
import prisma from '../../config/prisma.js';

interface TypingPayload {
  conversationId: string;
}

export const registerTypingHandler = (io: SocketIOServer, socket: AuthenticatedSocket) => {
  socket.on(CHAT_EVENTS.TYPING_START, async (payload: TypingPayload) => {
    try {
      const userId = socket.data.user?.id;
      const { conversationId } = payload || {};
      if (!userId || !conversationId || typeof conversationId !== 'string') return;

      const validParticipant = await isParticipant(userId, conversationId);
      if (!validParticipant) return;

      const participants = await prisma.conversationParticipant.findMany({
        where: { conversationId },
        select: { userId: true }
      });

      participants.forEach((p) => {
        if (p.userId !== userId) {
          io.to(`user:${p.userId}`).emit(CHAT_EVENTS.TYPING_START, {
            conversationId,
            userId
          });
        }
      });
    } catch (err) {}
  });

  socket.on(CHAT_EVENTS.TYPING_STOP, async (payload: TypingPayload) => {
    try {
      const userId = socket.data.user?.id;
      const { conversationId } = payload || {};
      if (!userId || !conversationId || typeof conversationId !== 'string') return;

      const validParticipant = await isParticipant(userId, conversationId);
      if (!validParticipant) return;

      const participants = await prisma.conversationParticipant.findMany({
        where: { conversationId },
        select: { userId: true }
      });

      participants.forEach((p) => {
        if (p.userId !== userId) {
          io.to(`user:${p.userId}`).emit(CHAT_EVENTS.TYPING_STOP, {
            conversationId,
            userId
          });
        }
      });
    } catch (err) {}
  });
};
