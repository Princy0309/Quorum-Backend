import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../config/prisma.js';
import { registerSchema, loginSchema } from '../validators/authValidators.js';
import { ApiError } from '../utils/ApiError.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { rotateRefreshToken, revokeRefreshToken, revokeAllSessions } from '../services/tokenService.js';
import { registerUser, loginUser } from '../services/authService.js';
import { refreshCookieOptions } from '../utils/cookieOptions.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const register = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { name, email, password } = req.body;
  const cleanEmail = email.trim().toLowerCase();

  const { user } = await registerUser(name, cleanEmail, password);

  return sendSuccess(res, 201, 'User registered successfully. Please verify your email with the OTP sent to your inbox.', {
    email: user.email,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isEmailVerified: false,
    },
  });
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
  const incomingToken = isMobile ? req.body?.refreshToken : req.cookies?.refreshToken;

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
    if (err instanceof ApiError) {
      throw err;
    }
    throw err;
  }
});

export const logout = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const isMobile = req.headers['x-client-platform'] === 'mobile';
  const incomingToken = isMobile ? req.body?.refreshToken : req.cookies?.refreshToken;

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
  if (!req.user){
    return next(new ApiError(401, 'unauthorized'));
  }
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
