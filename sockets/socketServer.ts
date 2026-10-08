import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { verifyAccessToken } from '../services/tokenService.js';
import prisma from '../config/prisma.js';
import { handleJoinMeeting, handleLeaveMeeting, handleDisconnectCleanup } from './meetingPresence.js';
import { handleAdmitParticipant, handleRejectParticipant } from './waitingRoom.js';

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

export const initSocketServer = (httpServer: HTTPServer): SocketIOServer => {
  ioServer = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      credentials: true,
    },
  });

  ioServer.use(async (socket, next) => {
    try {
      const rawToken =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization;

      if (!rawToken || typeof rawToken !== 'string') {
        return next(new Error('Authentication error: Missing token'));
      }

      const token = rawToken.startsWith('Bearer ')
        ? rawToken.slice(7).trim()
        : rawToken.trim();

      const payload = verifyAccessToken(token);

      const user = await prisma.user.findUnique({
        where: { id: payload.id },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      });

      if (!user) {
        return next(new Error('Authentication error: User not found'));
      }

      socket.data.user = user;
      next();
    } catch (err: any) {
      next(new Error('Authentication error: Invalid token'));
    }
  });

  ioServer.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id} (User: ${socket.data.user?.id})`);

    socket.on('meeting:join', (data: { meetingCode: string }) => {
      handleJoinMeeting(ioServer!, socket, data?.meetingCode);
    });

    socket.on('meeting:leave', (data: { meetingCode: string }) => {
      handleLeaveMeeting(ioServer!, socket, data?.meetingCode);
    });

    socket.on('meeting:admit-participant', (data: { meetingCode: string; targetUserId: string }) => {
      handleAdmitParticipant(ioServer!, socket, data);
    });

    socket.on('meeting:reject-participant', (data: { meetingCode: string; targetUserId: string }) => {
      handleRejectParticipant(ioServer!, socket, data);
    });

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
      handleDisconnectCleanup(ioServer!, socket);
    });
  });

  return ioServer;
};
