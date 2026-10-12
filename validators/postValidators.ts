import Joi from 'joi';

export const createPostSchema = Joi.object({
  content: Joi.string().trim().min(1).max(10000).required()
});

export const updatePostSchema = Joi.object({
  content: Joi.string().trim().min(1).max(10000).required()
});

export const createCommentSchema = Joi.object({
  content: Joi.string().trim().min(1).max(5000).required()
});

export const updateCommentSchema = Joi.object({
  content: Joi.string().trim().min(1).max(5000).required()
});
