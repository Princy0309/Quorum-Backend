import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(5000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string(),

  JWT_SECRET: z.string(),
  JWT_REFRESH_SECRET: z.string(),
  JWT_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().default(7 * 24 * 60 * 60),
  JWT_ISSUER: z.string().default('quorum-api'),
  JWT_AUDIENCE: z.string().default('quorum-app'),

  CLIENT_URL: z.string().url().default(process.env.NODE_ENV === 'production' ? 'https://newquorum.me' : 'http://localhost:3000'),
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  ALLOWED_ORIGINS: z.string().min(1, 'ALLOWED_ORIGINS is required in environment configuration'),
  REDIS_URL: z.string().url(),
}).passthrough();

const envVars = envSchema.safeParse(process.env);

if (!envVars.success) {
  console.error('Invalid environment variables:', envVars.error.issues);
  process.exit(1);
}
const data = envVars.data;

export const allowedOrigins: string[] = (data?.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin: string) => origin.trim())
  .filter(Boolean);

export const isOriginAllowed = (origin?: string | null): boolean => {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
    return true;
  }
  return false;
};

export const env = {
  PORT: data?.PORT || 5000,
  NODE_ENV: data?.NODE_ENV || 'production',
  DATABASE_URL: data?.DATABASE_URL,
  JWT_SECRET: data?.JWT_SECRET,
  JWT_REFRESH_SECRET: data?.JWT_REFRESH_SECRET,
  JWT_EXPIRES_IN: data?.JWT_EXPIRES_IN || '15m',
  REFRESH_TOKEN_TTL_SECONDS: data?.REFRESH_TOKEN_TTL_SECONDS || 604800,
  JWT_ISSUER: data?.JWT_ISSUER || 'quorum-api',
  JWT_AUDIENCE: data?.JWT_AUDIENCE || 'quorum-app',
  CLIENT_URL: data?.CLIENT_URL || allowedOrigins[0] || 'http://localhost:3000',
  SMTP_HOST: data?.SMTP_HOST || 'smtp.gmail.com',
  SMTP_PORT: data?.SMTP_PORT || 587,
  SMTP_USER: data?.SMTP_USER || '',
  SMTP_PASS: data?.SMTP_PASS || '',
  ALLOWED_ORIGINS: data?.ALLOWED_ORIGINS || '',
  allowedOrigins,
  REDIS_URL: data?.REDIS_URL,
  GEMINI_API_KEY: data?.GEMINI_API_KEY || process.env.GEMINI_API_KEY || '',
  GEMINI_MODEL: data?.GEMINI_MODEL || process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  AI_HISTORY_RETENTION_DAYS: Number(process.env.AI_HISTORY_RETENTION_DAYS || 30),
};

export default env;
