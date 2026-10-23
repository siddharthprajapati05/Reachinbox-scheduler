import { UnrecoverableError } from 'bullmq';
import { prisma } from '../db';
import { describeError, isPermanentSmtpError } from '../lib/smtpErrors';
import { emailInclude } from './emailService';
import { sendEmail } from './mailer';
import { releaseSlot, reserveSlot } from './rateLimiter';
import { syncEmailsToSearch } from './searchService';
import { notifyLimitReached } from './slackService';

// Everything the processor talks to is passed in, so automated tests can replace SMTP, Redis and Slack.
export interface ProcessorDeps {
  reserveSlot: typeof reserveSlot;
  releaseSlot: typeof releaseSlot;
  sendMail: typeof sendEmail;
  notifyLimitReached: typeof notifyLimitReached;
  syncSearch: (ids: string[]) => Promise<unknown>;
}

export const defaultDeps: ProcessorDeps = {
  reserveSlot,
  releaseSlot,
  sendMail: sendEmail,
  notifyLimitReached,
  syncSearch: syncEmailsToSearch,
};

export type ProcessResult = { kind: 'sent' } | { kind: 'skipped' } | { kind: 'delayed'; delayMs: number };

// Handles ONE email job. Returns what happened, or throws:
//   UnrecoverableError -> permanent failure, BullMQ must not retry
//   any other error    -> temporary failure, BullMQ retries with exponential backoff
export async function processEmail(
  emailId: string,
  options: { isLastAttempt: boolean },
  deps: ProcessorDeps = defaultDeps,
): Promise<ProcessResult> {
  const email = await prisma.email.findUnique({ where: { id: emailId }, include: emailInclude });
  if (!email) return { kind: 'skipped' };

  // Already finished (e.g. BullMQ delivered the same job twice): never send again.
  if (email.status === 'sent' || email.status === 'failed') return { kind: 'skipped' };

  const { batch } = email;
  const sender = batch.sender;

  // 1. Ask Redis for a send slot (enforces min delay + hourly limit for this sender, across all workers).
  const slot = await deps.reserveSlot(sender.id, email.id, batch.hourlyLimit, batch.minDelayMs);

  if (slot.waitMs > 0) {
    // Too early: keep the email (status stays "scheduled"), remember the new time, and let the worker delay the job.
    const nextSendAt = new Date(Date.now() + slot.waitMs);
    await prisma.email.update({ where: { id: email.id }, data: { status: 'scheduled', nextSendAt } });
    await deps.syncSearch([email.id]);
    if (slot.limitReached) {
      await deps.notifyLimitReached({
        userId: email.userId,
        senderId: sender.id,
        senderEmail: sender.email,
        hourlyLimit: batch.hourlyLimit,
        resumeAt: nextSendAt,
      });
    }
    return { kind: 'delayed', delayMs: slot.waitMs };
  }

  // 2. Our turn. Mark as processing BEFORE talking to SMTP so the database always shows what we were doing.
  await prisma.email.update({ where: { id: email.id }, data: { status: 'processing', attempts: { increment: 1 } } });

  let result;
  try {
    result = await deps.sendMail(sender, email.toEmail, batch.subject, batch.body);
  } catch (error) {
    await handleSendFailure(email.id, sender.id, error, options.isLastAttempt, deps);
    throw error; // not reached: handleSendFailure always throws
  }

  // 3. SMTP accepted the message -> only now it becomes "sent".
  await prisma.email.update({
    where: { id: email.id },
    data: {
      status: 'sent',
      sentAt: new Date(),
      smtpMessageId: result.messageId,
      previewUrl: result.previewUrl ?? null,
      lastError: null,
    },
  });
  await deps.syncSearch([email.id]);
  return { kind: 'sent' };
}

async function handleSendFailure(
  emailId: string,
  senderId: string,
  error: unknown,
  isLastAttempt: boolean,
  deps: ProcessorDeps,
): Promise<never> {
  const message = describeError(error);

  if (isPermanentSmtpError(error) || isLastAttempt) {
    // Give up: mark failed and return the reserved hourly capacity so other emails are not blocked.
    await prisma.email.update({ where: { id: emailId }, data: { status: 'failed', lastError: message } });
    await deps.releaseSlot(senderId, emailId);
    await deps.syncSearch([emailId]);
    throw new UnrecoverableError(message);
  }

  // Temporary problem: back to "scheduled" and let BullMQ retry. The slot stays reserved,
  // so the retry does not use a second unit of hourly capacity.
  await prisma.email.update({ where: { id: emailId }, data: { status: 'scheduled', lastError: message } });
  await deps.syncSearch([emailId]);
  throw error;
}
