import { generateCloudinarySignature } from '../config/cloudinary.js';

export const getSignedUploadUrl = (folder?: string) => {
  const targetFolder = folder ? `quorum_uploads/${folder}` : 'quorum_uploads';
  return generateCloudinarySignature(targetFolder);
};
