import { SenderAccount } from '@prisma/client';
import nodemailer, { Transporter } from 'nodemailer';
import { decrypt } from '../lib/crypto';

export interface SendResult {
  messageId: string;
  previewUrl?: string;
}

// One SMTP transporter per sender, reused between emails.
const transporters = new Map<string, Transporter>();

function getTransporter(sender: SenderAccount): Transporter {
  let transporter = transporters.get(sender.id);
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: sender.smtpHost,
      port: sender.smtpPort,
      secure: sender.smtpPort === 465,
      auth: { user: sender.smtpUser, pass: decrypt(sender.smtpPassEncrypted) },
      connectionTimeout: 30000,  // 30s — fail fast instead of hanging
      socketTimeout: 30000,
      greetingTimeout: 30000,
    });
    transporters.set(sender.id, transporter);
  }
  return transporter;
}

export async function sendEmail(sender: SenderAccount, to: string, subject: string, body: string): Promise<SendResult> {
  const info = await getTransporter(sender).sendMail({ from: sender.email, to, subject, text: body });
  // For Ethereal this is a link where you can open the "delivered" message. It is false for other SMTP servers.
  const previewUrl = nodemailer.getTestMessageUrl(info) || undefined;
  if (previewUrl) {
    console.log(`[mail] sent to ${to} - preview: ${previewUrl}`);
  }
  return { messageId: info.messageId, previewUrl };
}

// Creates a brand-new Ethereal test inbox (free, no signup, needs internet access).
export async function createEtherealAccount(): Promise<{ email: string; host: string; port: number; user: string; pass: string }> {
  const account = await nodemailer.createTestAccount();
  return { email: account.user, host: account.smtp.host, port: account.smtp.port, user: account.user, pass: account.pass };
}
