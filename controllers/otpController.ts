import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../config/prisma';
import redis from '../config/redis';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { sendSuccess } from '../utils/apiResponse';
import { storeAndSendOTP, verifyOTPFromRedis } from '../services/otpService';
import { issueTokens, revokeAllSessions } from '../services/tokenService';
import { refreshCookieOptions } from '../utils/cookieOptions';

import { verifyEmailSchema, sendResetSchema, resetPasswordSchema } from '../validators/otpValidators';

export const sendVerificationOTP = asyncHandler(async (req: Request | any, res: Response, next: NextFunction) => {
  const rawEmail = req.body?.email || req.user?.email;
  if (!rawEmail) throw new ApiError(400, 'Email address is required');
  const email = rawEmail.trim().toLowerCase();

  const user = (await prisma.user.findUnique({ where: { email } })) || req.user;
  if (!user) {
    return sendSuccess(res, 200, 'If an account with that email exists and is unverified, a verification code has been sent.');
  }

  const existing = await redis.get(`otp:verify:${user.id}`);
  if (existing) {
    try {
      const parsed = JSON.parse(existing);
      if (parsed.createdAt && Date.now() - parsed.createdAt < 60 * 1000) {
        return sendSuccess(res, 200, 'Verification code already sent. Please check your inbox.');
      }
    } catch (e) {}
  }

  await storeAndSendOTP(user.email, `otp:verify:${user.id}`, 'verification');
  return sendSuccess(res, 200, 'If an account with that email exists and is unverified, a verification code has been sent.');
});

export const verifyEmail = asyncHandler(async (req: Request | any, res: Response, next: NextFunction) => {
  const { error } = verifyEmailSchema.validate(req.body);
  if (error) throw new ApiError(400, error.details[0].message);

  const rawEmail = req.body?.email;
  const cleanEmail = rawEmail ? rawEmail.trim().toLowerCase() : null;
  const cleanOtp = String(req.body?.otp || '').trim();

  let user = null;
  if (cleanEmail) {
    user = await prisma.user.findUnique({ where: { email: cleanEmail } });
  }
  if (!user && req.user) {
    user = req.user;
  }

  if (!user) {
    throw new ApiError(400, 'User not found. Please provide your registered email address.');
  }

  if (user.isEmailVerified) {
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

  const result = await verifyOTPFromRedis(`otp:verify:${user.id}`, cleanOtp);
  if (!result.success) throw new ApiError(400, result.message);

  try {
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { isEmailVerified: true },
    });

    const { accessToken, refreshToken } = await issueTokens(updatedUser, req);

    res.cookie('refreshToken', refreshToken, refreshCookieOptions);
    res.setHeader('x-refresh-token', refreshToken);

    const responseData: any = {
      accessToken,
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        isEmailVerified: true,
      },
    };

    return sendSuccess(res, 200, 'Email verified successfully', responseData);
  } catch (err: any) {
    console.error('Error during post-verification session issuance:', err);
    // Recoverable workflow: user is verified, just needs to login
    return sendSuccess(res, 200, 'Email verified successfully. Please log in to continue.', {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isEmailVerified: true,
      },
    });
  }
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { error } = sendResetSchema.validate(req.body);
  if (error) throw new ApiError(400, error.details[0].message);

  const email = String(req.body?.email || '').trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    return sendSuccess(res, 200, 'If an account with that email exists, a password reset code has been sent to it.');
  }

  await storeAndSendOTP(user.email, `otp:reset:${user.id}`, 'reset');
  return sendSuccess(res, 200, 'If an account with that email exists, a password reset code has been sent to it.');
});

export const resetPassword = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { error } = resetPasswordSchema.validate(req.body);
  if (error) throw new ApiError(400, error.details[0].message);

  const email = String(req.body?.email || '').trim().toLowerCase();
  const cleanOtp = String(req.body?.otp || '').trim();
  const { newPassword } = req.body;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new ApiError(400, 'Invalid or expired OTP');

  const result = await verifyOTPFromRedis(`otp:reset:${user.id}`, cleanOtp);
  if (!result.success) throw new ApiError(400, result.message);

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  await revokeAllSessions(user.id);

  return sendSuccess(res, 200, 'Password reset successfully. Please log in with your new password.');
});
