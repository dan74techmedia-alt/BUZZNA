// apps/api/src/workers/index.ts

import { logger } from '../common/logging/logger';
import { billingRemindersWorker } from './billing-reminders.worker';
import { merchantReconciliationWorker } from './merchant-reconciliation.worker';
import { projectionRebuildWorker } from './projection-rebuild.worker';
import { reportExporterWorker } from './report-exporter.worker';
import { syncCleanupWorker } from './sync-cleanup.worker';
import { notificationWorker } from './notification.worker';
import { licenseExpiryWorker } from './license-expiry.worker';
import { cacheRefreshWorker } from './cache-refresh.worker';
import { auditPruningWorker } from './audit-pruning.worker';
import { analyticsRefreshWorker } from './analytics-refresh.worker';
import { staleStockWorker } from './stale-stock.worker';
import { customerAgingWorker } from './customer-aging.worker';
import { queues, initializeQueueListeners } from '../config/queues';

/**
 * All active workers
 */
export const workers = {
  billingReminders: billingRemindersWorker,
  merchantReconciliation: merchantReconciliationWorker,
  projectionRebuild: projectionRebuildWorker,
  reportExporter: reportExporterWorker,
  syncCleanup: syncCleanupWorker,
  notifications: notificationWorker,
  licenseExpiry: licenseExpiryWorker,
  cacheRefresh: cacheRefreshWorker,
  auditPruning: auditPruningWorker,
  analyticsRefresh: analyticsRefreshWorker,
  staleStock: staleStockWorker,
  customerAging: customerAgingWorker,
};

/**
 * Initialize all workers
 */
export async function initializeWorkers(): Promise<void> {
  try {
    logger.info('Initializing background workers...');

    // Initialize queue listeners
    await initializeQueueListeners();

    // All workers auto-initialize on import
    logger.info('Background workers initialized', {
      workerCount: Object.keys(workers).length,
    });
  } catch (error) {
    logger.error('Failed to initialize workers', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Schedule recurring jobs
 */
export async function scheduleRecurringJobs(): Promise<void> {
  try {
    // Billing reminders every 6 hours
    await queues.billingReminders.add(
      'check-all',
      { checkAllTenants: true },
      {
        repeat: {
          every: 6 * 60 * 60 * 1000,
        },
        jobId: 'billing-check-recurring',
      }
    );

    // Merchant reconciliation every 30 minutes
    await queues.merchantReconciliation.add(
      'reconcile',
      {},
      {
        repeat: {
          every: 30 * 60 * 1000,
        },
        jobId: 'merchant-reconcile-recurring',
      }
    );

    // Projection rebuild every 4 hours
    await queues.projectionRebuild.add(
      'rebuild-all',
      {},
      {
        repeat: {
          every: 4 * 60 * 60 * 1000,
        },
        jobId: 'projection-rebuild-recurring',
      }
    );

    // Analytics refresh every 6 hours
    await queues.analyticsRefresh.add(
      'refresh',
      {},
      {
        repeat: {
          every: 6 * 60 * 60 * 1000,
        },
        jobId: 'analytics-refresh-recurring',
      }
    );

    // License expiry check daily
    await queues.licenseExpiry.add(
      'check',
      {},
      {
        repeat: {
          every: 24 * 60 * 60 * 1000,
        },
        jobId: 'license-expiry-recurring',
      }
    );

    // Sync cleanup daily
    await queues.syncCleanup.add(
      'cleanup',
      {},
      {
        repeat: {
          every: 24 * 60 * 60 * 1000,
        },
        jobId: 'sync-cleanup-recurring',
      }
    );

    // Audit pruning weekly
    await queues.auditPruning.add(
      'prune',
      {},
      {
        repeat: {
          every: 7 * 24 * 60 * 60 * 1000,
        },
        jobId: 'audit-pruning-recurring',
      }
    );

    // Stale stock detection daily
    await queues.staleStock.add(
      'detect',
      {},
      {
        repeat: {
          every: 24 * 60 * 60 * 1000,
        },
        jobId: 'stale-stock-recurring',
      }
    );

    // Customer aging daily
    await queues.customerAging.add(
      'analyze',
      {},
      {
        repeat: {
          every: 24 * 60 * 60 * 1000,
        },
        jobId: 'customer-aging-recurring',
      }
    );

    logger.info('Recurring jobs scheduled');
  } catch (error) {
    logger.error('Failed to schedule recurring jobs', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Graceful shutdown
 */
export async function shutdownWorkers(): Promise<void> {
  try {
    logger.info('Shutting down background workers...');

    await Promise.all(
      Object.values(workers).map((worker) =>
        worker.close().catch((error) => {
          logger.error('Error closing worker', {
            error: error instanceof Error ? error.message : String(error),
          });
        })
      )
    );

    logger.info('All workers closed');
  } catch (error) {
    logger.error('Failed to shutdown workers', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export default workers;