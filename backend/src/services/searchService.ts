import { Client } from '@elastic/elasticsearch';
import { prisma } from '../db';
import { config } from '../config';
import { redis } from '../redis';

const client = new Client({ node: config.ELASTICSEARCH_URL });
const INDEX = 'emails';
// Ids whose last index attempt failed (for example Elasticsearch was down). Retried by reindexDirty().
const DIRTY_SET = 'search:dirty';

const emailInclude = { batch: { include: { sender: true } } } as const;

let indexReady = false;

// Creates the index with explicit mappings (so userId and status are exact-match "keyword" fields).
async function ensureIndex(): Promise<void> {
  if (indexReady) return;
  const exists = await client.indices.exists({ index: INDEX });
  if (!exists) {
    try {
      await client.indices.create({
        index: INDEX,
        mappings: {
          properties: {
            userId: { type: 'keyword' },
            toEmail: { type: 'text' },
            fromEmail: { type: 'text' },
            subject: { type: 'text' },
            status: { type: 'keyword' },
            scheduledAt: { type: 'date' },
            nextSendAt: { type: 'date' },
            sentAt: { type: 'date' },
            updatedAt: { type: 'date' },
          },
        },
      });
    } catch (error) {
      // Another process created it at the same moment - that is fine.
      if (!String((error as Error).message).includes('resource_already_exists_exception')) throw error;
    }
  }
  indexReady = true;
}

async function indexChunk(ids: string[]): Promise<void> {
  await ensureIndex();
  const rows = await prisma.email.findMany({ where: { id: { in: ids } }, include: emailInclude });
  const operations: object[] = rows.flatMap((row) => [
    // external_gte: an older copy of a document can never overwrite a newer one, even if two updates race.
    { index: { _index: INDEX, _id: row.id, version: row.updatedAt.getTime(), version_type: 'external_gte' } },
    {
      userId: row.userId,
      toEmail: row.toEmail,
      fromEmail: row.batch.sender.email,
      subject: row.batch.subject,
      status: row.status,
      scheduledAt: row.scheduledAt,
      nextSendAt: row.nextSendAt,
      sentAt: row.sentAt,
      updatedAt: row.updatedAt,
    },
  ]);
  if (operations.length === 0) return;

  const response = await client.bulk({ operations, refresh: false });
  if (response.errors) {
    // 409 = "a newer version is already indexed", which is fine.
    const failures = response.items.filter((item) => item.index?.error && item.index.status !== 409);
    if (failures.length > 0) throw new Error(`${failures.length} documents failed to index`);
  }
}

// Copies the latest PostgreSQL state of these emails into Elasticsearch.
// NEVER throws: PostgreSQL is the source of truth, so a search failure must not break sending.
// Returns false (and remembers the ids as "dirty") when Elasticsearch could not be reached.
export async function syncEmailsToSearch(ids: string[]): Promise<boolean> {
  let allOk = true;
  for (let start = 0; start < ids.length; start += 500) {
    const group = ids.slice(start, start + 500);
    try {
      await indexChunk(group);
      await redis.srem(DIRTY_SET, ...group);
    } catch (error) {
      allOk = false;
      console.warn(`[search] indexing failed, will retry later: ${(error as Error).message}`);
      await redis.sadd(DIRTY_SET, ...group).catch(() => undefined);
    }
  }
  return allOk;
}

// Retry everything that failed to index earlier. Runs when the API starts and from the reindex endpoint.
export async function reindexDirty(): Promise<number> {
  let total = 0;
  for (;;) {
    const ids = await redis.spop(DIRTY_SET, 500);
    if (!ids || ids.length === 0) return total;
    const ok = await syncEmailsToSearch(ids); // puts them back into the dirty set if it fails again
    if (!ok) return total;
    total += ids.length;
  }
}

// Full rebuild from PostgreSQL (all users, or just one). Use after wiping Elasticsearch.
export async function reindexAll(userId?: string): Promise<number> {
  let cursor: string | undefined;
  let total = 0;
  for (;;) {
    const rows = await prisma.email.findMany({
      where: userId ? { userId } : {},
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) return total;
    const ok = await syncEmailsToSearch(rows.map((row) => row.id));
    if (!ok) throw new Error('Elasticsearch is not reachable');
    total += rows.length;
    cursor = rows[rows.length - 1].id;
  }
}

export type EmailTab = 'scheduled' | 'sent';

export const TAB_STATUSES = {
  scheduled: ['scheduled', 'processing'],
  sent: ['sent', 'failed'],
} as const;

// Returns matching email ids (already filtered to this user and tab) plus the total hit count.
export async function searchEmailIds(userId: string, text: string, tab: EmailTab, page: number, pageSize: number) {
  await ensureIndex();
  const result = await client.search({
    index: INDEX,
    from: (page - 1) * pageSize,
    size: pageSize,
    track_total_hits: true,
    _source: false,
    query: {
      bool: {
        // filters first: only this user's documents, only the tab's statuses
        filter: [{ term: { userId } }, { terms: { status: [...TAB_STATUSES[tab]] } }],
        must: [
          {
            bool: {
              should: [
                // bool_prefix lets "alice@exa" or "welc" match while the user is still typing
                { multi_match: { query: text, type: 'bool_prefix', fields: ['toEmail', 'fromEmail', 'subject'] } },
                { term: { status: text.toLowerCase() } },
              ],
              minimum_should_match: 1,
            },
          },
        ],
      },
    },
    sort: tab === 'scheduled' ? [{ nextSendAt: 'asc' }] : [{ updatedAt: 'desc' }],
  });

  const total = typeof result.hits.total === 'number' ? result.hits.total : (result.hits.total?.value ?? 0);
  return { ids: result.hits.hits.map((hit) => String(hit._id)), total };
}
