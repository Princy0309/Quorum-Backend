import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../config/prisma.js';
import { registerSchema, loginSchema } from '../validators/authValidators.js';
import { ApiError } from '../utils/ApiError.js';
import { sendSuccess } from '../utils/ApiResponse.js';
import { rotateRefreshToken, revokeRefreshToken, revokeAllSessions, revokeAccessToken } from '../services/tokenService.js';
import { registerUser, loginUser } from '../services/authService.js';
import {
  accessCookieOptions,
  refreshCookieOptions,
  getAccessCookieOptions,
  getRefreshCookieOptions,
  clearCookieOptions,
  clearLegacyCookies
} from '../utils/cookieOptions.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const register = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { name, email, password } = req.body;
  const cleanEmail = email.trim().toLowerCase();

  const { user } = await registerUser(name, cleanEmail, password);

  return sendSuccess(res, 201, 'User registered successfully. Please verify your email with the OTP sent to your inbox.', {
    email: user.email,
    user: {
      id: user.id || '',
      name: user.name,
      email: user.email,
      role: user.role || 'USER',
      isEmailVerified: false,
    },
  });
});


export const login = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { email, password, rememberMe = false } = req.body;
  const cleanEmail = email.trim().toLowerCase();
  const isRememberMe = Boolean(rememberMe);
  
  const { user, accessToken, refreshToken } = await loginUser(cleanEmail, password, req.ip || '127.0.0.1', req, isRememberMe);

  const isMobile = req.headers['x-client-platform'] === 'mobile';

  const responseData: any = {
    accessToken,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, isEmailVerified: user.isEmailVerified },
  };

  if (isMobile) {
    responseData.refreshToken = refreshToken;
  } else {
    clearLegacyCookies(res);
    res.cookie('accessToken', accessToken, getAccessCookieOptions(isRememberMe));
    res.cookie('refreshToken', refreshToken, getRefreshCookieOptions(isRememberMe));
  }

  return sendSuccess(res, 200, 'Login successful', responseData);
});

export const refreshToken = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const isMobile = req.headers['x-client-platform'] === 'mobile';
  
  // Extract all potential candidates (handles duplicate cookies from legacy paths e.g. /api/auth vs /)
  const candidates: string[] = [];
  if (req.body?.refreshToken && typeof req.body.refreshToken === 'string' && req.body.refreshToken.trim()) {
    candidates.push(req.body.refreshToken.trim());
  }

  const cookieHeader = req.headers.cookie || '';
  const regex = /(?:^|;\s*)refreshToken=([^;]+)/g;
  let match;
  while ((match = regex.exec(cookieHeader)) !== null) {
    const decoded = decodeURIComponent(match[1]).trim();
    if (decoded && !candidates.includes(decoded)) {
      candidates.push(decoded);
    }
  }

  if (req.cookies?.refreshToken && !candidates.includes(req.cookies.refreshToken)) {
    candidates.push(req.cookies.refreshToken);
  }

  if (candidates.length === 0) {
    throw new ApiError(401, 'Refresh token required');
  }

  let rotationResult: { accessToken: string; refreshToken: string; rememberMe: boolean } | null = null;
  let lastError: any = null;

  // Try each candidate (valid token might be listed after a stale legacy /api/auth cookie)
  for (const tokenCandidate of candidates) {
    try {
      rotationResult = await rotateRefreshToken(tokenCandidate, req);
      break;
    } catch (err: any) {
      lastError = err;
    }
  }

  if (!rotationResult) {
    throw lastError || new ApiError(401, 'Invalid or expired refresh token');
  }

  const { accessToken, refreshToken: newRefreshToken, rememberMe } = rotationResult;
  const responseData: any = { accessToken };

  if (isMobile) {
    responseData.refreshToken = newRefreshToken;
  } else {
    clearLegacyCookies(res);
    res.cookie('accessToken', accessToken, getAccessCookieOptions(rememberMe));
    res.cookie('refreshToken', newRefreshToken, getRefreshCookieOptions(rememberMe));
  }

  return sendSuccess(res, 200, 'Tokens refreshed successfully', responseData);
});

export const logout = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const isMobile = req.headers['x-client-platform'] === 'mobile';
  const incomingToken = isMobile ? req.body?.refreshToken : (req.cookies?.refreshToken || req.body?.refreshToken);
  
  const authHeader = req.headers.authorization;
  const accessToken = (authHeader && authHeader.startsWith('Bearer ')) ? authHeader.split(' ')[1] : req.cookies?.accessToken;
  if (accessToken) {
    await revokeAccessToken(accessToken);
  }

  if (incomingToken) {
    await revokeRefreshToken(incomingToken);
  }

  if (!isMobile) {
    clearLegacyCookies(res);
    res.clearCookie('accessToken', clearCookieOptions);
    res.clearCookie('refreshToken', clearCookieOptions);
  }

  return sendSuccess(res, 200, 'Logged out successfully');
});

export const logoutAll = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const accessToken = (authHeader && authHeader.startsWith('Bearer ')) ? authHeader.split(' ')[1] : req.cookies?.accessToken;
  if (accessToken) {
    await revokeAccessToken(accessToken);
  }

  if (req.user && req.user.id) {
    await revokeAllSessions(req.user.id);
  }
  res.clearCookie('accessToken', clearCookieOptions);
  res.clearCookie('refreshToken', clearCookieOptions);
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
