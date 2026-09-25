const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { hashToken } = require('../utils/hashToken');
const redis = require('../config/redis');
const prisma = require('../config/prisma');

const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

const generateAccessToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '15m' });

const generateRefreshToken = () => crypto.randomBytes(64).toString('hex');

const issueTokens = async (user, req) => {
  const device = req?.headers?.['user-agent']?.slice(0, 200) || 'unknown';
  const accessToken = generateAccessToken(user.id);
  const refreshToken = generateRefreshToken();
  const tokenHash = hashToken(refreshToken);

  await redis.set(
    `refresh:${tokenHash}`,
    JSON.stringify({ userId: user.id, device, createdAt: Date.now() }),
    'EX',
    REFRESH_TTL_SECONDS
  );
  await redis.sadd(`user_sessions:${user.id}`, tokenHash);
  await redis.expire(`user_sessions:${user.id}`, REFRESH_TTL_SECONDS);

  return { accessToken, refreshToken };
};

const rotateRefreshToken = async (rawToken, req) => {
  const tokenHash = hashToken(rawToken);
  const raw = await redis.get(`refresh:${tokenHash}`);

  if (!raw) {
    throw new Error('Invalid or expired refresh token');
  }

  const { userId, device } = JSON.parse(raw);

  await redis.del(`refresh:${tokenHash}`);
  await redis.srem(`user_sessions:${userId}`, tokenHash);

  let user;
  try {
    user = await prisma.user.findUnique({ where: { id: userId } });
  } catch (err) {
    const error = new Error('Database error');
    error.status = 500;
    throw error;
  }
  
  if (!user) throw new Error('User not found');

  return issueTokens(user, { headers: { 'user-agent': device } });
};

const revokeAllSessions = async (userId) => {
  const hashes = await redis.smembers(`user_sessions:${userId}`);
  if (hashes.length) {
    await redis.del(...hashes.map((h) => `refresh:${h}`));
  }
  await redis.del(`user_sessions:${userId}`);
};

const verifyAccessToken = (token) => jwt.verify(token, process.env.JWT_SECRET);

module.exports = { issueTokens, rotateRefreshToken, revokeAllSessions, verifyAccessToken };