import Joi from 'joi';
import { passwordSchema } from './authValidators';

export const verifyEmailSchema = Joi.object({
  email: Joi.string().email().optional(),
  otp: Joi.alternatives().try(
    Joi.string().length(6),
    Joi.number().integer().min(100000).max(999999)
  ).required(),
}).unknown(true);

export const sendResetSchema = Joi.object({
  email: Joi.string().email().max(100).required(),
}).unknown(true);

export const resetPasswordSchema = Joi.object({
  email: Joi.string().email().max(100).required(),
  otp: Joi.alternatives().try(
    Joi.string().length(6),
    Joi.number().integer().min(100000).max(999999)
  ).required(),
  newPassword: passwordSchema,
}).unknown(true);
