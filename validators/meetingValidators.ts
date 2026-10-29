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
