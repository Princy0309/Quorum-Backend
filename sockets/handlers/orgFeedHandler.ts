import { Server as SocketIOServer } from 'socket.io';
import { AuthenticatedSocket } from '../socketAuth.js';
import prisma from '../../config/prisma.js';
import { ORG_FEED_EVENTS } from '../../utils/constants.js';
import logger from '../../utils/logger.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface SocketAck {
  success: boolean;
  code?: string;
  message?: string;
}

export const registerOrgFeedHandler = (io: SocketIOServer, socket: AuthenticatedSocket) => {
  socket.on(
    ORG_FEED_EVENTS.ORG_JOIN,
    async (payload: { organizationId?: string; orgId?: string }, ack?: (res: SocketAck) => void) => {
      try {
        const userId = socket.data.user?.id;
        if (!userId || !socket.data.user?.isAuthenticated) {
          return ack?.({ success: false, code: 'UNAUTHORIZED', message: 'Authentication required' });
        }

        const rawOrgId = payload?.organizationId || payload?.orgId;
        const orgId = typeof rawOrgId === 'string' ? rawOrgId.trim() : '';

        if (!orgId || !UUID_REGEX.test(orgId)) {
          return ack?.({ success: false, code: 'VALIDATION_ERROR', message: 'Valid organizationId is required' });
        }

        const membership = await prisma.organizationMember.findUnique({
          where: {
            organizationId_userId: {
              organizationId: orgId,
              userId,
            },
          },
          select: { id: true },
        });

        if (!membership) {
          return ack?.({ success: false, code: 'FORBIDDEN', message: 'You are not a member of this organization' });
        }

        const roomName = `org:${orgId}`;
        socket.join(roomName);
        return ack?.({ success: true, message: `Joined organization room ${roomName}` });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[OrgFeedSocket] Failed to join org room: ${msg}`);
        return ack?.({ success: false, code: 'SERVER_ERROR', message: 'Internal server error' });
      }
    }
  );

  socket.on(
    ORG_FEED_EVENTS.ORG_LEAVE,
    (payload: { organizationId?: string; orgId?: string }, ack?: (res: SocketAck) => void) => {
      const rawOrgId = payload?.organizationId || payload?.orgId;
      const orgId = typeof rawOrgId === 'string' ? rawOrgId.trim() : '';
      if (orgId && UUID_REGEX.test(orgId)) {
        socket.leave(`org:${orgId}`);
      }
      return ack?.({ success: true });
    }
  );
};