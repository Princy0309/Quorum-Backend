import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../config/prisma';
import { registerSchema, loginSchema } from '../validators/authValidators';
import { sendSuccess, sendError } from '../utils/apiResponse';
import { issueTokens, rotateRefreshToken } from '../services/tokenService';
import redis from '../config/redis';
import { hashToken } from '../utils/hashToken';
import { refreshCookieOptions } from '../utils/cookieOptions';
import { loginRateLimiter } from '../middlewares/rateLimiter';

export const register = async (req: Request, res: Response) => {
  const { error, value } = registerSchema.validate(req.body);
  if (error) return sendError(res, 400, error.details[0].message);

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
      return sendError(res, 409, 'Email already registered');
    }
    return sendError(res, 500, err.message || 'Internal Server Error');
  }
};

export const login = async (req: Request, res: Response) => {
  const { error, value } = loginSchema.validate(req.body);
  if (error) return sendError(res, 400, error.details[0].message);

  const { email, password } = value;

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      await loginRateLimiter.consume(req.ip).catch(() => {});
      return sendError(res, 401, 'Invalid credentials');
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      await loginRateLimiter.consume(req.ip).catch(() => {});
      return sendError(res, 401, "Invalid credentials");
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
  } catch (err: any) {
    return sendError(res, 500, err.message || 'Internal Server Error');
  }
};

export const refreshToken = async (req: Request, res: Response) => {
  const token = req.cookies?.refreshToken || req.body?.refreshToken;
  if (!token) return sendError(res, 401, 'No refresh token provided');

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
      return sendError(res, 500, 'Internal Server Error');
    }
    res.clearCookie('refreshToken');
    return sendError(res, 401, err.message);
  }
};

export const logout = async (req: Request, res: Response) => {
  const token = req.cookies?.refreshToken || req.body?.refreshToken;
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
  } catch (err: any) {
    return sendError(res, 500, 'Internal Server Error');
  }
};

export const getMe = async (req: Request | any, res: Response) => {
  const user = { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role, isEmailVerified: req.user.isEmailVerified, lastLogin: req.user.lastLogin };
  return sendSuccess(res, 200, 'User profile retrieved', user);
};
