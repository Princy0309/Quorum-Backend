import { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import {
  saveUserOnboarding,
  searchUsers,
  getUserProfile,
  updateUserProfile
} from '../services/userService.js';
import { getUserPresence, getMultipleUserPresences } from '../services/presenceService.js';
import { sendSuccess } from '../utils/ApiResponse.js';

export const getUserProfileController = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  if (!req.user?.id) {
    return next(new ApiError(401, 'Unauthorized'));
  }

  const user = await getUserProfile(req.user.id);
  const isMobile = req.headers['x-client-platform'] === 'mobile';

  return res.status(200).json({
    success: true,
    statusCode: 200,
    message: 'Profile fetched successfully',
    data: isMobile ? user : { user },
    user,
  });
});

export const updateUserProfileController = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  if (!req.user?.id) {
    return next(new ApiError(401, 'Unauthorized'));
  }

  const uploadedFile = (req.files && Array.isArray(req.files) && req.files.length > 0)
    ? req.files[0]
    : ((req as any).file || undefined);

  const updatedUser = await updateUserProfile(req.user.id, req.body, uploadedFile);
  const isMobile = req.headers['x-client-platform'] === 'mobile';

  return res.status(200).json({
    success: true,
    statusCode: 200,
    message: 'Profile updated successfully',
    data: isMobile ? updatedUser : { user: updatedUser },
    user: updatedUser,
  });
});

export const updateOnboarding = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    if(!req.user?.id){
        return next(new ApiError(401, 'Unauthorized'));
    }

    const { useCases } = req.body;

    const user = await saveUserOnboarding( req.user.id, useCases || []);

    return sendSuccess(res, 200, 'Onboarding preferences saved and successful', {user});
});

export const searchUsersController = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  if (!req.user?.id) {
    return next(new ApiError(401, 'Unauthorized'));
  }

  const rawQuery = req.query.q ?? req.query.query ?? req.query.search ?? '';
  const query = typeof rawQuery === 'string' ? rawQuery : '';
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;

  const result = await searchUsers(req.user.id, query, page, limit);
  const isMobile = req.headers['x-client-platform'] === 'mobile';

  return res.status(200).json({
    success: true,
    statusCode: 200,
    message: 'Users retrieved successfully',
    data: isMobile ? result.users : {
      users: result.users,
      pagination: result.pagination
    },
    users: result.users,
    pagination: result.pagination
  });
});

export const getUserPresenceController = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  if (!req.user?.id) {
    return next(new ApiError(401, 'Unauthorized'));
  }

  const rawUserId = req.params.userId || req.params.id;
  const rawParam = Array.isArray(rawUserId) ? rawUserId[0] : rawUserId;
  const targetUserId = (!rawParam || (typeof rawParam === 'string' && rawParam.trim().toLowerCase() === 'me'))
    ? req.user.id
    : (typeof rawParam === 'string' ? rawParam.trim() : req.user.id);

  const presence = await getUserPresence(targetUserId);

  return res.status(200).json({
    success: true,
    statusCode: 200,
    message: 'User presence retrieved successfully',
    data: {
      userId: targetUserId,
      isOnline: presence.isOnline,
      lastSeen: presence.lastSeen || null
    }
  });
});

export const getBatchUserPresenceController = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  if (!req.user?.id) {
    return next(new ApiError(401, 'Unauthorized'));
  }

  let userIds: string[] = [];
  if (Array.isArray(req.body?.userIds)) {
    userIds = req.body.userIds.filter((id: any) => typeof id === 'string' && id.trim().length > 0);
  } else if (typeof req.query.userIds === 'string') {
    userIds = req.query.userIds.split(',').map((id) => id.trim()).filter(Boolean);
  }

  if (userIds.length === 0) {
    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Presences retrieved successfully',
      data: {
        presences: {}
      }
    });
  }

  const boundedUserIds = userIds.slice(0, 100);
  const presenceMap = await getMultipleUserPresences(boundedUserIds);
  const presencesObj: Record<string, { isOnline: boolean; lastSeen: Date | null }> = {};

  presenceMap.forEach((val, uId) => {
    presencesObj[uId] = {
      isOnline: val.isOnline,
      lastSeen: val.lastSeen || null
    };
  });

  return res.status(200).json({
    success: true,
    statusCode: 200,
    message: 'Presences retrieved successfully',
    data: {
      presences: presencesObj
    }
  });
});