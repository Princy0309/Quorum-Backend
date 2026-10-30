import { Server } from 'socket.io';
import { registerSfuSignaling } from './sfuSignaling.js';
import { handleJoinMeeting, handleLeaveMeeting, handleEndMeeting, handleDisconnectCleanup } from './meetingPresence.js';
import { handleToggleMic, handleToggleCam, handleMuteParticipant, handleSendMeetingMessage } from './meetingControls.js';
import { handleAdmitParticipant, handleRejectParticipant } from './waitingRoom.js';
import logger from '../utils/logger.js';
import { verifyAccessToken, verifyRefreshToken } from '../services/tokenService.js';
import { hashToken } from '../utils/hashToken.js';
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
    const parseCookieToken = (cookieHeader?: string, name: string = 'accessToken'): string | null => {
      if (!cookieHeader) return null;
      const regex = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`);
      const match = cookieHeader.match(regex);
      return match ? decodeURIComponent(match[1]) : null;
    };

    const auth = socket.handshake.auth || {};
    const query = socket.handshake.query || {};

    const rawCandidates = [
      auth.token,
      socket.handshake.headers.authorization,
      parseCookieToken(socket.handshake.headers.cookie, 'accessToken'),
      query.token,
    ];

    const candidateTokens: string[] = [];
    for (const raw of rawCandidates) {
      if (typeof raw === 'string' && raw.trim()) {
        const clean = raw.replace(/^Bearer\s+/i, '').trim();
        if (clean && !candidateTokens.includes(clean)) {
          candidateTokens.push(clean);
        }
      }
    }

    let decoded: any = null;
    let token: string = '';

    for (const candidate of candidateTokens) {
      try {
        decoded = verifyAccessToken(candidate);
        token = candidate;
        break;
      } catch {
        // Continue to check other candidates (e.g. cookie if auth.token was expired)
      }
    }

    // Auto-healing fallback: If access token is expired or missing,
    // verify the client's active refreshToken cookie from the WebSocket handshake.
    if (!decoded) {
      const rawRefresh = parseCookieToken(socket.handshake.headers.cookie, 'refreshToken') || (typeof auth.refreshToken === 'string' ? auth.refreshToken : null);
      if (rawRefresh) {
        try {
          const decodedRefresh = verifyRefreshToken(rawRefresh.trim());
          if (decodedRefresh?.id) {
            const tokenHash = hashToken(rawRefresh.trim());
            const storedToken = await prisma.refreshToken.findUnique({
              where: { tokenHash },
              include: { user: true }
            });
            if (storedToken && !storedToken.revokedAt && storedToken.expiresAt > new Date()) {
              decoded = {
                id: storedToken.userId,
                type: 'access',
                sid: storedToken.familyId,
                jti: 'socket-refresh-fallback-' + storedToken.id,
              };
            }
          }
        } catch (refreshErr: any) {
          logger.warn(`[Socket Auth] Refresh token fallback check failed: ${refreshErr?.message}`);
        }
      }
    }

    if (!decoded) {
      if (candidateTokens.length === 0) {
        return next(new Error('Authentication error: Access token required'));
      }
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
