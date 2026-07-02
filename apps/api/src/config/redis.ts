// apps/api/src/config/redis.ts

import Redis from 'ioredis';
import { env } from './env';
import { logger } from '../common/logging/logger';

/**
 * Redis Connection Configuration
 *
 * PURPOSE:
 * - Cache frequently-accessed data (products, customer profiles)
 * - Backing store for BullMQ background job queues
 * - Session storage (optional, currently not used)
 *
 * TWO INSTANCES:
 * 1. redisCacheClient - Primary cache operations
 * 2. queueConnectionConfig - BullMQ queue driver
 *
 * Both use the same REDIS_URL but configured differently
 * ============================================================================
 */

const redisOptions = {
  maxRetriesPerRequest: null, // CRITICAL: Required by BullMQ
  enableReadyCheck: true,
  enableOfflineQueue: true,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  reconnectOnError: (err: Error) => {
    const targetError = 'READONLY';
    if (err.message.startsWith(targetError)) {
      return true; // Reconnect on READONLY errors
    }
    return false;
  },
};

/**
 * Primary Redis client for caching operations
 */
export const redisCacheClient = new Redis(env.REDIS_URL, redisOptions);

/**
 * Queue connection configuration for BullMQ
 * Extracted from REDIS_URL for BullMQ compatibility
 */
const redisUrl = new URL(env.REDIS_URL);

export const queueConnectionConfig = {
  host: redisUrl.hostname || 'localhost',
  port: parseInt(redisUrl.port || '6379', 10),
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  db: parseInt(redisUrl.pathname.slice(1) || '0', 10),
  tls: redisUrl.protocol === 'rediss:' ? {} : undefined,
  maxRetriesPerRequest: null,
};

/**
 * Event listeners for connection monitoring
 */
redisCacheClient.on('connect', () => {
  logger.info('✅ Redis cache client connected');
});

redisCacheClient.on('error', (error: Error) => {
  logger.error('❌ Redis cache client error', {
    error: error.message,
  });
});

redisCacheClient.on('reconnecting', () => {
  logger.warn('🔄 Redis cache client reconnecting...');
});

/**
 * Graceful shutdown
 */
export async function closeRedis(): Promise<void> {
  try {
    await redisCacheClient.quit();
    logger.info('✅ Redis connection closed');
  } catch (error) {
    logger.error('Error closing Redis connection', { error });
  }
}
