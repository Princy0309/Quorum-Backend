import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../config/prisma';
import redis from '../config/redis';
import { hashToken } from '../utils/hashToken';

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

export const generateAccessToken = (userId: string): string => {
  return jwt.sign({ id: userId, jti: crypto.randomUUID() }, JWT_SECRET, {
    algorithm: 'HS256',
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn: (process.env.JWT_EXPIRES_IN as any) || '15m',
  });
};

export const verifyAccessToken = (token: string): any => {
  return jwt.verify(token, JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
};

export const generateRefreshToken = (userId: string): string => {
  return jwt.sign({ id: userId, type: 'refresh', jti: crypto.randomUUID() }, JWT_REFRESH_SECRET, {
    algorithm: 'HS256',
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn: REFRESH_TTL_SECONDS,
  });
};

export const verifyRefreshToken = (token: string): any => {
  const decoded = jwt.verify(token, JWT_REFRESH_SECRET, {
    algorithms: ['HS256'],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  }) as any;

  if (decoded.type !== 'refresh') {
    throw new Error('Invalid token type');
  }

  return decoded;
};


export const issueTokens = async (user: { id: string }, req?: any): Promise<{ accessToken: string; refreshToken: string }> => {
  const device = req?.headers?.['user-agent']?.slice(0, 200) || 'unknown';
  const accessToken = generateAccessToken(user.id);
  const refreshToken = generateRefreshToken(user.id);
  const tokenHash = hashToken(refreshToken);

  const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);

  try {
    await prisma.refreshToken.create({
      data: {
        tokenHash,
        userId: user.id,
        device,
        expiresAt,
      },
    });
  } catch (err) {
    console.error('Failed to save RefreshToken session to database:', err);
    const error: any = new Error('Internal Server Error');
    error.status = 500;
    throw error;
  }

  try {
    await redis.set(
      `refresh:${tokenHash}`,
      JSON.stringify({ userId: user.id, device, createdAt: Date.now() }),
      'EX',
      REFRESH_TTL_SECONDS
    );
    await redis.sadd(`user_sessions:${user.id}`, tokenHash);
    await redis.expire(`user_sessions:${user.id}`, REFRESH_TTL_SECONDS);
  } catch (err) {
    console.error('Failed to save RefreshToken session to Redis:', err);
  }

  return { accessToken, refreshToken };
};

export const rotateRefreshToken = async (rawToken: string, req?: any): Promise<{ accessToken: string; refreshToken: string }> => {
  try {
    verifyRefreshToken(rawToken);
  } catch (err) {
    const error: any = new Error('Invalid or expired refresh token');
    error.status = 401;
    throw error;
  }

  const tokenHash = hashToken(rawToken);

  return await prisma.$transaction(async (tx) => {
    const storedToken = await tx.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!storedToken || storedToken.revokedAt || storedToken.expiresAt < new Date()) {
      if (storedToken && storedToken.revokedAt) {
        // Reuse detection: revoke only the affected session family
        const familyTokens = await tx.refreshToken.findMany({
          where: { familyId: storedToken.familyId, revokedAt: null },
          select: { tokenHash: true }
        });
        const hashesToRevoke = familyTokens.map(t => t.tokenHash);

        await tx.refreshToken.updateMany({
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
      }
      const error: any = new Error('Invalid or expired refresh token');
      error.status = 401;
      throw error;
    }

    // Atomic conditional update
    const { count } = await tx.refreshToken.updateMany({
      where: { id: storedToken.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (count === 0) {
      // Token was revoked by a concurrent request - trigger reuse detection
      const familyTokens = await tx.refreshToken.findMany({
        where: { familyId: storedToken.familyId, revokedAt: null },
        select: { tokenHash: true }
      });
      const hashesToRevoke = familyTokens.map(t => t.tokenHash);

      await tx.refreshToken.updateMany({
        where: { familyId: storedToken.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      
      console.warn(`[Security] Concurrent token reuse detected for user ${storedToken.userId}. Session family revoked.`);
      
      try {
        if (hashesToRevoke.length > 0) {
          await redis.del(...hashesToRevoke.map((h) => `refresh:${h}`));
          await redis.srem(`user_sessions:${storedToken.userId}`, ...hashesToRevoke);
        }
      } catch (redisErr) {}
      
      const error: any = new Error('Invalid or expired refresh token');
      error.status = 401;
      throw error;
    }

    // Issue new tokens within the transaction
    const device = req?.headers?.['user-agent']?.slice(0, 200) || storedToken.device;
    const accessToken = generateAccessToken(storedToken.userId);
    const refreshToken = generateRefreshToken(storedToken.userId);
    const newTokenHash = hashToken(refreshToken);
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

    try {
      await redis.del(`refresh:${tokenHash}`);
      await redis.srem(`user_sessions:${storedToken.userId}`, tokenHash);
      
      await redis.set(
        `refresh:${newTokenHash}`,
        JSON.stringify({ userId: storedToken.userId, device, createdAt: Date.now() }),
        'EX',
        REFRESH_TTL_SECONDS
      );
      await redis.sadd(`user_sessions:${storedToken.userId}`, newTokenHash);
      await redis.expire(`user_sessions:${storedToken.userId}`, REFRESH_TTL_SECONDS);
    } catch (err) {
      console.error('Failed to update Redis during rotation:', err);
    }

    return { accessToken, refreshToken };
  });
};

export const revokeRefreshToken = async (rawToken: string): Promise<void> => {
  const tokenHash = hashToken(rawToken);

  try {
    await prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  } catch (err) {
    // Database revocation error ignored safely
  }

  try {
    const raw = await redis.get(`refresh:${tokenHash}`);
    if (raw) {
      const { userId } = JSON.parse(raw);
      await redis.del(`refresh:${tokenHash}`);
      await redis.srem(`user_sessions:${userId}`, tokenHash);
    }
  } catch (err) {
    // Redis revocation error ignored safely
  }
};

export const revokeAllSessions = async (userId: string): Promise<void> => {
  try {
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  } catch (err) {
    // Database revocation error ignored safely
  }

  try {
    const hashes = await redis.smembers(`user_sessions:${userId}`);
    if (hashes.length) {
      await redis.del(...hashes.map((h) => `refresh:${h}`));
    }
    await redis.del(`user_sessions:${userId}`);
  } catch (err) {
    // Redis revocation error ignored safely
  }
};
