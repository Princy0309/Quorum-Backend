import { z } from 'zod';

export const aiFileAttachmentSchema = z.object({
  fileUrl: z.string().url('Must be a valid URL').max(2048).optional(),
  url: z.string().url('Must be a valid URL').max(2048).optional(),
  fileName: z.string().trim().max(255).optional(),
  fileType: z.string().trim().max(100).optional(),
  fileSize: z.coerce.number().int().min(0).max(26214400).optional(),
  mimeType: z.string().trim().max(100).optional(),
  base64Data: z.string().optional(),
}).passthrough();

export const aiUploadSchema = z.object({
  fileName: z.string().trim().min(1, 'fileName is required').max(255),
  fileSize: z.coerce.number().int().min(1, 'fileSize must be at least 1 byte').max(26214400, 'fileSize cannot exceed 25MB'),
  mimeType: z.string().trim().max(100).optional(),
  fileType: z.string().trim().max(100).optional(),
});

export const aiChatSchema = z.object({
  prompt: z.string().trim().max(10000).optional(),
  message: z.string().trim().max(10000).optional(),
  context: z.string().trim().max(10000).optional(),
  fileUrl: z.string().url('Must be a valid URL').max(2048).optional(),
  url: z.string().url('Must be a valid URL').max(2048).optional(),
  fileName: z.string().trim().max(255).optional(),
  fileType: z.string().trim().max(100).optional(),
  fileSize: z.coerce.number().int().min(0).max(26214400).optional(),
  mimeType: z.string().trim().max(100).optional(),
  base64Data: z.string().optional(),
  attachments: z.array(aiFileAttachmentSchema).max(5).optional(),
  files: z.array(aiFileAttachmentSchema).max(5).optional(),
}).passthrough().refine((data) => {
  const hasText = Boolean((data.prompt && data.prompt.trim()) || (data.message && data.message.trim()));
  const hasFile = Boolean(
    data.fileUrl ||
    data.url ||
    data.base64Data ||
    (data.attachments && data.attachments.length > 0) ||
    (data.files && data.files.length > 0)
  );
  return hasText || hasFile;
}, {
  message: 'Prompt, message, or at least one file attachment must be provided',
  path: ['prompt']
});

export const aiSummarySchema = z.object({
  conversationId: z.string().uuid().optional(),
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
}).refine(
  (data) => {
    const count = [data.organizationId, data.teamId, data.communityId].filter(Boolean).length;
    return count === 1;
  },
  {
    message: 'Exactly one project target identifier (organizationId, teamId, or communityId) must be provided',
    path: ['organizationId']
  }
);

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
}).refine(
  (data) => {
    const count = [data.organizationId, data.teamId, data.communityId].filter(Boolean).length;
    return count === 1;
  },
  {
    message: 'Exactly one project target identifier (organizationId, teamId, or communityId) must be provided',
    path: ['organizationId']
  }
);

export const aiHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1, 'Limit must be at least 1').max(50, 'Limit cannot exceed 50').optional().default(20),
  cursor: z.string().uuid('Cursor must be a valid UUID').optional(),
  actionType: z.string().trim().max(50).optional(),
  conversationId: z.string().uuid('Conversation ID must be a valid UUID').optional(),
});
