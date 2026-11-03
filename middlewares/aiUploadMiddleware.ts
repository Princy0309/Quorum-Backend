import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { ApiError } from '../utils/ApiError.js';

export const AI_CHAT_MAX_FILES = 5;
export const AI_CHAT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB per file

const storage = multer.memoryStorage();

const aiChatMulter = multer({
  storage,
  limits: {
    fileSize: AI_CHAT_MAX_FILE_SIZE,
    files: AI_CHAT_MAX_FILES,
  },
}).fields([
  { name: 'files', maxCount: AI_CHAT_MAX_FILES },
  { name: 'file', maxCount: AI_CHAT_MAX_FILES },
]);

export const extractUploadedFiles = (req: Request): Express.Multer.File[] => {
  const files: Express.Multer.File[] = [];

  if (req.files) {
    if (Array.isArray(req.files)) {
      files.push(...req.files);
    } else if (typeof req.files === 'object') {
      for (const field of Object.keys(req.files)) {
        const fileList = (req.files as Record<string, Express.Multer.File[]>)[field];
        if (Array.isArray(fileList)) {
          files.push(...fileList);
        }
      }
    }
  }

  if ((req as any).file) {
    files.push((req as any).file);
  }

  return files;
};

export const aiChatUploadMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    return next();
  }

  aiChatMulter(req, res, (err: any) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(new ApiError(400, 'File too large. Maximum size is 10 MB per file.'));
        }
        if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
          return next(new ApiError(400, `Too many files uploaded. Maximum ${AI_CHAT_MAX_FILES} files are allowed.`));
        }
        return next(new ApiError(400, err.message));
      }
      return next(new ApiError(400, err.message || 'File upload failed.'));
    }

    const uploaded = extractUploadedFiles(req);
    if (uploaded.length > AI_CHAT_MAX_FILES) {
      return next(new ApiError(400, `Too many files uploaded. Maximum ${AI_CHAT_MAX_FILES} files are allowed.`));
    }

    // Populate req.body.files so schema validation recognizes file attachments on file-only requests
    if (uploaded.length > 0) {
      if (!req.body) {
        req.body = {};
      }
      if (!req.body.files || !Array.isArray(req.body.files)) {
        req.body.files = uploaded.map((f) => ({
          fileName: f.originalname,
          mimeType: f.mimetype,
          fileSize: f.size,
        }));
      }
    }

    next();
  });
};
