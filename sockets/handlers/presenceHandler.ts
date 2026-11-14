import { Server as SocketIOServer } from 'socket.io';
import { AuthenticatedSocket } from '../socketAuth.js';
import {
  setUserOnline,
  setUserOffline,
  refreshUserPresence,
  setUserCustomStatus,
  clearUserCustomStatus,
  UserPresenceData,
  CustomStatusInput,
  getPresenceAudienceUserIds,
} from '../../services/presenceService.js';
import { getCoParticipantUserIds } from '../../services/chatService.js';
import { CHAT_EVENTS } from '../../utils/constants.js';
import redis from '../../config/redis.js';
import logger from '../../utils/logger.js';

export const broadcastUserPresenceUpdate = async (
  io: SocketIOServer,
  userId: string,
  presence: UserPresenceData
) => {
  try {
    const audience = await getPresenceAudienceUserIds(userId);

    const payload = {
      userId,
      isOnline: presence.isOnline,
      status: presence.status,
      statusMessage: presence.statusMessage || null,
      statusExpiresAt: presence.statusExpiresAt || null,
      lastSeen: presence.lastSeen || null,
    };

    audience.forEach((contactId) => {
      io.to(`user:${contactId}`).emit(CHAT_EVENTS.PRESENCE_STATUS_UPDATED, payload);
      io.to(`user:${contactId}`).emit('presence:update', payload);
      io.to(`user:${contactId}`).emit('presence:status_updated', payload);
    });
  } catch (err: any) {
    logger.error('Failed to broadcast user presence update', { userId, error: err.message });
  }
};

export const registerPresenceHandler = async (io: SocketIOServer, socket: AuthenticatedSocket) => {
  const userId = socket.data.user?.id;
  if (!userId || !socket.data.user?.isAuthenticated) return;

  try {
    const isFirstConnection = await setUserOnline(userId, socket.id);
    if (isFirstConnection) {
      const contacts = await getPresenceAudienceUserIds(userId);
      contacts.forEach((contactId) => {
        if(contactId != userId){
          io.to(`user:${contactId}`).emit(CHAT_EVENTS.PRESENCE_ONLINE, { userId });
        }
        
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

  socket.on('presence:set-status', async (data: CustomStatusInput, ack?: (res: any) => void) => {
    try {
      const updated = await setUserCustomStatus(userId, data);
      await broadcastUserPresenceUpdate(io, userId, updated);
      if (typeof ack === 'function') ack({ success: true, data: updated });
    } catch (err: any) {
      if (typeof ack === 'function') ack({ success: false, error: err.message });
    }
  });

  socket.on('presence:update', async (data: CustomStatusInput, ack?: (res: any) => void) => {
    try {
      const updated = await setUserCustomStatus(userId, data);
      await broadcastUserPresenceUpdate(io, userId, updated);
      if (typeof ack === 'function') ack({ success: true, data: updated });
    } catch (err: any) {
      if (typeof ack === 'function') ack({ success: false, error: err.message });
    }
  });

  socket.on('presence:clear-status', async (_data: any, ack?: (res: any) => void) => {
    try {
      const updated = await clearUserCustomStatus(userId);
      await broadcastUserPresenceUpdate(io, userId, updated);
      if (typeof ack === 'function') ack({ success: true, data: updated });
    } catch (err: any) {
      if (typeof ack === 'function') ack({ success: false, error: err.message });
    }
  });

  socket.on('disconnect', async () => {
    clearInterval(heartbeatInterval);
    redis.del(`user_app_state:${userId}`).catch(() => { });

    try {
      const isLastDisconnect = await setUserOffline(userId, socket.id);
      if (isLastDisconnect) {
        const contacts = await getPresenceAudienceUserIds(userId);
        const lastSeen = new Date();
        contacts.forEach((contactId) => {
          io.to(`user:${contactId}`).emit(CHAT_EVENTS.PRESENCE_OFFLINE, {
            userId,
            lastSeen,
          });
        });
      }
    } catch (err: any) {
      logger.error('Failed to handle socket disconnect presence update', { userId, error: err.message });
    }
  });
};
