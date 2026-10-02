import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../config/prisma';
import { registerSchema, loginSchema } from '../validators/authValidators';
import { ApiError } from '../utils/ApiError';
import { sendSuccess } from '../utils/apiResponse';
import { issueTokens, generateMFAToken, rotateRefreshToken, revokeRefreshToken } from '../services/tokenService';
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

  if (!user.passwordHash) {
    await loginRateLimiter.consume(req.ip || '127.0.0.1').catch(() => {});
    throw new ApiError(401, 'Invalid credentials');
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    await loginRateLimiter.consume(req.ip || '127.0.0.1').catch(() => {});
    throw new ApiError(401, 'Invalid credentials');
  }

  if (!user.isEmailVerified) {
    await storeAndSendOTP(user.email, `otp:verify:${user.id}`, 'verification');
    throw new ApiError(403, 'Email not verified. A fresh verification code has been sent to your email.');
  }

  if ((user as any).is2FAEnabled) {
    const mfaToken = generateMFAToken(user.id);
    return sendSuccess(res, 200, '2FA verification required', { requires2FA: true, mfaToken });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLogin: new Date() },
  });

  const { accessToken, refreshToken } = await issueTokens(user, req);

  res.setHeader('x-refresh-token', refreshToken);
  res.cookie('refreshToken', refreshToken, refreshCookieOptions);

  return sendSuccess(res, 200, 'Login successful', {
    accessToken,
    refreshToken,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, isEmailVerified: user.isEmailVerified },
  });
});

export const refreshToken = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const incomingToken =
    (req.headers['x-refresh-token'] as string) ||
    (req.headers['refresh-token'] as string) ||
    req.cookies?.refreshToken ||
    req.body?.refreshToken;

  if (!incomingToken) throw new ApiError(401, 'Refresh token required');

  try {
    const { accessToken, refreshToken: newRefreshToken } = await rotateRefreshToken(incomingToken, req);

    res.setHeader('x-refresh-token', newRefreshToken);
    res.cookie('refreshToken', newRefreshToken, refreshCookieOptions);

    return sendSuccess(res, 200, 'Tokens refreshed successfully', { accessToken, refreshToken: newRefreshToken });
  } catch (err: any) {
    throw new ApiError(401, err.message || 'Invalid or expired refresh token');
  }
});

export const logout = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const incomingToken =
    (req.headers['x-refresh-token'] as string) ||
    (req.headers['refresh-token'] as string) ||
    req.cookies?.refreshToken ||
    req.body?.refreshToken;

  if (incomingToken) {
    await revokeRefreshToken(incomingToken);
  }

  res.clearCookie('refreshToken', refreshCookieOptions);

  return sendSuccess(res, 200, 'Logged out successfully');
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
      is2FAEnabled: true,
      createdAt: true,
      lastLogin: true,
    },
  });

  if (!user) throw new ApiError(404, 'User not found');

  return sendSuccess(res, 200, 'Profile fetched successfully', { user });
});
