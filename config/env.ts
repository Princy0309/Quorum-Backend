import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(5000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string(),
  
  JWT_SECRET: z.string().default('quorum_default_super_secret_jwt_key_2026'),
  JWT_REFRESH_SECRET: z.string().default('quorum_default_super_refresh_jwt_key_2026'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().default(7 * 24 * 60 * 60),
  JWT_ISSUER: z.string().default('quorum-api'),
  JWT_AUDIENCE: z.string().default('quorum-app'),

  CLIENT_URL: z.string().url().default('http://localhost:3000'),
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  ALLOWED_ORIGINS: z.string().optional(),
  REDIS_URL: z.string().url(),
}).passthrough();

const envVars = envSchema.safeParse(process.env);

if (!envVars.success) {
  console.warn(`Config validation warning: ${envVars.error.issues[0].message}`);
}
const data = envVars.data!;


export const env = {
  PORT: data?.PORT || 5000,
  NODE_ENV: data?.NODE_ENV || 'production',
  DATABASE_URL: data?.DATABASE_URL,
  JWT_SECRET: data?.JWT_SECRET || 'quorum_default_super_secret_jwt_key_2026',
  JWT_REFRESH_SECRET: data?.JWT_REFRESH_SECRET || 'quorum_default_super_refresh_jwt_key_2026',
  JWT_EXPIRES_IN: data?.JWT_EXPIRES_IN || '15m',
  REFRESH_TOKEN_TTL_SECONDS: data?.REFRESH_TOKEN_TTL_SECONDS || 604800,
  JWT_ISSUER: data?.JWT_ISSUER || 'quorum-api',
  JWT_AUDIENCE: data?.JWT_AUDIENCE || 'quorum-app',
  CLIENT_URL: data?.CLIENT_URL || 'https://newquorum.me',
  SMTP_HOST: data?.SMTP_HOST || 'smtp.gmail.com',
  SMTP_PORT: data?.SMTP_PORT || 587,
  SMTP_USER: data?.SMTP_USER || '',
  SMTP_PASS: data?.SMTP_PASS || '',
  ALLOWED_ORIGINS: data?.ALLOWED_ORIGINS,
  REDIS_URL: data?.REDIS_URL,
};

export default env;
