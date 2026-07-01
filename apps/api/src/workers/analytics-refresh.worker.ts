// apps/api/src/workers/analytics-refresh.worker.ts

import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis';
import { db } from '../db/client';
import { logger } from '../common/logging/logger';

const MATERIALIZED_VIEWS = [
  'mv_daily_sales_summary',
  'mv_customer_debt_aging',
  'mv_product_velocity',
  'mv_stale_capital_audit',
];

async function processAnalyticsRefresh(job: Job): Promise<void> {
  try {
    for (const view of MATERIALIZED_VIEWS) {
      await db.raw(
        `REFRESH MATERIALIZED VIEW CONCURRENTLY ${view}`
      );
      logger.debug('Materialized view refreshed', {
        view,
      });
    }

    logger.info('Analytics refresh completed', {
      viewCount: MATERIALIZED_VIEWS.length,
    });
  } catch (error) {
    logger.error('Analytics refresh job failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export const analyticsRefreshWorker = new Worker(
  'buzzna:analytics-refresh',
  processAnalyticsRefresh,
  {
    connection: redis,
    concurrency: 1,
  }
);

export default analyticsRefreshWorker;