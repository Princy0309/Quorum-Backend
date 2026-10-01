import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
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
import { storeAndSendOTP } from '../services/otpService';


export const register = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { error, value } = registerSchema.validate(req.body);
  if (error) throw new ApiError(400, error.details[0].message);

  const { name, email, password } = value;

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, passwordHash }
    });
    
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
    await loginRateLimiter.consume(req.ip || '127.0.0.1').catch(() => {});
    throw new ApiError(401, 'Invalid credentials');
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    await loginRateLimiter.consume(req.ip || '127.0.0.1').catch(() => {});
    throw new ApiError(401, 'Invalid credentials');
  }

  if (!user.isEmailVerified) {
    await storeAndSendOTP(user.id, user.email, `otp:verify:${user.id}`, 'verification');
    throw new ApiError(403, 'Email not verified. A fresh verification code has been sent to your email.');
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
