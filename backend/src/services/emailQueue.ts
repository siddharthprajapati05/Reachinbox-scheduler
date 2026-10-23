import { Queue } from 'bullmq';
import { prisma } from '../db';
import { redis } from '../redis';

export const EMAIL_QUEUE_NAME = 'email-queue';

// The job only carries the email id. Subject, body and credentials stay in PostgreSQL,
// so nothing sensitive is stored in Redis or visible in Bull Board.
export interface EmailJobData {
  emailId: string;
}

export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 5, // retries for temporary errors (network, 4xx replies)
    backoff: { type: 'exponential', delay: 5000 }, // 5s, 10s, 20s, 40s...
    removeOnComplete: { age: 24 * 3600, count: 1000 }, // keep recent jobs visible in Bull Board
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});

// Stable job id: the same email can never become two jobs. BullMQ ignores an add() with an existing id.
// (BullMQ does not allow ":" in custom ids, so we use "_".)
export function jobIdFor(emailId: string): string {
  return `email_${emailId}`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

// Adds one delayed job per email, then records in PostgreSQL that the job exists (queuedAt).
export async function enqueueEmails(emails: { id: string; nextSendAt: Date }[]): Promise<void> {
  for (const group of chunk(emails, 500)) {
    const now = Date.now();
    await emailQueue.addBulk(
      group.map((email) => ({
        name: 'send-email',
        data: { emailId: email.id },
        opts: { jobId: jobIdFor(email.id), delay: Math.max(0, email.nextSendAt.getTime() - now) },
      })),
    );
    await prisma.email.updateMany({
      where: { id: { in: group.map((email) => email.id) } },
      data: { queuedAt: new Date() },
    });
  }
}

// Recovery for the crash window "row saved, job not added yet".
// It only touches rows that were never confirmed as queued - it does NOT rebuild the whole queue.
export async function enqueueUnqueuedEmails(batchId?: string): Promise<number> {
  let total = 0;
  for (;;) {
    const pending = await prisma.email.findMany({
      where: { status: 'scheduled', queuedAt: null, ...(batchId ? { batchId } : {}) },
      select: { id: true, nextSendAt: true },
      orderBy: { scheduledAt: 'asc' },
      take: 1000,
    });
    if (pending.length === 0) return total;
    await enqueueEmails(pending);
    total += pending.length;
  }
}
