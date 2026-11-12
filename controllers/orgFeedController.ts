import { Request, Response } from 'express';
import path from 'path';
import { z } from 'zod';
import { OrgPostCategory, OrgRole } from '@prisma/client';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/ApiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { uploadBufferToS3 } from '../services/uploadService.js';
import {
  createOrgFeedPost,
  getOrgFeed,
  getOrgFeedPostById,
  updateOrgFeedPost,
  deleteOrgFeedPost,
  togglePinOrgPost,
  toggleOrgPostReaction,
  createOrgComment,
  getOrgComments,
  updateOrgComment,
  deleteOrgComment,
} from '../services/orgFeedService.js';
import {
  orgIdParamSchema,
  orgPostParamSchema,
  orgCommentParamSchema,
  getOrgFeedQuerySchema,
  getOrgCommentsQuerySchema,
} from '../validators/orgFeedValidators.js';

const SAFE_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic']);
const SAFE_DOCUMENT_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv',
]);

const getAuthUserId = (req: Request): string => {
  if (!req.user?.id) {
    throw new ApiError(401, 'Unauthorized, login required');
  }
  return req.user.id;
};

const parseSchema = <T extends z.ZodTypeAny>(schema: T, payload: unknown): z.infer<T> => {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new ApiError(400, result.error.issues[0]?.message || 'Validation error');
  }
  return result.data;
};

const ensureCanUseCategory = (category: unknown, role?: OrgRole) => {
  const isPrivileged =
    category === OrgPostCategory.ANNOUNCEMENT || category === OrgPostCategory.FESTIVAL;

  if (isPrivileged && role !== OrgRole.ORG_ADMIN && role !== OrgRole.TEAM_HEAD) {
    throw new ApiError(
      403,
      `Only Organization Admins or Team Heads can create ${String(category).toLowerCase()} posts`
    );
  }
};

const uploadFeedAttachmentIfPresent = async (req: Request) => {
  const file =
    req.files && Array.isArray(req.files) && req.files.length > 0
      ? req.files[0]
      : (req as any).file || undefined;

  if (!file) return null;

  const originalName = file.originalname || 'attachment';
  const ext = path.extname(originalName).toLowerCase();
  const isImage = SAFE_IMAGE_EXTENSIONS.has(ext);
  const isDocument = SAFE_DOCUMENT_EXTENSIONS.has(ext);

  if (!isImage && !isDocument) {
    throw new ApiError(
      400,
      'Unsupported file type. Allowed: images (JPG, PNG, GIF, WEBP, HEIC) and documents (PDF, DOC, XLS, PPT, TXT, CSV)'
    );
  }

  if (isImage && file.mimetype && !file.mimetype.startsWith('image/')) {
    throw new ApiError(400, 'Uploaded image file has an invalid MIME type');
  }

  if (isDocument && file.mimetype && file.mimetype.includes('html')) {
    throw new ApiError(400, 'HTML content is not permitted in feed attachments');
  }

  const uploaded = await uploadBufferToS3(
    file.buffer,
    originalName,
    'org-feed',
    file.mimetype
  );

  return {
    fileUrl: uploaded.publicUrl,
    fileType: (isImage ? 'image' : 'document') as 'image' | 'document',
    fileName: uploaded.cleanName,
    fileSize: uploaded.fileSize,
  };
};

export const createOrgPostController = asyncHandler(async (req: Request, res: Response) => {
  const userId = getAuthUserId(req);
  const { id: orgId } = parseSchema(orgIdParamSchema, req.params);

  ensureCanUseCategory(req.body?.category, req.orgMembership?.role);

  const hasFileInReq =
    (req.files && Array.isArray(req.files) && req.files.length > 0) || Boolean((req as any).file);

  if (!req.body?.content?.trim() && !req.body?.fileUrl && !hasFileInReq) {
    throw new ApiError(400, 'Post must contain either text content or a media attachment');
  }

  const uploadedMedia = await uploadFeedAttachmentIfPresent(req);
  const post = await createOrgFeedPost(orgId, userId, {
    ...req.body,
    ...(uploadedMedia || {}),
  });

  return sendSuccess(res, 201, 'Organization feed post created successfully', post);
});

export const getOrgFeedController = asyncHandler(async (req: Request, res: Response) => {
  const userId = getAuthUserId(req);
  const { id: orgId } = parseSchema(orgIdParamSchema, req.params);
  const rawQuery = parseSchema(getOrgFeedQuerySchema, req.query);

  const feed = await getOrgFeed(orgId, userId, {
    category: rawQuery.category,
    teamId: rawQuery.teamId ?? undefined,
    search: rawQuery.search ?? undefined,
    pinnedOnly: rawQuery.pinnedOnly,
    cursor: rawQuery.cursor ?? undefined,
    limit: rawQuery.limit,
  });

  return sendSuccess(res, 200, 'Organization feed retrieved successfully', feed);
});

export const getOrgPostByIdController = asyncHandler(async (req: Request, res: Response) => {
  const userId = getAuthUserId(req);
  const { id: orgId, postId } = parseSchema(orgPostParamSchema, req.params);

  const post = await getOrgFeedPostById(orgId, userId, postId);
  return sendSuccess(res, 200, 'Organization feed post retrieved successfully', post);
});

export const updateOrgPostController = asyncHandler(async (req: Request, res: Response) => {
  const userId = getAuthUserId(req);
  const { id: orgId, postId } = parseSchema(orgPostParamSchema, req.params);

  ensureCanUseCategory(req.body?.category, req.orgMembership?.role);

  const uploadedMedia = await uploadFeedAttachmentIfPresent(req);
  const updated = await updateOrgFeedPost(orgId, userId, postId, {
    ...req.body,
    ...(uploadedMedia || {}),
  });

  return sendSuccess(res, 200, 'Organization feed post updated successfully', updated);
});

export const deleteOrgPostController = asyncHandler(async (req: Request, res: Response) => {
  const userId = getAuthUserId(req);
  const { id: orgId, postId } = parseSchema(orgPostParamSchema, req.params);

  const result = await deleteOrgFeedPost(orgId, userId, postId);
  return sendSuccess(res, 200, 'Organization feed post deleted successfully', result);
});

export const togglePinOrgPostController = asyncHandler(async (req: Request, res: Response) => {
  const userId = getAuthUserId(req);
  const { id: orgId, postId } = parseSchema(orgPostParamSchema, req.params);

  const updated = await togglePinOrgPost(orgId, userId, postId);
  const msg = updated.isPinned ? 'Post pinned to organization feed' : 'Post unpinned from organization feed';
  return sendSuccess(res, 200, msg, updated);
});

export const toggleOrgPostReactionController = asyncHandler(async (req: Request, res: Response) => {
  const userId = getAuthUserId(req);
  const { id: orgId, postId } = parseSchema(orgPostParamSchema, req.params);

  const result = await toggleOrgPostReaction(orgId, userId, postId, req.body.emoji);
  return sendSuccess(res, 200, `Reaction ${result.action} successfully`, result);
});

export const createOrgCommentController = asyncHandler(async (req: Request, res: Response) => {
  const userId = getAuthUserId(req);
  const { id: orgId, postId } = parseSchema(orgPostParamSchema, req.params);
  const { content, parentId } = req.body;

  const result = await createOrgComment(orgId, userId, postId, { content, parentId });
  return sendSuccess(res, 201, 'Comment added successfully', result.comment);
});

export const getOrgCommentsController = asyncHandler(async (req: Request, res: Response) => {
  const userId = getAuthUserId(req);
  const { id: orgId, postId } = parseSchema(orgPostParamSchema, req.params);
  const { cursor, limit } = parseSchema(getOrgCommentsQuerySchema, req.query);

  const result = await getOrgComments(orgId, userId, postId, cursor, limit);
  return sendSuccess(res, 200, 'Comments retrieved successfully', result);
});

export const updateOrgCommentController = asyncHandler(async (req: Request, res: Response) => {
  const userId = getAuthUserId(req);
  const { id: orgId, postId, commentId } = parseSchema(orgCommentParamSchema, req.params);

  const updated = await updateOrgComment(orgId, userId, postId, commentId, {
    content: req.body.content,
  });
  return sendSuccess(res, 200, 'Comment updated successfully', updated);
});

export const deleteOrgCommentController = asyncHandler(async (req: Request, res: Response) => {
  const userId = getAuthUserId(req);
  const { id: orgId, postId, commentId } = parseSchema(orgCommentParamSchema, req.params);

  const result = await deleteOrgComment(orgId, userId, postId, commentId);
  return sendSuccess(res, 200, 'Comment deleted successfully', result);
});