import 'dotenv/config';
import { z } from 'zod';

// All configuration is read and validated once, here. If something is missing we stop with a clear message.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  BACKEND_URL: z.string().url().default('http://localhost:4000'),

  DATABASE_URL: z.string().min(1, 'is required'),
  REDIS_URL: z.string().min(1, 'is required'),
  ELASTICSEARCH_URL: z.string().url('must be a URL such as http://localhost:9200'),

  SESSION_SECRET: z.string().min(32, 'is required (at least 32 characters). Generate one with: openssl rand -hex 32'),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'must be exactly 64 hex characters. Generate one with: openssl rand -hex 32'),

  GOOGLE_CLIENT_ID: z.string().min(1, 'is required (Google Cloud Console OAuth client)'),
  GOOGLE_CLIENT_SECRET: z.string().min(1, 'is required (Google Cloud Console OAuth client)'),

  // Slack is optional: without these the app still runs, only the Connect Slack button is disabled.
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  SLACK_REDIRECT_URL: z.string().optional(),

  ADMIN_EMAILS: z.string().default(''),

  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(5),
  MIN_DELAY_MS: z.coerce.number().int().min(0).default(2000),
  MAX_EMAILS_PER_HOUR_PER_SENDER: z.coerce.number().int().min(1).default(200),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('\nInvalid or missing environment variables:\n');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('\nCopy backend/.env.example to backend/.env and fill in the values.\n');
  process.exit(1);
}

const env = parsed.data;

export const config = {
  ...env,
  isProduction: env.NODE_ENV === 'production',
  adminEmails: env.ADMIN_EMAILS.split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email !== ''),
  slackEnabled: Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET && env.SLACK_REDIRECT_URL),
};
