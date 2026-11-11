import { z } from 'zod';

export const createDocumentSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(255, 'Title cannot exceed 255 characters'),
  content: z.any().optional(),
  scopeType: z.enum(['PERSONAL', 'ORGANIZATION', 'TEAM', 'PROJECT']).optional(),
  defaultPermission: z.enum(['VIEW', 'COMMENT', 'EDIT']).default('EDIT').optional(),
  initialCollaborators: z.array(z.object({
    userId: z.string().uuid('Invalid user ID'),
    permission: z.enum(['VIEW', 'COMMENT', 'EDIT']).default('EDIT')
  })).optional(),
  organizationId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  meetingId: z.string().uuid().optional(),
  whiteboardId: z.string().uuid().optional(),
});

export const updateDocumentSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  content: z.any().optional(),
  defaultPermission: z.enum(['VIEW', 'COMMENT', 'EDIT']).optional(),
  isArchived: z.boolean().optional(),
});

export const addCollaboratorSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
  permission: z.enum(['VIEW', 'COMMENT', 'EDIT']).default('EDIT'),
});

export const updateCollaboratorSchema = z.object({
  permission: z.enum(['VIEW', 'COMMENT', 'EDIT']),
});

export const openDocumentInMeetingSchema = z.object({
  meetingCode: z.string().trim().min(1, 'Meeting code is required'),
});

export const embedWhiteboardInDocSchema = z.object({
  whiteboardId: z.string().uuid('Invalid whiteboard ID'),
});

export const documentAiPromptSchema = z.object({
  action: z.enum(['summarize', 'action_items', 'rewrite', 'expand', 'fix_grammar', 'custom']),
  prompt: z.string().max(2000).optional(),
  selectedText: z.string().max(10000).optional(),
});

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;
export type AddCollaboratorInput = z.infer<typeof addCollaboratorSchema>;
export type UpdateCollaboratorInput = z.infer<typeof updateCollaboratorSchema>;
export type OpenDocumentInMeetingInput = z.infer<typeof openDocumentInMeetingSchema>;
export type EmbedWhiteboardInDocInput = z.infer<typeof embedWhiteboardInDocSchema>;
export type DocumentAiPromptInput = z.infer<typeof documentAiPromptSchema>;
