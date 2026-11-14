import { z } from 'zod';

export const workflowActionTypeSchema = z.enum([
  'CREATE_ORGANIZATION',
  'CREATE_TEAM',
  'ADD_TEAM_MEMBER',
  'REMOVE_TEAM_MEMBER',
  'INVITE_ORG_MEMBER',
  'SCHEDULE_MEETING',
  'SHARE_DOCUMENT',
  'CREATE_DOCUMENT',
  'CREATE_TASK',
  'ASSIGN_TASK',
  'CREATE_PROJECT',
  'CREATE_WHITEBOARD',
  'CREATE_POLL',
  'NOTIFY_MEMBERS',
  'CREATE_COMMUNITY',
  'CREATE_COMMUNITY_POST',
  'POST_COMMUNITY',
  'CREATE_POST',
  'INVITE_COMMUNITY_MEMBER',
  'REMOVE_COMMUNITY_MEMBER',
  'SEND_CHAT_MESSAGE',
  'SEND_MESSAGE',
  'WRITE_MESSAGE',
  'DELETE_CHAT_MESSAGE',
  'DELETE_MESSAGE',
  'DELETE_COMMUNITY_POST',
  'DELETE_POST',
  'START_VIDEO_CALL',
  'START_CALL',
  'START_MEETING',
  'MAKE_VIDEO_CALL',
  'CREATE_MEETING',
  'MAKE_MEETING',
  'INSTANT_MEETING',
  'LAUNCH_MEETING',
  'UPDATE_TASK_STATUS',
  'COMPLETE_TASK',
  'CANCEL_MEETING',
  'PIN_CHAT_MESSAGE',
  'PIN_MESSAGE',
  'ADD_PROJECT_MEMBER',
  'INVITE_PROJECT_MEMBER',
  'ARCHIVE_DOCUMENT',
  'SET_USER_STATUS',
  'UPDATE_USER_STATUS',
  'RESCHEDULE_MEETING',
  'MOVE_MEETING',
  'CHANGE_MEETING_TIME',
  'CREATE_PROJECT_TASK',
  'ADD_PROJECT_TASK',
  'UNPIN_CHAT_MESSAGE',
  'UNPIN_MESSAGE',
  'CREATE_CALENDAR_EVENT',
  'SCHEDULE_EVENT',
  'CREATE_EVENT',
  'ADD_REMINDER',
  'UPDATE_MEMBER_ROLE',
  'CHANGE_MEMBER_ROLE',
  'SET_MEMBER_ROLE',
  'DELETE_CALENDAR_EVENT',
  'CANCEL_EVENT',
  'REMOVE_EVENT',
  'DELETE_EVENT',
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
  confirmed: z.boolean().optional().default(false),
  timezone: z.string().trim().optional(),
  clientTime: z.string().trim().optional(),
});

export const workflowExecuteSchema = z.object({
  planId: z.string().trim().min(1, 'Plan ID is required'),
  confirmed: z.boolean().optional().default(false),
});

export type WorkflowActionType = z.infer<typeof workflowActionTypeSchema>;
export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export type WorkflowPlanInput = z.infer<typeof workflowPlanSchema>;
export type WorkflowExecuteInput = z.infer<typeof workflowExecuteSchema>;
