// apps/api/src/config/redis.ts

import Redis, { RedisOptions } from 'ioredis';
import { env } from '../bootstrap/load-env';
import { logger } from '../common/logging/logger';

const redisOptions: RedisOptions = {
  maxRetriesPerRequest: null, // Critical requirement for BullMQ integration
  enableReadyCheck: true,
  reconnectOnError: (err) => {
    const targetError = 'READONLY';
    if (err.message.slice(0, targetError.length) === targetError) {
      return true;
    }
    return false;
  },
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
};

// Authoritative shared connection instance for primary application cache operations
export const redisCacheClient = new Redis(env.REDIS_URL, redisOptions);

// Separate connection instance optimized specifically as a BullMQ driver to prevent blocking command collision
export const queueConnectionConfig = {
  host: new URL(env.REDIS_URL).hostname,
  port: parseInt(new URL(env.REDIS_URL).port || '6379', 10),
  username: new URL(env.REDIS_URL).username || undefined,
  password: new URL(env.REDIS_URL).password || undefined,
  tls: new URL(env.REDIS_URL).protocol === 'rediss:' ? {} : undefined,
  ...redisOptions
};

redisCacheClient.on('connect', () => {
  logger.info('Asynchronous memory fabric connection initialized successfully via ioredis.');
});

redisCacheClient.on('error', (error: Error) => {
  logger.error('Critical failure detected in system asynchronous Redis cache client:', error);
});