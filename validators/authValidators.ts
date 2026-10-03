import Joi from 'joi';

export const passwordSchema = Joi.string()
  .min(8)
  .max(72)
  .pattern(/^[\x20-\x7E]+$/, 'only printable ASCII characters allowed')
  .required();

export const registerSchema = Joi.object({
  name: Joi.string().trim().min(2).max(50).pattern(/^[\x20-\x7E]+$/, 'emojis not allowed').required(),
  email: Joi.string().email().lowercase().trim().max(50).pattern(/^[\x21-\x7E]+$/, 'no spaces or emojis allowed').required(),
  password: passwordSchema
});

export const loginSchema = Joi.object({
  email: Joi.string().email().lowercase().trim().max(50).pattern(/^[\x21-\x7E]+$/, 'no spaces or emojis allowed').required(),
  password: passwordSchema
});
