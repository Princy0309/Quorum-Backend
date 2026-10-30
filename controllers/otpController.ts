import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../config/prisma.js';
import redis from '../config/redis.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { sendSuccess } from '../utils/ApiResponse.js';
import { storeAndSendOTP, verifyOTPFromRedis } from '../services/otpService.js';
import { issueTokens, revokeAllSessions } from '../services/tokenService.js';
import { accessCookieOptions, refreshCookieOptions, clearLegacyCookies } from '../utils/cookieOptions.js';
import logger from '../utils/logger.js';

import { verifyEmailSchema, sendResetSchema, resetPasswordSchema } from '../validators/otpValidators.js';

export const sendVerificationOTP = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const rawEmail = req.body?.email || req.user?.email;
  if (!rawEmail) throw new ApiError(400, 'Email address is required');
  const email = rawEmail.trim().toLowerCase();

  const user = (await prisma.user.findUnique({ where: { email } })) || req.user;
  if (user && user.isEmailVerified) {
    return sendSuccess(res, 200, 'Email is already verified. Please log in.');
  }

  const pendingRaw = await redis.get(`otp:register:${email}`);
  if (pendingRaw) {
    try {
      const parsed = JSON.parse(pendingRaw);
      await storeAndSendOTP(email, `otp:register:${email}`, 'verification', parsed.payload, true);
      return sendSuccess(res, 200, 'Verification code sent. Please check your inbox.');
    } catch (e: any) {
      logger.error('Failed to parse pending registration record from Redis', { email, error: e.message });
    }
  }

  if (user) {
    await storeAndSendOTP(user.email, `otp:verify:${user.id}`, 'verification', undefined, true);
    return sendSuccess(res, 200, 'Verification code sent. Please check your inbox.');
  }

  return sendSuccess(res, 200, 'If an account with that email exists and is unverified, a verification code has been sent.');
});

export const verifyEmail = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const rawEmail = req.body?.email;
  const cleanEmail = rawEmail ? rawEmail.trim().toLowerCase() : null;
  const cleanOtp = String(req.body?.otp || '').trim();

  if (!cleanEmail && !req.user) {
    throw new ApiError(400, 'Email address is required');
  }

  const emailToVerify = cleanEmail || req.user?.email;

  let user = null;
  if (emailToVerify) {
    user = await prisma.user.findUnique({ where: { email: emailToVerify } });
  }
  if (!user && req.user) {
    user = req.user;
  }

  if (user && user.isEmailVerified) {
    return sendSuccess(res, 200, 'Email is already verified. Please log in.', {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isEmailVerified: true,
      },
    });
  }

  let result = await verifyOTPFromRedis(`otp:register:${emailToVerify}`, cleanOtp);
  if (!result.success && user) {
    result = await verifyOTPFromRedis(`otp:verify:${user.id}`, cleanOtp);
  }
  if (!result.success) {
    result = await verifyOTPFromRedis(`otp:verify:${emailToVerify}`, cleanOtp);
  }

  if (!result.success) throw new ApiError(400, result.message);

  const payload = result.payload;

  try {
    if (user) {
      const updateData: any = { isEmailVerified: true };
      if (payload && payload.name) {
        updateData.name = payload.name;
      }
      if (payload && payload.passwordHash) {
        updateData.passwordHash = payload.passwordHash;
      }
      user = await prisma.user.update({
        where: { id: user.id },
        data: updateData,
      });
    } else {
      if (!payload || !payload.passwordHash) {
        throw new ApiError(400, 'Registration session expired or invalid. Please sign up again.');
      }
      user = await prisma.user.create({
        data: {
          name: payload.name || 'User',
          email: emailToVerify!,
          passwordHash: payload.passwordHash,
          isEmailVerified: true,
        },
      });
    }

    await redis.del(`otp:register:${emailToVerify}`);
    if (user) {
      await redis.del(`otp:verify:${user.id}`);
    }

    const { accessToken, refreshToken } = await issueTokens(user, req);

    const isMobile = req.headers['x-client-platform'] === 'mobile';
    const responseData: any = {
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isEmailVerified: true,
      },
    };

    if (isMobile) {
      responseData.refreshToken = refreshToken;
    } else {
      clearLegacyCookies(res);
      res.cookie('accessToken', accessToken, accessCookieOptions);
      res.cookie('refreshToken', refreshToken, refreshCookieOptions);
    }

    return sendSuccess(res, 200, 'Email verified successfully', responseData);
  } catch (err: unknown) {
    if (err instanceof ApiError) {
      throw err;
    }
    logger.error('Error during post-verification user creation/session issuance', { error: (err as Error).message });
    throw new ApiError(500, 'Failed to complete registration. Please try again.');
  }
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  

  const email = String(req.body?.email || '').trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    return sendSuccess(res, 200, 'If an account with that email exists, a password reset code has been sent to it.');
  }

  await storeAndSendOTP(user.email, `otp:reset:${user.id}`, 'reset');
  return sendSuccess(res, 200, 'If an account with that email exists, a password reset code has been sent to it.');
});

export const resetPassword = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  

  const email = String(req.body?.email || '').trim().toLowerCase();
  const cleanOtp = String(req.body?.otp || '').trim();
  const { newPassword } = req.body;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new ApiError(400, 'Invalid or expired OTP');

  const result = await verifyOTPFromRedis(`otp:reset:${user.id}`, cleanOtp);
  if (!result.success) throw new ApiError(400, result.message);

  const passwordHash = await bcrypt.hash(newPassword, 10);
  
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        isEmailVerified: true,
        failedLoginAttempts: 0,
        lockedUntil: null
      },
    }),
    prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  ]);

  try {
    const redisHashes = await redis.smembers(`user_sessions:${user.id}`);
    if (redisHashes.length > 0) {
      await redis.del(...redisHashes.map((h) => `refresh:${h}`));
    }
    await redis.del(`user_sessions:${user.id}`);
  } catch (err: any) {
    logger.error('Failed to clean up Redis user sessions during password reset', { userId: user.id, error: err.message });
  }

  return sendSuccess(res, 200, 'Password reset successfully. Please log in with your new password.');
});
