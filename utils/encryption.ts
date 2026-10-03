import crypto from 'crypto';

export function encryptPayload(secret: string, payload: any): string {
  const key = crypto.createHash('sha256').update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return JSON.stringify({
    iv: iv.toString('hex'),
    data: encrypted.toString('hex'),
    authTag: authTag.toString('hex')
  });
}

export function decryptPayload(secret: string, encryptedData: string): any {
  const key = crypto.createHash('sha256').update(secret).digest();
  const { iv, data, authTag } = JSON.parse(encryptedData);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}
