import dotenv from 'dotenv';
import Joi from 'joi';

dotenv.config();

const envSchema = Joi.object({
  PORT: Joi.number().default(5000),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  DATABASE_URL: Joi.string().required(),
  
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required().invalid(Joi.ref('JWT_SECRET')).messages({
    'any.invalid': 'JWT_REFRESH_SECRET must be different from JWT_SECRET'
  }),
  JWT_EXPIRES_IN: Joi.string().default('15m'),
  REFRESH_TOKEN_TTL_SECONDS: Joi.number().required().min(3600), // e.g. at least 1 hour
  JWT_ISSUER: Joi.string().required(),
  JWT_AUDIENCE: Joi.string().required(),

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
  JWT_REFRESH_SECRET: envVars.JWT_REFRESH_SECRET,
  JWT_EXPIRES_IN: envVars.JWT_EXPIRES_IN,
  REFRESH_TOKEN_TTL_SECONDS: envVars.REFRESH_TOKEN_TTL_SECONDS,
  JWT_ISSUER: envVars.JWT_ISSUER,
  JWT_AUDIENCE: envVars.JWT_AUDIENCE,
  CLIENT_URL: envVars.CLIENT_URL,
  SMTP_HOST: envVars.SMTP_HOST,
  SMTP_PORT: envVars.SMTP_PORT,
  SMTP_USER: envVars.SMTP_USER,
  SMTP_PASS: envVars.SMTP_PASS,
  ALLOWED_ORIGINS: envVars.ALLOWED_ORIGINS,
  REDIS_URL: envVars.REDIS_URL,
};

export default env;
