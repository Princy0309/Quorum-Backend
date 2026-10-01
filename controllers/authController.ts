import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import prisma from '../config/prisma';
import { registerSchema, loginSchema } from '../validators/authValidators';
import { sendSuccess } from '../utils/apiResponse';
import { ApiError } from '../utils/ApiError';
import { issueTokens, rotateRefreshToken } from '../services/tokenService';
import redis from '../config/redis';
import { hashToken } from '../utils/hashToken';
import { refreshCookieOptions } from '../utils/cookieOptions';
import { loginRateLimiter } from '../middlewares/rateLimiter';
import { asyncHandler } from '../utils/asyncHandler';

import { generateOTP } from '../utils/generateOTP';
const { sendOTPEmail } = require('../services/emailService');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export const register = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { error, value } = registerSchema.validate(req.body);
  if (error) throw new ApiError(400, error.details[0].message);

  const { name, email, password } = value;

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, passwordHash }
    });

    const { code, codeHash } = generateOTP();
    await redis.set(`otp:verify:${user.id}`, JSON.stringify({ codeHash, attempts: 0, createdAt: Date.now() }), 'EX', 10 * 60);
    sendOTPEmail(user.email, code, 'verification').catch((err: any) => console.error(err));
    
    const { accessToken, refreshToken } = await issueTokens(user, req);
    const isMobile = req.headers['x-client-platform'] === 'mobile';

    if (isMobile) {
      return sendSuccess(res, 201, 'User registered successfully', { accessToken, refreshToken, user: { id: user.id, name: user.name, email: user.email, role: user.role, isEmailVerified: user.isEmailVerified } });
    } else {
      res.cookie('refreshToken', refreshToken, refreshCookieOptions);
      return sendSuccess(res, 201, 'User registered successfully', { accessToken, user: { id: user.id, name: user.name, email: user.email, role: user.role, isEmailVerified: user.isEmailVerified } });
    }
  } catch (err: any) {
    if (err.code === 'P2002') {
      throw new ApiError(409, 'Email already registered');
    }
    throw err;
  }
});

export const login = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { error, value } = loginSchema.validate(req.body);
  if (error) throw new ApiError(400, error.details[0].message);

  const { email, password } = value;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    await loginRateLimiter.consume(req.ip).catch(() => {});
    throw new ApiError(401, 'Invalid credentials');
  }

  if (!user.passwordHash) {
    await loginRateLimiter.consume(req.ip).catch(() => {});
    throw new ApiError(401, 'Invalid credentials');
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    await loginRateLimiter.consume(req.ip).catch(() => {});
    throw new ApiError(401, 'Invalid credentials');
  }

  if (user.is2FAEnabled) {
    const mfaToken = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'secret', { expiresIn: '5m' });
    return sendSuccess(res, 200, '2FA verification required', { requires2FA: true, mfaToken });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLogin: new Date() },
  });

  const { accessToken, refreshToken } = await issueTokens(user, req);
  const isMobile = req.headers['x-client-platform'] === 'mobile';

  if (isMobile) {
    return sendSuccess(res, 200, 'Login successful', { accessToken, refreshToken, user: { id: user.id, name: user.name, email: user.email, role: user.role, isEmailVerified: user.isEmailVerified } });
  } else {
    res.cookie('refreshToken', refreshToken, refreshCookieOptions);
    return sendSuccess(res, 200, 'Login successful', { accessToken, user: { id: user.id, name: user.name, email: user.email, role: user.role, isEmailVerified: user.isEmailVerified } });
  }
});

export const googleAuth = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { idToken } = req.body;
  if (!idToken) throw new ApiError(400, 'Google ID token is required');

  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();
  if (!payload || !payload.email) throw new ApiError(400, 'Invalid Google token');

  const { sub: googleId, email, name, picture } = payload;

  let user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    user = await prisma.user.create({
      data: {
        name: name || 'Google User',
        email,
        googleId,
        avatar: picture,
        isEmailVerified: true,
      },
    });
  } else if (!user.googleId) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { googleId, avatar: user.avatar || picture, isEmailVerified: true },
    });
  }

  if (user.is2FAEnabled) {
    const mfaToken = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'secret', { expiresIn: '5m' });
    return sendSuccess(res, 200, '2FA verification required', { requires2FA: true, mfaToken });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLogin: new Date() },
  });

  const { accessToken, refreshToken } = await issueTokens(user, req);
  const isMobile = req.headers['x-client-platform'] === 'mobile';

  if (isMobile) {
    return sendSuccess(res, 200, 'Google login successful', { accessToken, refreshToken, user: { id: user.id, name: user.name, email: user.email, role: user.role, isEmailVerified: user.isEmailVerified } });
  } else {
    res.cookie('refreshToken', refreshToken, refreshCookieOptions);
    return sendSuccess(res, 200, 'Google login successful', { accessToken, user: { id: user.id, name: user.name, email: user.email, role: user.role, isEmailVerified: user.isEmailVerified } });
  }
});

export const refreshToken = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const token = req.cookies?.refreshToken || req.body?.refreshToken;
  if (!token) throw new ApiError(401, 'No refresh token provided');

  try {
    const { accessToken, refreshToken: newRefreshToken } = await rotateRefreshToken(token, req);
    const isMobile = req.headers['x-client-platform'] === 'mobile';

    if (isMobile) {
      return sendSuccess(res, 200, 'Token refreshed successfully', { accessToken, refreshToken: newRefreshToken });
    } else {
      res.cookie('refreshToken', newRefreshToken, refreshCookieOptions);
      return sendSuccess(res, 200, 'Token refreshed successfully', { accessToken });
    }
  } catch (err: any) {
    if (err.status === 500) {
      throw err;
    }
    res.clearCookie('refreshToken');
    throw new ApiError(401, err.message);
  }
});

export const logout = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const token = req.cookies?.refreshToken || req.body?.refreshToken;
  if (!token) return sendSuccess(res, 200, 'Logged out successfully');

  const tokenHash = hashToken(token);

  const raw = await redis.get(`refresh:${tokenHash}`);
  if (raw) {
    const { userId } = JSON.parse(raw);
    await redis.del(`refresh:${tokenHash}`);
    await redis.srem(`user_sessions:${userId}`, tokenHash);
  }

  res.clearCookie('refreshToken');
  return sendSuccess(res, 200, 'Logged out successfully');
});

export const getMe = asyncHandler(async (req: Request | any, res: Response, next: NextFunction) => {
  const user = { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role, isEmailVerified: req.user.isEmailVerified, lastLogin: req.user.lastLogin };
  return sendSuccess(res, 200, 'User profile retrieved', user);
});
