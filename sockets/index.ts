import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { socketAuthMiddleware, AuthenticatedSocket } from './socketAuth.js';
import { registerMessageHandler } from './handlers/messageHandler.js';
import { registerTypingHandler } from './handlers/typingHandler.js';
import { registerPresenceHandler } from './handlers/presenceHandler.js';
import env from '../config/env.js';

let io: SocketIOServer | null = null;

const allowedOrigins = env.ALLOWED_ORIGINS 
  ? env.ALLOWED_ORIGINS.split(',').map((o: string) => o.trim()).filter(Boolean)
  : [
      'https://quorum-web-omega.vercel.app',
      'https://newquorum.me',
      'https://www.newquorum.me',
      'http://localhost:3000',
      'http://localhost:5173',
    ];

export const initSocketServer = (httpServer: HttpServer): SocketIOServer => {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        const isAllowedDomain = allowedOrigins.includes(origin);
        const isLocalDev = env.NODE_ENV !== 'production' && (
          origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')
        );
        if (isAllowedDomain || isLocalDev) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true
    }
  });

  io.use(socketAuthMiddleware);

  io.on('connection', (socket: AuthenticatedSocket) => {
    const userId = socket.data.user?.id;
    if (userId) {
      socket.join(`user:${userId}`);
    }

    registerMessageHandler(io!, socket);
    registerTypingHandler(io!, socket);
    registerPresenceHandler(io!, socket);
  });

  return io;
};


export const getIO = (): SocketIOServer => {
  if (!io) {
    throw new Error('Socket.io is not initialized');
  }
  return io;
};

