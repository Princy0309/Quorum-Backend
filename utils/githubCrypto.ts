import crypto from 'crypto';
import env from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

function getEncryptionKey(): Buffer {
  const keyHex = env.GITHUB_ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) {
    throw new Error('GITHUB_ENCRYPTION_KEY must be a valid 64-character hex string (32 bytes)');
  }
  return Buffer.from(keyHex, 'hex');
}

function getStateSecret(): string {
  const secret = env.GITHUB_STATE_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('GITHUB_STATE_SECRET is not set or too short (must be at least 32 chars)');
  }
  return secret;
}
export function encryptGithubToken(plainText: string): string {
  if (!plainText) {
    throw new Error('encryptGithubToken: cannot encrypt empty value');
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}
export function decryptGithubToken(encryptedPayload: string): string {
  if (!encryptedPayload) {
    throw new Error('decryptGithubToken: cannot decrypt empty value');
  }

  const parts = encryptedPayload.split(':');
  if (parts.length !== 3) {
    throw new Error('decryptGithubToken: invalid encrypted payload format');
  }

  const [ivHex, authTagHex, cipherText] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const key = getEncryptionKey();

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(cipherText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
export interface StatePayload {
  userId: string;
  nonce: string;
  timestamp: number;
}

export function generateSignedState(userId: string): { state: string; nonce: string } {
  if (!userId) {
    throw new Error('generateSignedState: userId is required');
  }

  const nonce = crypto.randomBytes(16).toString('hex');
  const payload: StatePayload = {
    userId,
    nonce,
    timestamp: Date.now(),
  };

  const payloadString = JSON.stringify(payload);
  const payloadBase64 = Buffer.from(payloadString, 'utf8').toString('base64url');

  const secret = getStateSecret();
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payloadBase64)
    .digest('base64url');

  return {
    state: `${payloadBase64}.${signature}`,
    nonce,
  };
}

export type VerifyStateResult =
  | { valid: true; userId: string; nonce: string }
  | { valid: false; reason: string };

export function verifySignedState(stateToken: string): VerifyStateResult {
  if (!stateToken || typeof stateToken !== 'string') {
    return { valid: false, reason: 'Missing state token' };
  }

  const parts = stateToken.split('.');
  if (parts.length !== 2) {
    return { valid: false, reason: 'Malformed state token format' };
  }

  const [payloadBase64, providedSignature] = parts;
  const secret = getStateSecret();

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payloadBase64)
    .digest('base64url');

  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const providedBuffer = Buffer.from(providedSignature, 'utf8');

  if (
    expectedBuffer.length !== providedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    return { valid: false, reason: 'Invalid state signature' };
  }

  try {
    const jsonString = Buffer.from(payloadBase64, 'base64url').toString('utf8');
    const payload: StatePayload = JSON.parse(jsonString);

    if (!payload.userId || !payload.nonce || !payload.timestamp) {
      return { valid: false, reason: 'Incomplete state payload' };
    }

    const age = Date.now() - payload.timestamp;
    if (age > STATE_MAX_AGE_MS || age < -30000) {
      return { valid: false, reason: 'State expired or timestamp in future' };
    }

    return {
      valid: true,
      userId: payload.userId,
      nonce: payload.nonce,
    };
  } catch (err: any) {
    return { valid: false, reason: `Failed to parse state payload: ${err.message}` };
  }
}
