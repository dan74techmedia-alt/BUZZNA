// apps/api/src/workers/index.ts

import { Worker, WorkerOptions } from 'bullmq';
import { redisConfig } from '../config/redis';
import { logger } from '../common/logging/logger';

// Import individual processor logic from the documented worker files
import { processBillingReminders } from './billing-reminders.worker';
import { processMerchantReconciliation } from './merchant-reconciliation.worker';
import { processProjectionRebuild } from './projection-rebuild.worker';
import { processReportExport } from './report-exporter.worker';

/**
 * Global queue name definitions to ensure strict typing across producers and consumers.
 */
export const QUEUES = {
  BILLING_REMINDERS: 'billing-reminders-queue',
  MERCHANT_RECONCILIATION: 'merchant-reconciliation-queue',
  PROJECTION_REBUILD: 'projection-rebuild-queue',
  REPORT_EXPORTER: 'report-exporter-queue',
} as const;

/**
 * Standardized BullMQ worker parameters optimized for production.
 * Ensures successful jobs are purged to save memory, while failed jobs 
 * are retained for 24 hours for debugging.
 */
const defaultWorkerOptions: Omit<WorkerOptions, 'connection'> = {
  concurrency: 5,
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 24 * 3600 },
};

/**
 * Bootstraps all BullMQ background workers for the BuzzNa D74 distributed async engine.
 * Must be executed during the application bootstrap phase (e.g., inside server.ts).
 */
export const initializeWorkers = (): void => {
  try {
    logger.info('Initializing distributed background workers (Redis + BullMQ)...');

    // 1. Automated Alerts: Evaluates tenant expiration dates and distributes automated alerts.
    const billingWorker = new Worker(
      QUEUES.BILLING_REMINDERS,
      processBillingReminders,
      { ...defaultWorkerOptions, connection: redisConfig }
    );

    // 2. Merchant Reconciliation: Sweeps unlinked transaction pools to pair orphaned M-Pesa receipts.
    const reconciliationWorker = new Worker(
      QUEUES.MERCHANT_RECONCILIATION,
      processMerchantReconciliation,
      { ...defaultWorkerOptions, connection: redisConfig }
    );

    // 3. Projection Rebuilder: Scans the immutable inventory_events ledger and recomputes current_quantity.
    // NOTE: Concurrency restricted to 1 to ensure sequential event-sourced consistency.
    const projectionWorker = new Worker(
      QUEUES.PROJECTION_REBUILD,
      processProjectionRebuild,
      { ...defaultWorkerOptions, connection: redisConfig, concurrency: 1 } 
    );

    // 4. Report Exporter: Compiles dense CSV and PDF financial statement exports asynchronously.
    const reportWorker = new Worker(
      QUEUES.REPORT_EXPORTER,
      processReportExport,
      { ...defaultWorkerOptions, connection: redisConfig, concurrency: 2 }
    );

    // Attach robust error handling to prevent silent application crashes
    const workers = [billingWorker, reconciliationWorker, projectionWorker, reportWorker];

    workers.forEach((worker) => {
      worker.on('failed', (job, err) => {
        logger.error(`Worker [${worker.name}] Job ${job?.id} failed with error: ${err.message}`, {
          stack: err.stack,
          jobData: job?.data,
        });
      });

      worker.on('error', (err) => {
        logger.error(`Worker [${worker.name}] critical connection error: ${err.message}`, { stack: err.stack });
      });
    });

    logger.info('All background workers initialized successfully and listening for jobs.');
  } catch (error) {
    logger.error('Failed to initialize background workers:', error);
    throw error; // Fail-fast during startup if Redis/Queue config is broken
  }
};