import IORedis from 'ioredis';
import { config } from './config';

// One shared connection for BullMQ, sessions and the rate limiter.
// BullMQ requires maxRetriesPerRequest to be null.
export const redis = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });

redis.on('error', (error) => console.error('[redis] connection error:', error.message));
