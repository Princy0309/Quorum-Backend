import { Request, Response, NextFunction } from 'express';
import { registerDeviceToken, unregisterDeviceToken } from '../services/notificationService.js';
import { ApiError } from '../utils/ApiError.js';

export const registerDeviceController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const { token, platform } = req.body || {};
    if (!token || typeof token !== 'string') {
      throw new ApiError(400, 'device token is required');
    }

    const platformStr = typeof platform === 'string' ? platform : 'web';
    const deviceToken = await registerDeviceToken(userId, token, platformStr);

    res.status(200).json({
      success: true,
      data: deviceToken
    });
  } catch (err) {
    next(err);
  }
};

export const unregisterDeviceController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const { token } = req.body || {};
    if (!token || typeof token !== 'string') {
      throw new ApiError(400, 'device token is required');
    }

    await unregisterDeviceToken(userId, token);

    res.status(200).json({
      success: true,
      message: 'Device token unregistered successfully'
    });
  } catch (err) {
    next(err);
  }
};
