import Joi from 'joi';

export const sendMessageSchema = Joi.object({
  conversationId: Joi.string().trim().max(100).required(),
  content: Joi.string().trim().max(5000).allow(''),
  fileUrl: Joi.string().uri({ scheme: ['http', 'https'] }).max(2048).allow(null, ''),
  fileType: Joi.string().valid('image', 'video', 'audio', 'file').allow(null, '')
}).or('content', 'fileUrl');

export const readMessageSchema = Joi.object({
  conversationId: Joi.string().trim().max(100).required(),
  messageId: Joi.string().trim().max(100).required()
});

export const typingSchema = Joi.object({
  conversationId: Joi.string().trim().max(100).required()
});
