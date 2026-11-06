import { Server, Socket } from 'socket.io';
import logger from '../../utils/logger.js';
import { OFFICE_EVENTS } from '../../utils/constants.js';
import { OfficeZoneId } from '../../types/office.js';
import {
  joinOffice,
  changeOfficeZone,
  knockOnDesk,
  leaveOffice,
  getOfficeFloorState,
} from '../../services/officeService.js';
import { broadcastUserPresenceUpdate } from './presenceHandler.js';
import { getUserPresence } from '../../services/presenceService.js';

export function registerOfficeHandler(io: Server, socket: Socket) {
  const user = socket.data.user;

  // 1. Join a team's virtual office
  socket.on(
    OFFICE_EVENTS.JOIN,
    async (data: { teamId: string }, ack?: (res: any) => void) => {
      const userId = socket.data.user?.id;
      if (!userId) {
        return ack?.({ success: false, message: 'Unauthorized' });
      }

      const teamId = data?.teamId;
      if (!teamId) {
        return ack?.({ success: false, message: 'teamId is required' });
      }

      try {
        const roomName = `office:team:${teamId}`;
        socket.join(roomName);

        const result = await joinOffice(teamId, {
          id: userId,
          name: socket.data.user.name || 'User',
          avatarUrl: socket.data.user.avatarUrl || null,
        });

        // Broadcast to other teammates on this floor
        socket.to(roomName).emit(OFFICE_EVENTS.USER_JOINED, {
          teamId,
          member: result.member,
        });

        ack?.({
          success: true,
          data: result,
        });
      } catch (err: any) {
        logger.error(`[OfficeSocket] Failed to join office: ${err.message}`);
        ack?.({ success: false, message: err.message });
      }
    }
  );

  // 2. Change room/zone (War Room, Lounge, Focus Pod, Desks)
  socket.on(
    OFFICE_EVENTS.CHANGE_ZONE,
    async (
      data: { teamId: string; newZoneId: OfficeZoneId; targetDeskId?: string },
      ack?: (res: any) => void
    ) => {
      const userId = socket.data.user?.id;
      if (!userId) {
        return ack?.({ success: false, message: 'Unauthorized' });
      }

      const { teamId, newZoneId, targetDeskId } = data || {};
      if (!teamId || !newZoneId) {
        return ack?.({ success: false, message: 'teamId and newZoneId are required' });
      }

      try {
        const changeEvent = await changeOfficeZone(teamId, userId, newZoneId, targetDeskId);

        // Broadcast to everyone currently viewing the floor
        const roomName = `office:team:${teamId}`;
        io.to(roomName).emit(OFFICE_EVENTS.ZONE_CHANGED, changeEvent);

        // Also broadcast global presence update (for chat badges and contact list)
        const presence = await getUserPresence(userId);
        await broadcastUserPresenceUpdate(io, userId, presence);

        ack?.({ success: true, data: changeEvent });
      } catch (err: any) {
        logger.error(`[OfficeSocket] Failed to change zone: ${err.message}`);
        ack?.({ success: false, message: err.message });
      }
    }
  );

  // 3. Knock on a colleague's desk
  socket.on(
    OFFICE_EVENTS.KNOCK,
    async (
      data: { teamId: string; targetUserId: string; message?: string },
      ack?: (res: any) => void
    ) => {
      const userId = socket.data.user?.id;
      if (!userId) {
        return ack?.({ success: false, message: 'Unauthorized' });
      }

      const { teamId, targetUserId, message } = data || {};
      if (!teamId || !targetUserId) {
        return ack?.({ success: false, message: 'teamId and targetUserId are required' });
      }

      try {
        
        const knockedEvent = await knockOnDesk(
          { teamId, targetUserId, message },
          {
            id: userId,
            name: socket.data.user.name || 'Teammate',
            avatarUrl: socket.data.user.avatarUrl || null,
          }
        );

        // Deliver directly to target user's personal socket room
        io.to(`user:${targetUserId}`).emit(OFFICE_EVENTS.KNOCKED, knockedEvent);

        ack?.({ success: true, message: 'Knocked on desk successfully', data: knockedEvent });
      } catch (err: any) {
        logger.warn(`[OfficeSocket] Knock rejected: ${err.message}`);
        ack?.({ success: false, message: err.message });
      }
    }
  );

  // 4. Leave the virtual office
  socket.on(
    OFFICE_EVENTS.LEAVE,
    async (data: { teamId: string }, ack?: (res: any) => void) => {
      const userId = socket.data.user?.id;
      if (!userId) return ack?.({ success: false, message: 'Unauthorized' });

      const teamId = data?.teamId;
      if (!teamId) return ack?.({ success: false, message: 'teamId is required' });

      try {
        const roomName = `office:team:${teamId}`;
        socket.leave(roomName);
        await leaveOffice(teamId, userId);

        socket.to(roomName).emit(OFFICE_EVENTS.USER_LEFT, {
          teamId,
          userId,
        });

        ack?.({ success: true });
      } catch (err: any) {
        logger.error(`[OfficeSocket] Failed to leave office: ${err.message}`);
        ack?.({ success: false, message: err.message });
      }
    }
  );
}
