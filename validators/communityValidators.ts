import { z } from 'zod';

export const createCommunitySchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(1000).optional().nullable()
});

export const updateCommunitySchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(1000).optional().nullable()
}).refine((data) => data.name !== undefined || data.description !== undefined, {
  message: 'At least one field (name or description) must be provided'
});

export const createInviteSchema = z.object({
  expiresInDays: z.coerce.number().int().min(1).max(30).optional()
});

export const updateMemberRoleSchema = z.object({
  role: z.enum(['ADMIN', 'MEMBER'])
});

export const transferOwnershipSchema = z.object({
  newOwnerId: z.string().trim().min(1)
});

