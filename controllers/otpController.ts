import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../config/prisma';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { sendSuccess } from '../utils/apiResponse';
import { storeAndSendOTP, verifyOTPFromRedis } from '../services/otpService';

const { verifyEmailSchema, sendResetSchema, resetPasswordSchema } = require('../validators/otpValidators');

export const sendVerificationOTP = asyncHandler(async (req: Request | any, res: Response, next: NextFunction) => {
 const email = req.user?.email || req.body?.email;
  if (!email) throw new ApiError(400, 'Email address is required');

  const user = req.user || await prisma.user.findUnique({ where: { email } });
  if (!user) throw new ApiError(404, 'User not found');


  await storeAndSendOTP(user.id, user.email, `otp:verify:${user.id}`, 'verification');

  return sendSuccess(res, 200, 'Verification OTP sent to your email');
});


export const verifyEmail = asyncHandler(async (req: Request | any, res: Response, next: NextFunction) => {
  const { error } = verifyEmailSchema.validate(req.body);
  if (error) throw new ApiError(400, error.details[0].message);

   const { otp, email } = req.body;
  const user = req.user || (email ? await prisma.user.findUnique({ where: { email } }) : null);

  if (!user) {
    throw new ApiError(400, 'User not found or authorization missing. Please provide your email.');
  }


  const result = await verifyOTPFromRedis(`otp:verify:${user.id}`, otp);

  if (!result.success) throw new ApiError(400, result.message);

  
  await prisma.user.update({
    where: { id: user.id },
    data: { isEmailVerified: true },
  });

  return sendSuccess(res, 200, 'Email verified successfully');
});


export const forgotPassword = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { error } = sendResetSchema.validate(req.body);
  if (error) throw new ApiError(400, error.details[0].message);

  const { email } = req.body;

  const user = await prisma.user.findUnique({ where: { email } });

  
  if (!user) {
    return sendSuccess(res, 200, 'If an account with that email exists, a reset code has been sent');
  }

  await storeAndSendOTP(user.id, user.email, `otp:reset:${user.id}`, 'reset');

  return sendSuccess(res, 200, 'Password reset OTP sent to your email');
});


export const resetPassword = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { error } = resetPasswordSchema.validate(req.body);
  if (error) throw new ApiError(400, error.details[0].message);

  const { email, otp, newPassword } = req.body;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new ApiError(404, 'User not found with this email address');

  const result = await verifyOTPFromRedis(`otp:reset:${user.id}`, otp);

  if (!result.success) throw new ApiError(400, result.message);

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  return sendSuccess(res, 200, 'Password reset successfully. Please log in with your new password.');
});
