import { z } from 'zod';

export const savedItemTypeEnum = z.enum([
  'MESSAGE',
  'FILE',
  'CHAT',
  'DOCUMENT',
  'RESOURCE'
]);

export const saveItemSchema = z.object({
  itemType: savedItemTypeEnum,
  itemId: z.string().trim().min(1, 'itemId cannot be empty'),
  note: z.string().trim().max(2000).optional().nullable(),
  collectionId: z.string().trim().uuid().optional().nullable()
});

export const updateSavedItemSchema = z.object({
  note: z.string().trim().max(2000).optional().nullable(),
  collectionId: z.string().trim().uuid().optional().nullable()
}).refine(
  (data) => data.note !== undefined || data.collectionId !== undefined,
  { message: 'At least one field (note or collectionId) must be provided' }
);

export const getSavedItemsQuerySchema = z.object({
  itemType: savedItemTypeEnum.optional(),
  collectionId: z.string().trim().uuid().optional(),
  search: z.string().trim().max(100).optional(),
  cursor: z.string().trim().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20)
});

export const createSavedCollectionSchema = z.object({
  name: z.string().trim().min(1, 'Collection name cannot be empty').max(100),
  description: z.string().trim().max(500).optional().nullable(),
  color: z.string().trim().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Invalid hex color').optional().nullable()
});

export const updateSavedCollectionSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  color: z.string().trim().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Invalid hex color').optional().nullable()
}).refine(
  (data) => data.name !== undefined || data.description !== undefined || data.color !== undefined,
  { message: 'At least one field must be provided to update collection' }
);

export const savedItemIdParamSchema = z.object({
  id: z.string().trim().uuid('Invalid saved item ID')
});

export const savedCollectionIdParamSchema = z.object({
  id: z.string().trim().uuid('Invalid collection ID')
});
