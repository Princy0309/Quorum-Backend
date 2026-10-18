import {Request, Response, NextFunction} from 'express';
import { ApiError } from '../utils/ApiError.js';
import {
  getUserNotifications,
  getUnreadNotificationCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  getUserPreferences,
  upsertUserPreference,
} from '../services/notificationService.js';


export const getNotificationsController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const { page, limit, unreadOnly } = req.query;

    const result = await getUserNotifications(userId, {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
      unreadOnly: unreadOnly === 'true',
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};


export const getUnreadCountController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const count = await getUnreadNotificationCount(userId);

    res.status(200).json({
      success: true,
      data: { unreadCount: count },
    });
  } catch (err) {
    next(err);
  }
};


export const markAsReadController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const id = String(req.params.id);
    await markNotificationAsRead(userId, id);

    res.status(200).json({
      success: true,
      message: 'Notification marked as read',
    });
  } catch (err) {
    next(err);
  }
};


export const markAllAsReadController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    await markAllNotificationsAsRead(userId);

    res.status(200).json({
      success: true,
      message: 'All notifications marked as read',
    });
  } catch (err) {
    next(err);
  }
};


export const deleteNotificationController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const id = String(req.params.id);
    await deleteNotification(userId, id);

    res.status(200).json({
      success: true,
      message: 'Notification deleted',
    });
  } catch (err) {
    next(err);
  }
};

export const getPreferencesController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const preferences = await getUserPreferences(userId);

    res.status(200).json({
      success: true,
      data: preferences,
    });
  } catch (err) {
    next(err);
  }
};

export const updatePreferenceController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const { notificationType, inApp, push, email } = req.body;
    if (!notificationType) {
      throw new ApiError(400, 'notificationType is required');
    }

    const preference = await upsertUserPreference(userId, {
      notificationType,
      inApp,
      push,
      email,
    });

    res.status(200).json({
      success: true,
      data: preference,
    });
  } catch (err) {
    next(err);
  }
};
