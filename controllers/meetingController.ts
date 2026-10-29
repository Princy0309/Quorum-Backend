import { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import {
  createMeeting,
  createScopedMeeting,
  getMeeting,
  endMeeting,
  getOrganizationMeetings,
  cancelMeeting,
  getTeamMeetings,
  getUserUpcomingMeetings,
} from '../services/meetingService.js';
import {
  createScopedMeetingSchema,
  meetingCodeParamSchema,
  uuidParamSchema,
} from '../validators/meetingValidators.js';


export const createMeetingController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return next(new ApiError(401, 'Unauthorized, login required'));
    }

    const organizationId = req.body?.organizationId as string | undefined;
    const meeting = await createMeeting(req.user.id, organizationId);

    return res.status(201).json({
      success: true,
      data: meeting,
    });
  }
);

export const createScopedMeetingController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return next(new ApiError(401, 'Unauthorized, login required'));
    }

    const parsed = createScopedMeetingSchema.safeParse(req.body);
    if (!parsed.success) {
      const errorMessage = parsed.error.issues.map((e) => e.message).join(', ');
      return next(new ApiError(400, errorMessage));
    }

    const meeting = await createScopedMeeting(req.user.id, parsed.data);

    return res.status(201).json({
      success: true,
      data: meeting,
    });
  }
);

export const getMeetingController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const parsedCode = meetingCodeParamSchema.safeParse(req.params.code);
    if (!parsedCode.success) {
      return next(new ApiError(400, parsedCode.error.issues[0]?.message || 'Invalid meeting code'));
    }

    const meeting = await getMeeting(parsedCode.data, req.user?.id);


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

export const cancelMeetingController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return next(new ApiError(401, 'Unauthorized, login required'));
    }

    const parsedCode = meetingCodeParamSchema.safeParse(req.params.code);
    if (!parsedCode.success) {
      return next(new ApiError(400, parsedCode.error.issues[0]?.message || 'Invalid meeting code'));
    }

    const result = await cancelMeeting(parsedCode.data, req.user.id);

    return res.status(200).json({
      success: true,
      message: result.message,
    });
  }
);


export const getOrganizationMeetingsController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return next(new ApiError(401, 'Unauthorized, login required'));
    }

    const parsedOrgId = uuidParamSchema.safeParse(req.params.organizationId);
    if (!parsedOrgId.success) {
      return next(new ApiError(400, 'Invalid organizationId UUID format'));
    }

    const meetings = await getOrganizationMeetings(parsedOrgId.data, req.user.id);

    return res.status(200).json({
      success: true,
      data: meetings,
    });
  }
);

export const getTeamMeetingsController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return next(new ApiError(401, 'Unauthorized, login required'));
    }

    const parsedTeamId = uuidParamSchema.safeParse(req.params.teamId);
    if (!parsedTeamId.success) {
      return next(new ApiError(400, 'Invalid teamId UUID format'));
    }

    const meetings = await getTeamMeetings(parsedTeamId.data, req.user.id);


    return res.status(200).json({
      success: true,
      data: meetings,
    });
  }
);

export const getUserUpcomingMeetingsController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return next(new ApiError(401, 'Unauthorized, login required'));
    }

    const meetings = await getUserUpcomingMeetings(req.user.id);

    return res.status(200).json({
      success: true,
      data: meetings,
    });
  }
);
