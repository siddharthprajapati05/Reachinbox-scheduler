import { parse } from 'csv-parse/sync';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const MAX_RECIPIENTS = 10000;

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_PATTERN.test(value);
}

export interface InvalidRow {
  row: number; // line number in the uploaded file (or position in the list)
  value: string;
  reason: string;
}

export interface RecipientCheck {
  validEmails: string[]; // lowercased and unique, in the original order
  invalidRows: InvalidRow[];
  duplicateCount: number;
}

// Used by BOTH the file upload and the schedule API, so the rules are identical everywhere.
export function checkEmailList(rows: { row: number; value: string }[]): RecipientCheck {
  const seen = new Set<string>();
  const validEmails: string[] = [];
  const invalidRows: InvalidRow[] = [];
  let duplicateCount = 0;

  for (const { row, value } of rows) {
    const email = value.trim().toLowerCase();
    if (email === '') {
      invalidRows.push({ row, value, reason: 'Empty email' });
    } else if (!isValidEmail(email)) {
      invalidRows.push({ row, value, reason: 'Not a valid email address' });
    } else if (seen.has(email)) {
      duplicateCount += 1;
    } else {
      seen.add(email);
      validEmails.push(email);
    }
  }

  return { validEmails, invalidRows, duplicateCount };
}

// Reads a CSV (needs an "email" column) or a plain text file (one address per line).
export function parseRecipientFile(text: string): RecipientCheck {
  const content = text.replace(/^\uFEFF/, ''); // drop the BOM Excel sometimes adds
  const lines = content.split(/\r?\n/);
  const firstLine = lines.find((line) => line.trim() !== '') ?? '';

  if (firstLine === '') {
    throw new Error('The file is empty');
  }

  // A comma in the first line means CSV; otherwise treat it as one address per line.
  if (firstLine.includes(',')) {
    const headers = firstLine.split(',').map((header) => header.trim().toLowerCase().replace(/^"|"$/g, ''));
    if (!headers.includes('email')) {
      throw new Error('The CSV file needs a column named "email"');
    }
    const records = parse(content, {
      columns: (header: string[]) => header.map((name) => name.trim().toLowerCase()),
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    }) as Record<string, string>[];
    // +2 because line 1 is the header and humans count from 1
    return checkEmailList(records.map((record, index) => ({ row: index + 2, value: record.email ?? '' })));
  }

  const rows: { row: number; value: string }[] = [];
  let skippedHeader = false;
  lines.forEach((line, index) => {
    const value = line.trim();
    if (value === '') return;
    if (!skippedHeader && value.toLowerCase() === 'email') {
      skippedHeader = true; // allow an optional "email" header line
      return;
    }
    skippedHeader = true;
    rows.push({ row: index + 1, value });
  });
  return checkEmailList(rows);
}
