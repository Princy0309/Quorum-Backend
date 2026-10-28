import { Server } from 'socket.io';
import { registerSfuSignaling } from './sfuSignaling.js';
import { handleJoinMeeting, handleLeaveMeeting, handleEndMeeting, handleDisconnectCleanup } from './meetingPresence.js';
import { handleToggleMic, handleToggleCam, handleMuteParticipant, handleSendMeetingMessage } from './meetingControls.js';
import { handleAdmitParticipant, handleRejectParticipant } from './waitingRoom.js';
import logger from '../utils/logger.js';
import { verifyAccessToken } from '../services/tokenService.js';
import prisma from '../config/prisma.js';
import redis from '../config/redis.js';
import { isOriginAllowed } from '../config/env.js';
import { registerMessageHandler } from './handlers/messageHandler.js';
import { registerTypingHandler } from './handlers/typingHandler.js';
import { registerPresenceHandler } from './handlers/presenceHandler.js';
import { registerCommunityHandler } from './handlers/communityHandler.js';
import { registerWhiteboardHandler } from './handlers/whiteboardHandler.js';

let ioInstance: Server | null = null;

export const getIO = (): Server => {
  if (!ioInstance) {
    throw new Error('Socket.IO has not been initialized');
  }
  return ioInstance;
};

export const initSocketServer = (httpServer: any) => {
  const io = new Server(httpServer, {
    cors: {
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        if (isOriginAllowed(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
    },
  });

  ioInstance = io;

  io.use(async (socket, next) => {
    const parseCookieToken = (cookieHeader?: string): string | null => {
      if (!cookieHeader) return null;
      const match = cookieHeader.match(/(?:^|;\s*)accessToken=([^;]+)/);
      return match ? decodeURIComponent(match[1]) : null;
    };

    const auth = socket.handshake.auth || {};
    const query = socket.handshake.query || {};

    let rawToken = auth.token ||
      (typeof socket.handshake.headers.authorization === 'string' ? socket.handshake.headers.authorization : '') ||
      (typeof query.token === 'string' ? query.token : '') ||
      parseCookieToken(socket.handshake.headers.cookie);

    let token = typeof rawToken === 'string' ? rawToken.replace(/^Bearer\s+/i, '').trim() : '';

    if (!token) {
      return next(new Error('Authentication error: Access token required'));
    }

    let decoded: any;
    try {
      decoded = verifyAccessToken(token);
    } catch (err: any) {
      return next(new Error('Authentication error: Invalid or expired token'));
    }

    if (!decoded || !decoded.id) {
      return next(new Error('Authentication error: Invalid token payload'));
    }

    if (decoded.jti) {
      try {
        const isRevoked = await redis.exists(`revoked_access:${decoded.jti}`);
        if (isRevoked) {
          return next(new Error('Authentication error: Token revoked'));
        }
      } catch (err: any) {
        logger.warn(`[Socket Auth] Redis revocation check failed: ${err.message}`);
      }
    }

    try {
      const dbUser = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          lockedUntil: true,
        },
      });

      if (!dbUser) {
        return next(new Error('Authentication error: User not found'));
      }

      if (dbUser.lockedUntil && dbUser.lockedUntil > new Date()) {
        return next(new Error('Authentication error: Account is temporarily locked'));
      }

      socket.data.user = {
        id: dbUser.id,
        name: dbUser.name || 'User',
        email: dbUser.email,
        role: dbUser.role,
        isAuthenticated: true,
      };
      socket.data.tokenPayload = decoded;

      next();
    } catch (err: any) {
      logger.error(`[Socket Auth] Database error verifying user ${decoded.id}: ${err.message}`);
      return next(new Error('Authentication error: Internal server error'));
    }
  });

  io.on('connection', (socket) => {
    logger.info(`[Socket] Client connected: ${socket.id}`);

    const userId = socket.data.user?.id;
    if (userId) {
      socket.join(`user:${userId}`);
    }

    registerMessageHandler(io, socket as any);
    registerTypingHandler(io, socket as any);
    registerPresenceHandler(io, socket as any);
    registerCommunityHandler(io, socket as any);
    registerWhiteboardHandler(io, socket as any);

    const handleDynamicAuth = async (data: { token?: string }, ack?: (res: any) => void) => {
      try {
        const raw = data?.token;
        const freshToken = typeof raw === 'string' ? raw.replace(/^Bearer\s+/i, '').trim() : '';
        if (!freshToken) {
          ack?.({ success: false, message: 'Token required' });
          return;
        }
        const decoded = verifyAccessToken(freshToken);
        if (!decoded?.id) {
          ack?.({ success: false, message: 'Invalid token payload' });
          return;
        }
        if (decoded.jti) {
          const isRevoked = await redis.exists(`revoked_access:${decoded.jti}`);
          if (isRevoked) {
            ack?.({ success: false, message: 'Token revoked' });
            return;
          }
        }
        const dbUser = await prisma.user.findUnique({
          where: { id: decoded.id },
          select: { id: true, name: true, email: true, role: true, lockedUntil: true }
        });
        if (!dbUser || (dbUser.lockedUntil && dbUser.lockedUntil > new Date())) {
          ack?.({ success: false, message: 'Unauthorized' });
          return;
        }
        socket.data.user = {
          id: dbUser.id,
          name: dbUser.name || 'User',
          email: dbUser.email,
          role: dbUser.role,
          isAuthenticated: true,
        };
        socket.data.tokenPayload = decoded;
        socket.join(`user:${dbUser.id}`);
        ack?.({ success: true, user: socket.data.user });
      } catch (err: any) {
        ack?.({ success: false, message: err.message });
      }
    };

    socket.on('socket:authenticate', handleDynamicAuth);
    socket.on('authenticate', handleDynamicAuth);

    registerSfuSignaling(io, socket);

    socket.on('meeting:join', (data, ack) => handleJoinMeeting(io, socket, data?.meetingCode, ack));
    socket.on('meeting:leave', (data, ack) => handleLeaveMeeting(io, socket, data?.meetingCode, ack));
    socket.on('meeting:end', (data, ack) => handleEndMeeting(io, socket, data, ack));

    socket.on('meeting:toggle-mic', (data, ack) => handleToggleMic(io, socket, data, ack));
    socket.on('meeting:toggle-cam', (data, ack) => handleToggleCam(io, socket, data, ack));
    socket.on('meeting:mute-participant', (data, ack) => handleMuteParticipant(io, socket, data, ack));
    socket.on('meeting:send-message', (data, ack) => handleSendMeetingMessage(io, socket, data, ack));

    socket.on('meeting:admit-participant', (data, ack) => handleAdmitParticipant(io, socket, data, ack));
    socket.on('meeting:reject-participant', (data, ack) => handleRejectParticipant(io, socket, data, ack));

    socket.on('disconnect', () => {
      logger.info(`[Socket] Client disconnected: ${socket.id}`);
      handleDisconnectCleanup(io, socket);
    });
  });

  return io;
};
