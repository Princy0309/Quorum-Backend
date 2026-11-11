import { z } from 'zod';
import { OrgPostCategory } from '@prisma/client';
import { isTrustedMediaUrl } from './postValidators.js';

const emptyToNull = (val: unknown) => {
  if (typeof val === 'string' && val.trim() === '') return null;
  return val;
};

const optionalUuidSchema = z.preprocess(
  emptyToNull,
  z.string().trim().uuid('Invalid UUID format').optional().nullable()
);

const optionalTrimmedString = (maxLength: number, label: string) =>
  z.preprocess(
    emptyToNull,
    z.string().trim().max(maxLength, `${label} cannot exceed ${maxLength} characters`).optional().nullable()
  );

  const baseMentionedUserIdsSchema = z.preprocess(
  (val) => {
    if (val === undefined) return undefined;
    if (val === null || val === '') return [];
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
      try {
        const parsed = JSON.parse(val);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return val
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
    }
    return val;
  },
  z
    .array(z.string().trim().uuid('Each mentioned user ID must be a valid UUID'))
    .max(25, 'You can mention at most 25 users per post')
    .transform((ids) => Array.from(new Set(ids)))
);

const trustedHttpsMediaUrlSchema = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .url('fileUrl must be a valid URL')
    .max(2048, 'fileUrl is too long')
    .refine((url) => url.startsWith('https://'), {
      message: 'Media URL must use HTTPS',
    })
    .refine(isTrustedMediaUrl, {
      message: 'fileUrl must originate from an authorized media storage provider (Cloudinary/S3)',
    })
    .optional()
    .nullable()
);

const fileTypeSchema = z.preprocess(
  emptyToNull,
  z.enum(['image', 'file', 'document']).optional().nullable()
);

const fileSizeSchema = z.preprocess(
  emptyToNull,
  z.coerce.number().int().min(1).max(26214400, 'File size cannot exceed 25MB').optional().nullable()
);

export const orgIdParamSchema = z.object({
  id: z.string().trim().uuid('Invalid organization ID format'),
});

export const orgPostParamSchema = z.object({
  id: z.string().trim().uuid('Invalid organization ID format'),
  postId: z.string().trim().uuid('Invalid post ID format'),
});

export const orgCommentParamSchema = z.object({
  id: z.string().trim().uuid('Invalid organization ID format'),
  postId: z.string().trim().uuid('Invalid post ID format'),
  commentId: z.string().trim().uuid('Invalid comment ID format'),
});

export const createOrgPostSchema = z.object({
  category: z.nativeEnum(OrgPostCategory).optional().default(OrgPostCategory.GENERAL),
  title: optionalTrimmedString(160, 'Title'),
  content: z.string().trim().max(10000, 'Post content cannot exceed 10000 characters').optional().default(''),
  fileUrl: trustedHttpsMediaUrlSchema,
  fileType: fileTypeSchema,
  fileName: optionalTrimmedString(255, 'File name'),
  fileSize: fileSizeSchema,
  targetUserId: optionalUuidSchema,
  targetTeamId: optionalUuidSchema,
  mentionedUserIds: baseMentionedUserIdsSchema.optional().default([]),
});

export const updateOrgPostSchema = z
  .object({
    category: z.nativeEnum(OrgPostCategory).optional(),
    title: optionalTrimmedString(160, 'Title'),
    content: z.string().trim().max(10000, 'Post content cannot exceed 10000 characters').optional(),
    fileUrl: trustedHttpsMediaUrlSchema,
    fileType: fileTypeSchema,
    fileName: optionalTrimmedString(255, 'File name'),
    fileSize: fileSizeSchema,
    targetUserId: optionalUuidSchema,
    targetTeamId: optionalUuidSchema,
    mentionedUserIds: baseMentionedUserIdsSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided to update',
  });

export const getOrgFeedQuerySchema = z.object({
  category: z.nativeEnum(OrgPostCategory).optional(),
  teamId: optionalUuidSchema,
  search: optionalTrimmedString(100, 'Search query'),
  pinnedOnly: z
    .preprocess((val) => val === 'true' || val === true, z.boolean())
    .optional()
    .default(false),
  cursor: optionalUuidSchema,
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export const toggleReactionSchema = z.object({
  emoji: z
    .string()
    .trim()
    .min(1, 'Emoji is required')
    .max(16, 'Invalid emoji reaction')
    .refine((val) => !/[<>"'/\\]/.test(val), {
      message: 'Emoji contains invalid characters',
    }),
});

export const createOrgCommentSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, 'Comment cannot be empty')
    .max(5000, 'Comment cannot exceed 5000 characters'),
  parentId: optionalUuidSchema,
});

export const updateOrgCommentSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, 'Comment cannot be empty')
    .max(5000, 'Comment cannot exceed 5000 characters'),
});

export const getOrgCommentsQuerySchema = z.object({
  cursor: optionalUuidSchema,
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});