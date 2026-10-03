import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../config/prisma';
import { registerSchema, loginSchema } from '../validators/authValidators';
import { ApiError } from '../utils/ApiError';
import { sendSuccess } from '../utils/apiResponse';
import { rotateRefreshToken, revokeRefreshToken, revokeAllSessions } from '../services/tokenService';
import { registerUser, loginUser } from '../services/authService';
import { refreshCookieOptions } from '../utils/cookieOptions';
import { asyncHandler } from '../utils/asyncHandler';

export const register = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { error, value } = registerSchema.validate(req.body);
  if (error) throw new ApiError(400, error.details[0].message);

  const { name, email, password } = value;
  const cleanEmail = email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, 10);

  await registerUser(name, cleanEmail, passwordHash);

  return sendSuccess(res, 201, 'Registration processed. If the email is valid and available, a verification code has been sent.');
});

export const login = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { error, value } = loginSchema.validate(req.body);
  if (error) throw new ApiError(400, error.details[0].message);

  const { email, password } = value;
  const cleanEmail = email.trim().toLowerCase();
  
  const { user, accessToken, refreshToken } = await loginUser(cleanEmail, password, req.ip || '127.0.0.1', req);

  // Always set HttpOnly cookie for browser clients
  res.cookie('refreshToken', refreshToken, refreshCookieOptions);
  // Always provide header for native clients (browsers will ignore it if not exposed)
  res.setHeader('x-refresh-token', refreshToken);

  const responseData = {
    accessToken,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, isEmailVerified: user.isEmailVerified },
  };

  return sendSuccess(res, 200, 'Login successful', responseData);
});

export const refreshToken = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const incomingToken = req.cookies?.refreshToken || req.headers['x-refresh-token'] as string;

  if (!incomingToken) throw new ApiError(401, 'Refresh token required');

  try {
    const { accessToken, refreshToken: newRefreshToken } = await rotateRefreshToken(incomingToken, req);

    res.cookie('refreshToken', newRefreshToken, refreshCookieOptions);
    res.setHeader('x-refresh-token', newRefreshToken);

    const responseData = { accessToken };

    return sendSuccess(res, 200, 'Tokens refreshed successfully', responseData);
  } catch (err: any) {
    throw new ApiError(401, err.message || 'Invalid or expired refresh token');
  }
});

export const logout = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const incomingToken = req.cookies?.refreshToken || req.headers['x-refresh-token'] as string;

  if (incomingToken) {
    await revokeRefreshToken(incomingToken);
  }

  res.clearCookie('refreshToken', refreshCookieOptions);

  return sendSuccess(res, 200, 'Logged out successfully');
});

export const logoutAll = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  if (req.user && req.user.id) {
    await revokeAllSessions(req.user.id);
  }
  res.clearCookie('refreshToken', refreshCookieOptions);
  return sendSuccess(res, 200, 'Logged out of all sessions successfully');
});

export const getMe = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isEmailVerified: true,
      createdAt: true,
      lastLogin: true,
    },
  });

  if (!user) throw new ApiError(404, 'User not found');

  return sendSuccess(res, 200, 'Profile fetched successfully', { user });
});
