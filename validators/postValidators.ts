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
    message: 'fileUrl must originate from an authorized media storage provider (Cloudinary/S3)'
  });

export const signCommunityUploadSchema = z.object({
  communityId: z.string().trim().max(100),
  fileName: z.string().trim().min(1).max(255),
  fileSize: z.number().int().min(1).max(26214400),
  fileType: z.enum(['image', 'file', 'document']).optional()
});

export const createPostSchema = z.object({
  channelId: z.string().trim().min(1).optional().nullable(),
  content: z.string().trim().max(10000).optional().nullable(),
  fileUrl: trustedMediaUrlSchema.optional().nullable(),
  fileType: z.enum(['image', 'file']).optional().nullable(),
  fileName: z.string().trim().max(255).optional().nullable(),
  fileSize: z.number().int().min(1).max(26214400).optional().nullable()
}).refine((data) => {
  const hasContent = typeof data.content === 'string' && data.content.trim().length > 0;
  const hasFile = typeof data.fileUrl === 'string' && data.fileUrl.trim().length > 0;
  return hasContent || hasFile;
}, {
  message: 'Post must contain either non-empty content or a file attachment'
});

export const updatePostSchema = z.object({
  content: z.string().trim().max(10000).optional().nullable(),
  fileUrl: trustedMediaUrlSchema.optional().nullable(),
  fileType: z.enum(['image', 'file']).optional().nullable(),
  fileName: z.string().trim().max(255).optional().nullable(),
  fileSize: z.number().int().min(1).max(26214400).optional().nullable()
}).refine((data) => {
  const hasContent = typeof data.content === 'string' && data.content.trim().length > 0;
  const hasFile = typeof data.fileUrl === 'string' && data.fileUrl.trim().length > 0;
  return hasContent || hasFile;
}, {
  message: 'Post must contain either non-empty content or a file attachment'
});

export const createCommentSchema = z.object({
  content: z.string().trim().min(1).max(5000)
});

export const updateCommentSchema = z.object({
  content: z.string().trim().min(1).max(5000)
});

