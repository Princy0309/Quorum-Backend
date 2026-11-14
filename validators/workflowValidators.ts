import { z } from 'zod';

export const workflowActionTypeSchema = z.enum([
  'CREATE_ORGANIZATION',
  'CREATE_TEAM',
  'SCHEDULE_MEETING',
  'SHARE_DOCUMENT',
  'NOTIFY_MEMBERS',
  'CREATE_COMMUNITY',
  'CREATE_COMMUNITY_POST',
  'POST_COMMUNITY',
  'CREATE_POST',
  'SEND_CHAT_MESSAGE',
  'SEND_MESSAGE',
  'WRITE_MESSAGE',
]);

export const workflowStepSchema = z.object({
  step: z.number().int().positive(),
  action: workflowActionTypeSchema,
  params: z.record(z.string(), z.any()),
  description: z.string().optional(),
});

export const workflowPlanSchema = z.object({
  prompt: z.string().trim().min(5, 'Prompt must be at least 5 characters long').max(4000),
  organizationId: z.string().trim().max(100).optional(),
  autoExecute: z.boolean().optional().default(false),
  timezone: z.string().trim().optional(),
  clientTime: z.string().trim().optional(),
});

export const workflowExecuteSchema = z.object({
  planId: z.string().trim().min(1, 'Plan ID is required'),
});

export type WorkflowActionType = z.infer<typeof workflowActionTypeSchema>;
export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export type WorkflowPlanInput = z.infer<typeof workflowPlanSchema>;
export type WorkflowExecuteInput = z.infer<typeof workflowExecuteSchema>;
