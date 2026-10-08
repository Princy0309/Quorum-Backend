import { z } from 'zod';
import { passwordSchema } from './authValidators.js';

export const verifyEmailSchema = z.object({
  email: z.string().email().optional(),
  otp: z.string().length(6),
    
  
}).passthrough();

export const sendResetSchema = z.object({
  email: z.string().email().max(100),
}).passthrough();

export const resetPasswordSchema = z.object({
  email: z.string().email().max(100),
  otp: z.string().length(6),

  newPassword: passwordSchema,
}).passthrough();
