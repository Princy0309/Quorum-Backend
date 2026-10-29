import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(5000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required in environment configuration').refine((url) => {
    if (process.env.NODE_ENV === 'production') {
      return !url.includes('sslmode=disable');
    }
    return true;
  }, {
    message: 'DATABASE_URL in production must enforce SSL encryption and cannot use sslmode=disable',
  }),

  JWT_SECRET: z.string(),
  JWT_REFRESH_SECRET: z.string(),
  JWT_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().default(7 * 24 * 60 * 60),
  JWT_ISSUER: z.string().default('quorum-api'),
  JWT_AUDIENCE: z.string().default('quorum-app'),

  CLIENT_URL: z.string().url().default(process.env.CLIENT_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000')).optional(),
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  ALLOWED_ORIGINS: z.string().min(1, 'ALLOWED_ORIGINS is required in environment configuration'),
  REDIS_URL: z.string().url(),

  JIRA_CLIENT_ID: z.string().min(1, 'JIRA_CLIENT_ID is required'),
  JIRA_CLIENT_SECRET: z.string().min(16, 'JIRA_CLIENT_SECRET must be at least 16 chars'),
  JIRA_REDIRECT_URI: z.string().url(),
  JIRA_ENCRYPTION_KEY: z.string().length(64, 'JIRA_ENCRYPTION_KEY must be 64 hex chars (32 bytes)'),
  JIRA_STATE_SECRET: z.string().min(32, 'JIRA_STATE_SECRET must be at least 32 chars'),

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
  if (origin === 'null') return false;
  return allowedOrigins.includes(origin);
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
  CLIENT_URL: data?.CLIENT_URL || allowedOrigins[0] || (data?.NODE_ENV === 'production' ? '' : 'http://localhost:3000'),
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

  JIRA_CLIENT_ID: data?.JIRA_CLIENT_ID,
  JIRA_CLIENT_SECRET: data?.JIRA_CLIENT_SECRET,
  JIRA_REDIRECT_URI: data?.JIRA_REDIRECT_URI,
  JIRA_ENCRYPTION_KEY: data?.JIRA_ENCRYPTION_KEY,
  JIRA_STATE_SECRET: data?.JIRA_STATE_SECRET,

};

export default env;
