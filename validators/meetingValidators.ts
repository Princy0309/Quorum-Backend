import { z } from 'zod';
import { MeetingScopeType } from '@prisma/client';

export const createScopedMeetingSchema = z
  .object({
    title: z.string().trim().min(1, 'Title cannot be empty').max(200, 'Title cannot exceed 200 characters').optional(),
    scopeType: z.nativeEnum(MeetingScopeType).default(MeetingScopeType.PERSONAL),
    organizationId: z.string().uuid('Invalid organization ID format').optional(),
    teamId: z.string().uuid('Invalid team ID format').optional(),
    scheduledStartTime: z.string().datetime().or(z.date()).optional(),
  })
  .refine(
    (data) => {
      if (data.scopeType === MeetingScopeType.ORGANIZATION) return !!data.organizationId;
      if (data.scopeType === MeetingScopeType.TEAM) return !!data.organizationId && !!data.teamId;
      return true;
    },
    {
      message: 'organizationId required for ORGANIZATION scope; both organizationId and teamId required for TEAM scope',
    }
  );

export const meetingCodeParamSchema = z
  .string()
  .regex(/^[a-z]{3}-[a-z]{3}-[a-z]{3}$/, 'Invalid meeting code format (expected xxx-xxx-xxx)');

export const uuidParamSchema = z
  .string()
  .uuid('Invalid UUID format');

export type CreateScopedMeetingInput = z.infer<typeof createScopedMeetingSchema>;

export const createMeetingPollSchema = z.object({
  question: z.string().trim().min(1, 'Poll question is required').max(500, 'Poll question cannot exceed 500 characters'),
  options: z.array(z.string().trim().min(1, 'Option text cannot be empty').max(200, 'Option cannot exceed 200 characters'))
    .min(2, 'A poll must have at least 2 options')
    .max(12, 'A poll cannot have more than 12 options'),
  allowMultipleAnswers: z.boolean().optional().default(false),
  isAnonymous: z.boolean().optional().default(false),
});

export const voteMeetingPollSchema = z.object({
  optionIds: z.array(z.string().trim().min(1, 'Option ID cannot be empty')).min(1, 'At least one option ID must be selected'),
});

export type CreateMeetingPollInput = z.infer<typeof createMeetingPollSchema>;
export type VoteMeetingPollInput = z.infer<typeof voteMeetingPollSchema>;
