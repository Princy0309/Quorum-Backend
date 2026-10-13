import { Request, Response, NextFunction } from 'express';
import { getSignedUploadUrl } from '../services/uploadService.js';
import { ApiError } from '../utils/ApiError.js';

export const signUploadController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const { folder } = req.body || {};
    const folderStr = typeof folder === 'string' ? folder : undefined;

    const signatureData = getSignedUploadUrl(folderStr);
    res.status(200).json({
      success: true,
      data: signatureData
    });
  } catch (err) {
    next(err);
  }
};
