import { Request, Response, NextFunction } from 'express';
import { registerDeviceToken, unregisterDeviceToken } from '../services/notificationService.js';
import { ApiError } from '../utils/ApiError.js';

export const registerDeviceController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const { token, platform } = req.body;
    const deviceToken = await registerDeviceToken(userId, token, platform);

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

    const { token } = req.body;
    await unregisterDeviceToken(userId, token);

    res.status(200).json({
      success: true,
      message: 'Device token unregistered successfully'
    });
  } catch (err) {
    next(err);
  }
};
