import crypto from 'crypto';
import { hashToken } from './hashToken.js';

export interface GeneratedOTP {
  code: string;
  codeHash: string;
}

export const generateOTP = (): GeneratedOTP => {
  const code = crypto.randomInt(100000, 1000000).toString();
  return {
    code,
    codeHash: hashToken(code)
  };
};
