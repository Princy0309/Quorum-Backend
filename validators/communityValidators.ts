import Joi from 'joi';

export const createCommunitySchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  description: Joi.string().trim().max(1000).allow('', null).optional()
});

export const updateCommunitySchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).optional(),
  description: Joi.string().trim().max(1000).allow('', null).optional()
}).min(1);
