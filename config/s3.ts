import dotenv from 'dotenv';
dotenv.config();

import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const isS3Configured = (): boolean => {
  return Boolean(process.env.AWS_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME);
};

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
  const endpoint = process.env.AWS_ENDPOINT || process.env.S3_ENDPOINT || process.env.CLOUDFLARE_R2_ENDPOINT;

  return new S3Client({
    ...(region ? { region } : {}),
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    credentials: accessKeyId && secretAccessKey ? {
      accessKeyId,
      secretAccessKey
    } : undefined
  });
};

export const s3Client = getS3Client();

export const extractS3KeyFromUrl = (
  keyOrUrl: string,
  validateHost: boolean = false
): { key: string; isValidStorageHost: boolean } => {
  if (!keyOrUrl.startsWith('http://') && !keyOrUrl.startsWith('https://')) {
    return { key: keyOrUrl, isValidStorageHost: true };
  }

  try {
    const url = new URL(keyOrUrl);
    const currentBucket = getBucketName();
    const region = getRegion();
    const customDomain = process.env.AWS_S3_CUSTOM_DOMAIN
      ? process.env.AWS_S3_CUSTOM_DOMAIN.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
      : '';
    const endpoint = process.env.AWS_ENDPOINT || process.env.S3_ENDPOINT || process.env.CLOUDFLARE_R2_ENDPOINT;
    const endpointHost = endpoint ? new URL(endpoint).host : '';

    let isValidStorageHost = false;
    const hostname = url.host.toLowerCase();

    if (customDomain && hostname === customDomain.toLowerCase()) {
      isValidStorageHost = true;
    } else if (endpointHost && hostname === endpointHost.toLowerCase()) {
      isValidStorageHost = true;
    } else if (
      hostname === `${currentBucket}.s3.${region}.amazonaws.com`.toLowerCase() ||
      hostname === `${currentBucket}.s3.amazonaws.com`.toLowerCase()
    ) {
      isValidStorageHost = true;
    } else if (hostname.endsWith('.amazonaws.com') || hostname.endsWith('.r2.cloudflarestorage.com')) {
      isValidStorageHost = true;
    }

    if (validateHost && !isValidStorageHost) {
      return { key: '', isValidStorageHost: false };
    }

    let decodedPath = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    if (decodedPath.startsWith(currentBucket + '/')) {
      decodedPath = decodedPath.substring(currentBucket.length + 1);
    }

    return { key: decodedPath, isValidStorageHost };
  } catch {
    return { key: '', isValidStorageHost: false };
  }
};

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
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  const fileUrl = customDomain
    ? `https://${customDomain.replace(/^https?:\/\//, '')}/${encodedKey}`
    : (region
        ? `https://${currentBucket}.s3.${region}.amazonaws.com/${encodedKey}`
        : `https://${currentBucket}.s3.amazonaws.com/${encodedKey}`);

  return {
    uploadUrl,
    fileUrl,
    key,
    bucket: currentBucket,
    expiresIn: expiresInSeconds
  };
};

export const deleteS3Object = async (keyOrUrl: string): Promise<boolean> => {
  if (!isS3Configured()) return true;
  try {
    const { key, isValidStorageHost } = extractS3KeyFromUrl(keyOrUrl, true);
    if (!isValidStorageHost || !key) return false;
    const currentBucket = getBucketName();
    const client = getS3Client();
    await client.send(new DeleteObjectCommand({
      Bucket: currentBucket,
      Key: key,
    }));
    return true;
  } catch (err: any) {
    if (err?.name === 'NoSuchKey' || err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) {
      return true;
    }
    return false;
  }
};

export const verifyS3ObjectExists = async (
  keyOrUrl: string
): Promise<{ exists: boolean; contentLength?: number; key: string; isValidStorageHost: boolean }> => {
  if (!isS3Configured()) {
    return { exists: false, key: keyOrUrl, isValidStorageHost: false };
  }
  try {
    const { key, isValidStorageHost } = extractS3KeyFromUrl(keyOrUrl, true);
    if (!isValidStorageHost || !key) {
      return { exists: false, key: keyOrUrl, isValidStorageHost: false };
    }
    const currentBucket = getBucketName();
    const client = getS3Client();
    const command = new HeadObjectCommand({
      Bucket: currentBucket,
      Key: key,
    });
    const res = await client.send(command);
    return {
      exists: true,
      contentLength: res.ContentLength !== undefined ? Number(res.ContentLength) : undefined,
      key,
      isValidStorageHost: true,
    };
  } catch {
    return { exists: false, key: keyOrUrl, isValidStorageHost: false };
  }
};

export const getS3SignedDownloadUrl = async (
  keyOrUrl: string,
  expiresInSeconds: number = 3600
): Promise<string> => {
  try {
    const { key } = extractS3KeyFromUrl(keyOrUrl);
    if (!key) return keyOrUrl;
    const currentBucket = getBucketName();
    const client = getS3Client();
    const command = new GetObjectCommand({
      Bucket: currentBucket,
      Key: key,
    });
    return await getSignedUrl(client, command, { expiresIn: expiresInSeconds });
  } catch {
    return keyOrUrl;
  }
};

export const getS3ObjectText = async (keyOrUrl: string): Promise<string | null> => {
  if (!isS3Configured()) return null;
  try {
    const { key, isValidStorageHost } = extractS3KeyFromUrl(keyOrUrl, true);
    if (!isValidStorageHost || !key) return null;
    const currentBucket = getBucketName();
    const client = getS3Client();
    const command = new GetObjectCommand({
      Bucket: currentBucket,
      Key: key,
    });
    const res = await client.send(command);
    if (!res.Body) return null;
    return await res.Body.transformToString('utf-8');
  } catch {
    return null;
  }
};

