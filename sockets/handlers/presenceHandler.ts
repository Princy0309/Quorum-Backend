import { Server as SocketIOServer } from 'socket.io';
import { AuthenticatedSocket } from '../socketAuth.js';
import { setUserOnline, setUserOffline, refreshUserPresence } from '../../services/presenceService.js';
import { getCoParticipantUserIds } from '../../services/chatService.js';
import { CHAT_EVENTS } from '../../utils/constants.js';

export const registerPresenceHandler = async (io: SocketIOServer, socket: AuthenticatedSocket) => {
  const userId = socket.data.user?.id;
  if (!userId) return;

  const isFirstConnection = await setUserOnline(userId, socket.id);
  if (isFirstConnection) {
    const contacts = await getCoParticipantUserIds(userId);
    contacts.forEach((contactId) => {
      io.to(`user:${contactId}`).emit(CHAT_EVENTS.PRESENCE_ONLINE, { userId });
    });
  }

  const heartbeatInterval = setInterval(() => {
    refreshUserPresence(userId).catch(() => {});
  }, 25000);

  socket.on('disconnect', async () => {
    clearInterval(heartbeatInterval);

    const isLastDisconnect = await setUserOffline(userId, socket.id);
    if (isLastDisconnect) {
      const contacts = await getCoParticipantUserIds(userId);
      const lastSeen = new Date();
      contacts.forEach((contactId) => {
        io.to(`user:${contactId}`).emit(CHAT_EVENTS.PRESENCE_OFFLINE, {
          userId,
          lastSeen
        });
      });
    }
  });
};
