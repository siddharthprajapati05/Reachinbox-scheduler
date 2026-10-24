// combined.ts — Runs both the API server and the BullMQ worker in the same process.
// Used for free-tier hosting (e.g. Render free web service) where only one process is allowed.
import { DelayedError, Job, Worker } from 'bullmq';
import { config } from './config.js';
import { prisma } from './db.js';
import { redis } from './redis.js';
import { EMAIL_QUEUE_NAME, EmailJobData } from './services/emailQueue.js';
import { processEmail } from './services/emailProcessor.js';

// Start the worker inline
const worker = new Worker<EmailJobData>(
  EMAIL_QUEUE_NAME,
  async (job: Job<EmailJobData>, token?: string) => {
    const maxAttempts = job.opts.attempts ?? 1;
    const outcome = await processEmail(job.data.emailId, { isLastAttempt: job.attemptsMade + 1 >= maxAttempts });

    if (outcome.kind === 'delayed') {
      await job.moveToDelayed(Date.now() + outcome.delayMs, token);
      throw new DelayedError();
    }
  },
  { connection: redis, concurrency: config.WORKER_CONCURRENCY },
);

worker.on('completed', (job) => console.log(`[worker] job ${job.id} completed`));
worker.on('failed', (job, error) =>
  console.error(`[worker] job ${job?.id} failed (attempt ${job?.attemptsMade}): ${error.message}`),
);
worker.on('error', (error) => console.error('[worker] error:', error.message));
console.log(`[worker] started inline, concurrency=${config.WORKER_CONCURRENCY}`);

// Now import and start the API server (server.ts handles its own app.listen)
import('./server.js').catch((error) => {
  console.error('[combined] failed to start API server:', error);
  process.exit(1);
});

async function shutdown(): Promise<void> {
  console.log('[combined] shutting down...');
  await worker.close();
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
