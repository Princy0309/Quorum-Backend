import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { socketAuthMiddleware, AuthenticatedSocket } from './socketAuth.js';

let io: SocketIOServer | null = null;

export const initSocketServer = (httpServer: HttpServer): SocketIOServer => {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || 'http://localhost:3000',
      credentials: true
    }
  });

  io.use(socketAuthMiddleware);

  io.on('connection', (socket: AuthenticatedSocket) => {
    const userId = socket.data.user?.id;
    if (userId) {
      socket.join(`user:${userId}`);
    }
  });

  return io;
};

export const getIO = (): SocketIOServer => {
  if (!io) {
    throw new Error('Socket.io is not initialized');
  }
  return io;
};

