import { z } from 'zod';

export const createProjectSchema = z.object({
  name: z.string().trim().min(2, 'Project name must be at least 2 characters').max(100, 'Project name cannot exceed 100 characters'),
  description: z.string().trim().max(1000, 'Description cannot exceed 1000 characters').optional(),
  budget: z.number().positive('Budget must be a positive number').optional(),
  dueDate: z.string().datetime({ message: 'Invalid dueDate format. Must be an ISO datetime string' }).optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(1000).optional(),
  status: z.enum(['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED']).optional(),
  budget: z.number().positive().optional(),
  dueDate: z.string().datetime().optional().nullable(),
});

export const inviteProjectMemberSchema = z.object({
  email: z.string().trim().email('Invalid email address'),
  role: z.enum(['PROJECT_MANAGER', 'INTERNAL_MEMBER', 'FREELANCER', 'CLIENT']).default('FREELANCER'),
  hourlyRate: z.number().positive('Hourly rate must be a positive number').optional(),
  companyName: z.string().trim().max(100).optional(),
});

export const updateProjectMemberRoleSchema = z.object({
  role: z.enum(['PROJECT_MANAGER', 'INTERNAL_MEMBER', 'FREELANCER', 'CLIENT']),
  hourlyRate: z.number().positive().optional().nullable(),
  companyName: z.string().trim().max(100).optional().nullable(),
});

export const createProjectTaskSchema = z.object({
  title: z.string().trim().min(1, 'Task title is required').max(200, 'Title cannot exceed 200 characters'),
  description: z.string().trim().max(2000, 'Description cannot exceed 2000 characters').optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  dueDate: z.string().datetime({ message: 'Invalid dueDate format' }).optional().nullable(),
  assigneeId: z.string().uuid('Invalid assignee ID format').optional().nullable(),
});

export const updateProjectTaskSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'COMPLETED', 'CANCELLED']).optional(),
  dueDate: z.string().datetime().optional().nullable(),
  assigneeId: z.string().uuid().optional().nullable(),
});

export const updateTaskStatusSchema = z.object({
  status: z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'COMPLETED', 'CANCELLED']),
});

export const submitTaskDeliverableSchema = z.object({
  deliverableUrl: z.string().trim().min(1, 'Deliverable URL or file link is required'),
  deliverableNote: z.string().trim().max(1000).optional(),
});

export const approveTaskDeliverableSchema = z.object({
  approved: z.boolean(),
  feedback: z.string().trim().max(1000).optional(),
});

