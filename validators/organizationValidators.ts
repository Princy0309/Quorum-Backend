import { z } from 'zod';

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, 'Organization name must be between 2 and 100 characters').max(100, 'Organization name must be between 2 and 100 characters'),
  description: z.string().trim().max(1000, 'Organization description cannot exceed 1000 characters').optional().nullable(),
  logo: z.string().trim().optional().nullable(),
  email: z.string().trim().email('Invalid email address').optional().nullable().or(z.literal('')),
  industry: z.string().trim().max(100).optional().nullable(),
  teamSize: z.string().trim().max(50).optional().nullable(),
}).passthrough();

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(2, 'Organization name must be between 2 and 100 characters').max(100, 'Organization name must be between 2 and 100 characters').optional(),
  description: z.string().trim().max(1000, 'Organization description cannot exceed 1000 characters').optional().nullable(),
  logo: z.string().trim().optional().nullable(),
  email: z.string().trim().email('Invalid email address').optional().nullable().or(z.literal('')),
  industry: z.string().trim().max(100).optional().nullable(),
  teamSize: z.string().trim().max(50).optional().nullable(),
}).passthrough().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided to update' }
);
