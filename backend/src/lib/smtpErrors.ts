// Decide whether an SMTP error is worth retrying.
const PERMANENT_CODES = new Set(['EENVELOPE', 'EAUTH', 'EMESSAGE']);

export function isPermanentSmtpError(error: unknown): boolean {
  const { code, responseCode } = error as { code?: string; responseCode?: number };
  if (code && PERMANENT_CODES.has(code)) return true; // bad address, wrong password, bad message
  // 5xx replies mean the server rejected the mail for good. 4xx and network errors are temporary.
  return typeof responseCode === 'number' && responseCode >= 500 && responseCode < 600;
}

export function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}
