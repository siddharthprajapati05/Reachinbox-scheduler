import { timingSafeEqual } from 'crypto';

// Compare two secrets without leaking information through timing.
export function safeEqual(a: string, b: string): boolean {
  const first = Buffer.from(a);
  const second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
}
