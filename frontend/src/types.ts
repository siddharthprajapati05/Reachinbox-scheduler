export type EmailStatus = 'scheduled' | 'processing' | 'sent' | 'failed';
export type Tab = 'scheduled' | 'sent';

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  isAdmin: boolean;
}

export interface EmailItem {
  id: string;
  toEmail: string;
  fromEmail: string;
  subject: string;
  status: EmailStatus;
  scheduledAt: string;
  nextSendAt: string;
  sentAt: string | null;
  attempts: number;
  previewUrl: string | null;
  lastError: string | null;
}

export interface EmailPage {
  items: EmailItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface Sender {
  id: string;
  email: string;
  smtpHost: string;
}

export interface Settings {
  defaultMinDelayMs: number;
  maxHourlyLimit: number;
  maxRecipients: number;
  slackConfigured: boolean;
}

export interface SlackStatus {
  configured: boolean;
  connected: boolean;
  teamName: string | null;
  channelName: string | null;
}

export interface InvalidRow {
  row: number;
  value: string;
  reason: string;
}

export interface ParseResult {
  validCount: number;
  validEmails: string[];
  duplicateCount: number;
  invalidCount: number;
  invalidRows: InvalidRow[];
}

export interface ScheduleRequest {
  senderId: string;
  subject: string;
  body: string;
  recipients: string[];
  startAt: string;
  minDelayMs: number;
  hourlyLimit: number;
}

export interface ScheduleResult {
  batchId: string;
  scheduledCount: number;
  alreadyScheduled: boolean;
}
