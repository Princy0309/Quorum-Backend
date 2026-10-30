import { Socket } from 'socket.io';
import { verifyAccessToken, verifyRefreshToken, AccessTokenPayload } from '../services/tokenService.js';
import { hashToken } from '../utils/hashToken.js';
import prisma from '../config/prisma.js';
import redis from '../config/redis.js';
import { User } from '@prisma/client';

export type SafeUser = Omit<User, 'passwordHash'>;

export interface AuthenticatedSocket extends Socket {
  data: {
    user?: SafeUser & { isAuthenticated?: boolean };
    tokenPayload?: AccessTokenPayload;
  };
}

export const socketAuthMiddleware = async (socket: Socket, next: (err?: Error) => void) => {
  const parseCookieToken = (cookieHeader?: string, name: string = 'accessToken'): string | null => {
    if (!cookieHeader) return null;
    const regex = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`);
    const match = cookieHeader.match(regex);
    return match ? decodeURIComponent(match[1]) : null;
  };

  const rawCandidates = [
    socket.handshake.auth?.token,
    socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, ''),
    parseCookieToken(socket.handshake.headers?.cookie, 'accessToken'),
  ];

  let decoded: AccessTokenPayload | null = null;
  for (const candidate of rawCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      try {
        decoded = verifyAccessToken(candidate.trim());
        break;
      } catch {
        // Try next candidate
      }
    }
  }

  // Auto-heal fallback: If access token candidates are expired or missing,
  // verify the client's active refreshToken cookie from the WebSocket handshake.
  if (!decoded) {
    const rawRefresh = parseCookieToken(socket.handshake.headers?.cookie, 'refreshToken') || socket.handshake.auth?.refreshToken;
    if (rawRefresh && typeof rawRefresh === 'string') {
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
      } catch {
        // Refresh token invalid
      }
    }
  }

  if (!decoded) {
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
    socket.data.user = {
      ...safeUser,
      isAuthenticated: true
    };
    socket.data.tokenPayload = decoded;

    next();
  } catch (err) {
    next(new Error('Authentication error: Internal server error'));
  }
};

