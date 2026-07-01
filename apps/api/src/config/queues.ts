// apps/api/src/config/queues.ts

import { Queue } from 'bullmq';
import { redis } from './redis';
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
 * 5. Sync conflict resolution (LWW merging)
 * 6. License expiry checks (grace period enforcement)
 * 7. Cache refresh (preload frequently-used data)
 * 8. Audit pruning (retain only 90 days of logs)
 * 9. Analytics refresh (rebuild materialized views)
 * 10. Stale stock detection (identify slow-moving inventory)
 * 11. Customer aging reports (debt collection metrics)
 *
 * Architecture Rules:
 * - All queues use Redis as backing store
 * - Jobs are transactional (idempotent, no duplicates)
 * - Failed jobs are automatically retried with exponential backoff
 * - Queue names are prefixed with 'buzzna:' for organization
 * - Each queue has dedicated worker processor
 *
 * Monitoring:
 * - All queue events logged via logger
 * - Failed jobs stored for manual review
 * - Dead-letter queue captures jobs exceeding retry limit
 */

interface QueueConfig {
  defaultJobOptions?: {
    attempts?: number;
    backoff?: {
      type: 'exponential' | 'fixed';
      delay: number;
    };
    removeOnComplete?: boolean | { age?: number };
    removeOnFail?: boolean;
  };
}

/**
 * Queue instances (shared across workers and API)
 */
export const queues = {
  // Billing operations
  billingReminders: new Queue('buzzna:billing-reminders', {
    connection: redis,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: { age: 7 * 24 * 60 * 60 }, // 7 days
    },
  }),

  // Merchant payment reconciliation
  merchantReconciliation: new Queue('buzzna:merchant-reconciliation', {
    connection: redis,
    defaultJobOptions: {
      attempts: 5, // More retries for reconciliation
      backoff: {
        type: 'exponential',
        delay: 10000,
      },
      removeOnComplete: { age: 30 * 24 * 60 * 60 }, // 30 days
    },
  }),

  // Inventory calculations
  projectionRebuild: new Queue('buzzna:projection-rebuild', {
    connection: redis,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: { age: 24 * 60 * 60 }, // 1 day
    },
  }),

  // Report generation
  reportExporter: new Queue('buzzna:report-exporter', {
    connection: redis,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 10000,
      },
      removeOnComplete: { age: 30 * 24 * 60 * 60 }, // 30 days
    },
  }),

  // Sync conflict resolution
  syncConflictResolution: new Queue('buzzna:sync-conflicts', {
    connection: redis,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'fixed',
        delay: 5000,
      },
      removeOnComplete: { age: 7 * 24 * 60 * 60 },
    },
  }),

  // License expiry checks
  licenseExpiry: new Queue('buzzna:license-expiry', {
    connection: redis,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'fixed',
        delay: 5000,
      },
      removeOnComplete: { age: 7 * 24 * 60 * 60 },
    },
  }),

  // Cache refresh
  cacheRefresh: new Queue('buzzna:cache-refresh', {
    connection: redis,
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: 'fixed',
        delay: 3000,
      },
      removeOnComplete: true,
    },
  }),

  // Audit log cleanup
  auditPruning: new Queue('buzzna:audit-pruning', {
    connection: redis,
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: 'fixed',
        delay: 5000,
      },
      removeOnComplete: true,
    },
  }),

  // Analytics materialized view refresh
  analyticsRefresh: new Queue('buzzna:analytics-refresh', {
    connection: redis,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 10000,
      },
      removeOnComplete: { age: 7 * 24 * 60 * 60 },
    },
  }),

  // Stale stock detection
  staleStock: new Queue('buzzna:stale-stock', {
    connection: redis,
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: 'fixed',
        delay: 5000,
      },
      removeOnComplete: { age: 7 * 24 * 60 * 60 },
    },
  }),

  // Customer aging analysis
  customerAging: new Queue('buzzna:customer-aging', {
    connection: redis,
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: 'fixed',
        delay: 5000,
      },
      removeOnComplete: { age: 7 * 24 * 60 * 60 },
    },
  }),

  // Notification delivery
  notifications: new Queue('buzzna:notifications', {
    connection: redis,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: { age: 30 * 24 * 60 * 60 },
    },
  }),

  // Sync cleanup
  syncCleanup: new Queue('buzzna:sync-cleanup', {
    connection: redis,
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: 'fixed',
        delay: 5000,
      },
      removeOnComplete: true,
    },
  }),
};

/**
 * Initialize all queue event listeners
 * Logs job lifecycle events for monitoring
 */
export async function initializeQueueListeners(): Promise<void> {
  try {
    Object.entries(queues).forEach(([queueName, queue]) => {
      // Job added
      queue.on('added', (job) => {
        logger.debug(`Job added to ${queueName}`, {
          jobId: job.id,
          data: job.data,
        });
      });

      // Job started
      queue.on('active', (job) => {
        logger.info(`Job started in ${queueName}`, {
          jobId: job.id,
        });
      });

      // Job completed
      queue.on('completed', (job) => {
        logger.info(`Job completed in ${queueName}`, {
          jobId: job.id,
          duration: job.finishedOn
            ? job.finishedOn - (job.processedOn || 0)
            : undefined,
        });
      });

      // Job failed
      queue.on('failed', (job, error) => {
        logger.error(`Job failed in ${queueName}`, {
          jobId: job?.id,
          attempt: job?.attemptsMade,
          error: error instanceof Error ? error.message : String(error),
        });
      });

      // Job stalled
      queue.on('stalled', (jobId) => {
        logger.warn(`Job stalled in ${queueName}`, {
          jobId,
        });
      });

      // Queue error
      queue.on('error', (error) => {
        logger.error(`Queue error in ${queueName}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });

    logger.info('Queue listeners initialized', {
      queueCount: Object.keys(queues).length,
    });
  } catch (error) {
    logger.error('Failed to initialize queue listeners', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Health check for all queues
 */
export async function checkQueuesHealth(): Promise<{
  healthy: boolean;
  queues: Record<string, { waiting: number; active: number; failed: number }>;
}> {
  try {
    const health: Record<string, any> = {};

    for (const [queueName, queue] of Object.entries(queues)) {
      const counts = await queue.getJobCounts();
      health[queueName] = counts;
    }

    return {
      healthy: Object.values(health).every((q) => q.failed < 100),
      queues: health,
    };
  } catch (error) {
    logger.error('Failed to check queue health', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      healthy: false,
      queues: {},
    };
  }
}

/**
 * Drain all queues (for graceful shutdown)
 */
export async function drainAllQueues(): Promise<void> {
  try {
    await Promise.all(
      Object.values(queues).map((queue) => queue.drain())
    );
    logger.info('All queues drained for shutdown');
  } catch (error) {
    logger.error('Failed to drain queues', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Close all queue connections
 */
export async function closeAllQueues(): Promise<void> {
  try {
    await Promise.all(
      Object.values(queues).map((queue) => queue.close())
    );
    logger.info('All queue connections closed');
  } catch (error) {
    logger.error('Failed to close queues', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export default queues;