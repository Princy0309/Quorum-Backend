import { z } from 'zod';

const whiteboardElementSchema = z.record(z.string(), z.any());
const whiteboardViewStateSchema = z
  .object({
    zoom: z.number().finite().optional(),
    scrollX: z.number().finite().optional(),
    scrollY: z.number().finite().optional(),
    backgroundColor: z.string().max(50).optional(),
  })
  .passthrough();

export const whiteboardContentSchema = z.union([
  z
    .object({
      elements: z.array(whiteboardElementSchema).max(5000, 'Board cannot exceed 5000 elements').optional(),
      viewState: whiteboardViewStateSchema.optional(),
      _version: z.number().int().nonnegative().optional(),
    })
    .passthrough(),
  z.array(whiteboardElementSchema).max(5000, 'Board cannot exceed 5000 elements'),
]);

export const createWhiteboardSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Board name is required')
    .max(100, 'Board name cannot exceed 100 characters'),
  organizationId: z.preprocess(
    (val) => (typeof val === 'string' && (val.trim() === '' || val === 'null' || val === 'undefined') ? undefined : val),
    z.string().trim().uuid('Valid organizationId is required').optional()
  ),
  content: whiteboardContentSchema.optional(),
  meetingId: z.preprocess(
    (val) => (typeof val === 'string' && (val.trim() === '' || val === 'null' || val === 'undefined') ? undefined : val),
    z.string().trim().uuid('Invalid meeting ID').optional().nullable()
  ),
});

export const getWhiteboardsQuerySchema = z.object({
  organizationId: z.preprocess(
    (val) => (typeof val === 'string' && (val.trim() === '' || val === 'null' || val === 'undefined') ? undefined : val),
    z.string().trim().uuid('Valid organizationId is required').optional()
  ),
  search: z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    z.string().trim().max(100).optional()
  ),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const updateWhiteboardSchema = z
  .object({
    name: z.string().trim().min(1, 'Board name cannot be empty').max(100).optional(),
    content: whiteboardContentSchema.optional(),
  })
  .refine(
    (data) => data.name !== undefined || data.content !== undefined,
    { message: 'At least one field (name or content) must be provided for update' }
  );

export const createMeetingWhiteboardSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Board name is required')
    .max(100, 'Board name cannot exceed 100 characters'),
  organizationId: z.preprocess(
    (val) => (typeof val === 'string' && (val.trim() === '' || val === 'null' || val === 'undefined') ? undefined : val),
    z.string().trim().uuid('Valid organizationId is required').optional()
  ),
  content: whiteboardContentSchema.optional(),
});

export type CreateWhiteboardInput = z.infer<typeof createWhiteboardSchema>;
export type GetWhiteboardsQuery = z.infer<typeof getWhiteboardsQuerySchema>;
export type UpdateWhiteboardInput = z.infer<typeof updateWhiteboardSchema>;
export type CreateMeetingWhiteboardInput = z.infer<typeof createMeetingWhiteboardSchema>;

const singleSocketElementSchema = z
  .object({
    id: z.string().trim().min(1, 'Element id is required').max(128, 'Element id is too long'),
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    width: z.number().finite().optional(),
    height: z.number().finite().optional(),
  })
  .passthrough()
  .refine(
    (el) => {
      try {
        return JSON.stringify(el).length <= 65536;
      } catch {
        return false;
      }
    },
    { message: 'Serialized element size cannot exceed 64KB' }
  );

export const socketDrawElementSchema = z.object({
  boardId: z.string().trim().min(1, 'boardId is required').max(128),
  element: singleSocketElementSchema,
});

export const socketElementsChangeSchema = z.object({
  boardId: z.string().trim().min(1, 'boardId is required').max(128),
  updates: z
    .array(singleSocketElementSchema)
    .max(500, 'Batch updates cannot exceed 500 elements')
    .optional(),
  deletes: z
    .array(z.string().trim().min(1).max(128))
    .max(500, 'Batch deletes cannot exceed 500 elements')
    .optional(),
});

export const socketViewStatePayloadSchema = z.object({
  boardId: z.string().trim().min(1, 'boardId is required').max(128),
  viewState: whiteboardViewStateSchema,
});

export const socketCursorMoveSchema = z.object({
  boardId: z.string().trim().min(1, 'boardId is required').max(128),
  x: z.number().finite('Cursor x coordinate must be a finite number'),
  y: z.number().finite('Cursor y coordinate must be a finite number'),
});

export type SocketDrawElementInput = z.infer<typeof socketDrawElementSchema>;
export type SocketElementsChangeInput = z.infer<typeof socketElementsChangeSchema>;
export type SocketViewStatePayloadInput = z.infer<typeof socketViewStatePayloadSchema>;
export type SocketCursorMoveInput = z.infer<typeof socketCursorMoveSchema>;

