import { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import {
  createCalendarEvent,
  getCalendarEventsByMonth,
  getCalendarEventsByDate,
  getUpcomingCalendarEvents,
  getCalendarEventById,
  updateCalendarEvent,
  deleteCalendarEvent,
} from '../services/calendarService.js';

export const createCalendarEventController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return next(new ApiError(401, 'Unauthorized, login required'));
    }

    const event = await createCalendarEvent(req.user.id, req.body);

    return res.status(201).json({
      success: true,
      message: 'Calendar event created successfully',
      data: event,
    });
  }
);

export const getCalendarEventsByMonthController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return next(new ApiError(401, 'Unauthorized, login required'));
    }

    const year = Number(req.query.year);
    const month = Number(req.query.month);

    const events = await getCalendarEventsByMonth(req.user.id, year, month);

    return res.status(200).json({
      success: true,
      data: events,
    });
  }
);

export const getCalendarEventsByDateController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return next(new ApiError(401, 'Unauthorized, login required'));
    }

    const dateStr = String(req.query.date);
    const events = await getCalendarEventsByDate(req.user.id, dateStr);

    return res.status(200).json({
      success: true,
      data: events,
    });
  }
);

export const getUpcomingCalendarEventsController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return next(new ApiError(401, 'Unauthorized, login required'));
    }

    const limit = Number(req.query.limit) || 5;
    const events = await getUpcomingCalendarEvents(req.user.id, limit);

    return res.status(200).json({
      success: true,
      data: events,
    });
  }
);

export const getCalendarEventByIdController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return next(new ApiError(401, 'Unauthorized, login required'));
    }

    const event = await getCalendarEventById(req.user.id, req.params.id as string);

    return res.status(200).json({
      success: true,
      data: event,
    });
  }
);

export const updateCalendarEventController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return next(new ApiError(401, 'Unauthorized, login required'));
    }

    const event = await updateCalendarEvent(req.user.id, req.params.id as string, req.body);

    return res.status(200).json({
      success: true,
      message: 'Calendar event updated successfully',
      data: event,
    });
  }
);

export const deleteCalendarEventController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return next(new ApiError(401, 'Unauthorized, login required'));
    }

    await deleteCalendarEvent(req.user.id, req.params.id as string);

    return res.status(200).json({
      success: true,
      message: 'Calendar event deleted successfully',
    });
  }
);
