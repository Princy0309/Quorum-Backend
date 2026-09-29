const Joi = require('joi');

const registerSchema = Joi.object({
  name: Joi.string().trim().min(2).max(50).pattern(/^\S+$/, 'no spaces allowed').required(),
  email: Joi.string().email().lowercase().trim().max(255).pattern(/^\S+$/, 'no spaces allowed').required(),
  password: Joi.string().min(8).max(100).pattern(/^\S+$/, 'no spaces allowed').required()
});

const loginSchema = Joi.object({
  email: Joi.string().email().lowercase().trim().max(255).pattern(/^\S+$/, 'no spaces allowed').required(),
  password: Joi.string().max(100).pattern(/^\S+$/, 'no spaces allowed').required()
});

module.exports = { registerSchema, loginSchema };