import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../config/prisma';
import redis from '../config/redis';
import { hashToken } from '../utils/hashToken';
import { ApiError } from '../utils/ApiError';

const JWT_ISSUER = process.env.JWT_ISSUER || 'quorum-api';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'quorum-app';

const parsedTTL = parseInt(process.env.REFRESH_TOKEN_TTL_SECONDS || '', 10);
if (isNaN(parsedTTL) || parsedTTL <= 0) {
  throw new Error('FATAL: REFRESH_TOKEN_TTL_SECONDS must be a valid positive integer');
}
const REFRESH_TTL_SECONDS = parsedTTL;

if (!process.env.JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is missing');
}
const JWT_SECRET = process.env.JWT_SECRET;

if (!process.env.JWT_REFRESH_SECRET) {
  throw new Error('FATAL: JWT_REFRESH_SECRET environment variable is missing');
}
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

export interface AccessTokenPayload {
  id: string;
  type: 'access';
  sid?: string;
  jti: string;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string;
}

export interface RefreshTokenPayload {
  id: string;
  type: 'refresh';
  jti: string;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string;
}

export const generateAccessToken = (userId: string, sid?: string): string => {
  return jwt.sign({ id: userId, type: 'access', sid, jti: crypto.randomUUID() }, JWT_SECRET, {
    algorithm: 'HS256',
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn: (process.env.JWT_EXPIRES_IN as any) || '15m',
  });
};

export const verifyAccessToken = (token: string): AccessTokenPayload => {
  const decoded = jwt.verify(token, JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  }) as any;

  if (decoded.type !== 'access') {
    throw new Error('Invalid token type');
  }

  return decoded as AccessTokenPayload;
};

export const generateRefreshToken = (userId: string): string => {
  return jwt.sign({ id: userId, type: 'refresh', jti: crypto.randomUUID() }, JWT_REFRESH_SECRET, {
    algorithm: 'HS256',
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn: REFRESH_TTL_SECONDS,
  });
};

export const verifyRefreshToken = (token: string): RefreshTokenPayload => {
  const decoded = jwt.verify(token, JWT_REFRESH_SECRET, {
    algorithms: ['HS256'],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  }) as any;

  if (decoded.type !== 'refresh') {
    throw new Error('Invalid token type');
  }

  return decoded as RefreshTokenPayload;
};


export const saveSessionToDb = async (tokenHash: string, userId: string, device: string, expiresAt: Date, familyId?: string) => {
  try {
    return await prisma.refreshToken.create({
      data: {
        tokenHash,
        userId,
        device,
        expiresAt,
        ...(familyId && { familyId }),
      },
    });
  } catch (err) {
    console.error('Failed to save RefreshToken session to database:', err);
    throw new ApiError(500, 'Internal Server Error');
  }
};

export const saveSessionToRedis = async (tokenHash: string, userId: string, device: string) => {
  try {
    await redis.set(
      `refresh:${tokenHash}`,
      JSON.stringify({ userId, device, createdAt: Date.now() }),
      'EX',
      REFRESH_TTL_SECONDS
    );
    await redis.sadd(`user_sessions:${userId}`, tokenHash);
    await redis.expire(`user_sessions:${userId}`, REFRESH_TTL_SECONDS);
  } catch (err) {
    console.error('Failed to save RefreshToken session to Redis:', err);
    throw new ApiError(500, 'Internal Server Error');
  }
};

export const deleteSessionFromRedis = async (tokenHash: string, userId: string) => {
  try {
    await redis.del(`refresh:${tokenHash}`);
    await redis.srem(`user_sessions:${userId}`, tokenHash);
  } catch (err) {
    console.error('Failed to remove session from Redis:', err);
    throw new ApiError(500, 'Internal Server Error');
  }
};

export const issueTokens = async (user: { id: string }, req?: any): Promise<{ accessToken: string; refreshToken: string }> => {
  const device = req?.headers?.['user-agent']?.slice(0, 200) || 'unknown';
  const refreshToken = generateRefreshToken(user.id);
  const tokenHash = hashToken(refreshToken);
  const accessToken = generateAccessToken(user.id, tokenHash);

  const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);

  await saveSessionToDb(tokenHash, user.id, device, expiresAt);

  try {
    await saveSessionToRedis(tokenHash, user.id, device);
  } catch (err) {
    console.error('Rolling back DB after Redis failure');
    await prisma.refreshToken.delete({ where: { tokenHash } }).catch(e => console.error('Rollback failed:', e));
    throw err;
  }

  return { accessToken, refreshToken };
};

const performReuseRevocation = async (storedToken: any) => {
  const familyTokens = await prisma.refreshToken.findMany({
    where: { familyId: storedToken.familyId, revokedAt: null },
    select: { tokenHash: true }
  });
  const hashesToRevoke = familyTokens.map(t => t.tokenHash);

  await prisma.refreshToken.updateMany({
    where: { familyId: storedToken.familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  
  console.warn(`[Security] Token reuse detected for user ${storedToken.userId}. Session family revoked.`);
  
  try {
    if (hashesToRevoke.length > 0) {
      await redis.del(...hashesToRevoke.map((h) => `refresh:${h}`));
      await redis.srem(`user_sessions:${storedToken.userId}`, ...hashesToRevoke);
    }
  } catch (redisErr) {}
};

export const rotateRefreshToken = async (rawToken: string, req?: any): Promise<{ accessToken: string; refreshToken: string }> => {
  try {
    verifyRefreshToken(rawToken);
  } catch (err) {
    throw new ApiError(401, 'Invalid or expired refresh token');
  }

  const tokenHash = hashToken(rawToken);

  const storedToken = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  const GRACE_PERIOD_MS = 20000; // 20 seconds grace period for concurrent requests
  let isConcurrentRefresh = false;

  if (!storedToken || storedToken.expiresAt < new Date()) {
    throw new ApiError(401, 'Invalid or expired refresh token');
  }

  if (storedToken.revokedAt) {
    const timeSinceRevoked = Date.now() - storedToken.revokedAt.getTime();
    if (timeSinceRevoked > GRACE_PERIOD_MS) {
      await performReuseRevocation(storedToken);
      throw new ApiError(401, 'Invalid or expired refresh token');
    } else {
      isConcurrentRefresh = true;
    }
  }

  let result: any;
  try {
    result = await prisma.$transaction(async (tx) => {
      if (!isConcurrentRefresh) {
        // Atomic conditional update
        const { count } = await tx.refreshToken.updateMany({
          where: { id: storedToken.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });

        if (count === 0) {
          // A concurrent request just revoked it between our read and write!
          isConcurrentRefresh = true;
        }
      }

      // Issue new tokens within the transaction
      const device = req?.headers?.['user-agent']?.slice(0, 200) || storedToken.device;
      const refreshToken = generateRefreshToken(storedToken.userId);
      const newTokenHash = hashToken(refreshToken);
      const accessToken = generateAccessToken(storedToken.userId, newTokenHash);
      const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);

      await tx.refreshToken.create({
        data: {
          tokenHash: newTokenHash,
          userId: storedToken.userId,
          familyId: storedToken.familyId,
          device,
          expiresAt,
        },
      });

      return { accessToken, refreshToken, newTokenHash, device };
    });
  } catch (err: any) {
    throw err;
  }

  // Perform Redis updates AFTER successful database commit
  try {
    await redis.del(`refresh:${tokenHash}`);
    await redis.srem(`user_sessions:${storedToken.userId}`, tokenHash);
    
    await saveSessionToRedis(result.newTokenHash, storedToken.userId, result.device);
  } catch (err) {
    console.error('Failed to update Redis during rotation, performing DB compensation:', err);
    await prisma.refreshToken.delete({ where: { tokenHash: result.newTokenHash } }).catch(e => console.error('Compensation failed:', e));
    throw new ApiError(500, 'Internal Server Error');
  }

  return { accessToken: result.accessToken, refreshToken: result.refreshToken };
};

export const revokeRefreshToken = async (rawToken: string): Promise<void> => {
  const tokenHash = hashToken(rawToken);

  try {
    await prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  } catch (err) {
    console.error('Failed to revoke RefreshToken in database:', err);
    throw new ApiError(500, 'Internal Server Error');
  }

  try {
    const raw = await redis.get(`refresh:${tokenHash}`);
    if (raw) {
      const { userId } = JSON.parse(raw);
      await deleteSessionFromRedis(tokenHash, userId);
    }
  } catch (err) {
    console.error('Failed to revoke RefreshToken in Redis:', err);
    throw new ApiError(500, 'Internal Server Error');
  }
};

export const revokeAllSessions = async (userId: string): Promise<void> => {
  try {
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  } catch (err) {
    console.error('Failed to revoke all sessions in database:', err);
    throw new ApiError(500, 'Internal Server Error');
  }

  try {
    const hashes = await redis.smembers(`user_sessions:${userId}`);
    if (hashes.length) {
      await redis.del(...hashes.map((h) => `refresh:${h}`));
    }
    await redis.del(`user_sessions:${userId}`);
  } catch (err) {
    console.error('Failed to revoke all sessions in Redis:', err);
    throw new ApiError(500, 'Internal Server Error');
  }
};
