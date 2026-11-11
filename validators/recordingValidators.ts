import { z } from 'zod';

export const startRecordingSchema = z.object({
  meetingCode: z.string().trim().min(1, 'Meeting code is required'),
});

export const stopRecordingSchema = z.object({
  meetingCode: z.string().trim().min(1, 'Meeting code is required'),
});

export const getRecordingsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const recordingIdParamSchema = z.object({
  id: z.string().uuid('Invalid recording ID'),
});

export const meetingCodeParamSchema = z.object({
  code: z.string().trim().min(1, 'Meeting code is required'),
});

export const completeRecordingSchema = z.object({
  fileUrl: z.string().url('Valid file URL is required'),
  thumbnailUrl: z.string().url().optional(),
  transcriptUrl: z.string().url().optional(),
  summary: z.string().optional(),
  durationSeconds: z.number().int().nonnegative().optional(),
  fileSizeBytes: z.number().int().nonnegative().optional(),
});

export type StartRecordingInput = z.infer<typeof startRecordingSchema>;
export type StopRecordingInput = z.infer<typeof stopRecordingSchema>;
export type GetRecordingsQueryInput = z.infer<typeof getRecordingsQuerySchema>;
export type CompleteRecordingInput = z.infer<typeof completeRecordingSchema>;

export const summarizeRecordingSchema = z.object({
  transcriptText: z.string().trim().min(5).max(100000).optional(),
  regenerate: z.boolean().optional(),
});

export type SummarizeRecordingInput = z.infer<typeof summarizeRecordingSchema>;

