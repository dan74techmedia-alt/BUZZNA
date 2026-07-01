// apps/api/src/workers/projection-rebuild.worker.ts

import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis';
import { db } from '../db/client';
import { logger } from '../common/logging/logger';

/**
 * Projection Rebuild Worker
 *
 * CRITICAL FOR INVENTORY INTEGRITY
 *
 * The products table stores current_quantity as a cached projection.
 * It is NEVER updated directly. Instead, it is calculated on-demand by
 * aggregating immutable inventory_events rows.
 *
 * This worker:
 * 1. Scans all products in all tenants
 * 2. Aggregates their inventory_events (STOCK_ADD - SALE_DISPATCH - ADJUSTMENTS)
 * 3. Recalculates current_quantity from first principles
 * 4. Detects and flags stock anomalies (negative when shouldn't be)
 * 5. Logs discrepancies for audit
 *
 * Why This Matters:
 * - Prevents accumulated rounding errors in quantity calculations
 * - Detects data corruption or synchronization issues
 * - Provides authoritative source of truth for stock levels
 * - Supports offline sync conflict resolution ("walkaway protocol")
 *
 * Schedule: Runs every 4 hours (reconciliation frequency)
 * Scope: All products across all tenants (scoped by RLS)
 */

interface ProductProjection {
  productId: string;
  tenantId: string;
  barcode: string;
  calculatedQuantity: string; // NUMERIC as string for precision
  cachedQuantity: string;
  discrepancy: boolean;
  allowsNegative: boolean;
}

/**
 * Calculate actual inventory for a product from events
 */
async function calculateProductInventory(
  tenantId: string,
  productId: string
): Promise<{
  quantity: string;
  eventCount: number;
  allowsNegative: boolean;
}> {
  try {
    // Sum all inventory events for this product
    const result = await db
      .selectFrom('inventory_events' as any)
      .select(
        db.raw(
          `SUM(CAST(quantity_delta AS NUMERIC(15,3))) as total_quantity, COUNT(*) as event_count`
        ) as any
      )
      .where('tenant_id', '=', tenantId)
      .where('product_id', '=', productId)
      .executeTakeFirst();

    const quantity = (result?.total_quantity || 0).toString();
    const eventCount = parseInt(result?.event_count || 0);

    // Check if product allows negative stock (digital goods, special category)
    const product = await db
      .selectFrom('products' as any)
      .select(['allows_negative_stock', 'product_type'])
      .where('tenant_id', '=', tenantId)
      .where('product_id', '=', productId)
      .executeTakeFirst();

    return {
      quantity,
      eventCount,
      allowsNegative: product?.allows_negative_stock || false,
    };
  } catch (error) {
    logger.error('Failed to calculate product inventory', {
      tenantId,
      productId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get all products in a tenant
 */
async function getProductsInTenant(tenantId: string): Promise<ProductProjection[]> {
  try {
    const results = await db
      .selectFrom('products' as any)
      .select(['product_id', 'barcode', 'current_quantity'])
      .where('tenant_id', '=', tenantId)
      .execute();

    return Promise.all(
      results.map(async (row: any) => {
        const { quantity, allowsNegative } = await calculateProductInventory(
          tenantId,
          row.product_id
        );

        return {
          productId: row.product_id,
          tenantId,
          barcode: row.barcode,
          calculatedQuantity: quantity,
          cachedQuantity: row.current_quantity?.toString() || '0',
          discrepancy:
            Math.abs(
              parseFloat(quantity) - parseFloat(row.current_quantity || 0)
            ) > 0.01,
          allowsNegative,
        };
      })
    );
  } catch (error) {
    logger.error('Failed to get products in tenant', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Update product projection with calculated quantity
 */
async function updateProductProjection(
  tenantId: string,
  productId: string,
  calculatedQuantity: string
): Promise<void> {
  try {
    await db
      .updateTable('products' as any)
      .set({
        current_quantity: calculatedQuantity,
        projected_at: new Date(),
      })
      .where('tenant_id', '=', tenantId)
      .where('product_id', '=', productId)
      .execute();
  } catch (error) {
    logger.error('Failed to update product projection', {
      tenantId,
      productId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Log inventory anomaly
 */
async function logAnomalyEvent(
  tenantId: string,
  projection: ProductProjection
): Promise<void> {
  try {
    const quantity = parseFloat(projection.calculatedQuantity);
    const isNegative = quantity < 0;

    // Only flag true anomalies
    if (isNegative && !projection.allowsNegative) {
      // Negative stock where not allowed = walkaway sync scenario
      await db
        .insertInto('attention_cards' as any)
        .values({
          tenant_id: tenantId,
          card_type: 'inventory_anomaly',
          title: 'Negative Stock Detected',
          description: `Product ${projection.barcode} has negative stock (${projection.calculatedQuantity} units). This typically indicates a sync conflict from offline sales.`,
          severity: 'medium',
          status: 'active',
          action_url: `/inventory/products/${projection.productId}`,
          metadata: JSON.stringify({
            productId: projection.productId,
            quantity: projection.calculatedQuantity,
            barcode: projection.barcode,
          }),
          created_at: new Date(),
        })
        .execute();

      logger.warn('Inventory anomaly created', {
        tenantId,
        productId: projection.productId,
        quantity: projection.calculatedQuantity,
      });
    }
  } catch (error) {
    logger.error('Failed to log anomaly', {
      tenantId,
      productId: projection.productId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get all tenants
 */
async function getAllTenants(): Promise<string[]> {
  try {
    const results = await db
      .selectFrom('businesses' as any)
      .select('tenant_id')
      .execute();

    return results.map((row: any) => row.tenant_id);
  } catch (error) {
    logger.error('Failed to get all tenants', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Main job processor
 */
async function processProjectionRebuild(job: Job): Promise<void> {
  try {
    logger.info('Starting projection rebuild job', {
      jobId: job.id,
    });

    const tenants = await getAllTenants();
    let totalProcessed = 0;
    let totalDiscrepancies = 0;
    let totalAnomalies = 0;

    // Process each tenant
    for (const tenantId of tenants) {
      try {
        logger.info('Rebuilding projections for tenant', {
          tenantId,
        });

        const projections = await getProductsInTenant(tenantId);

        if (projections.length === 0) {
          continue;
        }

        for (const projection of projections) {
          try {
            // Update projection
            await updateProductProjection(
              tenantId,
              projection.productId,
              projection.calculatedQuantity
            );

            totalProcessed++;

            // Log discrepancy
            if (projection.discrepancy) {
              logger.warn('Stock discrepancy corrected', {
                tenantId,
                productId: projection.productId,
                barcode: projection.barcode,
                cachedQuantity: projection.cachedQuantity,
                calculatedQuantity: projection.calculatedQuantity,
              });
              totalDiscrepancies++;
            }

            // Log anomaly if detected
            const quantity = parseFloat(projection.calculatedQuantity);
            if (quantity < 0 && !projection.allowsNegative) {
              await logAnomalyEvent(tenantId, projection);
              totalAnomalies++;
            }
          } catch (error) {
            logger.error('Failed to process product projection', {
              tenantId,
              productId: projection.productId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      } catch (error) {
        logger.error('Failed to rebuild projections for tenant', {
          tenantId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info('Projection rebuild job completed', {
      jobId: job.id,
      totalProcessed,
      totalDiscrepancies,
      totalAnomalies,
    });
  } catch (error) {
    logger.error('Projection rebuild job failed', {
      jobId: job.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Worker initialization
 */
export const projectionRebuildWorker = new Worker(
  'buzzna:projection-rebuild',
  processProjectionRebuild,
  {
    connection: redis,
    concurrency: 1,
    settings: {
      lockDuration: 120000,
      lockRenewTime: 60000,
      maxStalledCount: 2,
      stalledInterval: 30000,
    },
  }
);

projectionRebuildWorker.on('error', (error) => {
  logger.error('Projection rebuild worker error', {
    error: error instanceof Error ? error.message : String(error),
  });
});

export default projectionRebuildWorker;