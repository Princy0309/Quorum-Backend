import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { socketAuthMiddleware, AuthenticatedSocket } from './socketAuth.js';
import { registerMessageHandler } from './handlers/messageHandler.js';
import { registerTypingHandler } from './handlers/typingHandler.js';
import { registerPresenceHandler } from './handlers/presenceHandler.js';
import { registerCommunityHandler } from './handlers/communityHandler.js';
import { registerWhiteboardHandler } from './handlers/whiteboardHandler.js';
import env, { isOriginAllowed } from '../config/env.js';
import prisma from '../config/prisma.js';
import redis from '../config/redis.js';
import { createAdapter } from '@socket.io/redis-adapter';

let io: SocketIOServer | null = null;

export const initSocketServer = (httpServer: HttpServer): SocketIOServer => {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (isOriginAllowed(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true
    }
  });

  const pubClient = redis;
  const subClient = redis.duplicate();
  io.adapter(createAdapter(pubClient, subClient));

  io.use(socketAuthMiddleware);

  io.on('connection', (socket: AuthenticatedSocket) => {
    const userId = socket.data.user?.id;
    if (userId) {
      socket.join(`user:${userId}`);
    }

    registerMessageHandler(io!, socket);
    registerTypingHandler(io!, socket);
    registerPresenceHandler(io!, socket);
    registerCommunityHandler(io!, socket);
    registerWhiteboardHandler(io!, socket as any);
  });

  return io;
};


export const getIO = (): SocketIOServer => {
  if (!io) {
    throw new Error('Socket.io is not initialized');
  }
  return io;
};

