import { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import {
  createMeeting,
  getMeeting,
  endMeeting,
} from '../services/meetingService.js';

export const createMeetingController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return next(new ApiError(401, 'Unauthorized, login required'));
    }

    const meeting = await createMeeting(req.user.id);

    return res.status(201).json({
      success: true,
      data: meeting,
    });
  }
);

export const getMeetingController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const code = req.params.code as string;

    if (!code) {
      return next(new ApiError(400, 'Meeting code is required'));
    }

    const meeting = await getMeeting(code);

    return res.status(200).json({
      success: true,
      data: meeting,
    });
  }
);

export const endMeetingController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return next(new ApiError(401, 'Unauthorized, login required'));
    }

    const code = req.params.code as string;

    if (!code) {
      return next(new ApiError(400, 'Meeting code is required'));
    }

    const result = await endMeeting(code, req.user.id);

    return res.status(200).json({
      success: true,
      message: result.message,
    });
  }
);
