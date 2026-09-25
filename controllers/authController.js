const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const { registerSchema, loginSchema } = require('../validators/authValidators');
const { sendSuccess, sendError } = require('../utils/apiResponse');
const { issueTokens, rotateRefreshToken } = require('../services/tokenService');
const redis = require('../config/redis');
const { hashToken } = require('../utils/hashToken');
const { refreshCookieOptions } = require('../utils/cookieOptions');

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

const register = async (req, res) => {
  const { error } = registerSchema.validate(req.body);
  if (error) return sendError(res, 400, error.details[0].message);

  const { name, email, password } = req.body;
  
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, passwordHash }
    });
    
    const { accessToken, refreshToken } = await issueTokens(user, req);
    
    res.cookie('refreshToken', refreshToken, refreshCookieOptions);
    
    return sendSuccess(res, 201, 'User registered successfully', { accessToken, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    if (err.code === 'P2002') {
      return sendError(res, 409, 'Email already registered');
    }
    console.error(err);
    return sendError(res, 500, 'Internal Server Error');
  }
};

const login = async (req, res) => {
  const { error } = loginSchema.validate(req.body);
  if (error) return sendError(res, 400, error.details[0].message);

  const { email, password } = req.body;

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return sendError(res, 401, 'Invalid credentials');

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutesLeft = Math.ceil((user.lockedUntil - Date.now()) / 60000);
      return sendError(res, 423, `Account locked. Try again in ${minutesLeft} minute(s).`);
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      const newAttempts = user.failedLoginAttempts + 1;
      const shouldLock = newAttempts >= MAX_FAILED_ATTEMPTS;

      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: newAttempts,
          lockedUntil: shouldLock ? new Date(Date.now() + LOCK_DURATION_MS) : null,
        },
      });

      const message = shouldLock
        ? 'Too many failed attempts. Account locked for 15 minutes.'
        : 'Invalid credentials';
      return sendError(res, 401, message);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLogin: new Date() },
    });

    const { accessToken, refreshToken } = await issueTokens(user, req);

    res.cookie('refreshToken', refreshToken, refreshCookieOptions);

    return sendSuccess(res, 200, 'Login successful', { accessToken, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    return sendError(res, 500, 'Internal Server Error');
  }
};

const refreshToken = async (req, res) => {
  const token = req.cookies.refreshToken;
  if (!token) return sendError(res, 401, 'No refresh token provided');

  try {
    const { accessToken, refreshToken: newRefreshToken } = await rotateRefreshToken(token, req);

    res.cookie('refreshToken', newRefreshToken, refreshCookieOptions);

    return sendSuccess(res, 200, 'Token refreshed successfully', { accessToken });
  } catch (err) {
    if (err.status === 500) {
      console.error(err);
      return sendError(res, 500, 'Internal Server Error');
    }
    res.clearCookie('refreshToken');
    return sendError(res, 401, err.message);
  }
};

const logout = async (req, res) => {
  const token = req.cookies.refreshToken;
  if (!token) return sendSuccess(res, 200, 'Logged out successfully');

  try {
    const tokenHash = hashToken(token);
    
    const raw = await redis.get(`refresh:${tokenHash}`);
    if (raw) {
      const { userId } = JSON.parse(raw);
      await redis.del(`refresh:${tokenHash}`);
      await redis.srem(`user_sessions:${userId}`, tokenHash);
    }

    res.clearCookie('refreshToken');
    return sendSuccess(res, 200, 'Logged out successfully');
  } catch (err) {
    console.error(err);
    return sendError(res, 500, 'Internal Server Error');
  }
};

const getMe = async (req, res) => {
  const user = { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role, isEmailVerified: req.user.isEmailVerified, lastLogin: req.user.lastLogin };
  return sendSuccess(res, 200, 'User profile retrieved', user);
};

module.exports = { register, login, refreshToken, logout, getMe };