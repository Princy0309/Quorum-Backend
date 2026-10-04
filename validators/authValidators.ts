import { z } from 'zod';

export const passwordSchema = z.string()
  .min(8)
  .max(72)
  .regex(/^[\x20-\x7E]+$/, 'only printable ASCII characters allowed');

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(50).regex(/^[\x20-\x7E]+$/, 'only printable ASCII allowed'),
  email: z.string().email().toLowerCase().trim().max(50).regex(/^[\x21-\x7E]+$/, 'only printable ASCII allowed'),
  password: passwordSchema
});

export const loginSchema = z.object({
  email: z.string().email().toLowerCase().trim().max(50).regex(/^[\x21-\x7E]+$/, 'only printable ASCII allowed'),
  password: passwordSchema
});
