import Joi from 'joi';

const isTrustedMediaUrl = (value: string, helpers: Joi.CustomHelpers) => {
  if (!value) return value;

  const allowedHosts = [
    'res.cloudinary.com',
    'cloudinary.com',
    's3.amazonaws.com',
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
  content: Joi.string().trim().max(5000).allow(''),
  fileUrl: Joi.string()
    .uri({ scheme: ['https'] })
    .max(2048)
    .custom(isTrustedMediaUrl)
    .messages({
      'any.invalid': 'fileUrl must originate from an authorized media storage provider (Cloudinary/S3)'
    })
    .allow(null, ''),
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
