import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../config/prisma';
import redis from '../config/redis';
import { hashToken } from '../utils/hashToken';
import { ApiError } from '../utils/ApiError';

import env from '../config/env';

const JWT_ISSUER = env.JWT_ISSUER;
const JWT_AUDIENCE = env.JWT_AUDIENCE;
const REFRESH_TTL_SECONDS = env.REFRESH_TOKEN_TTL_SECONDS;
const JWT_SECRET = env.JWT_SECRET;
const JWT_REFRESH_SECRET = env.JWT_REFRESH_SECRET;

export interface AccessTokenPayload {
  id: string;
  type: 'access';
  sid: string;
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
    expiresIn: env.JWT_EXPIRES_IN || '15m',
  });
};

export const verifyAccessToken = (token: string): AccessTokenPayload => {
  const decoded = jwt.verify(token, JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });

  if (typeof decoded !== 'object' || decoded === null) {
    throw new Error('Invalid token payload');
  }
  if (decoded.type !== 'access') {
    throw new Error('Invalid token type');
  }
  if (typeof decoded.id !== 'string' || !decoded.id.trim()) {
    throw new Error('Missing or invalid id claim');
  }
  if (typeof decoded.jti !== 'string' || !decoded.jti.trim()) {
    throw new Error('Missing or invalid jti claim');
  }
  if (typeof decoded.sid !== 'string' || !decoded.sid.trim()) {
    throw new Error('Missing or invalid sid claim');
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
  });

  if (typeof decoded !== 'object' || decoded === null) {
    throw new Error('Invalid token payload');
  }
  if (decoded.type !== 'refresh') {
    throw new Error('Invalid token type');
  }
  if (typeof decoded.id !== 'string' || !decoded.id.trim()) {
    throw new Error('Missing or invalid id claim');
  }
  if (typeof decoded.jti !== 'string' || !decoded.jti.trim()) {
    throw new Error('Missing or invalid jti claim');
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
  } catch (redisErr) {
    console.error(`[Security] Failed to remove revoked family from Redis for user ${storedToken.userId}. DB revocation succeeded.`, redisErr);
  }
};

export const rotateRefreshToken = async (rawToken: string, req?: any): Promise<{ accessToken: string; refreshToken: string }> => {
  try {
    verifyRefreshToken(rawToken);
  } catch (err) {
    throw new ApiError(401, 'Invalid or expired refresh token');
  }

  const tokenHash = hashToken(rawToken);

  // 1. Idempotency Check
  const idempotencyKey = `rotate_result:${tokenHash}`;
  const cachedResult = await redis.get(idempotencyKey);
  if (cachedResult) {
    const parsed = JSON.parse(cachedResult);
    return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
  }

  const storedToken = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!storedToken || storedToken.expiresAt < new Date()) {
    throw new ApiError(401, 'Invalid or expired refresh token');
  }

  if (storedToken.revokedAt) {
    // If it is revoked but not in the idempotency cache, the 20s grace period is over.
    // This is confirmed reuse outside the retry mechanism.
    await performReuseRevocation(storedToken);
    throw new ApiError(401, 'Invalid or expired refresh token');
  }

  let result: any;
  try {
    result = await prisma.$transaction(async (tx) => {
      // Atomically claim the token
      const { count } = await tx.refreshToken.updateMany({
        where: { id: storedToken.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      if (count === 0) {
        // We lost the race. Another thread is currently processing the rotation.
        // Throw a specific error to catch and poll the idempotency cache.
        throw new Error('CONCURRENT_ROTATION');
      }

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
    if (err.message === 'CONCURRENT_ROTATION') {
      // Wait briefly for the winning thread to write the rotation result to Redis
      await new Promise(resolve => setTimeout(resolve, 500));
      const retryCache = await redis.get(idempotencyKey);
      if (retryCache) {
        const parsed = JSON.parse(retryCache);
        return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
      }
      throw new ApiError(401, 'Invalid or expired refresh token');
    }
    throw err;
  }

  try {
    await redis.del(`refresh:${tokenHash}`);
    await redis.srem(`user_sessions:${storedToken.userId}`, tokenHash);
    await saveSessionToRedis(result.newTokenHash, storedToken.userId, result.device);
    
    // Save idempotency result in Redis for the grace period (20s)
    await redis.set(idempotencyKey, JSON.stringify({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken
    }), 'EX', 20);
    
  } catch (err) {
    console.error('Failed to update Redis during rotation. DB transaction succeeded. Client will receive tokens and can recover via DB.', err);
    // We do NOT throw an error or compensate here. PostgreSQL is the source of truth.
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
