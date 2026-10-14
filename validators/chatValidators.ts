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
  content: Joi.string().allow('', null).trim().max(5000).optional(),
  caption: Joi.string().allow('', null).trim().max(5000).optional(),
  fileUrl: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .max(2048)
    .custom(isTrustedMediaUrl)
    .messages({
      'any.invalid': 'fileUrl must originate from an authorized media storage provider (Cloudinary/S3)'
    })
    .allow('', null)
    .optional(),
  url: Joi.string().uri({ scheme: ['http', 'https'] }).max(2048).allow('', null).optional(),
  fileType: Joi.string().allow(null, '').optional(),
  type: Joi.string().allow(null, '').optional(),
  fileName: Joi.string().trim().max(255).allow(null, '').optional(),
  fileSize: Joi.number().integer().min(0).max(26214400).allow(null).optional()
}).unknown(true);

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
  avatar: Joi.string().uri({ scheme: ['https'] }).max(2048).custom(isTrustedMediaUrl).allow(null, '').optional(),
  participantIds: Joi.array().items(Joi.string().trim().max(100)).min(1).max(99).optional(),
  userIds: Joi.array().items(Joi.string().trim().max(100)).min(1).max(99).optional(),
  members: Joi.array().items(Joi.string().trim().max(100)).min(1).max(99).optional(),
  memberIds: Joi.array().items(Joi.string().trim().max(100)).min(1).max(99).optional()
}).or('participantIds', 'userIds', 'members', 'memberIds');

export const addParticipantsSchema = Joi.object({
  participantIds: Joi.array().items(Joi.string().trim().max(100)).min(1).max(50).optional(),
  userIds: Joi.array().items(Joi.string().trim().max(100)).min(1).max(50).optional(),
  members: Joi.array().items(Joi.string().trim().max(100)).min(1).max(50).optional(),
  memberIds: Joi.array().items(Joi.string().trim().max(100)).min(1).max(50).optional()
}).or('participantIds', 'userIds', 'members', 'memberIds');

export const updateGroupSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100).optional(),
  avatar: Joi.string().uri({ scheme: ['https'] }).max(2048).custom(isTrustedMediaUrl).allow(null).optional()
}).or('name', 'avatar');

export const transferOwnershipSchema = Joi.object({
  newOwnerId: Joi.string().trim().max(100).required()
});

export const signUploadSchema = Joi.object({
  conversationId: Joi.string().trim().max(100).optional(),
  communityId: Joi.string().trim().max(100).optional(),
  fileName: Joi.string().trim().min(1).max(255).required(),
  fileSize: Joi.number().integer().min(1).max(26214400).required(),
  fileType: Joi.string().valid('image', 'file', 'document').optional(),
  folder: Joi.string().trim().max(100).optional()
}).unknown(true);

