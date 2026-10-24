import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { encrypt } from '../lib/crypto';
import { HttpError } from '../lib/httpError';
import { createEtherealAccount } from './mailer';

export interface CustomSmtpInput {
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
}

const publicFields = { id: true, email: true, smtpHost: true, createdAt: true } as const;

export function listSenders(userId: string) {
  return prisma.senderAccount.findMany({ where: { userId }, select: publicFields, orderBy: { createdAt: 'asc' } });
}

// No input = create a fresh Ethereal test account. Otherwise use the SMTP details the user gave.
export async function createSender(userId: string, custom?: CustomSmtpInput) {
  const count = await prisma.senderAccount.count({ where: { userId } });
  if (count >= 10) {
    throw new HttpError(400, 'too_many_senders', 'You can have at most 10 sender accounts');
  }

  let smtp: { email: string; host: string; port: number; user: string; pass: string };
  if (custom) {
    smtp = { email: custom.email, host: custom.smtpHost, port: custom.smtpPort, user: custom.smtpUser, pass: custom.smtpPass };
  } else {
    try {
      smtp = await createEtherealAccount();
    } catch (error) {
      console.error('[sender] could not create Ethereal account:', (error as Error).message);
      throw new HttpError(502, 'ethereal_unavailable', 'Could not create an Ethereal test account. Check your internet connection.');
    }
  }

  try {
    return await prisma.senderAccount.create({
      data: {
        userId,
        email: smtp.email,
        smtpHost: smtp.host,
        smtpPort: smtp.port,
        smtpUser: smtp.user,
        smtpPassEncrypted: encrypt(smtp.pass),
      },
      select: publicFields,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new HttpError(409, 'sender_exists', 'A sender with this email already exists');
    }
    throw error;
  }
}

export async function deleteSender(userId: string, senderId: string) {
  const sender = await prisma.senderAccount.findUnique({ where: { id: senderId } });
  if (!sender || sender.userId !== userId) {
    throw new HttpError(404, 'not_found', 'Sender not found');
  }
  // Remove linked emails and batches first (cascade)
  await prisma.email.deleteMany({ where: { batch: { senderId } } });
  await prisma.batch.deleteMany({ where: { senderId } });
  await prisma.senderAccount.delete({ where: { id: senderId } });
}
