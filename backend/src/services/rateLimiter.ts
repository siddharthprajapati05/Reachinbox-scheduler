import { redis } from '../redis';

/**
 * SLOT BOOKING (the heart of rate limiting)
 * -----------------------------------------
 * Every sender has one Redis sorted set: member = email id, score = the time (ms) that email
 * is allowed to be sent. Before sending, a worker asks Redis for a slot. One Lua script does,
 * atomically (no other worker can run in between):
 *
 *   1. Forget slots older than one hour (they no longer count towards the hourly limit).
 *   2. If this email already has a slot, return it. This makes retries safe: a retry never
 *      uses up a second unit of hourly capacity.
 *   3. Otherwise pick a new slot = the LATEST of
 *        a) now
 *        b) last booked slot + minDelay          (minimum gap between sends of this sender)
 *        c) the time the hourly window frees up: if `limit` slots already exist, the
 *           "limit-th newest" slot + 1 hour.     (never more than `limit` sends per rolling hour)
 *   4. Save the slot and return it.
 *
 * The worker then either sends now (slot <= now) or moves the job to the delayed set until the
 * slot. Nothing is dropped, jobs get consecutive slots so the original order is kept, and
 * there is no tight retry loop because every delayed job already knows its exact wake-up time.
 *
 * Time comes from Redis (TIME), not from the worker, so workers with different clocks agree.
 */
const RESERVE_SLOT_SCRIPT = `
local key = KEYS[1]
local emailId = ARGV[1]
local hourlyLimit = tonumber(ARGV[2])
local minDelayMs = tonumber(ARGV[3])
local HOUR = 3600000

local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - HOUR)

local existing = redis.call('ZSCORE', key, emailId)
if existing then
  return { tonumber(existing), now, 0 }
end

local slot = now
local last = redis.call('ZREVRANGE', key, 0, 0, 'WITHSCORES')
if #last > 0 then
  slot = math.max(slot, tonumber(last[2]) + minDelayMs)
end

local limitReached = 0
if redis.call('ZCARD', key) >= hourlyLimit then
  limitReached = 1
  local boundary = redis.call('ZREVRANGE', key, hourlyLimit - 1, hourlyLimit - 1, 'WITHSCORES')
  slot = math.max(slot, tonumber(boundary[2]) + HOUR)
end

redis.call('ZADD', key, slot, emailId)
redis.call('PEXPIRE', key, (slot - now) + 2 * HOUR)
return { slot, now, limitReached }
`;

const slotKey = (senderId: string): string => `ratelimit:sender:${senderId}`;

export interface SlotResult {
  slotAt: number; // when the email may be sent (ms since epoch, Redis clock)
  waitMs: number; // 0 means "send now"
  limitReached: boolean; // true when the hourly limit was full while booking this email
}

export async function reserveSlot(
  senderId: string,
  emailId: string,
  hourlyLimit: number,
  minDelayMs: number,
): Promise<SlotResult> {
  const [slotAt, nowAt, limitReached] = (await redis.eval(
    RESERVE_SLOT_SCRIPT,
    1,
    slotKey(senderId),
    emailId,
    hourlyLimit,
    minDelayMs,
  )) as [number, number, number];

  return { slotAt, waitMs: Math.max(0, slotAt - nowAt), limitReached: limitReached === 1 };
}

// Give the capacity back when an email fails for good, so it does not block other emails.
export async function releaseSlot(senderId: string, emailId: string): Promise<void> {
  await redis.zrem(slotKey(senderId), emailId);
}
