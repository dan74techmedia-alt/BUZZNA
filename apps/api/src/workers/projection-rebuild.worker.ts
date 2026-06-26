import { Worker, Job } from 'bullmq';
import { db } from '../../bootstrap/database';
import { sql } from 'kysely';
import { redisConnection } from '../config/redis';

export const projectionRebuildWorker = new Worker(
    'projection-rebuild',
    async (job: Job) => {
        const { tenantId } = job.data;
        console.log(`Rebuilding event-sourced inventory metrics projection layer for business unit: ${tenantId}`);

        try {
            await db.transaction().execute(async (trx) => {
                // Assert connection isolation
                await trx.executeQuery(sql`SET LOCAL app.current_tenant_id = ${tenantId}`);

                // Calculate total historical delta groups across all items 
                const aggregations = await trx.selectFrom('inventory_events')
                    .select([
                        'product_id',
                        sql<number>`SUM(quantity_delta)`.as('calculated_stock')
                    ])
                    .groupBy('product_id')
                    .execute();

                for (const row of aggregations) {
                    // Update cache parameters projection target field safely
                    await trx.updateTable('products')
                        .set({ 
                            current_quantity: row.calculated_stock,
                            updated_at: new Date()
                        })
                        .where('product_id', '=', row.product_id)
                        .execute();
                }

                // Log audit clearance status verification
                await trx.insertInto('audit_logs')
                    .values({
                        tenant_id: tenantId,
                        action: 'INVENTORY_PROJECTION_REBUILD',
                        entity_name: 'products',
                        notes: `Asynchronous structural re-aggregation execution completed across ${aggregations.length} items.`
                    })
                    .execute();
            });
        } catch (error) {
            console.error(`Projection rebuild failed for tenant ${tenantId}:`, error);
            throw error;
        }
    },
    { connection: redisConnection }
);