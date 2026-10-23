import { createHash } from 'crypto';

// Email number i is first allowed to go out at: start + i * minDelay.
// This keeps a big batch spread out from the beginning. The Redis limiter (rateLimiter.ts)
// is the one that actually ENFORCES the delay and the hourly limit when workers run.
export function calculateSendTimes(start: Date, count: number, minDelayMs: number): Date[] {
  return Array.from({ length: count }, (_, index) => new Date(start.getTime() + index * minDelayMs));
}

export interface BatchKeyParts {
  senderId: string;
  subject: string;
  body: string;
  startAt: Date;
  minDelayMs: number;
  hourlyLimit: number;
  recipients: string[];
}

// Fingerprint of a schedule request. The same request always gives the same key,
// and the database has a unique index on (userId, batchKey), so a double click cannot schedule twice.
export function createBatchKey(parts: BatchKeyParts): string {
  const hash = createHash('sha256');
  hash.update(
    JSON.stringify([
      parts.senderId,
      parts.subject,
      parts.body,
      parts.startAt.toISOString(),
      parts.minDelayMs,
      parts.hourlyLimit,
    ]),
  );
  hash.update([...parts.recipients].sort().join('\n'));
  return hash.digest('hex');
}
