import { Socket } from 'socket.io';
import { verifyAccessToken, AccessTokenPayload } from '../services/tokenService.js';

export interface AuthenticatedSocket extends Socket {
  data: {
    user?: AccessTokenPayload;
  };
}

export const socketAuthMiddleware = (socket: Socket, next: (err?: Error) => void) => {
  const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');

  if (!token) {
    return next(new Error('Authentication error: Missing token'));
  }

  try {
    const decoded = verifyAccessToken(token);
    socket.data.user = decoded;
    next();
  } catch (err) {
    next(new Error('Authentication error: Invalid or expired token'));
  }
};
