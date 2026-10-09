import Joi from 'joi';
import { z } from 'zod';

const isTrustedMediaUrl = (value: string, helpers: Joi.CustomHelpers) => {
  if (!value) return value;

  const allowedHosts = [
    'res.cloudinary.com',
    'cloudinary.com',
    's3.amazonaws.com',
    'amazonaws.com',
    'storage.googleapis.com'
  ];

  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();

    const isAllowed = allowedHosts.some((allowed) => host === allowed || host.endsWith('.' + allowed));
    if (!isAllowed) {
      return helpers.error('any.invalid');
    }
    return value;
  } catch (err) {
    return helpers.error('string.uri');
  }
};

export const sendMessageSchema = Joi.object({
  conversationId: Joi.string().trim().max(100).required(),
  clientMessageId: Joi.string().trim().max(100).optional(),
  content: Joi.string().trim().min(1).max(5000),
  fileUrl: Joi.string()
    .uri({ scheme: ['https'] })
    .max(2048)
    .custom(isTrustedMediaUrl)
    .messages({
      'any.invalid': 'fileUrl must originate from an authorized media storage provider (Cloudinary/S3)'
    }),
  fileType: Joi.string().valid('image', 'video', 'audio', 'file')
}).or('content', 'fileUrl');

export const readMessageSchema = Joi.object({
  conversationId: Joi.string().trim().max(100).required(),
  messageId: Joi.string().trim().max(100).required()
});

export const typingSchema = Joi.object({
  conversationId: Joi.string().trim().max(100).required()
});

export const registerDeviceTokenSchema = z.object({
  token: z.string().trim().min(10).max(500),
  platform: z.enum(['web', 'android', 'ios']).default('web')
});

export const unregisterDeviceTokenSchema = z.object({
  token: z.string().trim().min(10).max(500)
});

export const createGroupSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100).required(),
  avatar: Joi.string().uri({ scheme: ['https'] }).max(2048).custom(isTrustedMediaUrl).optional(),
  participantIds: Joi.array().items(Joi.string().trim().max(100)).min(1).max(99).required()
});

export const addParticipantsSchema = Joi.object({
  participantIds: Joi.array().items(Joi.string().trim().max(100)).min(1).max(50).required()
});

export const updateGroupSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100).optional(),
  avatar: Joi.string().uri({ scheme: ['https'] }).max(2048).custom(isTrustedMediaUrl).allow(null).optional()
}).or('name', 'avatar');
