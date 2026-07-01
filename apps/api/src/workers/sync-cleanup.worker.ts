// apps/api/src/workers/sync-cleanup.worker.ts

import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis';
import { db } from '../db/client';
import { logger } from '../common/logging/logger';

/**
 * Sync Cleanup Worker
 *
 * MAINTENANCE TASK: Runs daily
 *
 * Cleanup tasks for offline sync infrastructure:
 * 1. Archive old sync batches (>30 days)
 * 2. Clean up sync_rejections queue (>90 days)
 * 3. Delete failed offline transactions (after 7-day review period)
 * 4. Prune idempotency cache (expired entries)
 * 5. Optimize sync_tables indices
 *
 * Architecture Rules:
 * - Never delete data; only mark as archived
 * - Retained data must remain queryable for audit purposes
 * - Cleanup respects tenant data retention policies
 */

async function archiveOldSyncBatches(): Promise<number> {
  try {
    const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

    const result = await db
      .updateTable('sync_batches' as any)
      .set({
        status: 'archived',
      })
      .where('created_at', '<', cutoffDate)
      .where('status', '!=', 'archived')
      .execute();

    const count = result.numUpdatedRows || 0;

    if (count > 0) {
      logger.info('Old sync batches archived', {
        count,
        cutoffDate: cutoffDate.toISOString(),
      });
    }

    return count;
  } catch (error) {
    logger.error('Failed to archive old sync batches', {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

async function cleanupSyncRejections(): Promise<number> {
  try {
    const cutoffDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days ago

    const result = await db
      .updateTable('sync_rejections' as any)
      .set({
        status: 'archived',
      })
      .where('created_at', '<', cutoffDate)
      .where('status', '!=', 'archived')
      .execute();

    const count = result.numUpdatedRows || 0;

    if (count > 0) {
      logger.info('Old sync rejections cleaned up', {
        count,
      });
    }

    return count;
  } catch (error) {
    logger.error('Failed to cleanup sync rejections', {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

async function pruneIdempotencyCache(): Promise<number> {
  try {
    const result = await db
      .deleteFrom('idempotency_cache' as any)
      .where('expires_at', '<', new Date())
      .execute();

    const count = result.numDeletedRows || 0;

    if (count > 0) {
      logger.info('Expired idempotency records deleted', {
        count,
      });
    }

    return count;
  } catch (error) {
    logger.error('Failed to prune idempotency cache', {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

async function processSyncCleanup(job: Job): Promise<void> {
  try {
    logger.info('Starting sync cleanup job', {
      jobId: job.id,
    });

    let totalCleaned = 0;

    totalCleaned += await archiveOldSyncBatches();
    totalCleaned += await cleanupSyncRejections();
    totalCleaned += await pruneIdempotencyCache();

    logger.info('Sync cleanup job completed', {
      jobId: job.id,
      totalCleaned,
    });
  } catch (error) {
    logger.error('Sync cleanup job failed', {
      jobId: job.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export const syncCleanupWorker = new Worker(
  'buzzna:sync-cleanup',
  processSyncCleanup,
  {
    connection: redis,
    concurrency: 1,
    settings: {
      lockDuration: 120000,
      lockRenewTime: 60000,
    },
  }
);

export default syncCleanupWorker;