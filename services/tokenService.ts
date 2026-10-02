import jwt from 'jsonwebtoken';
import prisma from '../config/prisma';
import redis from '../config/redis';
import { hashToken } from '../utils/hashToken';

const REFRESH_TTL_SECONDS = parseInt(process.env.REFRESH_TOKEN_TTL_SECONDS || '', 10) || 7 * 24 * 60 * 60;

export const generateAccessToken = (userId: string): string => {
  const secret = process.env.JWT_SECRET || 'default_jwt_secret';
  return jwt.sign({ id: userId }, secret, {
    expiresIn: (process.env.JWT_EXPIRES_IN as any) || '15m',
  });
};

export const generateRefreshToken = (userId: string): string => {
  const secret = process.env.JWT_REFRESH_SECRET || 'fallback_refresh_secret';
  return jwt.sign({ id: userId }, secret, {
    expiresIn: (process.env.REFRESH_TOKEN_EXPIRES_IN as any) || '7d',
  });
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
    console.error('Error creating RefreshToken in Prisma:', err);
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
    console.error('Error storing refresh session in Redis:', err);
  }

  return { accessToken, refreshToken };
};

export const rotateRefreshToken = async (rawToken: string, req?: any): Promise<{ accessToken: string; refreshToken: string }> => {
  const secret = process.env.JWT_REFRESH_SECRET || 'fallback_refresh_secret';
  
  try {
    jwt.verify(rawToken, secret);
  } catch (err) {
    const error: any = new Error('Invalid or expired refresh token');
    error.status = 401;
    throw error;
  }

  const tokenHash = hashToken(rawToken);

  const storedToken = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!storedToken || storedToken.revokedAt || storedToken.expiresAt < new Date()) {
    const error: any = new Error('Invalid or expired refresh token');
    error.status = 401;
    throw error;
  }

  await prisma.refreshToken.update({
    where: { id: storedToken.id },
    data: { revokedAt: new Date() },
  });

  try {
    await redis.del(`refresh:${tokenHash}`);
    await redis.srem(`user_sessions:${storedToken.userId}`, tokenHash);
  } catch (err) {
    
  }

  const device = req?.headers?.['user-agent']?.slice(0, 200) || storedToken.device;
  return issueTokens(storedToken.user, { headers: { 'user-agent': device } });
};

export const revokeAllSessions = async (userId: string): Promise<void> => {
  try {
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  } catch (err) {

  }

  try {
    const hashes = await redis.smembers(`user_sessions:${userId}`);
    if (hashes.length) {
      await redis.del(...hashes.map((h) => `refresh:${h}`));
    }
    await redis.del(`user_sessions:${userId}`);
  } catch (err) {
  }
};

export const verifyAccessToken = (token: string): any => {
  const secret = process.env.JWT_SECRET || 'default_jwt_secret';
  return jwt.verify(token, secret);
};
