const Joi = require('joi');

const verifyEmailSchema = Joi.object({
  email: Joi.string().email().optional(),
  otp: Joi.alternatives().try(
    Joi.string().length(6),
    Joi.number().integer().min(100000).max(999999)
  ).required(),
});

const sendResetSchema = Joi.object({
  email: Joi.string().email().max(100).required(),
});

const resetPasswordSchema = Joi.object({
  email: Joi.string().email().max(100).required(),
  otp: Joi.alternatives().try(
    Joi.string().length(6),
    Joi.number().integer().min(100000).max(999999)
  ).required(),
  newPassword: Joi.string().min(8).max(50).required(),
});

module.exports = {
  verifyEmailSchema,
  sendResetSchema,
  resetPasswordSchema,
};
