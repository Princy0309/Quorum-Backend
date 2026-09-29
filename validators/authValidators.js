const Joi = require('joi');

const registerSchema = Joi.object({
  name: Joi.string().trim().min(2).max(20).pattern(/^[\x21-\x7E]+$/, 'no spaces or emojis allowed').required(),
  email: Joi.string().email().lowercase().trim().max(50).pattern(/^[\x21-\x7E]+$/, 'no spaces or emojis allowed').required(),
  password: Joi.string().min(8).max(30).pattern(/^[\x21-\x7E]+$/, 'no spaces or emojis allowed').required()
});

const loginSchema = Joi.object({
  email: Joi.string().email().lowercase().trim().max(50).pattern(/^[\x21-\x7E]+$/, 'no spaces or emojis allowed').required(),
  password: Joi.string().max(30).pattern(/^[\x21-\x7E]+$/, 'no spaces or emojis allowed').required()
});

module.exports = { registerSchema, loginSchema };