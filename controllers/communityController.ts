import { Request, Response, NextFunction } from 'express';
import {
  createCommunity,
  getUserCommunities,
  getCommunityDetails,
  updateCommunity,
  deleteCommunity
} from '../services/communityService.js';
import { ApiError } from '../utils/ApiError.js';

export const createCommunityController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const result = await createCommunity(userId, req.body);
    res.status(201).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const getUserCommunitiesController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const result = await getUserCommunities(userId);
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const getCommunityDetailsController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const { id } = req.params;
    if (!id || typeof id !== 'string') {
      throw new ApiError(400, 'Invalid community ID');
    }

    const result = await getCommunityDetails(userId, id);
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const updateCommunityController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const { id } = req.params;
    if (!id || typeof id !== 'string') {
      throw new ApiError(400, 'Invalid community ID');
    }

    const result = await updateCommunity(userId, id, req.body);
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

export const deleteCommunityController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const { id } = req.params;
    if (!id || typeof id !== 'string') {
      throw new ApiError(400, 'Invalid community ID');
    }

    const result = await deleteCommunity(userId, id);
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};
