import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/ApiError.js';
import {
  createWhiteboardSchema,
  getWhiteboardsQuerySchema,
  updateWhiteboardSchema,
  createMeetingWhiteboardSchema,
} from '../validators/whiteboardValidators.js';
import {
  createWhiteboard,
  getOrganizationWhiteboards,
  getWhiteboardById,
  updateWhiteboard,
  deleteWhiteboard,
  openWhiteboardInMeeting,
  getMeetingWhiteboards,
  createWhiteboardForMeeting,
} from '../services/whiteboardService.js';

export const createWhiteboardController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const validatedData = createWhiteboardSchema.parse(req.body);
    const whiteboard = await createWhiteboard(userId, validatedData);

    return res.status(201).json({
      success: true,
      message: 'Whiteboard created successfully',
      data: whiteboard,
    });
  } catch (err) {
    next(err);
  }
};

export const getWhiteboardsController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const query = getWhiteboardsQuerySchema.parse(req.query);
    const result = await getOrganizationWhiteboards(userId, query);

    return res.status(200).json({
      success: true,
      data: result.whiteboards,
      pagination: result.pagination,
    });
  } catch (err) {
    next(err);
  }
};

export const getWhiteboardByIdController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const id = req.params.id as string;
    if (!id) {
      throw new ApiError(400, 'Whiteboard ID is required');
    }

    const whiteboard = await getWhiteboardById(userId, id);

    return res.status(200).json({
      success: true,
      data: whiteboard,
    });
  } catch (err) {
    next(err);
  }
};

export const updateWhiteboardController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const id = req.params.id as string;
    if (!id) {
      throw new ApiError(400, 'Whiteboard ID is required');
    }

    const validatedData = updateWhiteboardSchema.parse(req.body);
    const updated = await updateWhiteboard(userId, id, validatedData);

    return res.status(200).json({
      success: true,
      message: 'Whiteboard updated successfully',
      data: updated,
    });
  } catch (err) {
    next(err);
  }
};

export const deleteWhiteboardController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const id = req.params.id as string;
    if (!id) {
      throw new ApiError(400, 'Whiteboard ID is required');
    }

    const result = await deleteWhiteboard(userId, id);

    return res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (err) {
    next(err);
  }
};

export const openWhiteboardInMeetingController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const whiteboardId = (req.params.id || req.params.whiteboardId) as string;
    const meetingCodeOrId = (req.params.meetingCode || req.params.code) as string;

    if (!whiteboardId || !meetingCodeOrId) {
      throw new ApiError(400, 'Whiteboard ID and meeting code/ID are required');
    }

    const result = await openWhiteboardInMeeting(userId, whiteboardId, meetingCodeOrId);

    return res.status(200).json({
      success: true,
      message: 'Whiteboard opened in meeting successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getMeetingWhiteboardsController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const meetingCodeOrId = (req.params.code || req.params.meetingCode) as string;
    if (!meetingCodeOrId) {
      throw new ApiError(400, 'Meeting code is required');
    }

    const result = await getMeetingWhiteboards(userId, meetingCodeOrId);

    return res.status(200).json({
      success: true,
      data: result.whiteboards,
      meeting: result.meeting,
    });
  } catch (err) {
    next(err);
  }
};

export const createMeetingWhiteboardController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const meetingCodeOrId = (req.params.code || req.params.meetingCode) as string;
    if (!meetingCodeOrId) {
      throw new ApiError(400, 'Meeting code is required');
    }

    const validatedData = createMeetingWhiteboardSchema.parse(req.body);

    const result = await createWhiteboardForMeeting(
      userId,
      meetingCodeOrId,
      validatedData
    );

    return res.status(201).json({
      success: true,
      message: 'Whiteboard created and linked to meeting successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};
