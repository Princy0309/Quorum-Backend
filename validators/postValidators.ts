import Joi from 'joi';

export const createPostSchema = Joi.object({
  content: Joi.string().trim().min(1).max(10000).required()
});

export const updatePostSchema = Joi.object({
  content: Joi.string().trim().min(1).max(10000).required()
});
