import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { config } from '../config';

// AES-256-GCM encryption for SMTP passwords and Slack tokens stored in the database.
// Stored format (base64): 12-byte IV + 16-byte auth tag + ciphertext
const key = Buffer.from(config.ENCRYPTION_KEY, 'hex');

export function encrypt(plainText: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

export function decrypt(payload: string): string {
  const data = Buffer.from(payload, 'base64');
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(12, 28);
  const encrypted = data.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
