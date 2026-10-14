import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const region = process.env.AWS_REGION || 'ap-south-1';
const accessKeyId = process.env.AWS_ACCESS_KEY_ID || '';
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || '';
export const bucketName = process.env.AWS_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME || 'quorum-uploads';
const customDomain = process.env.AWS_S3_CUSTOM_DOMAIN || '';

export const s3Client = new S3Client({
  region,
  credentials: accessKeyId && secretAccessKey ? {
    accessKeyId,
    secretAccessKey
  } : undefined
});

export const generateS3PresignedUpload = async (
  key: string,
  contentType: string,
  expiresInSeconds: number = 900
) => {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: contentType
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
  const fileUrl = customDomain
    ? `https://${customDomain.replace(/^https?:\/\//, '')}/${key}`
    : `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;

  return {
    uploadUrl,
    fileUrl,
    key,
    bucket: bucketName,
    expiresIn: expiresInSeconds
  };
};
