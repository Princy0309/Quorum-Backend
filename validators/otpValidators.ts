import { z } from 'zod';
import { passwordSchema } from './authValidators.js';

export const verifyEmailSchema = z.object({
  email: z.string().email().optional(),
  otp: z.string().length(6).optional(),
  code: z.string().length(6).optional(),
}).refine((data) => Boolean(data.otp || data.code), {
  message: 'OTP is required',
  path: ['otp'],
}).passthrough();

export const sendResetSchema = z.object({
  email: z.string().email().max(100),
}).passthrough();

export const resetPasswordSchema = z.object({
  email: z.string().email().max(100),
  otp: z.string().length(6),

  newPassword: passwordSchema,
}).passthrough();
