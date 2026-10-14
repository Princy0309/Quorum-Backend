import { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { saveUserOnboarding, searchUsers } from '../services/userService.js';
import { sendSuccess } from '../utils/apiResponse.js';

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

  return res.status(200).json({
    success: true,
    statusCode: 200,
    message: 'Users retrieved successfully',
    data: {
      users: result.users,
      pagination: result.pagination
    },
    users: result.users,
    pagination: result.pagination
  });
});