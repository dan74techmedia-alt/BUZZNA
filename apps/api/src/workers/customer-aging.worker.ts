// apps/api/src/workers/customer-aging.worker.ts

import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis';
import { db } from '../db/client';
import { logger } from '../common/logging/logger';

async function processCustomerAging(job: Job): Promise<void> {
  try {
    // Get customers with significant debt
    const customerDebtors = await db
      .selectFrom('mv_customer_debt_aging' as any)
      .selectAll()
      .where('days_overdue', '>', 30)
      .where('total_debt', '>', 1000)
      .execute();

    for (const debtor of customerDebtors) {
      // Create attention card
      await db
        .insertInto('attention_cards' as any)
        .values({
          tenant_id: debtor.tenant_id,
          card_type: 'customer_debt_overdue',
          title: `Overdue Debt: ${debtor.customer_name}`,
          description: `${debtor.days_overdue} days overdue. Amount: KES ${debtor.total_debt}`,
          severity: debtor.days_overdue > 60 ? 'high' : 'medium',
          status: 'active',
          metadata: JSON.stringify({
            customerId: debtor.customer_id,
            amount: debtor.total_debt,
            daysOverdue: debtor.days_overdue,
          }),
          created_at: new Date(),
        })
        .execute();
    }

    logger.info('Customer aging analysis completed', {
      debtorCount: customerDebtors.length,
    });
  } catch (error) {
    logger.error('Customer aging job failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export const customerAgingWorker = new Worker(
  'buzzna:customer-aging',
  processCustomerAging,
  {
    connection: redis,
    concurrency: 1,
  }
);

export default customerAgingWorker;