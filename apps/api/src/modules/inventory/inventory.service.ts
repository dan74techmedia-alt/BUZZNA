// apps/api/src/modules/inventory/inventory.service.ts

import { db, withTenant } from '../../config/database';
import { logger } from '../../common/logging/logger';
import { AppError } from '../../common/errors/AppError';
import { Decimal } from 'decimal.js';

interface AdjustStockPayload {
  productId: string;
  quantityDelta: string; // NUMERIC as string for precision
  eventType: 'STOCK_ADD' | 'SALE_DISPATCH' | 'DAMAGE' | 'SPOILAGE' | 'THEFT_LOSS' | 'RESTOCK_RESTORE' | 'COUNT_ADJUSTMENT';
  reasonCode?: string;
  description?: string;
}

interface StockProjection {
  productId: string;
  currentQuantity: string;
  lastCalculatedAt: Date;
  eventCount: number;
}

export class InventoryService {
  /**
   * Calculate authoritative stock level by aggregating immutable inventory_events
   * Never directly query current_quantity - always aggregate from events
   */
  static async calculateProductInventory(
    tenantId: string,
    productId: string
  ): Promise<StockProjection> {
    return await withTenant(tenantId, async (trx) => {
      try {
        // Aggregate all inventory events for this product
        const result = await trx
          .selectFrom('inventory_events')
          .select(db.raw<string>('COALESCE(SUM(CAST(quantity_delta AS NUMERIC(15,3))), 0) as total_quantity'))
          .select(db.raw<number>('COUNT(*) as event_count'))
          .where('tenant_id', '=', tenantId)
          .where('product_id', '=', productId)
          .executeTakeFirst();

        const currentQuantity = result?.total_quantity || '0';
        
        logger.info('[InventoryService] Stock calculated', {
          tenantId,
          productId,
          quantity: currentQuantity,
          eventCount: result?.event_count,
        });

        return {
          productId,
          currentQuantity,
          lastCalculatedAt: new Date(),
          eventCount: result?.event_count || 0,
        };
      } catch (error) {
        logger.error('[InventoryService] Failed to calculate inventory', {
          tenantId,
          productId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new AppError('Failed to calculate inventory', 500);
      }
    });
  }

  /**
   * Record stock adjustment event (immutable append-only)
   * Never updates current_quantity directly - always appends event
   */
  static async adjustStock(
    tenantId: string,
    userId: string,
    payload: AdjustStockPayload
  ): Promise<{ eventId: string; quantity: string }> {
    return await withTenant(tenantId, async (trx) => {
      try {
        // Validate quantity is NUMERIC
        const quantityDecimal = new Decimal(payload.quantityDelta);
        
        // Insert immutable event record
        const result = await trx
          .insertInto('inventory_events')
          .values({
            tenant_id: tenantId,
            product_id: payload.productId,
            event_type: payload.eventType,
            reason_code: payload.reasonCode || null,
            quantity_delta: quantityDecimal.toString(),
            description: payload.description || null,
            created_by: userId,
            created_at: new Date(),
          })
          .returning(['event_id', 'quantity_delta'])
          .executeTakeFirst();

        if (!result) {
          throw new Error('Failed to insert inventory event');
        }

        // Recalculate and update cached projection
        const projection = await this.calculateProductInventory(tenantId, payload.productId);

        // Update cached current_quantity in products table
        await trx
          .updateTable('products')
          .set({
            current_quantity: projection.currentQuantity,
            projected_at: new Date(),
          })
          .where('product_id', '=', payload.productId)
          .where('tenant_id', '=', tenantId)
          .execute();

        logger.info('[InventoryService] Stock adjusted', {
          tenantId,
          productId: payload.productId,
          eventType: payload.eventType,
          delta: payload.quantityDelta,
          newQuantity: projection.currentQuantity,
        });

        return {
          eventId: result.event_id,
          quantity: projection.currentQuantity,
        };
      } catch (error) {
        logger.error('[InventoryService] Failed to adjust stock', {
          tenantId,
          productId: payload.productId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new AppError('Failed to adjust stock', 500);
      }
    });
  }

  /**
   * Check for inventory anomalies (negative stock when not allowed)
   * Create attention cards for alerts
   */
  static async detectAnomalies(tenantId: string): Promise<number> {
    return await withTenant(tenantId, async (trx) => {
      try {
        // Find products with negative stock
        const anomalies = await trx
          .selectFrom('products')
          .selectAll()
          .where('tenant_id', '=', tenantId)
          .where('current_quantity', '<', 0)
          .execute();

        for (const product of anomalies) {
          // Check if allows negative stock
          if (!product.allows_negative_stock) {
            // Create attention card
            await trx
              .insertInto('attention_cards')
              .values({
                tenant_id: tenantId,
                card_type: 'inventory_anomaly',
                title: `Negative Stock: ${product.name}`,
                description: `Product ${product.barcode} has negative quantity (${product.current_quantity} units). Likely from offline sync walkaway.`,
                severity: 'medium',
                status: 'active',
                action_url: `/inventory/products/${product.product_id}`,
                metadata: JSON.stringify({
                  productId: product.product_id,
                  quantity: product.current_quantity,
                  barcode: product.barcode,
                }),
                created_at: new Date(),
              })
              .execute();
          }
        }

        logger.info('[InventoryService] Anomaly detection completed', {
          tenantId,
          anomalyCount: anomalies.length,
        });

        return anomalies.length;
      } catch (error) {
        logger.error('[InventoryService] Failed to detect anomalies', {
          tenantId,
          error: error instanceof Error ? error.message : String(error),
        });
        return 0;
      }
    });
  }

  /**
   * Get inventory status snapshot for offline cache
   */
  static async getInventorySnapshot(tenantId: string): Promise<any[]> {
    return await withTenant(tenantId, async (trx) => {
      try {
        const products = await trx
          .selectFrom('products')
          .select([
            'product_id',
            'barcode',
            'name',
            'current_quantity',
            'retail_price',
            'cost_floor',
          ])
          .where('tenant_id', '=', tenantId)
          .where('is_active', '=', true)
          .execute();

        return products;
      } catch (error) {
        logger.error('[InventoryService] Failed to get snapshot', {
          tenantId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new AppError('Failed to get inventory snapshot', 500);
      }
    });
  }
}