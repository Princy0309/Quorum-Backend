import { Server as SocketIOServer } from 'socket.io';
import { AuthenticatedSocket } from '../socketAuth.js';
import {
  setUserOnline,
  setUserOffline,
  refreshUserPresence,
  setUserCustomStatus,
  clearUserCustomStatus,
  getUserPresence,
  getUserTeamIds,
  UserPresenceData,
  CustomStatusInput,
  getPresenceAudienceUserIds,
} from '../../services/presenceService.js';
import { getCoParticipantUserIds } from '../../services/chatService.js';
import { CHAT_EVENTS, OFFICE_EVENTS } from '../../utils/constants.js';
import redis from '../../config/redis.js';
import logger from '../../utils/logger.js';
import prisma from '../../config/prisma.js';
import { leaveOffice } from '../../services/officeService.js';
import { OfficeZoneId, OfficeMember, OfficeZoneChangedEvent } from '../../types/office.js';

export const broadcastUserPresenceUpdate = async (
  io: SocketIOServer,
  userId: string,
  presence: UserPresenceData
) => {
  try {
    const [audience, teamIds] = await Promise.all([
      getPresenceAudienceUserIds(userId),
      getUserTeamIds(userId),
    ]);

    const payload = {
      userId,
      isOnline: presence.isOnline,
      status: presence.status,
      statusMessage: presence.statusMessage || null,
      statusExpiresAt: presence.statusExpiresAt || null,
      lastSeen: presence.lastSeen || null,
      isInMeeting: presence.isInMeeting || false,
      meetingCode: presence.meetingCode || null,
      presence: {
        userId,
        isOnline: presence.isOnline,
        status: presence.status,
        statusMessage: presence.statusMessage || null,
        statusExpiresAt: presence.statusExpiresAt || null,
        lastSeen: presence.lastSeen || null,
      },
      data: {
        userId,
        isOnline: presence.isOnline,
        status: presence.status,
        statusMessage: presence.statusMessage || null,
        statusExpiresAt: presence.statusExpiresAt || null,
        lastSeen: presence.lastSeen || null,
      },
    };

    // 1. Deliver to individual 1-on-1 chats and contact badges
    audience.forEach((contactId) => {
      io.to(`user:${contactId}`).emit(CHAT_EVENTS.PRESENCE_STATUS_UPDATED, payload);
      io.to(`user:${contactId}`).emit('presence:update', payload);
      io.to(`user:${contactId}`).emit('presence:status_updated', payload);
    });

    // 2. If user went completely offline, clean them from all virtual office floors
    if (!presence.isOnline) {
      for (const teamId of teamIds) {
        const roomName = `office:team:${teamId}`;
        await leaveOffice(teamId, userId).catch(() => { });
        io.to(roomName).emit(OFFICE_EVENTS.USER_LEFT, { teamId, userId });
        io.to(roomName).emit('office:user-left', { teamId, userId });
      }
      return;
    }

    // 3. Fetch real user profile so name is never empty (fixes the '?' initial bug)
    let userName = '';
    let userAvatar: string | null = null;
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, avatar: true },
      });
      if (user) {
        userName = user.name;
        userAvatar = user.avatar;
      }
    } catch (e: any) {
      logger.warn(`Failed to fetch user profile for presence broadcast: ${e?.message}`);
    }

    // 4. Deliver live updates to each Virtual Office floor
    for (const teamId of teamIds) {
      const roomName = `office:team:${teamId}`;
      const membersKey = `office:team:${teamId}:members`;
      const desksKey = `office:team:${teamId}:desks`;
      const meetingKey = `office:team:${teamId}:meeting`;

      let parsedMember: any = null;
      try {
        const rawMember = await redis.hget(membersKey, userId);
        if (rawMember) {
          parsedMember = JSON.parse(rawMember);
        }
      } catch (err: any) {
        logger.warn(`Failed to parse office member for team ${teamId}: ${err?.message}`);
      }

      const previousZoneId: OfficeZoneId = (parsedMember?.zoneId as OfficeZoneId) || 'OPEN_WORKSPACE';
      let deskId: string | null = parsedMember?.deskId || null;

      // Check meeting in this team
      const activeMeetingCode = await redis.get(meetingKey).catch(() => null);
      const isUserInThisMeeting = Boolean(
        presence.isInMeeting &&
        activeMeetingCode &&
        presence.meetingCode === activeMeetingCode
      );

      // Resolve the zone dynamically (routes to Coffee Lounge or Focus Pod)
      let resolvedZoneId: OfficeZoneId = 'OPEN_WORKSPACE';
      let resolvedStatusMsg = presence.statusMessage || null;

      if (isUserInThisMeeting) {
        resolvedZoneId = 'WAR_ROOM';
      } else if (presence.isInMeeting) {
        resolvedZoneId = 'OPEN_WORKSPACE';
        resolvedStatusMsg = 'In another meeting';
      } else if (presence.status === 'DO_NOT_DISTURB') {
        resolvedZoneId = 'FOCUS_POD';
      } else if (presence.status === 'BE_RIGHT_BACK') {
        resolvedZoneId = 'COFFEE_LOUNGE';
      } else if (
        parsedMember?.zoneId &&
        parsedMember.zoneId !== 'WAR_ROOM' &&
        parsedMember.zoneId !== 'FOCUS_POD' &&
        parsedMember.zoneId !== 'COFFEE_LOUNGE'
      ) {
        resolvedZoneId = parsedMember.zoneId;
      }

      // Manage desk allocation
      if (resolvedZoneId !== 'OPEN_WORKSPACE') {
        // Free previous desk when entering Focus Pod, Lounge, or War Room
        if (deskId) {
          await redis.hdel(desksKey, deskId).catch(() => { });
          deskId = null;
        }
      } else {
        // In OPEN_WORKSPACE: ensure they are assigned a desk (1 to 12)
        try {
          const rawDesks = (await redis.hgetall(desksKey).catch(() => ({}))) as Record<string, string>;
          if (!deskId || rawDesks[deskId] !== userId) {
            deskId = null;
            for (let i = 1; i <= 12; i++) {
              const dId = `desk_${i}`;
              if (!rawDesks[dId] || rawDesks[dId] === userId) {
                deskId = dId;
                await redis.hset(desksKey, dId, userId);
                break;
              }
            }
          }
        } catch (err: any) {
          logger.warn(`Failed to sync desk assignment for user ${userId} in team ${teamId}: ${err?.message}`);
        }
      }

      const memberName = userName || parsedMember?.name || 'Teammate';
      const memberAvatar = userAvatar !== undefined && userAvatar !== null ? userAvatar : (parsedMember?.avatarUrl || null);

      const updatedMember: OfficeMember = {
        userId,
        name: memberName,
        avatarUrl: memberAvatar,
        presenceStatus: presence.status,
        zoneId: resolvedZoneId,
        deskId,
        isInMeeting: Boolean(presence.isInMeeting),
        statusMessage: resolvedStatusMsg,
        joinedOfficeAt: parsedMember?.joinedOfficeAt || new Date().toISOString(),
      };

      await redis.hset(membersKey, userId, JSON.stringify(updatedMember)).catch(() => { });

      const officePayload: OfficeZoneChangedEvent = {
        teamId,
        userId,
        name: memberName,
        avatarUrl: memberAvatar,
        previousZoneId,
        newZoneId: resolvedZoneId,
        deskId,
        presenceStatus: presence.status,
        isInMeeting: Boolean(presence.isInMeeting),
        statusMessage: resolvedStatusMsg,
        timestamp: new Date().toISOString(),
      };

      // If teammate is new to the floor (just opened the app), emit user-joined
      if (!parsedMember) {
        io.to(roomName).emit(OFFICE_EVENTS.USER_JOINED, { teamId, member: updatedMember });
        io.to(roomName).emit('office:user-joined', { teamId, member: updatedMember });
      }

      // Broadcast zone changes and state updates to the floor
      io.to(roomName).emit(OFFICE_EVENTS.ZONE_CHANGED, officePayload);
      io.to(roomName).emit('office:zone-changed', officePayload);
      io.to(roomName).emit(OFFICE_EVENTS.STATE_UPDATED, { teamId, member: updatedMember });
      io.to(roomName).emit('office:member-updated', officePayload);
      io.to(roomName).emit(CHAT_EVENTS.PRESENCE_STATUS_UPDATED, payload);
      io.to(roomName).emit('presence:update', payload);
      io.to(roomName).emit('presence:status_updated', payload);
    }
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
        if (contactId != userId) {
          io.to(`user:${contactId}`).emit(CHAT_EVENTS.PRESENCE_ONLINE, { userId });
        }

      });
      const currentPresence = await getUserPresence(userId);
      await broadcastUserPresenceUpdate(io, userId, currentPresence);
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
      if (!data?.status) {
        await refreshUserPresence(userId, socket.id);
        const current = await getUserPresence(userId);
        if (typeof ack === 'function') ack({ success: true, data: current });
        return;
      }
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
        const offlinePresence = await getUserPresence(userId);
        await broadcastUserPresenceUpdate(io, userId, offlinePresence);
      }
    } catch (err: any) {
      logger.error('Failed to handle socket disconnect presence update', { userId, error: err.message });
    }
  });
};
