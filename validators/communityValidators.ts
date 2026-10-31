import { z } from 'zod';

export const createCommunitySchema = z.object({
  name: z.string().trim().min(2, 'Community name must be between 2 and 100 characters').max(100, 'Community name must be between 2 and 100 characters'),
  description: z.string().trim().max(300, 'Community description cannot exceed 300 characters').optional().nullable()
});

export const updateCommunitySchema = z.object({
  name: z.string().trim().min(2, 'Community name must be between 2 and 100 characters').max(100, 'Community name must be between 2 and 100 characters').optional(),
  description: z.string().trim().max(300, 'Community description cannot exceed 300 characters').optional().nullable()
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
  invitedUserId: z.string().trim().min(1).optional(),
  targetUserId: z.string().trim().min(1).optional(),
  inviteeId: z.string().trim().min(1).optional(),
  email: z.string().trim().email().optional(),
  invitedEmail: z.string().trim().email().optional(),
  role: z.enum(['ADMIN', 'MEMBER']).optional().default('MEMBER'),
  expiresInDays: z.coerce.number().int().min(1).max(30).optional(),
  expiresInHours: z.coerce.number().int().min(1).optional()
}).passthrough();

export const respondInviteSchema = z.object({
  action: z.enum(['accept', 'decline'])
});

export const createChannelSchema = z.object({
  name: z.string().trim().min(2, 'Channel name must be between 2 and 50 characters').max(50, 'Channel name must be between 2 and 50 characters'),
  description: z.string().trim().max(300, 'Channel description cannot exceed 300 characters').optional().nullable()
});

export const updateChannelSchema = z.object({
  name: z.string().trim().min(2, 'Channel name must be between 2 and 50 characters').max(50, 'Channel name must be between 2 and 50 characters').optional(),
  description: z.string().trim().max(300, 'Channel description cannot exceed 300 characters').optional().nullable()
}).refine((data) => data.name !== undefined || data.description !== undefined, {
  message: 'At least one field (name or description) must be provided'
});
