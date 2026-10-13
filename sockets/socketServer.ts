import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { verifyAccessToken } from '../services/tokenService.js';
import prisma from '../config/prisma.js';
import env from '../config/env.js';
import logger from '../utils/logger.js';
import { handleJoinMeeting, handleLeaveMeeting, handleEndMeeting, handleDisconnectCleanup } from './meetingPresence.js';
import { handleAdmitParticipant, handleRejectParticipant } from './waitingRoom.js';
import { handleToggleMic, handleToggleCam, handleMuteParticipant, handleSendMeetingMessage, MuteParticipantPayload } from './meetingControls.js';
import { registerSfuSignalingHandler } from './sfuSignaling.js';
import { registerMessageHandler } from './handlers/messageHandler.js';
import { registerTypingHandler } from './handlers/typingHandler.js';
import { registerPresenceHandler } from './handlers/presenceHandler.js';

export interface AuthenticatedSocket extends Socket {
  data: {
    user: {
      id: string;
      name: string;
      email: string;
      role: string;
    };
  };
}

let ioServer: SocketIOServer | null = null;

export const getIO = (): SocketIOServer => {
  if (!ioServer) {
    throw new Error('Socket.io server has not been initialized');
  }
  return ioServer;
};

const allowedOrigins = env.ALLOWED_ORIGINS
  ? env.ALLOWED_ORIGINS.split(',').map((o: string) => o.trim()).filter(Boolean)
  : [
    'https://quorum-web-omega.vercel.app',
    'https://newquorum.me',
    'https://www.newquorum.me',
    'https://api.newquorum.me',
    'http://localhost:3000',
    'http://localhost:5173',
  ];

export const initSocketServer = (httpServer: HTTPServer): SocketIOServer => {
  ioServer = new SocketIOServer(httpServer, {
    cors: {
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        if (!origin) return callback(null, true);

        const isAllowedDomain = allowedOrigins.includes(origin);
        const isLocalDev = env.NODE_ENV !== 'production' && (
          origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')
        );

        if (isAllowedDomain || isLocalDev) {
          callback(null, true);
        } else {
          callback(new Error('CORS origin not allowed'), false);
        }
      },
    },
  });

  ioServer.use(async (socket, next) => {
    try {
      const auth = socket.handshake.auth || {};
      const query = socket.handshake.query || {};

      let rawToken =
        auth.token ||
        (typeof socket.handshake.headers.authorization === 'string' ? socket.handshake.headers.authorization : '') ||
        (typeof query.token === 'string' ? query.token : '');

      let token = typeof rawToken === 'string' ? rawToken.replace(/^Bearer\s+/i, '').trim() : '';

      if (!token) {
        return next(new Error('Authentication error: Missing token'));
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

      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { id: true, name: true, email: true },
      });

      if (!user) {
        return next(new Error('Authentication error: User not found'));
      }

      socket.data.user = {
        id: user.id,
        name: user.name || auth.name || 'User',
        email: user.email,
        role: decoded.role || 'user',
      };

      socket.join(`user:${user.id}`);
      next();
    } catch (err: any) {
      next(new Error(`Authentication error: ${err.message}`));
    }
  });

  ioServer.on('connection', (socket) => {
    logger.info(`[Socket] Client connected: ${socket.id}`);

    registerMessageHandler(ioServer!, socket as any);
    registerTypingHandler(ioServer!, socket as any);
    registerPresenceHandler(ioServer!, socket as any);

    socket.on('meeting:join', (data: { meetingCode: string }, ack?: (res: any) => void) => {
      handleJoinMeeting(ioServer!, socket, data?.meetingCode, ack);
    });

    socket.on('meeting:leave', (data: { meetingCode: string }, ack?: (res: any) => void) => {
      handleLeaveMeeting(ioServer!, socket, data?.meetingCode, ack);
    });

    socket.on('meeting:admit-participant', (data: { meetingCode: string; targetUserId: string }, ack?: (res: any) => void) => {
      handleAdmitParticipant(ioServer!, socket, data, ack);
    });

    socket.on('meeting:reject-participant', (data: { meetingCode: string; targetUserId: string }, ack?: (res: any) => void) => {
      handleRejectParticipant(ioServer!, socket, data, ack);
    });

    socket.on('meeting:toggle-mic', (data: { meetingCode: string; isMuted: boolean }, ack?: (res: any) => void) => {
      handleToggleMic(ioServer!, socket, data, ack);
    });

    socket.on('meeting:mute-participant', (data: MuteParticipantPayload, ack?: (res: any) => void) => {
      handleMuteParticipant(ioServer!, socket, data, ack);
    });

    socket.on('meeting:toggle-cam', (data: { meetingCode: string; isVideoOff: boolean }, ack?: (res: any) => void) => {
      handleToggleCam(ioServer!, socket, data, ack);
    });

    socket.on('meeting:send-message', (data: { meetingCode: string; content: string }, ack?: (res: any) => void) => {
      handleSendMeetingMessage(ioServer!, socket, data, ack);
    });

    socket.on('meeting:end', (data: { meetingCode: string }, ack?: (res: any) => void) => {
      handleEndMeeting(ioServer!, socket, data, ack);
    });

    registerSfuSignalingHandler(ioServer!, socket);

    socket.on('disconnect', () => {
      logger.info(`[Socket] Client disconnected: ${socket.id}`);
      handleDisconnectCleanup(ioServer!, socket);
    });
  });

  return ioServer;
};
