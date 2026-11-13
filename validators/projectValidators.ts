import { z } from 'zod';

export const createProjectSchema = z.object({
  name: z.string().trim().min(2, 'Project name must be at least 2 characters').max(100, 'Project name cannot exceed 100 characters'),
  description: z.string().trim().max(1000, 'Description cannot exceed 1000 characters').optional().nullable(),
  budget: z.preprocess((val) => (val === '' || val === null ? undefined : typeof val === 'string' ? parseFloat(val) : val), z.number().nonnegative('Budget must be a non-negative number').optional().nullable()),
  dueDate: z.string().optional().nullable().refine((val) => !val || !isNaN(Date.parse(val)), { message: 'Invalid dueDate format' }),
  organizationId: z.string().uuid('Invalid organization ID format').optional().nullable(),
});

export const updateProjectSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  status: z.enum(['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED']).optional(),
  budget: z.preprocess((val) => (val === '' || val === null ? undefined : typeof val === 'string' ? parseFloat(val) : val), z.number().nonnegative().optional().nullable()),
  dueDate: z.string().optional().nullable().refine((val) => !val || !isNaN(Date.parse(val)), { message: 'Invalid dueDate format' }),
});

export const inviteProjectMemberSchema = z.object({
  email: z.string().trim().email('Invalid email address'),
  role: z.enum(['PROJECT_MANAGER', 'INTERNAL_MEMBER', 'FREELANCER', 'CLIENT']).default('FREELANCER'),
  hourlyRate: z.preprocess((val) => (val === '' || val === null ? undefined : typeof val === 'string' ? parseFloat(val) : val), z.number().nonnegative('Hourly rate must be a non-negative number').optional().nullable()),
  companyId: z.preprocess((val) => (val === '' ? null : val), z.string().uuid('Invalid company ID format').optional().nullable()),
  companyName: z.preprocess((val) => (val === '' ? null : val), z.string().trim().max(100).optional().nullable()),
});

export const updateProjectMemberRoleSchema = z
  .object({
    role: z.enum(['PROJECT_MANAGER', 'INTERNAL_MEMBER', 'FREELANCER', 'CLIENT']).optional(),
    hourlyRate: z.preprocess((val) => (val === '' || val === null ? undefined : typeof val === 'string' ? parseFloat(val) : val), z.number().nonnegative('Hourly rate must be a non-negative number').optional().nullable()),
    companyId: z.preprocess((val) => (val === '' ? null : val), z.string().uuid('Invalid company ID format').optional().nullable()),
    companyName: z.preprocess((val) => (val === '' ? null : val), z.string().trim().max(100).optional().nullable()),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
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

export const getProjectTasksQuerySchema = z.object({
  status: z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'COMPLETED', 'CANCELLED']).optional(),
  assigneeId: z.string().uuid('Invalid assignee ID format').optional(),
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

export const createProjectResourceSchema = z.object({
  title: z.string().trim().min(1, 'Resource title is required').max(200, 'Title cannot exceed 200 characters'),
  fileUrl: z.string().trim().url('Invalid file URL').max(2048),
  fileName: z.string().trim().max(255).optional(),
  fileType: z.string().trim().max(100).optional(),
  fileSize: z.coerce.number().int().positive().optional(),
});

