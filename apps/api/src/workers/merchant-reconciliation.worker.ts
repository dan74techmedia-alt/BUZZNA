import { Worker, Job } from 'bullmq';
import { db } from '../../bootstrap/database';
import { sql } from 'kysely';
import { redisConnection } from '../config/redis';

export const merchantReconciliationWorker = new Worker(
    'merchant-reconciliation',
    async (job: Job) => {
        console.log(`Executing automated revenue reconciliation sweep job index: ${job.id}`);

        // Pull out all unmatched merchant transaction lines
        const unmatchedPayments = await db.selectFrom('merchant_payments')
            .where('status', '=', 'UNMATCHED')
            .selectAll()
            .execute();

        for (const payment of unmatchedPayments) {
            const tenantId = payment.tenant_id;

            await db.transaction().execute(async (trx) => {
                // Establish Row-Level Security verification context token
                await trx.executeQuery(sql`SET LOCAL app.current_tenant_id = ${tenantId}`);

                // Look for an unallocated sale matching the precise amount within a 30-minute validation window
                const matchingSale = await trx.selectFrom('sales' as any)
                    .innerJoin('sale_payment_allocations as spa', 'sales.sale_id', 'spa.sale_id')
                    .where('spa.payment_method', '=', 'MPESA')
                    .where('spa.merchant_payment_id', 'is', null)
                    .where('sales.total_amount', '=', payment.amount)
                    .where('sales.status', '=', 'FINALIZED')
                    .where('sales.created_at', '>=', sql`${payment.created_at}::timestamp - interval '30 minutes'`)
                    .where('sales.created_at', '<=', sql`${payment.created_at}::timestamp + interval '30 minutes'`)
                    .select(['sales.sale_id', 'spa.allocation_id'])
                    .executeTakeFirst();

                if (matchingSale) {
                    // Update matching trace reference matrix indices
                    await trx.insertInto('merchant_payment_matches')
                        .values({
                            tenant_id: tenantId,
                            merchant_payment_id: payment.merchant_payment_id,
                            sale_id: matchingSale.sale_id,
                            matched_at: new Date()
                        })
                        .execute();

                    // Update parent allocation row
                    await trx.updateTable('sale_payment_allocations' as any)
                        .set({ merchant_payment_id: payment.merchant_payment_id })
                        .where('allocation_id', '=', matchingSale.allocation_id)
                        .execute();

                    // Advance state parameters to MATCHED
                    await trx.updateTable('merchant_payments')
                        .set({ status: 'MATCHED', updated_at: new Date() })
                        .where('merchant_payment_id', '=', payment.merchant_payment_id)
                        .execute();

                    // Append cryptographic security tracking vector logs
                    await trx.insertInto('audit_logs')
                        .values({
                            tenant_id: tenantId,
                            action: 'AUTOMATED_RECONCILIATION_MATCH',
                            entity_name: 'merchant_payments',
                            entity_id: payment.merchant_payment_id,
                            notes: `Engine matched trace ${payment.mpesa_receipt_number} to sale manifest context ID: ${matchingSale.sale_id}`
                        })
                        .execute();
                }
            });
        }
    },
    { connection: redisConnection }
);