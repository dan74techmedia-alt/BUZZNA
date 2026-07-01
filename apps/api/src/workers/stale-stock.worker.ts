// apps/api/src/workers/stale-stock.worker.ts

import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis';
import { db } from '../db/client';
import { logger } from '../common/logging/logger';

async function processStaleStock(job: Job): Promise<void> {
  try {
    // Query stale capital audit view
    const staleItems = await db
      .selectFrom('mv_stale_capital_audit' as any)
      .selectAll()
      .where('days_without_transaction', '>=', 45)
      .execute();

    for (const item of staleItems) {
      // Create attention card
      await db
        .insertInto('attention_cards' as any)
        .values({
          tenant_id: item.tenant_id,
          card_type: 'stale_stock_alert',
          title: `Stale Stock: ${item.product_name}`,
          description: `No transactions for ${item.days_without_transaction} days. Consider clearance.`,
          severity: 'low',
          status: 'active',
          metadata: JSON.stringify({
            productId: item.product_id,
            quantity: item.quantity,
            value: item.total_value,
          }),
          created_at: new Date(),
        })
        .execute();
    }

    logger.info('Stale stock detection completed', {
      alertCount: staleItems.length,
    });
  } catch (error) {
    logger.error('Stale stock job failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export const staleStockWorker = new Worker(
  'buzzna:stale-stock',
  processStaleStock,
  {
    connection: redis,
    concurrency: 1,
  }
);

export default staleStockWorker;