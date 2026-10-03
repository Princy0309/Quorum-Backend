import dotenv from 'dotenv';
import Joi from 'joi';

dotenv.config();

const envSchema = Joi.object({
  PORT: Joi.number().default(5000),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  DATABASE_URL: Joi.string().required(),
  
  JWT_SECRET: Joi.string().default('quorum_default_super_secret_jwt_key_2026'),
  JWT_REFRESH_SECRET: Joi.string().default('quorum_default_super_refresh_jwt_key_2026'),
  JWT_EXPIRES_IN: Joi.string().default('15m'),
  REFRESH_TOKEN_TTL_SECONDS: Joi.number().default(7 * 24 * 60 * 60),
  JWT_ISSUER: Joi.string().default('quorum-api'),
  JWT_AUDIENCE: Joi.string().default('quorum-app'),

  CLIENT_URL: Joi.string().uri().default('http://localhost:3000'),
  SMTP_HOST: Joi.string().default('smtp.gmail.com'),
  SMTP_PORT: Joi.number().default(587),
  SMTP_USER: Joi.string().allow('', null).default(''),
  SMTP_PASS: Joi.string().allow('', null).default(''),
  ALLOWED_ORIGINS: Joi.string().optional(),
  REDIS_URL: Joi.string().uri().required(),
}).unknown(true);

const { error, value: envVars } = envSchema.validate(process.env);

if (error) {
  console.warn(`Config validation warning: ${error.message}`);
}

export const env = {
  PORT: envVars?.PORT || 5000,
  NODE_ENV: envVars?.NODE_ENV || 'production',
  DATABASE_URL: envVars?.DATABASE_URL,
  JWT_SECRET: envVars?.JWT_SECRET || 'quorum_default_super_secret_jwt_key_2026',
  JWT_REFRESH_SECRET: envVars?.JWT_REFRESH_SECRET || 'quorum_default_super_refresh_jwt_key_2026',
  JWT_EXPIRES_IN: envVars?.JWT_EXPIRES_IN || '15m',
  REFRESH_TOKEN_TTL_SECONDS: envVars?.REFRESH_TOKEN_TTL_SECONDS || 604800,
  JWT_ISSUER: envVars?.JWT_ISSUER || 'quorum-api',
  JWT_AUDIENCE: envVars?.JWT_AUDIENCE || 'quorum-app',
  CLIENT_URL: envVars?.CLIENT_URL || 'https://newquorum.me',
  SMTP_HOST: envVars?.SMTP_HOST || 'smtp.gmail.com',
  SMTP_PORT: envVars?.SMTP_PORT || 587,
  SMTP_USER: envVars?.SMTP_USER || '',
  SMTP_PASS: envVars?.SMTP_PASS || '',
  ALLOWED_ORIGINS: envVars?.ALLOWED_ORIGINS,
  REDIS_URL: envVars?.REDIS_URL,
};

export default env;
