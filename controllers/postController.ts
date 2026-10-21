import { Request, Response, NextFunction } from 'express';
import {
  createCommunityPost,
  getCommunityPosts,
  getCommunityFeed,
  updateCommunityPost,
  deleteCommunityPost
} from '../services/postService.js';
import { ApiError } from '../utils/ApiError.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const validateCommunityId = (id: unknown): string => {
  if (!id || typeof id !== 'string' || !UUID_REGEX.test(id.trim())) {
    throw new ApiError(400, 'Invalid community ID format');
  }
  return id.trim();
};

const validatePostId = (id: unknown): string => {
  if (!id || typeof id !== 'string' || !UUID_REGEX.test(id.trim())) {
    throw new ApiError(400, 'Invalid post ID format');
  }
  return id.trim();
};

const validateChannelId = (id: unknown): string => {
  if (!id || typeof id !== 'string' || !UUID_REGEX.test(id.trim())) {
    throw new ApiError(400, 'Invalid channel ID format');
  }
  return id.trim();
};

export const createPostController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const id = validateCommunityId(req.params.id);
    const { content, fileUrl, fileType, fileName, fileSize } = req.body;
    const rawChannelId = req.params.channelId || req.body.channelId;
    const channelId = rawChannelId ? validateChannelId(rawChannelId) : null;

    const result = await createCommunityPost(userId, id, { content, fileUrl, fileType, fileName, fileSize, channelId });
    res.status(201).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const getCommunityPostsController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const id = validateCommunityId(req.params.id);
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = typeof req.query.limit === 'string' && /^\d+$/.test(req.query.limit)
      ? parseInt(req.query.limit, 10)
      : 20;
    const rawChannelId = req.params.channelId || req.query.channelId;
    const channelId = rawChannelId ? validateChannelId(rawChannelId) : undefined;
    const search = typeof req.query.search === 'string' && req.query.search.trim()
      ? req.query.search.trim()
      : (typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : undefined);

    const result = await getCommunityPosts(userId, id, cursor, limit, channelId, search);
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const getCommunityFeedController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = typeof req.query.limit === 'string' && /^\d+$/.test(req.query.limit)
      ? parseInt(req.query.limit, 10)
      : 20;
    const scope = typeof req.query.scope === 'string' ? req.query.scope : (req.query.all === 'true' ? 'all' : undefined);

    const result = await getCommunityFeed(userId, cursor, limit, scope);
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const updatePostController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const postId = validatePostId(req.params.postId);
    const { content, fileUrl, fileType, fileName, fileSize } = req.body;

    const result = await updateCommunityPost(userId, postId, { content, fileUrl, fileType, fileName, fileSize });
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const deletePostController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const postId = validatePostId(req.params.postId);

    const result = await deleteCommunityPost(userId, postId);
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};
