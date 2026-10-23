import { z } from 'zod';

export const createCalendarEventSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'Title is required').max(120),
    description: z.string().max(1000).optional(),
    eventType: z.enum(['REMINDER', 'MEETING', 'DEADLINE', 'GENERAL']).default('REMINDER'),
    startDate: z.string().datetime(),
    endDate: z.string().datetime().optional(),
    isAllDay: z.boolean().optional().default(false),
    meetingLink: z.string().max(500).optional(),
    attendeeEmails: z.array(z.string().email()).optional().default([]),
    hasReminder: z.boolean().optional().default(false),
    reminderMinutes: z.number().int().min(0).max(10080).optional().default(15),
  }),
});

export const updateCalendarEventSchema = z.object({
  body: z.object({
    title: z.string().min(1).max(120).optional(),
    description: z.string().max(1000).optional(),
    eventType: z.enum(['REMINDER', 'MEETING', 'DEADLINE', 'GENERAL']).optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().nullable().optional(),
    isAllDay: z.boolean().optional(),
    meetingLink: z.string().max(500).optional(),
    attendeeEmails: z.array(z.string().email()).optional(),
    hasReminder: z.boolean().optional(),
    reminderMinutes: z.number().int().min(0).max(10080).optional(),
  }),
});

export const monthQuerySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2035),
  month: z.coerce.number().int().min(1).max(12),
});

export const dateQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in format YYYY-MM-DD'),
});
