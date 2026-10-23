import { DelayedError, Job, Worker } from 'bullmq';
import { config } from './config';
import { prisma } from './db';
import { redis } from './redis';
import { EMAIL_QUEUE_NAME, EmailJobData } from './services/emailQueue';
import { processEmail } from './services/emailProcessor';

// The worker is a separate process from the API: `npm run dev:worker`.
// It is event driven (BullMQ wakes a job when its delay is over). There is no cron and no polling loop of ours.
const worker = new Worker<EmailJobData>(
  EMAIL_QUEUE_NAME,
  async (job: Job<EmailJobData>, token?: string) => {
    const maxAttempts = job.opts.attempts ?? 1;
    const outcome = await processEmail(job.data.emailId, { isLastAttempt: job.attemptsMade + 1 >= maxAttempts });

    if (outcome.kind === 'delayed') {
      // Rate limited: park the job until its booked slot. It is NOT a failure and uses no retry attempt.
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

console.log(`[worker] started, concurrency=${config.WORKER_CONCURRENCY}, minDelay default=${config.MIN_DELAY_MS}ms`);

async function shutdown(): Promise<void> {
  console.log('[worker] shutting down...');
  await worker.close(); // lets the running jobs finish
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
