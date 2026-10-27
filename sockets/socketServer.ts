import { Server } from 'socket.io';
import { registerSfuSignaling } from './sfuSignaling.js';
import { handleJoinMeeting, handleLeaveMeeting, handleEndMeeting, handleDisconnectCleanup } from './meetingPresence.js';
import { handleToggleMic, handleToggleCam, handleMuteParticipant, handleSendMeetingMessage } from './meetingControls.js';
import { handleAdmitParticipant, handleRejectParticipant } from './waitingRoom.js';
import logger from '../utils/logger.js';
import { verifyAccessToken } from '../services/tokenService.js';
import prisma from '../config/prisma.js';
import { isOriginAllowed } from '../config/env.js';
import { registerMessageHandler } from './handlers/messageHandler.js';
import { registerTypingHandler } from './handlers/typingHandler.js';
import { registerPresenceHandler } from './handlers/presenceHandler.js';
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
    const auth = socket.handshake.auth || {};
    const query = socket.handshake.query || {};
    let userId: string | null = (typeof auth.userId === 'string' && auth.userId.trim()) || (typeof query.userId === 'string' && query.userId.trim()) || null;
    let name: string = auth.name || (typeof query.name === 'string' ? query.name : '') || 'Participant';

    let rawToken = auth.token ||
      (typeof socket.handshake.headers.authorization === 'string' ? socket.handshake.headers.authorization : '') ||
      (typeof query.token === 'string' ? query.token : '');

    let token = typeof rawToken === 'string' ? rawToken.replace(/^Bearer\s+/i, '').trim() : '';

    if (token) {
      try {
        const decoded = verifyAccessToken(token);
        if (decoded?.id) {
          userId = decoded.id;
        }
      } catch (err: any) {
        logger.warn(`[Socket Auth] Token verification failed for socket ${socket.id}: ${err.message}`);
        return next(new Error('Authentication error: jwt expired'));
      }
    }

    if (userId && (!name || name === 'Participant')) {
      try {
        const dbUser = await prisma.user.findUnique({
          where: { id: userId },
          select: { name: true },
        });
        if (dbUser?.name) {
          name = dbUser.name;
        }
      } catch (err: any) {
        logger.warn(`[Socket Auth] Could not fetch user name for ${userId}: ${err.message}`);
      }
    }

    socket.data.user = {
      id: String(userId || socket.id),
      name: String(name),
      isAuthenticated: !!userId,
    };

    logger.info(`[Socket Auth] Client ${socket.id} resolved: userId=${socket.data.user.id}, name=${socket.data.user.name}, isAuth=${socket.data.user.isAuthenticated}`);
    next();
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
        const dbUser = await prisma.user.findUnique({
          where: { id: decoded.id },
          select: { id: true, name: true }
        });
        if (!dbUser) {
          ack?.({ success: false, message: 'User not found' });
          return;
        }
        socket.data.user = {
          id: dbUser.id,
          name: dbUser.name || 'User',
          isAuthenticated: true,
        };
        socket.join(`user:${dbUser.id}`);
        logger.info(`[Socket Auth] Client ${socket.id} dynamically authenticated as userId=${dbUser.id}`);
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
