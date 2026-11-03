import { Server as SocketIOServer } from 'socket.io';
import { AuthenticatedSocket } from '../socketAuth.js';
import { setUserOnline, setUserOffline, refreshUserPresence } from '../../services/presenceService.js';
import { getCoParticipantUserIds } from '../../services/chatService.js';
import { CHAT_EVENTS } from '../../utils/constants.js';
import redis from '../../config/redis.js';
import logger from '../../utils/logger.js';

export const registerPresenceHandler = async (io: SocketIOServer, socket: AuthenticatedSocket) => {
  const userId = socket.data.user?.id;
  if (!userId || !socket.data.user?.isAuthenticated) return;

  try {
    const isFirstConnection = await setUserOnline(userId, socket.id);
    if (isFirstConnection) {
      const contacts = await getCoParticipantUserIds(userId);
      contacts.forEach((contactId) => {
        io.to(`user:${contactId}`).emit(CHAT_EVENTS.PRESENCE_ONLINE, { userId });
      });
    }
  } catch (err: any) {
    logger.error('Failed to register user online presence', { userId, error: err.message });
  }

  const heartbeatInterval = setInterval(() => {
    refreshUserPresence(userId, socket.id).catch((err: any) => {
      logger.error('Failed to refresh presence TTL during heartbeat', { userId, error: err.message });
    });
  }, 25000);

  socket.on('client:lifecycle', async (data: { state?: 'active' | 'background' }) => {
    try {
      const state = data?.state === 'background' ? 'background' : 'active';
      await redis.set(`user_app_state:${userId}`, state, 'EX', 86400);
      logger.debug(`User app lifecycle state updated`, { userId, state });
    } catch (err: any) {
      logger.warn('Failed to update user app lifecycle state in Redis', { userId, error: err.message });
    }
  });

  socket.on('disconnect', async () => {
    clearInterval(heartbeatInterval);
    redis.del(`user_app_state:${userId}`).catch(() => {});

    try {
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
    } catch (err: any) {
      logger.error('Failed to handle socket disconnect presence update', { userId, error: err.message });
    }
  });
};
