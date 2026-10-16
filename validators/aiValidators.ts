import { z } from 'zod';

export const aiChatSchema = z.object({
  prompt: z.string().trim().min(1, 'Prompt cannot be empty').max(5000),
  context: z.string().trim().max(10000).optional(),
});
