import type { EmailPage, ParseResult, ScheduleRequest, ScheduleResult, Sender, Settings, SlackStatus, Tab, User } from './types';

// Every call goes to the real backend. The CSRF token (from /api/auth/me) is sent on all changing requests.
let csrfToken = '';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  json?: unknown;
  form?: FormData;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;

  if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
  if (options.form) {
    body = options.form;
  } else if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  }

  let response: Response;
  try {
    response = await fetch(path, { method, headers, body, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'network_error', 'Cannot reach the server. Is the backend running?');
  }

  const payload = (await response.json().catch(() => null)) as {
    data?: T;
    error?: { code?: string; message?: string; details?: unknown };
  } | null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'error',
      payload?.error?.message ?? 'Something went wrong',
      payload?.error?.details,
    );
  }
  return payload?.data as T;
}

export async function getMe(): Promise<User> {
  const data = await request<{ user: User; csrfToken: string }>('/api/auth/me');
  csrfToken = data.csrfToken;
  return data.user;
}

export const logout = () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
export const getSettings = () => request<Settings>('/api/settings');
export const listSenders = () => request<Sender[]>('/api/senders');
export const createSender = () => request<Sender>('/api/senders', { method: 'POST', json: {} });

export interface CustomSmtpInput {
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
}
export const createCustomSender = (input: CustomSmtpInput) =>
  request<Sender>('/api/senders', { method: 'POST', json: input });

export const deleteSender = (id: string) =>
  request<{ ok: boolean }>(`/api/senders/${id}`, { method: 'DELETE' });

export function parseRecipientFile(file: File): Promise<ParseResult> {
  const form = new FormData();
  form.append('file', file);
  return request<ParseResult>('/api/emails/parse', { method: 'POST', form });
}

export const scheduleEmails = (input: ScheduleRequest) =>
  request<ScheduleResult>('/api/emails', { method: 'POST', json: input });

export function listEmails(tab: Tab, page: number, pageSize: number): Promise<EmailPage> {
  return request<EmailPage>(`/api/emails?${new URLSearchParams({ tab, page: String(page), pageSize: String(pageSize) })}`);
}

export function searchEmails(q: string, tab: Tab, page: number, pageSize: number): Promise<EmailPage> {
  return request<EmailPage>(
    `/api/emails/search?${new URLSearchParams({ q, tab, page: String(page), pageSize: String(pageSize) })}`,
  );
}

export const reindexSearch = () => request<{ reindexed: number }>('/api/emails/search/reindex', { method: 'POST' });
export const getSlackStatus = () => request<SlackStatus>('/api/slack/status');
export const disconnectSlack = () => request<{ ok: boolean }>('/api/slack/disconnect', { method: 'POST' });
