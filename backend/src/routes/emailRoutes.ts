import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler } from '../lib/asyncHandler';
import { MAX_RECIPIENTS, parseRecipientFile } from '../lib/emailParser';
import { HttpError } from '../lib/httpError';
import { currentUserId, requireAuth, requireCsrf } from '../middleware/auth';
import { emailInclude, EmailWithBatch, listEmails, scheduleBatch, toEmailDto } from '../services/emailService';
import { reindexAll, reindexDirty, searchEmailIds } from '../services/searchService';

export const emailRouter = Router();
emailRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

const scheduleSchema = z.object({
  senderId: z.string().min(1, 'Choose a sender'),
  subject: z.string().trim().min(1, 'Subject is required').max(200),
  body: z.string().trim().min(1, 'Body is required').max(20000),
  recipients: z.array(z.string()).min(1, 'At least one recipient is required').max(MAX_RECIPIENTS),
  startAt: z.string().datetime({ offset: true }),
  minDelayMs: z.number().int().min(0).max(3_600_000),
  hourlyLimit: z.number().int().min(1).max(100_000),
});

const pagingSchema = z.object({
  tab: z.enum(['scheduled', 'sent']).default('scheduled'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
const searchSchema = pagingSchema.extend({ q: z.string().trim().min(1).max(200) });

// Step 1 of composing: read a CSV/text file and report what was found. Nothing is saved yet.
emailRouter.post('/parse', requireCsrf, upload.single('file'), (req, res) => {
  const file = req.file;
  if (!file) {
    throw new HttpError(400, 'file_required', 'Upload a .csv or .txt file in the "file" field');
  }
  const name = file.originalname.toLowerCase();
  if (!name.endsWith('.csv') && !name.endsWith('.txt')) {
    throw new HttpError(400, 'bad_file_type', 'Only .csv and .txt files are supported');
  }

  let result;
  try {
    result = parseRecipientFile(file.buffer.toString('utf8'));
  } catch (error) {
    throw new HttpError(400, 'invalid_file', (error as Error).message);
  }
  if (result.validEmails.length > MAX_RECIPIENTS) {
    throw new HttpError(400, 'too_many_recipients', `A file can contain at most ${MAX_RECIPIENTS} addresses`);
  }

  res.json({
    data: {
      validCount: result.validEmails.length,
      validEmails: result.validEmails,
      duplicateCount: result.duplicateCount,
      invalidCount: result.invalidRows.length,
      invalidRows: result.invalidRows.slice(0, 50), // enough to show the user what to fix
    },
  });
});

// Step 2: schedule. One DB row + one BullMQ delayed job per recipient.
emailRouter.post(
  '/',
  requireCsrf,
  asyncHandler(async (req, res) => {
    const input = scheduleSchema.parse(req.body);
    const result = await scheduleBatch(currentUserId(req), { ...input, startAt: new Date(input.startAt) });
    res.status(result.alreadyScheduled ? 200 : 201).json({ data: result });
  }),
);

emailRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { tab, page, pageSize } = pagingSchema.parse(req.query);
    res.json({ data: await listEmails(currentUserId(req), tab, page, pageSize) });
  }),
);

// Elasticsearch finds the ids, then PostgreSQL provides the fresh data (and re-checks ownership).
emailRouter.get(
  '/search',
  asyncHandler(async (req, res) => {
    const { q, tab, page, pageSize } = searchSchema.parse(req.query);
    const userId = currentUserId(req);

    let found;
    try {
      found = await searchEmailIds(userId, q, tab, page, pageSize);
    } catch (error) {
      console.warn('[search] Elasticsearch unavailable:', (error as Error).message);
      throw new HttpError(503, 'search_unavailable', 'Search is temporarily unavailable. Your emails are safe.');
    }

    const rows = await prisma.email.findMany({ where: { id: { in: found.ids }, userId }, include: emailInclude });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const items = found.ids
      .map((id) => byId.get(id))
      .filter((row): row is EmailWithBatch => row !== undefined)
      .map(toEmailDto);
    res.json({ data: { items, page, pageSize, total: found.total } });
  }),
);

// Recovery: rebuild the search index for the logged-in user's emails from PostgreSQL.
emailRouter.post(
  '/search/reindex',
  requireCsrf,
  asyncHandler(async (req, res) => {
    try {
      await reindexDirty();
      const reindexed = await reindexAll(currentUserId(req));
      res.json({ data: { reindexed } });
    } catch (error) {
      throw new HttpError(503, 'search_unavailable', `Reindex failed: ${(error as Error).message}`);
    }
  }),
);

emailRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const email = await prisma.email.findFirst({
      where: { id: String(req.params.id), userId: currentUserId(req) },
      include: emailInclude,
    });
    if (!email) {
      throw new HttpError(404, 'not_found', 'Email not found');
    }
    res.json({ data: { ...toEmailDto(email), body: email.batch.body } });
  }),
);
