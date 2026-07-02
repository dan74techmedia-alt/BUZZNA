// apps/api/src/config/queues.ts

import { Queue } from 'bullmq';
import { queueConnectionConfig } from './redis';
import { logger } from '../common/logging/logger';

/**
 * BullMQ Queue Configuration & Registration
 *
 * MANAGES ALL BACKGROUND JOB QUEUES
 *
 * The BuzzNa system offloads long-running tasks to Redis-backed job queues:
 * 1. Billing reminders (subscription expiration alerts)
 * 2. Merchant reconciliation (matching Daraja M-Pesa payments)
 * 3. Inventory projection rebuild (recalculating stock from event log)
 * 4. Report generation & export (async PDF/CSV compilation)
 *
 * Architecture Rules:
 * - All queues use Redis as backing store
 * - Jobs are transactional (idempotent, no duplicates)
 * - Failed jobs are automatically retried with exponential backoff
 * - Queue names are prefixed with 'buzzna:' for organization
 * - Each queue has dedicated worker processor
 *
 * ============================================================================
 */

export const queues = {
  /**
   * Billing Reminders Queue
   * Handles subscription expiration warnings and license enforcement
   */
  billingReminders: new Queue('buzzna:billing-reminders', {
    connection: queueConnectionConfig,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: { age: 7 * 24 * 60 * 60 }, // 7 days
    },
  }),

  /**
   * Merchant Reconciliation Queue
   * Matches unmatched M-Pesa payments to sales transactions
   * More retries needed for payment reliability
   */
  merchantReconciliation: new Queue('buzzna:merchant-reconciliation', {
    connection: queueConnectionConfig,
    defaultJobOptions: {
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 10000,
      },
      removeOnComplete: { age: 30 * 24 * 60 * 60 }, // 30 days
    },
  }),

  /**
   * Projection Rebuild Queue
   * Recalculates inventory projections from event ledger
   * Critical for data integrity
   */
  projectionRebuild: new Queue('buzzna:projection-rebuild', {
    connection: queueConnectionConfig,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: { age: 24 * 60 * 60 }, // 1 day
    },
  }),

  /**
   * Report Exporter Queue
   * Generates CSV/PDF financial reports
   */
  reportExporter: new Queue('buzzna:report-exporter', {
    connection: queueConnectionConfig,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 10000,
      },
      removeOnComplete: { age: 30 * 24 * 60 * 60 }, // 30 days
    },
  }),
};

/**
 * Check health of all queues
 */
export async function checkQueuesHealth(): Promise<{
  healthy: boolean;
  queues: Record<string, { count: number; failed: number }>;
}> {
  try {
    const health: Record<string, { count: number; failed: number }> = {};

    for (const [name, queue] of Object.entries(queues)) {
      const count = await queue.count();
      const failed = await queue.getFailedCount();
      health[name] = { count, failed };
    }

    logger.info('Queue health check', health);
    return { healthy: true, queues: health };
  } catch (error) {
    logger.error('Queue health check failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { healthy: false, queues: {} };
  }
}
