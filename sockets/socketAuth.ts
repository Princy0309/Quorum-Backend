import { Socket } from 'socket.io';
import { verifyAccessToken, AccessTokenPayload } from '../services/tokenService.js';
import prisma from '../config/prisma.js';
import redis from '../config/redis.js';
import { User } from '@prisma/client';

export type SafeUser = Omit<User, 'passwordHash'>;

export interface AuthenticatedSocket extends Socket {
  data: {
    user?: SafeUser;
    tokenPayload?: AccessTokenPayload;
  };
}

export const socketAuthMiddleware = async (socket: Socket, next: (err?: Error) => void) => {
  const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');

  if (!token) {
    return next(new Error('Authentication error: Missing token'));
  }

  let decoded: AccessTokenPayload;
  try {
    decoded = verifyAccessToken(token);
  } catch (err) {
    return next(new Error('Authentication error: Invalid or expired token'));
  }

  if (!decoded.sid) {
    return next(new Error('Authentication error: Missing session ID'));
  }

  try {
    const isRevoked = await redis.exists(`revoked_access:${decoded.jti}`);
    if (isRevoked) {
      return next(new Error('Authentication error: Token revoked'));
    }

    const dbSession = await prisma.refreshToken.findFirst({
      where: { familyId: decoded.sid, revokedAt: null }
    });

    if (!dbSession || dbSession.userId !== decoded.id || dbSession.expiresAt < new Date()) {
      return next(new Error('Authentication error: Session revoked or expired'));
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.id }
    });

    if (!user) {
      return next(new Error('Authentication error: User no longer exists'));
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return next(new Error('Authentication error: Account is temporarily locked'));
    }

    const { passwordHash, ...safeUser } = user;
    socket.data.user = safeUser;
    socket.data.tokenPayload = decoded;

    next();
  } catch (err) {
    next(new Error('Authentication error: Internal server error'));
  }
};

