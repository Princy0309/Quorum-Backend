import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { verifyAccessToken } from '../services/tokenService.js';
import { getSignedUploadUrl, authorizeChatFileUpload, uploadBufferToS3 } from '../services/uploadService.js';
import { signUploadSchema } from '../validators/chatValidators.js';
import { ApiError } from '../utils/ApiError.js';
import env from '../config/env.js';

const storage = multer.memoryStorage();
export const uploadMiddleware = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024
  }
}).any();

export const signUploadController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    if (req.body?.conversationId && req.body?.fileName && req.body?.fileSize) {
      const parsed = signUploadSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ApiError(400, parsed.error.issues[0]?.message || 'Validation failed');
      }
      const value = parsed.data;

      const uploadData = await authorizeChatFileUpload(
        userId,
        value.conversationId!,
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

    const { folder } = req.body || {};
    const folderStr = typeof folder === 'string' ? folder : 'chat';
    const timestamp = Math.floor(Date.now() / 1000);
    const secret = env.JWT_SECRET;
    const signature = crypto
      .createHmac('sha256', secret)
      .update(`${userId}:${timestamp}:${folderStr}`)
      .digest('hex');

    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.get('host') || 'localhost';
    const uploadUrl = `${protocol}://${host}/api/uploads/s3`;

    res.status(200).json({
      success: true,
      data: {
        uploadUrl,
        fileUrl: uploadUrl,
        storageProvider: 's3',
        folder: folderStr,
        apiKey: userId,
        signature,
        timestamp
      }
    });
  } catch (err) {
    next(err);
  }
};

export const directS3UploadController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const files = (req.files && Array.isArray(req.files) && req.files.length > 0)
      ? req.files
      : ((req as any).file ? [(req as any).file] : []);

    if (files.length === 0) {
      throw new ApiError(400, 'No file uploaded');
    }

    const file = files[0];
    const apiKey = (req.body?.api_key || req.body?.apiKey || '').toString();
    const signature = (req.body?.signature || '').toString();
    const timestamp = (req.body?.timestamp || '').toString();
    const folder = (req.body?.folder || 'chat').toString();

    let authenticated = false;
    const authHeader = req.headers.authorization;
    const tokenFromHeader = (authHeader && authHeader.startsWith('Bearer ')) ? authHeader.split(' ')[1] : null;
    const token = tokenFromHeader || req.cookies?.accessToken;

    if (token) {
      try {
        verifyAccessToken(token);
        authenticated = true;
      } catch {
        authenticated = false;
      }
    }

    if (!authenticated) {
      if (signature && apiKey && timestamp) {
        const secret = env.JWT_SECRET;
        const expectedSig = crypto
          .createHmac('sha256', secret)
          .update(`${apiKey}:${timestamp}:${folder}`)
          .digest('hex');
        if (signature === expectedSig) {
          authenticated = true;
        }
      }
    }

    if (!authenticated) {
      throw new ApiError(401, 'Unauthorized file upload');
    }

    const originalName = file.originalname || 'file.jpg';
    const uploaded = await uploadBufferToS3(file.buffer, originalName, folder, file.mimetype);

    res.status(200).json({
      secure_url: uploaded.publicUrl,
      url: uploaded.publicUrl,
      fileUrl: uploaded.publicUrl,
      fileName: uploaded.cleanName,
      fileSize: uploaded.fileSize,
      fileType: uploaded.category,
      public_id: uploaded.s3Key,
      format: uploaded.ext.replace(/^\./, ''),
      resource_type: uploaded.category,
      bytes: uploaded.fileSize,
      created_at: new Date().toISOString(),
      success: true,
      data: {
        secure_url: uploaded.publicUrl,
        url: uploaded.publicUrl,
        fileUrl: uploaded.publicUrl,
        fileName: uploaded.cleanName,
        fileSize: uploaded.fileSize,
        fileType: uploaded.category
      }
    });
  } catch (err) {
    next(err);
  }
};

