// apps/api/src/workers/index.ts

import { logger } from '../common/logging/logger';
import { queues } from '../config/queues';
import { initBillingRemindersWorker } from './billing-reminders.worker';
import { initMerchantReconciliationWorker } from './merchant-reconciliation.worker';
import { initProjectionRebuildWorker } from './projection-rebuild.worker';
import { initReportExporterWorker } from './report-exporter.worker';

/**
 * ============================================================================
 * BUZZNA D74 - Background Workers System
 * ============================================================================
 *
 * PURPOSE:
 * - Offload long-running tasks from HTTP request handlers
 * - Process asynchronous jobs using Redis-backed queues (BullMQ)
 * - Handle billing reminders, merchant reconciliation, reporting
 * - Provide automatic retry logic and dead-letter queues
 *
 * WORKERS MANAGED:
 * 1. Billing Reminders - Sends expiration warnings (daily)
 * 2. Merchant Reconciliation - Matches Daraja M-Pesa payments (hourly)
 * 3. Projection Rebuild - Recalculates inventory from events (on-demand)
 * 4. Report Exporter - Generates CSV/PDF exports (on-demand)
 *
 * ARCHITECTURE:
 * - Each worker runs in separate process/thread (scalable)
 * - Jobs stored in Redis (persistent across restarts)
 * - Automatic retry with exponential backoff
 * - Dead-letter queue for failed jobs (manual review)
 *
 * ============================================================================
 */

let workers: NodeJS.Timeout[] = [];

/**
 * Initialize all background workers
 * Called during server bootstrap (server.ts)
 */
export async function initializeWorkers(): Promise<void> {
  try {
    logger.info('🚀 Initializing background workers...');

    // Initialize individual worker processors
    await initBillingRemindersWorker();
    await initMerchantReconciliationWorker();
    await initProjectionRebuildWorker();
    await initReportExporterWorker();

    logger.info('✅ All background workers initialized');
  } catch (error) {
    logger.error('Failed to initialize workers', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Schedule recurring jobs
 * Called after workers are initialized
 */
export async function scheduleRecurringJobs(): Promise<void> {
  try {
    logger.info('📅 Scheduling recurring jobs...');

    // Schedule billing reminders to run daily at 2 AM
    await queues.billingReminders.add(
      'daily-reminders',
      {},
      {
        repeat: {
          pattern: '0 2 * * *', // Every day at 2 AM
        },
      }
    );

    // Schedule merchant reconciliation every hour
    await queues.merchantReconciliation.add(
      'hourly-reconciliation',
      {},
      {
        repeat: {
          pattern: '0 * * * *', // Every hour
        },
      }
    );

    logger.info('✅ Recurring jobs scheduled');
  } catch (error) {
    logger.error('Failed to schedule recurring jobs', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Shutdown all workers gracefully
 * Called during server shutdown
 */
export async function shutdownWorkers(): Promise<void> {
  try {
    logger.info('🛑 Shutting down workers...');

    // Close all queue instances
    await Promise.all([
      queues.billingReminders.close(),
      queues.merchantReconciliation.close(),
      queues.projectionRebuild.close(),
      queues.reportExporter.close(),
    ]);

    logger.info('✅ All workers shut down');
  } catch (error) {
    logger.error('Error during worker shutdown', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
