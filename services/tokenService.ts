import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../config/prisma';
import redis from '../config/redis';
import { hashToken } from '../utils/hashToken';
import { ApiError } from '../utils/ApiError';
import { encryptPayload, decryptPayload } from '../utils/encryption';

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

export const saveSessionToRedis = async (familyId: string, userId: string, device: string) => {
  try {
    await redis.set(
      `refresh:${familyId}`,
      JSON.stringify({ userId, device, createdAt: Date.now() }),
      'EX',
      REFRESH_TTL_SECONDS
    );
    await redis.sadd(`user_sessions:${userId}`, familyId);
    await redis.expire(`user_sessions:${userId}`, REFRESH_TTL_SECONDS);
  } catch (err) {
    console.error('Failed to save RefreshToken session to Redis:', err);
    throw new ApiError(500, 'Internal Server Error');
  }
};

export const deleteSessionFromRedis = async (familyId: string, userId: string) => {
  try {
    await redis.del(`refresh:${familyId}`);
    await redis.srem(`user_sessions:${userId}`, familyId);
  } catch (err) {
    console.error('Failed to remove session from Redis:', err);
    throw new ApiError(500, 'Internal Server Error');
  }
};

export const issueTokens = async (user: { id: string }, req?: any): Promise<{ accessToken: string; refreshToken: string }> => {
  const device = req?.headers?.['user-agent']?.slice(0, 200) || 'unknown';
  const refreshToken = generateRefreshToken(user.id);
  const tokenHash = hashToken(refreshToken);
  
  const familyId = crypto.randomUUID();
  const accessToken = generateAccessToken(user.id, familyId);

  const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);

  await saveSessionToDb(tokenHash, user.id, device, expiresAt, familyId);

  try {
    await saveSessionToRedis(familyId, user.id, device);
  } catch (err) {
    console.error('Rolling back DB after Redis failure');
    await prisma.refreshToken.delete({ where: { tokenHash } }).catch(e => console.error('Rollback failed:', e));
    throw err;
  }

  return { accessToken, refreshToken };
};

const performReuseRevocation = async (storedToken: any) => {

  await prisma.refreshToken.updateMany({
    where: { familyId: storedToken.familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  
  console.warn(`[Security] Token reuse detected for user ${storedToken.userId}. Session family revoked.`);
  
  try {
    await redis.del(`refresh:${storedToken.familyId}`);
    await redis.srem(`user_sessions:${storedToken.userId}`, storedToken.familyId);
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

  const storedToken = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!storedToken || storedToken.expiresAt < new Date()) {
    throw new ApiError(401, 'Invalid or expired refresh token');
  }

  const idempotencyKey = `rotate_result:${tokenHash}`;

  if (storedToken.revokedAt) {
    const cachedResult = await redis.get(idempotencyKey);
    if (cachedResult) {
      try {
        const parsed = decryptPayload(rawToken, cachedResult);
        return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
      } catch (e) {
        throw new ApiError(401, 'Invalid or expired refresh token');
      }
    }
    await performReuseRevocation(storedToken);
    throw new ApiError(401, 'Invalid or expired refresh token');
  }

  let result: any;
  try {
    result = await prisma.$transaction(async (tx) => {
      const { count } = await tx.refreshToken.updateMany({
        where: { id: storedToken.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      if (count === 0) {
        throw new Error('CONCURRENT_ROTATION');
      }

      const device = req?.headers?.['user-agent']?.slice(0, 200) || storedToken.device;
      const refreshToken = generateRefreshToken(storedToken.userId);
      const newTokenHash = hashToken(refreshToken);
      const accessToken = generateAccessToken(storedToken.userId, storedToken.familyId);
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
      for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setTimeout(resolve, 300));
        const retryCache = await redis.get(idempotencyKey);
        if (retryCache) {
          try {
            const parsed = decryptPayload(rawToken, retryCache);
            return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
          } catch (e) {
            throw new ApiError(401, 'Invalid or expired refresh token');
          }
        }
      }
      throw new ApiError(401, 'Invalid or expired refresh token');
    }
    throw err;
  }

  try {
    await saveSessionToRedis(storedToken.familyId, storedToken.userId, result.device);
    const encryptedCache = encryptPayload(rawToken, {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken
    });
    await redis.set(idempotencyKey, encryptedCache, 'EX', 20);
    
  } catch (err) {
    console.error('Failed to update Redis during rotation. DB transaction succeeded. Client will receive tokens and can recover via DB.', err);
  }

  return { accessToken: result.accessToken, refreshToken: result.refreshToken };
};

export const revokeRefreshToken = async (rawToken: string): Promise<void> => {
  const tokenHash = hashToken(rawToken);

  let familyId: string | undefined;
  try {
    const token = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { familyId: true }
    });
    
    if (token) {
      familyId = token.familyId;
      await prisma.refreshToken.updateMany({
        where: { familyId: token.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  } catch (err) {
    console.error('Failed to revoke session family in database:', err);
    throw new ApiError(500, 'Internal Server Error');
  }

  if (familyId) {
    try {
      const raw = await redis.get(`refresh:${familyId}`);
      if (raw) {
        const { userId } = JSON.parse(raw);
        await deleteSessionFromRedis(familyId, userId);
      }
    } catch (err) {
      console.error('Failed to revoke session family in Redis:', err);
      throw new ApiError(500, 'Internal Server Error');
    }
  }
};

export const revokeAllSessions = async (userId: string): Promise<void> => {
  let dbFamilyIds: string[] = [];
  try {
    const activeSessions = await prisma.refreshToken.findMany({
      where: { userId, revokedAt: null },
      select: { familyId: true },
    });
    dbFamilyIds = activeSessions.map(s => s.familyId);

    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  } catch (err) {
    console.error('Failed to revoke all sessions in database:', err);
    throw new ApiError(500, 'Internal Server Error');
  }

  try {
    const redisHashes = await redis.smembers(`user_sessions:${userId}`);
    const allFamilyIds = Array.from(new Set([...redisHashes, ...dbFamilyIds]));
    
    if (allFamilyIds.length > 0) {
      await redis.del(...allFamilyIds.map((h) => `refresh:${h}`));
    }
    await redis.del(`user_sessions:${userId}`);
  } catch (err) {
    console.error('Failed to revoke all sessions in Redis:', err);
    throw new ApiError(500, 'Internal Server Error');
  }
};
