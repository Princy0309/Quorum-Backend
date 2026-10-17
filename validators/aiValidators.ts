import { z } from 'zod';

export const aiChatSchema = z.object({
  prompt: z.string().trim().min(1, 'Prompt cannot be empty').max(10000),
  context: z.string().trim().max(10000).optional(),
});

export const aiSummarySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  focus: z.string().trim().max(500).optional(),
});

export const aiSearchSchema = z.object({
  query: z.string().trim().min(1, 'Search query cannot be empty').max(1000),
  limit: z.coerce.number().int().min(1).max(50).optional().default(15),
});

export const aiProjectAssistanceSchema = z.object({
  prompt: z.string().trim().min(1, 'Prompt cannot be empty').max(10000),
  organizationId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  communityId: z.string().uuid().optional(),
});

export const aiQuickRepliesSchema = z.object({
  mode: z.enum(['replies', 'follow_up', 'rewrite']).default('replies'),
  message: z.string().trim().max(10000).optional(),
  conversationId: z.string().uuid().optional(),
  tone: z.enum(['professional', 'casual', 'friendly', 'concise', 'enthusiastic']).default('professional'),
}).refine((data) => data.message || data.conversationId, {
  message: 'Either message or conversationId must be provided',
  path: ['message']
});

export const aiProjectUpdateSchema = z.object({
  organizationId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  communityId: z.string().uuid().optional(),
  timeframe: z.enum(['last_7_days', 'last_30_days', 'all']).default('last_7_days'),
});

export const aiHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  cursor: z.string().optional(),
  actionType: z.string().optional(),
  conversationId: z.string().uuid().optional(),
});
