import dotenv from 'dotenv';
dotenv.config();

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const getRegion = () => process.env.AWS_REGION || 'ap-south-1';
const getAccessKeyId = () => process.env.AWS_ACCESS_KEY_ID || '';
const getSecretAccessKey = () => process.env.AWS_SECRET_ACCESS_KEY || '';
export const getBucketName = () => process.env.AWS_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME || 'quorumuploads';
export const bucketName = getBucketName();

export const getS3Client = () => {
  const region = getRegion();
  const accessKeyId = getAccessKeyId();
  const secretAccessKey = getSecretAccessKey();

  return new S3Client({
    region,
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
    : `https://${currentBucket}.s3.${region}.amazonaws.com/${key}`;

  return {
    uploadUrl,
    fileUrl,
    key,
    bucket: currentBucket,
    expiresIn: expiresInSeconds
  };
};

