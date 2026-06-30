// apps/api/src/workers/billing-reminders.worker.ts

import { Worker, Job } from 'bullmq';
import { queueConnectionConfig } from '../config/redis';
import { pool } from '../config/database';
import { logger } from '../common/logging/logger';

interface BillingEvaluationJobData {
  execution_timestamp: string;
}

/**
 * BullMQ Worker: Evaluates tenant expiration dates and orchestrates state downgrades
 * and automated alert distributions.
 */
export const billingRemindersWorker = new Worker<BillingEvaluationJobData>(
  'billing-reminders-queue',
  async (job: Job) => {
    logger.info(`[Job ID: ${job.id}] Initiating global SaaS subscription evaluation sweep.`);

    const client = await pool.connect();

    try {
      await client.query('BEGIN;');

      // 1. Identify businesses entering the 3-day Grace Period
      const gracePeriodQuery = `
        UPDATE businesses
        SET license_status = 'GRACE_PERIOD'
        WHERE license_status IN ('TRIAL_ACTIVE', 'FULLY_ACTIVATED')
          AND license_expires_at <= NOW()
          AND license_expires_at > NOW() - INTERVAL '3 days'
        RETURNING tenant_id, legal_name;
      `;
      const graceResult = await client.query(gracePeriodQuery);
      
      for (const row of graceResult.rows) {
        logger.warn(`Tenant [${row.tenant_id}] (${row.legal_name}) transitioned to GRACE_PERIOD.`);
        // Note: Integration point for SMS/Email notification microservice injection
      }

      // 2. Identify businesses exceeding the Grace Period (Enforce Strict Suspension)
      const suspensionQuery = `
        UPDATE businesses
        SET license_status = 'SUSPENDED_NON_PAYMENT'
        WHERE license_status = 'GRACE_PERIOD'
          AND license_expires_at <= NOW() - INTERVAL '3 days'
        RETURNING tenant_id, legal_name;
      `;
      const suspendedResult = await client.query(suspensionQuery);

      for (const row of suspendedResult.rows) {
        logger.error(`Tenant [${row.tenant_id}] (${row.legal_name}) transitioned to SUSPENDED_NON_PAYMENT. Enforcing POS lock.`);
        // Note: Integration point for Attention Card database injection
      }

      await client.query('COMMIT;');
      logger.info(`Billing evaluation complete. Suspended: ${suspendedResult.rowCount}, Grace Period: ${graceResult.rowCount}`);

    } catch (error) {
      await client.query('ROLLBACK;');
      logger.error('CRITICAL: Transaction failed during billing evaluation sweep:', error);
      throw error;
    } finally {
      client.release();
    }
  },
  {
    connection: queueConnectionConfig,
    concurrency: 1, // Single concurrency to prevent database deadlock conditions during global updates
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 }
  }
);

billingRemindersWorker.on('failed', (job, err) => {
  logger.error(`Billing Reminder Worker Failed for Job ${job?.id}: ${err.message}`);
});