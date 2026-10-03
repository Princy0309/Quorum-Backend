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
  const { name, email, password } = req.body;
  const cleanEmail = email.trim().toLowerCase();

  await registerUser(name, cleanEmail, password);

  return sendSuccess(res, 201, 'Registration processed. If the email is valid and available, a verification code has been sent.');
});

export const login = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { email, password } = req.body;
  const cleanEmail = email.trim().toLowerCase();
  
  const { user, accessToken, refreshToken } = await loginUser(cleanEmail, password, req.ip || '127.0.0.1', req);

  const isMobile = req.headers['x-client-platform'] === 'mobile';

  const responseData: any = {
    accessToken,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, isEmailVerified: user.isEmailVerified },
  };

  if (isMobile) {
    responseData.refreshToken = refreshToken;
  } else {
    res.cookie('refreshToken', refreshToken, refreshCookieOptions);
  }

  return sendSuccess(res, 200, 'Login successful', responseData);
});

export const refreshToken = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const isMobile = req.headers['x-client-platform'] === 'mobile';
  const incomingToken = isMobile ? req.body.refreshToken : req.cookies?.refreshToken;

  if (!incomingToken) throw new ApiError(401, 'Refresh token required');

  try {
    const { accessToken, refreshToken: newRefreshToken } = await rotateRefreshToken(incomingToken, req);

    const responseData: any = { accessToken };

    if (isMobile) {
      responseData.refreshToken = newRefreshToken;
    } else {
      res.cookie('refreshToken', newRefreshToken, refreshCookieOptions);
    }

    return sendSuccess(res, 200, 'Tokens refreshed successfully', responseData);
  } catch (err: any) {
    throw new ApiError(401, err.message || 'Invalid or expired refresh token');
  }
});

export const logout = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const isMobile = req.headers['x-client-platform'] === 'mobile';
  const incomingToken = isMobile ? req.body.refreshToken : req.cookies?.refreshToken;

  if (incomingToken) {
    await revokeRefreshToken(incomingToken);
  }

  if (!isMobile) {
    res.clearCookie('refreshToken', refreshCookieOptions);
  }

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
