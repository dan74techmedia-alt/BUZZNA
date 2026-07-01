// apps/api/src/workers/audit-pruning.worker.ts

import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis';
import { db } from '../db/client';
import { logger } from '../common/logging/logger';

async function processAuditPruning(job: Job): Promise<void> {
  try {
    // Archive audit logs older than 90 days
    const cutoffDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const result = await db
      .updateTable('audit_logs' as any)
      .set({
        status: 'archived',
      })
      .where('created_at', '<', cutoffDate)
      .where('status', '!=', 'archived')
      .execute();

    const count = result.numUpdatedRows || 0;

    logger.info('Audit logs archived', {
      count,
      cutoffDate: cutoffDate.toISOString(),
    });
  } catch (error) {
    logger.error('Audit pruning job failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export const auditPruningWorker = new Worker(
  'buzzna:audit-pruning',
  processAuditPruning,
  {
    connection: redis,
    concurrency: 1,
  }
);

export default auditPruningWorker;