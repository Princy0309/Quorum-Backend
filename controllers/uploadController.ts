import { Request, Response, NextFunction } from 'express';
import { getSignedUploadUrl, authorizeChatFileUpload } from '../services/uploadService.js';
import { signUploadSchema } from '../validators/chatValidators.js';
import { ApiError } from '../utils/ApiError.js';

export const signUploadController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    if (req.body?.conversationId && req.body?.fileName && req.body?.fileSize) {
      const { error, value } = signUploadSchema.validate(req.body);
      if (error) {
        throw new ApiError(400, error.details[0].message);
      }

      const uploadData = await authorizeChatFileUpload(
        userId,
        value.conversationId,
        value.fileName,
        value.fileSize,
        value.fileType
      );

      res.status(200).json({
        success: true,
        data: uploadData
      });
      return;
    }

    const { folder, fileName } = req.body || {};
    const folderStr = typeof folder === 'string' ? folder : undefined;
    const fileNameStr = typeof fileName === 'string' ? fileName : undefined;

    const signatureData = await getSignedUploadUrl(folderStr, fileNameStr);
    res.status(200).json({
      success: true,
      data: signatureData
    });
  } catch (err) {
    next(err);
  }
};
