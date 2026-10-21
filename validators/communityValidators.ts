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
  expiresInDays: z.coerce.number().int().min(1).max(30).optional().default(7)
});

export const updateMemberRoleSchema = z.object({
  role: z.enum(['ADMIN', 'MEMBER'])
});

export const transferOwnershipSchema = z.object({
  newOwnerId: z.string().trim().min(1)
});

export const inviteMemberSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  email: z.string().trim().email().optional(),
  role: z.enum(['ADMIN', 'MEMBER']).optional().default('MEMBER'),
  expiresInDays: z.coerce.number().int().min(1).max(30).optional().default(7)
}).refine((data) => Boolean(data.userId || data.email), {
  message: 'Either userId or email must be provided to invite a user'
});

export const inviteOrLinkSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  email: z.string().trim().email().optional(),
  role: z.enum(['ADMIN', 'MEMBER']).optional().default('MEMBER'),
  expiresInDays: z.coerce.number().int().min(1).max(30).optional().default(7)
});

export const respondInviteSchema = z.object({
  action: z.enum(['accept', 'decline'])
});

export const createChannelSchema = z.object({
  name: z.string().trim().min(2).max(50),
  description: z.string().trim().max(500).optional().nullable()
});

export const updateChannelSchema = z.object({
  name: z.string().trim().min(2).max(50).optional(),
  description: z.string().trim().max(500).optional().nullable()
}).refine((data) => data.name !== undefined || data.description !== undefined, {
  message: 'At least one field (name or description) must be provided'
});
