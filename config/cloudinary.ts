import crypto from 'crypto';

export const getCloudinaryConfig = () => {
  return {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || 'quorum',
    apiKey: process.env.CLOUDINARY_API_KEY || '1234567890',
    apiSecret: process.env.CLOUDINARY_API_SECRET || 'secret'
  };
};

export const generateCloudinarySignature = (folder: string = 'quorum_uploads') => {
  const timestamp = Math.floor(Date.now() / 1000);
  const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();

  const strToSign = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
  const signature = crypto.createHash('sha1').update(strToSign).digest('hex');

  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
    timestamp,
    signature,
    apiKey,
    folder
  };
};
