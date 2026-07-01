/**
 * ============================================================================
 * BUZZNA D74 - Inventory Service (Event-Sourced Stock Ledger)
 * ============================================================================
 *
 * PURPOSE:
 * - Manage append-only inventory event ledger (STRICTLY NO direct updates)
 * - Calculate current_quantity as materialized projection from events
 * - Support restock, manual adjustment, and refund scenarios
 * - Enforce strict decimal precision (NUMERIC(15,3) for quantities)
 *
 * ARCHITECTURAL RULES (CRITICAL):
 * 1. products.current_quantity is CACHE ONLY - derived from inventory_events
 * 2. NEVER execute UPDATE on products.current_quantity directly
 * 3. ALWAYS INSERT into inventory_events with quantity_delta
 * 4. Negative inventory is ALLOWED (walkaway sync protocol)
 * 5. All operations execute within tenant context via withTenant()
 * 6. Historical accuracy preserved forever (append-only, no deletes)
 *
 * DATABASE DEPENDENCIES:
 * - products (catalog master, current_quantity is projection)
 * - inventory_events (authoritative ledger, immutable)
 * - stock_counts (optional physical verification)
 *
 * ============================================================================
 */

import { db, withTenant } from '../../config/database';
import { AppError } from '../../common/errors/AppError';
import { logger } from '../../common/logging/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * Inventory event types matching the database enum
 */
export type InventoryEventType =
  | 'OPENING_STOCK'
  | 'STOCK_ADD'
  | 'STOCK_TRANSFER'
  | 'SALE_DISPATCH'
  | 'RETURN'
  | 'REFUND_RETURN'
  | 'ADJUSTMENT'
  | 'SPOILAGE'
  | 'DAMAGE'
  | 'THEFT_LOSS';

/**
 * Reason codes for inventory adjustments
 */
export type ReasonCode =
  | 'INITIAL_COUNT'
  | 'PURCHASE_ORDER'
  | 'PHYSICAL_COUNT'
  | 'CUSTOMER_RETURN'
  | 'SPOILAGE_LOSS'
  | 'DAMAGE_LOSS'
  | 'THEFT_LOSS'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'PRICE_CORRECTION'
  | 'SYSTEM_ADJUSTMENT';

/**
 * Restock operation input
 */
export interface RestockInput {
  productId: string;
  quantityDelta: string; // NUMERIC string to preserve precision
  unitBuyingPrice?: string;
  unitSellingPrice?: string;
  reasonCode: ReasonCode;
  notes?: string;
}

/**
 * Inventory event output
 */
export interface InventoryEvent {
  event_id: string;
  tenant_id: string;
  product_id: string;
  event_type: InventoryEventType;
  reason_code: ReasonCode | null;
  quantity_delta: string;
  unit_buying_price: string | null;
  unit_selling_price: string | null;
  actor_user_id: string | null;
  timestamp: Date;
}

/**
 * Current stock snapshot (derived from ledger)
 */
export interface StockSnapshot {
  product_id: string;
  current_quantity: string;
  last_event_at: Date;
  event_count: number;
}

/**
 * Manual adjustment input
 */
export interface AdjustmentInput {
  productId: string;
  newQuantity: string; // Absolute quantity (not delta)
  reasonCode: ReasonCode;
  notes?: string;
}

/**
 * Inventory Service
 */
class InventoryService {
  /**
   * Append restock event to ledger
   *
   * RULE: Never directly updates products.current_quantity
   * The projection rebuild worker will recalculate from events
   *
   * @param tenantId - Tenant UUID
   * @param userId - User performing action
   * @param input - Restock details
   * @returns Inserted inventory event
   */
  async processRestock(
    tenantId: string,
    userId: string,
    input: RestockInput
  ): Promise<InventoryEvent> {
    logger.info('Processing inventory restock', {
      tenantId,
      productId: input.productId,
      quantityDelta: input.quantityDelta,
      reasonCode: input.reasonCode,
    });

    return withTenant(tenantId, async (trx) => {
      // Validate product exists and belongs to tenant
      const productCheck = await trx
        .selectFrom('products')
        .select('product_id')
        .where('product_id', '=', input.productId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      if (!productCheck) {
        throw new AppError(
          'Product not found or access restricted',
          404,
          true,
          'PRODUCT_NOT_FOUND'
        );
      }

      // Parse quantity delta as decimal (preserve precision)
      const quantityDelta = parseFloat(input.quantityDelta);
      if (isNaN(quantityDelta)) {
        throw new AppError(
          'Quantity delta must be a valid decimal number',
          400,
          true,
          'INVALID_QUANTITY'
        );
      }

      // Append event to immutable ledger
      const eventId = uuidv4();
      const result = await trx
        .insertInto('inventory_events')
        .values({
          event_id: eventId,
          tenant_id: tenantId,
          product_id: input.productId,
          event_type: 'STOCK_ADD',
          reason_code: input.reasonCode,
          quantity_delta: input.quantityDelta, // Store as string to preserve NUMERIC(15,3)
          unit_buying_price: input.unitBuyingPrice || null,
          unit_selling_price: input.unitSellingPrice || null,
          actor_user_id: userId,
          timestamp: new Date(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      logger.info('Restock event appended to ledger', {
        tenantId,
        eventId,
        productId: input.productId,
      });

      return result as InventoryEvent;
    });
  }

  /**
   * Record sale dispatch (negative inventory delta)
   * Called by sales service when checkout is completed
   *
   * @param tenantId - Tenant UUID
   * @param productId - Product UUID
   * @param quantity - Quantity sold (positive number, will be negated)
   * @param saleId - Sale transaction UUID for audit trail
   * @returns Inserted inventory event
   */
  async recordSaleDispatch(
    tenantId: string,
    productId: string,
    quantity: string,
    saleId: string
  ): Promise<InventoryEvent> {
    logger.info('Recording sale dispatch', {
      tenantId,
      productId,
      quantity,
      saleId,
    });

    return withTenant(tenantId, async (trx) => {
      // Negate quantity for sale dispatch
      const quantityDelta = (-Math.abs(parseFloat(quantity))).toString();

      const eventId = uuidv4();
      const result = await trx
        .insertInto('inventory_events')
        .values({
          event_id: eventId,
          tenant_id: tenantId,
          product_id: productId,
          event_type: 'SALE_DISPATCH',
          reason_code: null,
          quantity_delta: quantityDelta,
          unit_buying_price: null,
          unit_selling_price: null,
          actor_user_id: null, // System-generated
          timestamp: new Date(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      logger.info('Sale dispatch recorded', { eventId, saleId });
      return result as InventoryEvent;
    });
  }

  /**
   * Record refund return (positive inventory delta)
   * Called by sales service when refund is processed
   *
   * @param tenantId - Tenant UUID
   * @param productId - Product UUID
   * @param quantity - Quantity returned (positive number)
   * @param saleId - Original sale transaction UUID
   * @returns Inserted inventory event
   */
  async recordRefundReturn(
    tenantId: string,
    productId: string,
    quantity: string,
    saleId: string
  ): Promise<InventoryEvent> {
    logger.info('Recording refund return', {
      tenantId,
      productId,
      quantity,
      saleId,
    });

    return withTenant(tenantId, async (trx) => {
      // Refund returns are positive (restoring stock)
      const quantityDelta = Math.abs(parseFloat(quantity)).toString();

      const eventId = uuidv4();
      const result = await trx
        .insertInto('inventory_events')
        .values({
          event_id: eventId,
          tenant_id: tenantId,
          product_id: productId,
          event_type: 'REFUND_RETURN',
          reason_code: 'CUSTOMER_RETURN',
          quantity_delta: quantityDelta,
          unit_buying_price: null,
          unit_selling_price: null,
          actor_user_id: null,
          timestamp: new Date(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      logger.info('Refund return recorded', { eventId, saleId });
      return result as InventoryEvent;
    });
  }

  /**
   * Manual stock adjustment (physical count reconciliation)
   * Calculates delta between current quantity and physical count
   *
   * @param tenantId - Tenant UUID
   * @param userId - User performing adjustment
   * @param input - Adjustment details (absolute quantity)
   * @returns Inserted inventory event
   */
  async recordAdjustment(
    tenantId: string,
    userId: string,
    input: AdjustmentInput
  ): Promise<InventoryEvent> {
    logger.info('Recording inventory adjustment', {
      tenantId,
      productId: input.productId,
      newQuantity: input.newQuantity,
      reasonCode: input.reasonCode,
    });

    return withTenant(tenantId, async (trx) => {
      // Fetch current quantity projection
      const product = await trx
        .selectFrom('products')
        .select('current_quantity')
        .where('product_id', '=', input.productId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      if (!product) {
        throw new AppError(
          'Product not found or access restricted',
          404,
          true,
          'PRODUCT_NOT_FOUND'
        );
      }

      // Calculate delta (new - current)
      const currentQty = parseFloat(product.current_quantity);
      const newQty = parseFloat(input.newQuantity);
      const delta = (newQty - currentQty).toString();

      // Only create event if delta is non-zero
      if (delta === '0') {
        logger.warn('Adjustment skipped: quantity unchanged', {
          tenantId,
          productId: input.productId,
        });
        throw new AppError(
          'Physical count matches system quantity',
          400,
          true,
          'NO_ADJUSTMENT_NEEDED'
        );
      }

      // Append adjustment event
      const eventId = uuidv4();
      const result = await trx
        .insertInto('inventory_events')
        .values({
          event_id: eventId,
          tenant_id: tenantId,
          product_id: input.productId,
          event_type: 'ADJUSTMENT',
          reason_code: input.reasonCode,
          quantity_delta: delta,
          unit_buying_price: null,
          unit_selling_price: null,
          actor_user_id: userId,
          timestamp: new Date(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      logger.info('Adjustment recorded', { eventId, delta });
      return result as InventoryEvent;
    });
  }

  /**
   * Fetch current stock snapshot for a product
   * Calculates current_quantity by aggregating all events
   *
   * @param tenantId - Tenant UUID
   * @param productId - Product UUID
   * @returns Stock snapshot with calculated quantity
   */
  async getStockSnapshot(
    tenantId: string,
    productId: string
  ): Promise<StockSnapshot> {
    return withTenant(tenantId, async (trx) => {
      // Aggregate all events for this product to calculate current quantity
      const result = await trx
        .selectFrom('inventory_events')
        .select((eb) => [
          'product_id',
          eb.fn('sum', ['quantity_delta']).as('current_quantity'),
          eb.fn('max', ['timestamp']).as('last_event_at'),
          eb.fn('count', ['event_id']).as('event_count'),
        ])
        .where('product_id', '=', productId)
        .where('tenant_id', '=', tenantId)
        .groupBy('product_id')
        .executeTakeFirst();

      if (!result) {
        throw new AppError(
          'No inventory events found for product',
          404,
          true,
          'NO_STOCK_HISTORY'
        );
      }

      return {
        product_id: result.product_id,
        current_quantity: result.current_quantity?.toString() || '0',
        last_event_at: result.last_event_at || new Date(),
        event_count: parseInt(result.event_count?.toString() || '0'),
      };
    });
  }

  /**
   * Fetch inventory event history for a product
   *
   * @param tenantId - Tenant UUID
   * @param productId - Product UUID
   * @param limit - Number of events to return (default 100)
   * @returns Array of inventory events ordered by timestamp desc
   */
  async getEventHistory(
    tenantId: string,
    productId: string,
    limit: number = 100
  ): Promise<InventoryEvent[]> {
    return withTenant(tenantId, async (trx) => {
      const events = await trx
        .selectFrom('inventory_events')
        .selectAll()
        .where('product_id', '=', productId)
        .where('tenant_id', '=', tenantId)
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .execute();

      return events as InventoryEvent[];
    });
  }

  /**
   * Verify inventory data integrity
   * Checks for orphaned events or calculation mismatches
   *
   * @param tenantId - Tenant UUID
   * @returns Integrity report
   */
  async verifyIntegrity(
    tenantId: string
  ): Promise<{
    healthy: boolean;
    mismatches: Array<{
      productId: string;
      cachedQuantity: string;
      calculatedQuantity: string;
    }>;
  }> {
    logger.info('Running inventory integrity check', { tenantId });

    return withTenant(tenantId, async (trx) => {
      // Fetch all products with cached current_quantity
      const products = await trx
        .selectFrom('products')
        .select(['product_id', 'current_quantity'])
        .where('tenant_id', '=', tenantId)
        .execute();

      const mismatches = [];

      // For each product, verify cached quantity matches ledger sum
      for (const product of products) {
        const calculated = await trx
          .selectFrom('inventory_events')
          .select((eb) => eb.fn('sum', ['quantity_delta']).as('total'))
          .where('product_id', '=', product.product_id)
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst();

        const calculatedQty = calculated?.total?.toString() || '0';

        if (calculatedQty !== product.current_quantity) {
          mismatches.push({
            productId: product.product_id,
            cachedQuantity: product.current_quantity,
            calculatedQuantity: calculatedQty,
          });

          logger.warn('Inventory mismatch detected', {
            productId: product.product_id,
            cached: product.current_quantity,
            calculated: calculatedQty,
          });
        }
      }

      return {
        healthy: mismatches.length === 0,
        mismatches,
      };
    });
  }

  /**
   * Rebuild current_quantity projection for all products
   * Called by projection-rebuild worker on schedule
   * Used to recover from cache corruption or recalculate after mass imports
   *
   * @param tenantId - Tenant UUID
   * @returns Number of products updated
   */
  async rebuildProjections(tenantId: string): Promise<number> {
    logger.info('Rebuilding inventory projections', { tenantId });

    return withTenant(tenantId, async (trx) => {
      // Fetch all products for this tenant
      const products = await trx
        .selectFrom('products')
        .select('product_id')
        .where('tenant_id', '=', tenantId)
        .execute();

      let updateCount = 0;

      for (const product of products) {
        // Calculate current quantity from events
        const result = await trx
          .selectFrom('inventory_events')
          .select((eb) => eb.fn('sum', ['quantity_delta']).as('total'))
          .where('product_id', '=', product.product_id)
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst();

        const newQuantity = result?.total?.toString() || '0';

        // Update cached projection
        await trx
          .updateTable('products')
          .set({ current_quantity: newQuantity })
          .where('product_id', '=', product.product_id)
          .where('tenant_id', '=', tenantId)
          .execute();

        updateCount++;
      }

      logger.info('Inventory projections rebuilt', {
        tenantId,
        productsUpdated: updateCount,
      });

      return updateCount;
    });
  }
}

// Export singleton instance
export const inventoryService = new InventoryService();