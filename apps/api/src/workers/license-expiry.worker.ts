// apps/api/src/workers/license-expiry.worker.ts

import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis';
import { db } from '../db/client';
import { logger } from '../common/logging/logger';

async function processLicenseExpiry(job: Job): Promise<void> {
  try {
    // Update license status for expired businesses
    const result = await db
      .updateTable('businesses' as any)
      .set({
        license_status: 'SUSPENDED_NON_PAYMENT',
      })
      .where('license_status', '=', 'GRACE_PERIOD')
      .where('license_expires_at', '<', new Date())
      .execute();

    const count = result.numUpdatedRows || 0;

    if (count > 0) {
      logger.warn('Licenses suspended for non-payment', {
        count,
      });
    }
  } catch (error) {
    logger.error('License expiry job failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export const licenseExpiryWorker = new Worker(
  'buzzna:license-expiry',
  processLicenseExpiry,
  {
    connection: redis,
    concurrency: 1,
  }
);

export default licenseExpiryWorker;