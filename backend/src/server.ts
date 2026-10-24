import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import RedisStore from 'connect-redis';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import helmet from 'helmet';
import multer from 'multer';
import { ZodError } from 'zod';
import { config } from './config';
import { prisma } from './db';
import { MAX_RECIPIENTS } from './lib/emailParser';
import { HttpError } from './lib/httpError';
import { requireAdmin, requireAuth } from './middleware/auth';
import { redis } from './redis';
import { authRouter } from './routes/authRoutes';
import { emailRouter } from './routes/emailRoutes';
import { senderRouter } from './routes/senderRoutes';
import { slackRouter } from './routes/slackRoutes';
import { emailQueue, enqueueUnqueuedEmails } from './services/emailQueue';
import { reindexDirty } from './services/searchService';

const app = express();

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false })); // CSP off so the Bull Board UI can load; this server only serves JSON + Bull Board
const allowedOrigins = [
  config.FRONTEND_URL,
  'http://localhost:5173',
  'https://reachinbox-scheduler-wheat.vercel.app',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) callback(null, true);
    else callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));

// Sessions live in Redis, so users stay logged in when the API restarts.
app.use(
  session({
    store: new RedisStore({ client: redis, prefix: 'sess:' }),
    name: 'sid',
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: config.isProduction ? 'none' : 'lax', // 'none' required for cross-site cookies in production
      secure: config.isProduction,                      // HTTPS only in production
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);

// Protects the API itself from abuse (not the same thing as the email sending limits).
app.use('/api', rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false }));
app.use('/api/auth', rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }));

app.get('/api/health', (_req, res) => {
  res.json({ data: { status: 'ok' } });
});

app.get('/api/settings', requireAuth, (_req, res) => {
  res.json({
    data: {
      defaultMinDelayMs: config.MIN_DELAY_MS,
      maxHourlyLimit: config.MAX_EMAILS_PER_HOUR_PER_SENDER,
      maxRecipients: MAX_RECIPIENTS,
      slackConfigured: config.slackEnabled,
    },
  });
});

app.use('/api/auth', authRouter);
app.use('/api/senders', senderRouter);
app.use('/api/emails', emailRouter);
app.use('/api/slack', slackRouter);

// Bull Board: live view of the REAL email queue. Admin only, read-only, and jobs only contain an email id.
const bullBoardAdapter = new ExpressAdapter();
bullBoardAdapter.setBasePath('/admin/queues');
createBullBoard({ queues: [new BullMQAdapter(emailQueue, { readOnlyMode: true })], serverAdapter: bullBoardAdapter });
app.use('/admin/queues', requireAdmin, bullBoardAdapter.getRouter());

app.use((_req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: 'Route not found' } });
});

// One place that turns errors into consistent JSON responses.
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details } });
  } else if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'validation_error',
        message: 'Invalid request',
        details: error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
      },
    });
  } else if (error instanceof multer.MulterError) {
    res.status(400).json({ error: { code: 'upload_error', message: error.message } });
  } else if (error instanceof SyntaxError) {
    res.status(400).json({ error: { code: 'invalid_json', message: 'Request body is not valid JSON' } });
  } else {
    console.error('[api] unexpected error:', error);
    res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong' } });
  }
});

async function start(): Promise<void> {
  await prisma.$connect();

  // Restart recovery: add jobs ONLY for rows whose job was never confirmed (not the whole queue).
  const recovered = await enqueueUnqueuedEmails();
  if (recovered > 0) console.log(`[api] re-queued ${recovered} emails that had no job yet`);

  // Retry search indexing that failed earlier. Not awaited: Elasticsearch being down must not block startup.
  reindexDirty().catch((error) => console.warn('[search] startup reindex skipped:', error.message));

  app.listen(config.PORT, () => {
    console.log(`[api] listening on ${config.BACKEND_URL}`);
    console.log(`[api] Bull Board: ${config.BACKEND_URL}/admin/queues (admin login required)`);
  });
}

start().catch((error) => {
  console.error('[api] failed to start:', error);
  process.exit(1);
});
