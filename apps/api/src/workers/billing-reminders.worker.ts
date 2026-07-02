// apps/api/src/workers/billing-reminders.worker.ts

import { Worker, Job } from 'bullmq';
import { logger } from '../common/logging/logger';
import { queueConnectionConfig } from '../config/redis';
import { queues } from '../config/queues';

/**
 * Billing Reminders Worker
 *
 * PURPOSE:
 * - Send subscription expiration warnings to businesses
 * - Enforce license status transitions
 * - Prevent revenue loss from expired licenses
 *
 * TRIGGERS:
 * - Scheduled daily at 2 AM
 * - Checks all active businesses for upcoming/overdue payments
 *
 * ACTIONS:
 * - 14 days before: "Your trial ends in 2 weeks"
 * - 3 days before: "Your subscription expires in 3 days"
 * - 0 days: License moves to PAYMENT_DUE status
 * - 3 days after: License moves to GRACE_PERIOD
 * - 7 days after: License moves to SUSPENDED_NON_PAYMENT
 *
 * ============================================================================
 */

export async function initBillingRemindersWorker(): Promise<void> {
  const worker = new Worker(
    queues.billingReminders.name,
    async (job: Job) => {
      try {
        logger.info('📧 Processing billing reminders job', {
          jobId: job.id,
          attempts: job.attemptsMade + 1,
        });

        // TODO: Implement billing reminders logic
        // 1. Query businesses with license_expires_at < now + 14 days
        // 2. For each business:
        //    - Determine warning level (14d, 3d, 0d, 3d overdue, 7d overdue)
        //    - Send SMS/email notification
        //    - Update license_status if needed
        // 3. Log all actions

        logger.info('✅ Billing reminders job completed');
        return { processed: 0 }; // Placeholder
      } catch (error) {
        logger.error('Billing reminders worker failed', {
          jobId: job.id,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error; // Will trigger retry
      }
    },
    {
      connection: queueConnectionConfig,
      concurrency: 1, // Process one job at a time
    }
  );

  // Event listeners
  worker.on('completed', (job: Job) => {
    logger.debug('Billing reminders job completed', { jobId: job.id });
  });

  worker.on('failed', (job: Job | undefined, error: Error) => {
    logger.error('Billing reminders job failed', {
      jobId: job?.id,
      error: error.message,
    });
  });

  logger.info('✅ Billing reminders worker initialized');
}
