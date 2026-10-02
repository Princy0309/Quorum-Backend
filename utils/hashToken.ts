import crypto from 'crypto';

export const hashToken = (token: string | number): string => {
  return crypto.createHash('sha256').update(token.toString()).digest('hex');
};
