import dotenv from 'dotenv';
dotenv.config();

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const getRegion = () => process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || '';
export const getAccessKeyId = () => process.env.AWS_ACCESS_KEY_ID || '';
export const getSecretAccessKey = () => process.env.AWS_SECRET_ACCESS_KEY || '';
export const getBucketName = () => {
  const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME || '';
  if (!bucket) {
    throw new Error('AWS_S3_BUCKET is not configured in environment variables');
  }
  return bucket;
};
export const bucketName = process.env.AWS_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME || '';

export const getS3Client = () => {
  const region = getRegion();
  const accessKeyId = getAccessKeyId();
  const secretAccessKey = getSecretAccessKey();

  return new S3Client({
    ...(region ? { region } : {}),
    credentials: accessKeyId && secretAccessKey ? {
      accessKeyId,
      secretAccessKey
    } : undefined
  });
};

export const s3Client = getS3Client();

export const generateS3PresignedUpload = async (
  key: string,
  contentType: string,
  expiresInSeconds: number = 900
) => {
  const region = getRegion();
  const currentBucket = getBucketName();
  const customDomain = process.env.AWS_S3_CUSTOM_DOMAIN || '';
  const client = getS3Client();

  const command = new PutObjectCommand({
    Bucket: currentBucket,
    Key: key,
    ContentType: contentType
  });

  const uploadUrl = await getSignedUrl(client, command, { expiresIn: expiresInSeconds });
  const fileUrl = customDomain
    ? `https://${customDomain.replace(/^https?:\/\//, '')}/${key}`
    : (region
        ? `https://${currentBucket}.s3.${region}.amazonaws.com/${key}`
        : `https://${currentBucket}.s3.amazonaws.com/${key}`);

  return {
    uploadUrl,
    fileUrl,
    key,
    bucket: currentBucket,
    expiresIn: expiresInSeconds
  };
};

