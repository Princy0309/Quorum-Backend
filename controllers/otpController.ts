import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../config/prisma';
import redis from '../config/redis';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { sendSuccess } from '../utils/apiResponse';
import { storeAndSendOTP, verifyOTPFromRedis } from '../services/otpService';
import { issueTokens } from '../services/tokenService';
import { refreshCookieOptions } from '../utils/cookieOptions';

const { verifyEmailSchema, sendResetSchema, resetPasswordSchema } = require('../validators/otpValidators');

export const sendVerificationOTP = asyncHandler(async (req: Request | any, res: Response, next: NextFunction) => {
  const rawEmail = req.body?.email || req.user?.email;
  if (!rawEmail) throw new ApiError(400, 'Email address is required');
  const email = rawEmail.trim().toLowerCase();

  const user = (await prisma.user.findUnique({ where: { email } })) || req.user;
  if (!user) throw new ApiError(404, 'User not found');

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
  return sendSuccess(res, 200, 'Verification OTP sent to your email');
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

  const result = await verifyOTPFromRedis(`otp:verify:${user.id}`, cleanOtp);
  if (!result.success) throw new ApiError(400, result.message);

  try {
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { isEmailVerified: true },
    });

    const { accessToken, refreshToken } = await issueTokens(updatedUser, req);

    res.setHeader('x-refresh-token', refreshToken);
    res.cookie('refreshToken', refreshToken, refreshCookieOptions);

    return sendSuccess(res, 200, 'Email verified successfully', {
      accessToken,
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        isEmailVerified: true,
      },
    });
  } catch (err: any) {
    console.error('Error during post-verification:', err);
    throw new ApiError(500, `Verification completion failed: ${err.message}`);
  }
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { error } = sendResetSchema.validate(req.body);
  if (error) throw new ApiError(400, error.details[0].message);

  const email = String(req.body?.email || '').trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    return sendSuccess(res, 200, 'If an account with that email exists, a reset code has been sent');
  }

  await storeAndSendOTP(user.email, `otp:reset:${user.id}`, 'reset');
  return sendSuccess(res, 200, 'Password reset OTP sent to your email');
});

export const resetPassword = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { error } = resetPasswordSchema.validate(req.body);
  if (error) throw new ApiError(400, error.details[0].message);

  const email = String(req.body?.email || '').trim().toLowerCase();
  const cleanOtp = String(req.body?.otp || '').trim();
  const { newPassword } = req.body;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new ApiError(404, 'User not found with this email address');

  const result = await verifyOTPFromRedis(`otp:reset:${user.id}`, cleanOtp);
  if (!result.success) throw new ApiError(400, result.message);

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  return sendSuccess(res, 200, 'Password reset successfully. Please log in with your new password.');
});
