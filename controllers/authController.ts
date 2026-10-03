import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../config/prisma';
import { registerSchema, loginSchema } from '../validators/authValidators';
import { ApiError } from '../utils/ApiError';
import { sendSuccess } from '../utils/apiResponse';
import { issueTokens, rotateRefreshToken, revokeRefreshToken, revokeAllSessions } from '../services/tokenService';
import { refreshCookieOptions } from '../utils/cookieOptions';
import { loginRateLimiter } from '../middlewares/rateLimiter';
import { asyncHandler } from '../utils/asyncHandler';
import { storeAndSendOTP } from '../services/otpService';

export const register = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { error, value } = registerSchema.validate(req.body);
  if (error) throw new ApiError(400, error.details[0].message);

  const { name, email, password } = value;
  const cleanEmail = email.trim().toLowerCase();

  const passwordHash = await bcrypt.hash(password, 10);

  const existingUser = await prisma.user.findUnique({ where: { email: cleanEmail } });

  if (existingUser) {
    if (existingUser.isEmailVerified) {
      throw new ApiError(409, 'Email already registered. Please log in.');
    }

    const user = await prisma.user.update({
      where: { id: existingUser.id },
      data: { name, passwordHash },
    });

    await storeAndSendOTP(user.email, `otp:verify:${user.id}`, 'verification');

    return sendSuccess(res, 201, 'Account exists but unverified. A fresh verification code has been sent to your email.', {
      user: { id: user.id, name: user.name, email: user.email, role: user.role, isEmailVerified: false },
    });
  }

  const user = await prisma.user.create({
    data: { name, email: cleanEmail, passwordHash },
  });

  await storeAndSendOTP(user.email, `otp:verify:${user.id}`, 'verification');

  return sendSuccess(res, 201, 'User registered successfully. Please verify your email with the OTP sent to your inbox.', {
    user: { id: user.id, name: user.name, email: user.email, role: user.role, isEmailVerified: false },
  });
});

const handleFailedLogin = async (userId: string, currentAttempts: number) => {
  const newAttempts = currentAttempts + 1;
  let lockedUntil = null;
  if (newAttempts >= 5) {
    lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 mins lock
  }
  await prisma.user.update({
    where: { id: userId },
    data: {
      failedLoginAttempts: newAttempts,
      lockedUntil,
    },
  });
};

export const login = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { error, value } = loginSchema.validate(req.body);
  if (error) throw new ApiError(400, error.details[0].message);

  const { email, password } = value;
  const cleanEmail = email.trim().toLowerCase();

  const user = await prisma.user.findUnique({ where: { email: cleanEmail } });
  if (!user) {
    await loginRateLimiter.consume(req.ip || '127.0.0.1').catch(() => {});
    throw new ApiError(401, 'Invalid credentials');
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new ApiError(403, 'Account is temporarily locked due to multiple failed login attempts. Please try again later.');
  }

  if (!user.passwordHash) {
    await loginRateLimiter.consume(req.ip || '127.0.0.1').catch(() => {});
    await handleFailedLogin(user.id, user.failedLoginAttempts);
    throw new ApiError(401, 'Invalid credentials');
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    await loginRateLimiter.consume(req.ip || '127.0.0.1').catch(() => {});
    await handleFailedLogin(user.id, user.failedLoginAttempts);
    throw new ApiError(401, 'Invalid credentials');
  }

  if (!user.isEmailVerified) {
    await storeAndSendOTP(user.email, `otp:verify:${user.id}`, 'verification');
    throw new ApiError(403, 'Email not verified. A fresh verification code has been sent to your email.');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { 
      lastLogin: new Date(),
      failedLoginAttempts: 0,
      lockedUntil: null
    },
  });

  const { accessToken, refreshToken } = await issueTokens(user, req);

  // Always set HttpOnly cookie for browser clients
  res.cookie('refreshToken', refreshToken, refreshCookieOptions);

  const isMobileClient = req.headers['x-client-type'] === 'mobile' || req.headers['x-client-type'] === 'native';

  const responseData: any = {
    accessToken,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, isEmailVerified: user.isEmailVerified },
  };

  // Provide refreshToken in header ONLY for explicit mobile/native non-browser clients
  if (isMobileClient) {
    res.setHeader('x-refresh-token', refreshToken);
  }

  return sendSuccess(res, 200, 'Login successful', responseData);
});

export const refreshToken = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const isMobileClient = req.headers['x-client-type'] === 'mobile' || req.headers['x-client-type'] === 'native';

  const incomingToken =
    req.cookies?.refreshToken ||
    (isMobileClient ? (req.headers['x-refresh-token'] as string) : null);

  if (!incomingToken) throw new ApiError(401, 'Refresh token required');

  try {
    const { accessToken, refreshToken: newRefreshToken } = await rotateRefreshToken(incomingToken, req);

    res.cookie('refreshToken', newRefreshToken, refreshCookieOptions);

    const responseData: any = { accessToken };
    if (isMobileClient) {
      res.setHeader('x-refresh-token', newRefreshToken);
    }

    return sendSuccess(res, 200, 'Tokens refreshed successfully', responseData);
  } catch (err: any) {
    throw new ApiError(401, err.message || 'Invalid or expired refresh token');
  }
});

export const logout = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const isMobileClient = req.headers['x-client-type'] === 'mobile' || req.headers['x-client-type'] === 'native';

  const incomingToken =
    req.cookies?.refreshToken ||
    (isMobileClient ? (req.headers['x-refresh-token'] as string) : null);

  if (incomingToken) {
    await revokeRefreshToken(incomingToken);
  }

  res.clearCookie('refreshToken', refreshCookieOptions);

  return sendSuccess(res, 200, 'Logged out successfully');
});

export const logoutAll = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
  if (req.user && req.user.id) {
    await revokeAllSessions(req.user.id);
  }
  res.clearCookie('refreshToken', refreshCookieOptions);
  return sendSuccess(res, 200, 'Logged out of all sessions successfully');
});

export const getMe = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
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
