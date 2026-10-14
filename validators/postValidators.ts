import Joi from 'joi';

export const isTrustedMediaUrl = (value: string, helpers: Joi.CustomHelpers) => {
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

export const signCommunityUploadSchema = Joi.object({
  communityId: Joi.string().trim().max(100).required(),
  fileName: Joi.string().trim().min(1).max(255).required(),
  fileSize: Joi.number().integer().min(1).max(26214400).required(),
  fileType: Joi.string().valid('image', 'file', 'document').optional()
});

export const createPostSchema = Joi.object({
  content: Joi.string().trim().max(10000).allow(null, '').optional(),
  fileUrl: Joi.string()
    .uri({ scheme: ['https'] })
    .max(2048)
    .custom(isTrustedMediaUrl)
    .messages({
      'any.invalid': 'fileUrl must originate from an authorized media storage provider (Cloudinary/S3)'
    })
    .allow(null)
    .optional(),
  fileType: Joi.string().valid('image', 'file').allow(null).optional(),
  fileName: Joi.string().trim().max(255).allow(null, '').optional(),
  fileSize: Joi.number().integer().min(1).max(26214400).allow(null).optional()
}).custom((value, helpers) => {
  const hasContent = typeof value.content === 'string' && value.content.trim().length > 0;
  const hasFile = typeof value.fileUrl === 'string' && value.fileUrl.trim().length > 0;
  if (!hasContent && !hasFile) {
    return helpers.error('object.missing', { peers: ['content', 'fileUrl'] });
  }
  return value;
});

export const updatePostSchema = Joi.object({
  content: Joi.string().trim().max(10000).allow(null, '').optional(),
  fileUrl: Joi.string()
    .uri({ scheme: ['https'] })
    .max(2048)
    .custom(isTrustedMediaUrl)
    .messages({
      'any.invalid': 'fileUrl must originate from an authorized media storage provider (Cloudinary/S3)'
    })
    .allow(null)
    .optional(),
  fileType: Joi.string().valid('image', 'file').allow(null).optional(),
  fileName: Joi.string().trim().max(255).allow(null, '').optional(),
  fileSize: Joi.number().integer().min(1).max(26214400).allow(null).optional()
}).custom((value, helpers) => {
  const hasContent = typeof value.content === 'string' && value.content.trim().length > 0;
  const hasFile = typeof value.fileUrl === 'string' && value.fileUrl.trim().length > 0;
  if (!hasContent && !hasFile) {
    return helpers.error('object.missing', { peers: ['content', 'fileUrl'] });
  }
  return value;
});

export const createCommentSchema = Joi.object({
  content: Joi.string().trim().min(1).max(5000).required()
});

export const updateCommentSchema = Joi.object({
  content: Joi.string().trim().min(1).max(5000).required()
});
