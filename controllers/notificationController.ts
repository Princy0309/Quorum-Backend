import {Request, Response, NextFunction} from 'express';
import { ApiError } from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import {
  getUserNotifications,
  getUnreadNotificationCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  getUserPreferences,
  upsertUserPreference,
  normalizeNotificationType,
} from '../services/notificationService.js';
import type { UpdateNotificationPreferenceInput } from '../types/index.js';


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

    const preferencesMap: Record<string, any> = {};
    for (const p of preferences) {
      preferencesMap[p.notificationType] = {
        inApp: p.inApp,
        push: p.push,
        email: p.email,
      };
    }

    res.status(200).json({
      success: true,
      data: preferences,
      preferences: preferencesMap,
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

    logger.info('[PreferenceUpdate] Incoming preference update request', {
      userId,
      method: req.method,
      url: req.originalUrl,
      body: req.body,
    });

    const itemsToUpsert: UpdateNotificationPreferenceInput[] = [];

    const parseItem = (item: any, fallbackKey?: string) => {
      if (!item || typeof item !== 'object') return;
      const rawType = item.notificationType || item.type || item.category || item.key || item.id || fallbackKey;
      const normalizedType = normalizeNotificationType(rawType);
      if (normalizedType) {
        itemsToUpsert.push({
          notificationType: normalizedType,
          inApp: typeof item.inApp === 'boolean' ? item.inApp : undefined,
          push: typeof item.push === 'boolean' ? item.push : undefined,
          email: typeof item.email === 'boolean' ? item.email : undefined,
        });
      }
    };

    if (Array.isArray(req.body)) {
      for (const item of req.body) {
        parseItem(item);
      }
    } else if (req.body && typeof req.body === 'object') {
      if (Array.isArray(req.body.preferences)) {
        for (const item of req.body.preferences) {
          parseItem(item);
        }
      } else if (req.body.preferences && typeof req.body.preferences === 'object') {
        for (const [key, val] of Object.entries(req.body.preferences)) {
          parseItem(val, key);
        }
      } else if (req.body.notificationType || req.body.type || req.body.category || req.body.key) {
        parseItem(req.body);
      } else {
        for (const [key, val] of Object.entries(req.body)) {
          if (val && typeof val === 'object') {
            parseItem(val, key);
          }
        }
      }
    }

    if (itemsToUpsert.length === 0) {
      throw new ApiError(400, 'Invalid preference payload. notificationType could not be identified.');
    }

    const savedResults = await Promise.all(
      itemsToUpsert.map((item) => upsertUserPreference(userId, item))
    );

    const allPreferences = await getUserPreferences(userId);

    const preferencesMap: Record<string, any> = {};
    for (const p of allPreferences) {
      preferencesMap[p.notificationType] = {
        inApp: p.inApp,
        push: p.push,
        email: p.email,
      };
    }

    logger.info('[PreferenceUpdate] Successfully saved user preferences', {
      userId,
      savedCount: savedResults.length,
      savedTypes: itemsToUpsert.map((i) => i.notificationType),
    });

    res.status(200).json({
      success: true,
      message: 'Notification preferences updated successfully',
      data: allPreferences,
      preferences: preferencesMap,
      updated: savedResults.length === 1 ? savedResults[0] : savedResults,
    });
  } catch (err) {
    next(err);
  }
};
