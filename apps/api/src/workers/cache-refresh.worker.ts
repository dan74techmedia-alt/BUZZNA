// apps/api/src/workers/cache-refresh.worker.ts

import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis';
import { logger } from '../common/logging/logger';
import { invalidateCache } from '../common/middleware/cache.middleware';

interface CacheRefreshJob {
  tenantId: string;
  pattern?: string;
}

async function processCacheRefresh(job: Job<CacheRefreshJob>): Promise<void> {
  try {
    await invalidateCache(job.data.tenantId, job.data.pattern);

    logger.info('Cache refreshed', {
      tenantId: job.data.tenantId,
      pattern: job.data.pattern,
    });
  } catch (error) {
    logger.error('Cache refresh job failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export const cacheRefreshWorker = new Worker(
  'buzzna:cache-refresh',
  processCacheRefresh,
  {
    connection: redis,
    concurrency: 5,
  }
);

export default cacheRefreshWorker;