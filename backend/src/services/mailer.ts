import { SenderAccount } from '@prisma/client';
import nodemailer, { Transporter } from 'nodemailer';
import { decrypt } from '../lib/crypto.js';

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

// Brevo HTTP API — used when smtpHost === 'api.brevo.com' to bypass SMTP port blocks.
async function sendViaBrevoApi(sender: SenderAccount, to: string, subject: string, body: string): Promise<SendResult> {
  const apiKey = decrypt(sender.smtpPassEncrypted);
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: { email: sender.email, name: sender.email },
      to: [{ email: to }],
      subject,
      textContent: body,
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Brevo API error ${response.status}: ${err}`);
  }
  const data = await response.json() as { messageId?: string };
  return { messageId: data.messageId ?? `brevo-${Date.now()}` };
}

export async function sendEmail(sender: SenderAccount, to: string, subject: string, body: string): Promise<SendResult> {
  // Use Brevo HTTP API when host is set to api.brevo.com (avoids SMTP port blocks on free hosting).
  if (sender.smtpHost === 'api.brevo.com') {
    return sendViaBrevoApi(sender, to, subject, body);
  }
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
