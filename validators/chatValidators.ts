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

export const registerDeviceTokenSchema = Joi.object({
  token: Joi.string().trim().min(10).max(500).required(),
  platform: Joi.string().trim().valid('web', 'android', 'ios').default('web')
});

export const unregisterDeviceTokenSchema = Joi.object({
  token: Joi.string().trim().min(10).max(500).required()
});
