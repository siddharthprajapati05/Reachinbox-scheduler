import { Prisma } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../db';
import { checkEmailList, MAX_RECIPIENTS } from '../lib/emailParser';
import { HttpError } from '../lib/httpError';
import { calculateSendTimes, createBatchKey } from '../lib/scheduling';
import { enqueueEmails, enqueueUnqueuedEmails } from './emailQueue';
import { EmailTab, syncEmailsToSearch, TAB_STATUSES } from './searchService';

export const emailInclude = { batch: { include: { sender: true } } } as const;
export type EmailWithBatch = Prisma.EmailGetPayload<{ include: typeof emailInclude }>;

// What the frontend receives. SMTP credentials are never included.
export function toEmailDto(email: EmailWithBatch) {
  return {
    id: email.id,
    toEmail: email.toEmail,
    fromEmail: email.batch.sender.email,
    subject: email.batch.subject,
    status: email.status,
    scheduledAt: email.scheduledAt,
    nextSendAt: email.nextSendAt,
    sentAt: email.sentAt,
    attempts: email.attempts,
    previewUrl: email.previewUrl,
    lastError: email.lastError,
  };
}

export interface ScheduleInput {
  senderId: string;
  subject: string;
  body: string;
  recipients: string[];
  startAt: Date;
  minDelayMs: number;
  hourlyLimit: number;
}

export interface ScheduleResult {
  batchId: string;
  scheduledCount: number;
  alreadyScheduled: boolean;
}

const CHUNK_SIZE = 1000;

export async function scheduleBatch(userId: string, input: ScheduleInput): Promise<ScheduleResult> {
  // Operator limits from .env are the floor/ceiling. The form can only be stricter.
  if (input.minDelayMs < config.MIN_DELAY_MS) {
    throw new HttpError(400, 'delay_too_small', `Minimum delay cannot be below ${config.MIN_DELAY_MS} ms`);
  }
  if (input.hourlyLimit > config.MAX_EMAILS_PER_HOUR_PER_SENDER) {
    throw new HttpError(400, 'limit_too_high', `Hourly limit cannot be above ${config.MAX_EMAILS_PER_HOUR_PER_SENDER}`);
  }
  if (input.startAt.getTime() <= Date.now()) {
    throw new HttpError(400, 'start_in_past', 'Start time must be in the future');
  }

  // Authorization: the sender must belong to the logged-in user. The userId comes from the session, never from the request body.
  const sender = await prisma.senderAccount.findFirst({ where: { id: input.senderId, userId } });
  if (!sender) {
    throw new HttpError(404, 'sender_not_found', 'Sender account not found');
  }

  // Validate again on the server even though the upload endpoint already did.
  const check = checkEmailList(input.recipients.map((value, index) => ({ row: index + 1, value })));
  if (check.invalidRows.length > 0) {
    throw new HttpError(400, 'invalid_recipients', `${check.invalidRows.length} invalid email address(es)`, {
      invalidRows: check.invalidRows.slice(0, 50),
    });
  }
  const recipients = check.validEmails;
  if (recipients.length === 0 || recipients.length > MAX_RECIPIENTS) {
    throw new HttpError(400, 'bad_recipient_count', `Provide between 1 and ${MAX_RECIPIENTS} recipients`);
  }

  const batchKey = createBatchKey({ ...input, recipients });
  const sendTimes = calculateSendTimes(input.startAt, recipients.length, input.minDelayMs);

  let batchId: string;
  try {
    // One transaction: either the batch and ALL its emails are saved, or nothing is.
    batchId = await prisma.$transaction(
      async (tx) => {
        const batch = await tx.batch.create({
          data: {
            userId,
            senderId: sender.id,
            subject: input.subject,
            body: input.body,
            startAt: input.startAt,
            minDelayMs: input.minDelayMs,
            hourlyLimit: input.hourlyLimit,
            batchKey,
          },
        });
        for (let start = 0; start < recipients.length; start += CHUNK_SIZE) {
          await tx.email.createMany({
            data: recipients.slice(start, start + CHUNK_SIZE).map((toEmail, offset) => ({
              batchId: batch.id,
              userId,
              toEmail,
              scheduledAt: sendTimes[start + offset],
              nextSendAt: sendTimes[start + offset],
            })),
          });
        }
        return batch.id;
      },
      { timeout: 60_000 },
    );
  } catch (error) {
    // DUPLICATE PREVENTION: the unique index (userId, batchKey) rejects an identical second request.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await prisma.batch.findUnique({ where: { userId_batchKey: { userId, batchKey } } });
      if (existing) {
        await enqueueUnqueuedEmails(existing.id); // finish the job of the first request if it crashed half way
        const scheduledCount = await prisma.email.count({ where: { batchId: existing.id } });
        return { batchId: existing.id, scheduledCount, alreadyScheduled: true };
      }
    }
    throw error;
  }

  const emails = await prisma.email.findMany({
    where: { batchId },
    select: { id: true, nextSendAt: true },
    orderBy: { scheduledAt: 'asc' },
  });
  await enqueueEmails(emails); // one delayed BullMQ job per recipient
  await syncEmailsToSearch(emails.map((email) => email.id)); // best effort, never throws

  return { batchId, scheduledCount: emails.length, alreadyScheduled: false };
}

export async function listEmails(userId: string, tab: EmailTab, page: number, pageSize: number) {
  const where = { userId, status: { in: [...TAB_STATUSES[tab]] } };
  const [rows, total] = await Promise.all([
    prisma.email.findMany({
      where,
      include: emailInclude,
      orderBy: tab === 'scheduled' ? { nextSendAt: 'asc' } : { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.email.count({ where }),
  ]);
  return { items: rows.map(toEmailDto), page, pageSize, total };
}
