// apps/api/src/workers/merchant-reconciliation.worker.ts

import { Worker, Job } from 'bullmq';
import { logger } from '../common/logging/logger';
import { queueConnectionConfig } from '../config/redis';
import { queues } from '../config/queues';

/**
 * Merchant Reconciliation Worker
 *
 * PURPOSE:
 * - Match unmatched Safaricom Daraja M-Pesa receipts to POS sales
 * - Reconcile payment status for offline terminals
 * - Prevent revenue loss from mismatched payments
 *
 * TRIGGERS:
 * - Scheduled hourly
 * - Manual trigger after offline sync
 *
 * WORKFLOW:
 * 1. Query unmatched merchant_payments (status = UNMATCHED)
 * 2. For each unmatched payment:
 *    - Look for sale_transactions with matching amount + time window
 *    - Validate customer phone number (if present)
 *    - Create merchant_payment_match record
 *    - Update sales_transaction payment_status to COMPLETED_VERIFIED
 * 3. Log all matches/failures
 *
 * WALKAWAY PROTOCOL:
 * - If terminal processes offline cash sale, then another terminal depletes stock:
 *   - Server MUST accept the sale (cash already walked out)
 *   - Drop inventory to negative (flag as Inventory Anomaly)
 *   - Send alert to Owner dashboard
 *
 * ============================================================================
 */

export async function initMerchantReconciliationWorker(): Promise<void> {
  const worker = new Worker(
    queues.merchantReconciliation.name,
    async (job: Job) => {
      try {
        logger.info('🔄 Processing merchant reconciliation job', {
          jobId: job.id,
          attempts: job.attemptsMade + 1,
        });

        // TODO: Implement merchant reconciliation logic
        // 1. Query merchant_payments with status = 'UNMATCHED'
        // 2. For each payment:
        //    - Find matching sales_transaction (amount + time window)
        //    - Create merchant_payment_match record
        //    - Update sales_transaction.payment_status
        // 3. Handle walkaway conflicts (negative inventory)
        // 4. Log all actions

        logger.info('✅ Merchant reconciliation job completed');
        return { reconciled: 0 }; // Placeholder
      } catch (error) {
        logger.error('Merchant reconciliation worker failed', {
          jobId: job.id,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error; // Will trigger retry
      }
    },
    {
      connection: queueConnectionConfig,
      concurrency: 2, // Process multiple reconciliations in parallel
    }
  );

  // Event listeners
  worker.on('completed', (job: Job) => {
    logger.debug('Merchant reconciliation job completed', { jobId: job.id });
  });

  worker.on('failed', (job: Job | undefined, error: Error) => {
    logger.error('Merchant reconciliation job failed', {
      jobId: job?.id,
      error: error.message,
    });
  });

  logger.info('✅ Merchant reconciliation worker initialized');
}
