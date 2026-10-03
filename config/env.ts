import dotenv from 'dotenv';
import Joi from 'joi';

dotenv.config();

const envSchema = Joi.object({
  PORT: Joi.number().default(5000),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  DATABASE_URL: Joi.string().required(),
  JWT_SECRET: Joi.string().required(),
  JWT_EXPIRES_IN: Joi.string().default('15m'),
  REFRESH_TOKEN_EXPIRES_DAYS: Joi.number().default(7),
  CLIENT_URL: Joi.string().uri().default('http://localhost:3000'),
  SMTP_HOST: Joi.string().required(),
  SMTP_PORT: Joi.number().required(),
  SMTP_USER: Joi.string().required(),
  SMTP_PASS: Joi.string().required(),
  ALLOWED_ORIGINS: Joi.string().optional(),
  REDIS_URL: Joi.string().uri().required(),
}).unknown(true);

const { error, value: envVars } = envSchema.validate(process.env);

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

export const env = {
  PORT: envVars.PORT,
  NODE_ENV: envVars.NODE_ENV,
  DATABASE_URL: envVars.DATABASE_URL,
  JWT_SECRET: envVars.JWT_SECRET,
  JWT_EXPIRES_IN: envVars.JWT_EXPIRES_IN,
  REFRESH_TOKEN_EXPIRES_DAYS: envVars.REFRESH_TOKEN_EXPIRES_DAYS,
  CLIENT_URL: envVars.CLIENT_URL,
  SMTP_HOST: envVars.SMTP_HOST,
  SMTP_PORT: envVars.SMTP_PORT,
  SMTP_USER: envVars.SMTP_USER,
  SMTP_PASS: envVars.SMTP_PASS,
  ALLOWED_ORIGINS: envVars.ALLOWED_ORIGINS,
  REDIS_URL: envVars.REDIS_URL,
};

export default env;
