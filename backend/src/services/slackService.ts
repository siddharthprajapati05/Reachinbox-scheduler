import { prisma } from '../db';
import { config } from '../config';
import { decrypt, encrypt } from '../lib/crypto';
import { redis } from '../redis';

const SLACK_AUTHORIZE_URL = 'https://slack.com/oauth/v2/authorize';
const SLACK_ACCESS_URL = 'https://slack.com/api/oauth.v2.access';
const SLACK_REVOKE_URL = 'https://slack.com/api/auth.revoke';

// The only permission we ask for: post messages to ONE channel the user picks on Slack's consent screen.
const SLACK_SCOPE = 'incoming-webhook';

export function buildSlackAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.SLACK_CLIENT_ID ?? '',
    scope: SLACK_SCOPE,
    redirect_uri: config.SLACK_REDIRECT_URL ?? '',
    state,
  });
  return `${SLACK_AUTHORIZE_URL}?${params.toString()}`;
}

interface SlackAccessResponse {
  ok: boolean;
  error?: string;
  access_token?: string;
  team?: { name?: string };
  incoming_webhook?: { url: string; channel: string };
}

// Called from the OAuth callback: swaps the temporary "code" for the real credentials and stores them encrypted.
export async function connectSlack(userId: string, code: string): Promise<void> {
  const response = await fetch(SLACK_ACCESS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.SLACK_CLIENT_ID ?? '',
      client_secret: config.SLACK_CLIENT_SECRET ?? '',
      code,
      redirect_uri: config.SLACK_REDIRECT_URL ?? '',
    }),
  });
  const data = (await response.json()) as SlackAccessResponse;
  if (!data.ok || !data.incoming_webhook) {
    throw new Error(`Slack OAuth failed: ${data.error ?? 'no webhook returned'}`);
  }

  const values = {
    teamName: data.team?.name ?? 'Slack workspace',
    channelName: data.incoming_webhook.channel,
    webhookUrlEncrypted: encrypt(data.incoming_webhook.url),
    accessTokenEncrypted: data.access_token ? encrypt(data.access_token) : null,
  };
  await prisma.slackConnection.upsert({ where: { userId }, update: values, create: { userId, ...values } });
}

export async function getSlackStatus(userId: string) {
  const connection = await prisma.slackConnection.findUnique({ where: { userId } });
  return {
    configured: config.slackEnabled,
    connected: Boolean(connection),
    teamName: connection?.teamName ?? null,
    channelName: connection?.channelName ?? null,
  };
}

export async function disconnectSlack(userId: string): Promise<void> {
  const connection = await prisma.slackConnection.findUnique({ where: { userId } });
  if (!connection) return;

  // Best effort: tell Slack to invalidate the token. We delete our copy even if this call fails.
  if (connection.accessTokenEncrypted) {
    try {
      await fetch(SLACK_REVOKE_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${decrypt(connection.accessTokenEncrypted)}` },
      });
    } catch (error) {
      console.warn('[slack] could not revoke token:', (error as Error).message);
    }
  }
  await prisma.slackConnection.delete({ where: { userId } });
}

export interface LimitAlert {
  userId: string;
  senderId: string;
  senderEmail: string;
  hourlyLimit: number;
  resumeAt: Date;
}

// Sends a real Slack message when a sender's hourly limit is full. NEVER throws, so sending continues
// even if Slack is disconnected or down.
// Deduplication: at most one alert per sender per hour (Redis SET ... NX EX), not one per blocked email.
export async function notifyLimitReached(alert: LimitAlert): Promise<boolean> {
  try {
    const connection = await prisma.slackConnection.findUnique({ where: { userId: alert.userId } });
    if (!connection) return false; // Slack not connected: nothing to do (checked every time, so connecting later just works)

    const dedupeKey = `slack-alert:${alert.senderId}`;
    const firstAlert = await redis.set(dedupeKey, '1', 'EX', 3600, 'NX');
    if (!firstAlert) return false; // already alerted for this sender within the last hour

    const resumeSeconds = Math.floor(alert.resumeAt.getTime() / 1000);
    const text =
      `:warning: *Hourly email limit reached* for sender \`${alert.senderEmail}\` (${alert.hourlyLimit} emails per hour).\n` +
      `Remaining emails are not dropped. They are delayed and sending resumes around ` +
      `<!date^${resumeSeconds}^{date_short_pretty} at {time}|${alert.resumeAt.toISOString()}>.`;

    const response = await fetch(decrypt(connection.webhookUrlEncrypted), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      await redis.del(dedupeKey); // let the next blocked email try again
      console.warn(`[slack] notification failed with HTTP ${response.status}`);
      return false;
    }
    console.log(`[slack] limit alert sent for ${alert.senderEmail}`);
    return true;
  } catch (error) {
    console.warn('[slack] notification error:', (error as Error).message);
    return false;
  }
}
