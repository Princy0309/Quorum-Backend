import { z } from 'zod';

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, 'Organization name must be between 2 and 100 characters').max(100, 'Organization name must be between 2 and 100 characters'),
  description: z.string().trim().max(300, 'Organization description cannot exceed 300 characters').optional().nullable(),
  logo: z.string().trim().optional().nullable(),
  email: z.string().trim().email('Invalid email address').optional().nullable().or(z.literal('')),
  industry: z.string().trim().max(100).optional().nullable(),
  teamSize: z.string().trim().max(50).optional().nullable(),
}).passthrough();

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(2, 'Organization name must be between 2 and 100 characters').max(100, 'Organization name must be between 2 and 100 characters').optional(),
  description: z.string().trim().max(300, 'Organization description cannot exceed 300 characters').optional().nullable(),
  logo: z.string().trim().optional().nullable(),
  email: z.string().trim().email('Invalid email address').optional().nullable().or(z.literal('')),
  industry: z.string().trim().max(100).optional().nullable(),
  teamSize: z.string().trim().max(50).optional().nullable(),
}).passthrough().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided to update' }
);

export const createTeamSchema = z.object({
  name: z.string().trim().min(2, 'Team name must be between 2 and 50 characters').max(50, 'Team name must be between 2 and 50 characters'),
  description: z.string().trim().max(300, 'Team description cannot exceed 300 characters').optional().nullable(),
}).passthrough();

export const updateTeamSchema = z.object({
  name: z.string().trim().min(2, 'Team name must be between 2 and 50 characters').max(50, 'Team name must be between 2 and 50 characters').optional(),
  description: z.string().trim().max(300, 'Team description cannot exceed 300 characters').optional().nullable(),
}).passthrough().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided to update' }
);
