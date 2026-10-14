import crypto from 'crypto';
import path from 'path';
import { generateS3PresignedUpload, bucketName } from '../config/s3.js';
import { ApiError } from '../utils/ApiError.js';
import { resolveConversationId } from './chatService.js';

const ALLOWED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.heic',
  '.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.txt', '.csv', '.zip'
]);

const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.sh', '.bin', '.apk', '.dll', '.js', '.mjs', '.cjs',
  '.ts', '.php', '.vbs', '.scr', '.msi', '.com', '.pif', '.jar',
  '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.wma',
  '.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v', '.3gp'
]);

const CATEGORY_LIMITS: Record<string, number> = {
  image: 10 * 1024 * 1024,
  file: 25 * 1024 * 1024
};

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.heic': 'image/heic',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.zip': 'application/zip'
};

const resolveFileCategory = (ext: string): 'image' | 'file' => {
  const imageExts = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.heic']);
  if (imageExts.has(ext)) return 'image';
  return 'file';
};

export const getSignedUploadUrl = async (folder: string = 'general', fileName: string = 'file.jpg') => {
  const cleanName = path.basename(fileName.trim());
  const ext = path.extname(cleanName).toLowerCase() || '.jpg';
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
  const s3Key = `uploads/${folder}/${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${cleanName}`;
  const s3Data = await generateS3PresignedUpload(s3Key, mimeType);
  return {
    uploadUrl: s3Data.uploadUrl,
    fileUrl: s3Data.fileUrl,
    key: s3Data.key,
    bucket: s3Data.bucket,
    storageProvider: 's3',
    folder,
    apiKey: 's3',
    signature: 's3',
    timestamp: Math.floor(Date.now() / 1000)
  };
};

export const authorizeChatFileUpload = async (
  userId: string,
  conversationId: string,
  fileName: string,
  fileSize: number,
  clientFileType?: string
) => {
  const resolvedConvId = await resolveConversationId(userId, conversationId);
  if (!resolvedConvId) {
    throw new ApiError(403, 'You are not a participant in this conversation');
  }

  const cleanName = path.basename(fileName.trim());
  const ext = path.extname(cleanName).toLowerCase();

  if (!ext || BLOCKED_EXTENSIONS.has(ext) || !ALLOWED_EXTENSIONS.has(ext)) {
    throw new ApiError(400, 'File type is not permitted');
  }

  const category = resolveFileCategory(ext);
  const maxAllowedSize = CATEGORY_LIMITS[category] || CATEGORY_LIMITS.file;

  if (fileSize > maxAllowedSize) {
    throw new ApiError(400, `File size exceeds the allowed limit for ${category} (${Math.floor(maxAllowedSize / (1024 * 1024))}MB)`);
  }

  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
  const s3Key = `conversations/${resolvedConvId}/${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${cleanName}`;
  const s3Data = await generateS3PresignedUpload(s3Key, mimeType);

  return {
    uploadUrl: s3Data.uploadUrl,
    fileUrl: s3Data.fileUrl,
    key: s3Data.key,
    bucket: s3Data.bucket,
    storageProvider: 's3',
    apiKey: 's3',
    signature: 's3',
    timestamp: Math.floor(Date.now() / 1000),
    metadata: {
      fileName: cleanName,
      fileSize,
      fileType: category,
      maxAllowedSize,
      contentType: mimeType
    }
  };
};
