import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma';
import redis from '../config/redis';
import { registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema } from '../validators/authValidators';
import { ApiError } from '../utils/ApiError';
import { sendSuccess } from '../utils/apiResponse';
import { issueTokens } from '../services/tokenService';
import { hashToken } from '../utils/hashToken';
import { refreshCookieOptions } from '../utils/cookieOptions';
import { loginRateLimiter } from '../middlewares/rateLimiter';
import { asyncHandler } from '../utils/asyncHandler';
import { storeAndSendOTP } from '../services/otpService';

export const register = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { error, value } = registerSchema.validate(req.body);
  if (error) throw new ApiError(400, error.details[0].message);

  const { name, email, password } = value;

  const passwordHash = await bcrypt.hash(password, 10);
  const isMobile = req.headers['x-client-platform'] === 'mobile';

  const existingUser = await prisma.user.findUnique({ where: { email } });

  if (existingUser) {
    if (existingUser.isEmailVerified) {
      throw new ApiError(409, 'Email already registered. Please log in.');
    }

    const user = await prisma.user.update({
      where: { id: existingUser.id },
      data: { name, passwordHash },
    });

    await storeAndSendOTP(user.id, user.email, `otp:verify:${user.id}`, 'verification');
    const { accessToken, refreshToken } = await issueTokens(user, req);

    if (isMobile) {
      return sendSuccess(res, 200, 'Account exists but unverified. A fresh verification code has been sent.', {
        accessToken,
        refreshToken,
        user: { id: user.id, name: user.name, email: user.email, role: user.role, isEmailVerified: user.isEmailVerified },
      });
    } else {
      res.cookie('refreshToken', refreshToken, refreshCookieOptions);
      return sendSuccess(res, 200, 'Account exists but unverified. A fresh verification code has been sent.', {
        accessToken,
        user: { id: user.id, name: user.name, email: user.email, role: user.role, isEmailVerified: user.isEmailVerified },
      });
    }
  }

  const user = await prisma.user.create({
    data: { name, email, passwordHash },
  });

  await storeAndSendOTP(user.id, user.email, `otp:verify:${user.id}`, 'verification');
  const { accessToken, refreshToken } = await issueTokens(user, req);

  if (isMobile) {
    return sendSuccess(res, 201, 'User registered successfully', {
      accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, isEmailVerified: user.isEmailVerified },
    });
  } else {
    res.cookie('refreshToken', refreshToken, refreshCookieOptions);
    return sendSuccess(res, 201, 'User registered successfully', {
      accessToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, isEmailVerified: user.isEmailVerified },
    });
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
    await storeAndSendOTP(user.id, user.email, `otp:verify:${user.id}`, 'verification');
    throw new ApiError(403, 'Email not verified. A fresh verification code has been sent to your email.');
  }

  if (user.is2FAEnabled) {
    const mfaToken = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'secret', { expiresIn: '5m' });
    return sendSuccess(res, 200, '2FA verification required', { requires2FA: true, mfaToken });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const { accessToken, refreshToken } = await issueTokens(user, req);
  const isMobile = req.headers['x-client-platform'] === 'mobile';

  if (isMobile) {
    return sendSuccess(res, 200, 'Login successful', {
      accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, isEmailVerified: user.isEmailVerified },
    });
  } else {
    res.cookie('refreshToken', refreshToken, refreshCookieOptions);
    return sendSuccess(res, 200, 'Login successful', {
      accessToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, isEmailVerified: user.isEmailVerified },
    });
  }
});

export const refreshToken = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const isMobile = req.headers['x-client-platform'] === 'mobile';
  const incomingToken = isMobile ? req.body.refreshToken : req.cookies.refreshToken;

  if (!incomingToken) throw new ApiError(401, 'Refresh token required');

  let decoded: any;
  try {
    decoded = jwt.verify(incomingToken, process.env.JWT_REFRESH_SECRET || 'fallback_refresh_secret');
  } catch (err) {
    throw new ApiError(401, 'Invalid or expired refresh token');
  }

  const storedToken = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(incomingToken) },
    include: { user: true },
  });

  if (!storedToken || storedToken.revokedAt || storedToken.expiresAt < new Date()) {
    if (storedToken && storedToken.revokedAt) {
      await prisma.refreshToken.updateMany({
        where: { userId: storedToken.userId },
        data: { revokedAt: new Date() },
      });
    }
    throw new ApiError(401, 'Invalid or expired refresh token');
  }

  await prisma.refreshToken.update({
    where: { id: storedToken.id },
    data: { revokedAt: new Date() },
  });

  const { accessToken, refreshToken: newRefreshToken } = await issueTokens(storedToken.user, req);

  if (isMobile) {
    return sendSuccess(res, 200, 'Tokens refreshed successfully', { accessToken, refreshToken: newRefreshToken });
  } else {
    res.cookie('refreshToken', newRefreshToken, refreshCookieOptions);
    return sendSuccess(res, 200, 'Tokens refreshed successfully', { accessToken });
  }
});

export const logout = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const isMobile = req.headers['x-client-platform'] === 'mobile';
  const incomingToken = isMobile ? req.body.refreshToken : req.cookies.refreshToken;

  if (incomingToken) {
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(incomingToken) },
      data: { revokedAt: new Date() },
    });
  }

  if (!isMobile) {
    res.clearCookie('refreshToken', refreshCookieOptions);
  }

  return sendSuccess(res, 200, 'Logged out successfully');
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { error, value } = forgotPasswordSchema.validate(req.body);
  if (error) throw new ApiError(400, error.details[0].message);

  const { email } = value;
  const user = await prisma.user.findUnique({ where: { email } });

  if (user) {
    await storeAndSendOTP(user.id, user.email, `otp:reset:${user.id}`, 'reset');
  }

  return sendSuccess(res, 200, 'If that email exists, an OTP has been sent');
});

export const resetPassword = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { error, value } = resetPasswordSchema.validate(req.body);
  if (error) throw new ApiError(400, error.details[0].message);

  const { resetToken, newPassword } = value;

  const key = `reset-token:${resetToken}`;
  const userId = await redis.get(key);

  if (!userId) {
    throw new ApiError(400, 'Invalid or expired reset token');
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });

  await prisma.refreshToken.updateMany({
    where: { userId },
    data: { revokedAt: new Date() },
  });

  await redis.del(key);

  return sendSuccess(res, 200, 'Password reset successfully. Please log in with your new password.');
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
      lastLoginAt: true,
    },
  });

  if (!user) throw new ApiError(404, 'User not found');

  return sendSuccess(res, 200, 'Profile fetched successfully', { user });
});

