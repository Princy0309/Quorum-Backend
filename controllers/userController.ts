import { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { saveUserOnboarding } from '../services/userService.js';
import { sendSuccess } from '../utils/apiResponse.js';

export const updateOnboarding = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    if(!req.user?.id){
        return next(new ApiError(401, 'Unauthorized'));
    }

    const { useCases } = req.body;

    const user = await saveUserOnboarding( req.user.id, useCases || []);

    return sendSuccess(res, 200, 'Onboarding preferences saved and successful', {user});
});