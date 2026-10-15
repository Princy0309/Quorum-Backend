import { z } from 'zod';

export const isTrustedMediaUrl = (url?: string | null): boolean => {
  if (!url) return true;

  const allowedHosts = [
    'res.cloudinary.com',
    'cloudinary.com',
    's3.amazonaws.com',
    'amazonaws.com',
    'storage.googleapis.com'
  ];

  if (process.env.AWS_S3_CUSTOM_DOMAIN) {
    try {
      const parsedCustom = new URL(
        process.env.AWS_S3_CUSTOM_DOMAIN.startsWith('http')
          ? process.env.AWS_S3_CUSTOM_DOMAIN
          : `https://${process.env.AWS_S3_CUSTOM_DOMAIN}`
      );
      allowedHosts.push(parsedCustom.hostname.toLowerCase());
    } catch {
      allowedHosts.push(process.env.AWS_S3_CUSTOM_DOMAIN.toLowerCase());
    }
  }

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return allowedHosts.some((allowed) => host === allowed || host.endsWith('.' + allowed));
  } catch {
    return false;
  }
};

const trustedMediaUrlSchema = z.string()
  .url('Must be a valid URL')
  .max(2048)
  .refine(isTrustedMediaUrl, {
    message: 'Must originate from an authorized media storage provider (Cloudinary/S3)'
  });

export const sendMessageSchema = z.object({
  conversationId: z.string().trim().min(1, 'conversationId is required').max(100),
  clientMessageId: z.string().trim().max(100).optional(),
  content: z.string().trim().max(5000).optional().nullable(),
  caption: z.string().trim().max(5000).optional().nullable(),
  fileUrl: trustedMediaUrlSchema.optional().nullable().or(z.literal('')),
  url: trustedMediaUrlSchema.optional().nullable().or(z.literal('')),
  fileType: z.string().optional().nullable(),
  type: z.string().optional().nullable(),
  fileName: z.string().trim().max(255).optional().nullable(),
  fileSize: z.number().int().min(0).max(26214400).optional().nullable()
})
  .passthrough()
  .refine((val) => {
    const hasText = Boolean((val.content && val.content.trim()) || (val.caption && val.caption.trim()));
    const hasMedia = Boolean((val.fileUrl && val.fileUrl.trim()) || (val.url && val.url.trim()));
    return hasText || hasMedia;
  }, {
    message: 'Message must contain either non-empty text content or an attachment URL'
  });

export const readMessageSchema = z.object({
  conversationId: z.string().trim().min(1).max(100),
  messageId: z.string().trim().min(1).max(100)
}).passthrough();

export const typingSchema = z.object({
  conversationId: z.string().trim().min(1).max(100)
}).passthrough();

export const registerDeviceTokenSchema = z.object({
  token: z.string().trim().min(10).max(500),
  platform: z.enum(['web', 'android', 'ios']).default('web')
});

export const unregisterDeviceTokenSchema = z.object({
  token: z.string().trim().min(10).max(500)
});

export const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(100),
  avatar: trustedMediaUrlSchema.optional().nullable().or(z.literal('')),
  participantIds: z.array(z.string().trim().max(100)).min(1).max(99).optional(),
  userIds: z.array(z.string().trim().max(100)).min(1).max(99).optional(),
  members: z.array(z.string().trim().max(100)).min(1).max(99).optional(),
  memberIds: z.array(z.string().trim().max(100)).min(1).max(99).optional()
}).refine((data) => {
  return Boolean(
    (data.participantIds && data.participantIds.length > 0) ||
    (data.userIds && data.userIds.length > 0) ||
    (data.members && data.members.length > 0) ||
    (data.memberIds && data.memberIds.length > 0)
  );
}, {
  message: 'At least one participant must be provided'
});

export const addParticipantsSchema = z.object({
  participantIds: z.array(z.string().trim().max(100)).min(1).max(50).optional(),
  userIds: z.array(z.string().trim().max(100)).min(1).max(50).optional(),
  members: z.array(z.string().trim().max(100)).min(1).max(50).optional(),
  memberIds: z.array(z.string().trim().max(100)).min(1).max(50).optional()
}).refine((data) => {
  return Boolean(
    (data.participantIds && data.participantIds.length > 0) ||
    (data.userIds && data.userIds.length > 0) ||
    (data.members && data.members.length > 0) ||
    (data.memberIds && data.memberIds.length > 0)
  );
}, {
  message: 'At least one participant must be provided'
});

export const updateGroupSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  avatar: trustedMediaUrlSchema.optional().nullable().or(z.literal(''))
}).refine((data) => {
  return data.name !== undefined || data.avatar !== undefined;
}, {
  message: 'At least one field (name or avatar) must be provided'
});

export const transferOwnershipSchema = z.object({
  newOwnerId: z.string().trim().min(1).max(100)
});

export const signUploadSchema = z.object({
  conversationId: z.string().trim().max(100).optional(),
  communityId: z.string().trim().max(100).optional(),
  fileName: z.string().trim().min(1).max(255),
  fileSize: z.number().int().min(1).max(26214400),
  fileType: z.enum(['image', 'file', 'document']).optional(),
  folder: z.string().trim().max(100).optional()
}).passthrough();
