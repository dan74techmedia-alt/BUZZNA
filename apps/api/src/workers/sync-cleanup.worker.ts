/**
 * ============================================================================
 * BUZZNA D74 - Sync Cleanup Worker
 * ============================================================================
 *
 * PURPOSE:
 * - Archive old sync batches (older than 30 days)
 * - Clean up rejected events for audit compliance
 * - Maintain database size and query performance
 *
 * SCHEDULED: Runs daily
 *
 * ============================================================================
 */

import { Worker, Job } from 'bullmq';
import { db } from '../config/database';
import { queueConnectionConfig } from '../config/redis';
import { logger } from '../common/logging/logger';

async function processSyncCleanup(job: Job): Promise<void> {
  try {
    logger.info('Starting sync cleanup job', { jobId: job.id });

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Archive old sync batches
    const archivedCount = await db
      .updateTable('sync_batches')
      .set({ archived_at: new Date() })
      .where('created_at', '<', thirtyDaysAgo)
      .where('archived_at', 'is', null)
      .execute();

    logger.info('Sync cleanup job completed', {
      jobId: job.id,
      archivedBatches: archivedCount,
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
    connection: queueConnectionConfig,
    concurrency: 1,
  }
);

export default syncCleanupWorker;