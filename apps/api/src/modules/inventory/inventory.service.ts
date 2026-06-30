/**
 * File: apps/api/src/modules/inventory/inventory.service.ts
 * Description: Authoritative Event-Sourced Inventory Engine for BuzzNa D74.
 * Enforces pure append-only tracking over inventory_events and isolates the cached product projections.
 * Strictly adheres to multi-tenant transaction security limits and precision decimal integrity.
 */

import { v4 as uuidv4 } from 'uuid';
import { db } from '../../config/database';

export interface InventoryEventPayload {
  productId: string;
  eventType: 'STOCK_ADD' | 'SALE_DISPATCH' | 'REFUND_RETURN' | 'STOCK_COUNT_ADJUST' | 'SPOILAGE' | 'DAMAGE' | 'THEFT_LOSS';
  reasonCode: string | null;
  quantityDelta: string; // Transmitted as string to ensure NUMERIC(15,3) decimal integrity
  userId: string;
}

export class InventoryService {
  /**
   * Appends an immutable tracking record into the inventory ledger.
   * Automatically updates the product's cached projection inside a strict tenant-isolated transaction.
   */
  static async appendEvent(tenantId: string, event: InventoryEventPayload): Promise<void> {
    if (!tenantId || !event.productId || !event.quantityDelta) {
      throw new Error('InventoryEngineError: Missing critical transaction identifiers.');
    }

    await db.transaction(async (trx: any) => {
      // Layer 2: Explicitly inject current tenant ID context to bind PgBouncer session safety
      await trx.query(`SET LOCAL app.current_tenant_id = $1`, [tenantId]);

      // 1. Assert the target product exists and belongs within this tenant boundary
      const productCheck = await trx.query(
        `SELECT product_id, current_quantity FROM products WHERE product_id = $1 AND tenant_id = $2`,
        [event.productId, tenantId]
      );

      if (productCheck.rows.length === 0) {
        throw new Error(`InventoryEngineError: Targeted product catalog line item does not exist or access is restricted.`);
      }

      const currentCachedQty = parseFloat(productCheck.rows[0].current_quantity || '0.000');
      const incomingDelta = parseFloat(event.quantityDelta);
      const computedNewQty = currentCachedQty + incomingDelta;

      // 2. Write the immutable row entry to the ground truth ledger
      const eventId = uuidv4();
      await trx.query(
        `INSERT INTO inventory_events (
          event_id, tenant_id, product_id, event_type, reason_code, quantity_delta, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          eventId,
          tenantId,
          event.productId,
          event.eventType,
          event.reasonCode,
          event.quantityDelta
        ]
      );

      // 3. Update the cached product projection record
      await trx.query(
        `UPDATE products 
         SET current_quantity = current_quantity + $1 
         WHERE product_id = $2 AND tenant_id = $3`,
        [event.quantityDelta, event.productId, tenantId]
      );

      // 4. Walkaway Sync Rule: Evaluate for inventory anomalies (Negative Stock Post-Sync)
      // If stock drops below zero, the server accepts the state but registers an Attention Card for the business dashboard.
      if (computedNewQty < 0) {
        const alertId = uuidv4();
        await trx.query(
          `INSERT INTO security_events (
            event_id, tenant_id, entity_name, entity_id, severity, message, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [
            alertId,
            tenantId,
            'PRODUCTS',
            event.productId,
            'WARNING',
            `Inventory Anomaly: Product stock dipped to negative bounds (${computedNewQty.toFixed(3)}) following event type ${event.eventType}.`
          ]
        );
      }
    });
  }

  /**
   * Comprehensive Projection Rebuilder (Triggered by BullMQ projection-rebuild.worker.ts).
   * Scans the full historical chain of immutable event streams to audit and correct the cached projection.
   */
  static async rebuildProductProjection(tenantId: string, productId: string): Promise<string> {
    if (!tenantId || !productId) {
      throw new Error('InventoryEngineError: Identification fields required for projection rebuilding.');
    }

    return await db.transaction(async (trx: any) => {
      // Enforce connection pool context safety
      await trx.query(`SET LOCAL app.current_tenant_id = $1`, [tenantId]);

      // Calculate the true historical mathematical summation
      const ledgerSumResult = await trx.query(
        `SELECT COALESCE(SUM(quantity_delta), 0.000) as true_quantity 
         FROM inventory_events 
         WHERE product_id = $1 AND tenant_id = $2`,
        [productId, tenantId]
      );

      const trueQuantity = ledgerSumResult.rows[0].true_quantity;

      // Synchronize the cache matrix
      await trx.query(
        `UPDATE products 
         SET current_quantity = $1 
         WHERE product_id = $2 AND tenant_id = $3`,
        [trueQuantity, productId, tenantId]
      );

      return trueQuantity.toString();
    });
  }

  /**
   * Fetches accurate, real-time availability.
   * Can evaluate via rapid cached lookups (for high-velocity frontline POS checkouts) or live ledger compute.
   */
  static async getStockLevel(tenantId: string, productId: string, forceLiveLedgerCompute = false): Promise<string> {
    if (!tenantId || !productId) {
      throw new Error('InventoryEngineError: Required context keys are absent.');
    }

    const client = await db.connect();
    try {
      await client.query(`BEGIN`);
      await client.query(`SET LOCAL app.current_tenant_id = $1`, [tenantId]);

      if (forceLiveLedgerCompute) {
        const liveQuery = await client.query(
          `SELECT COALESCE(SUM(quantity_delta), 0.000) as balance 
           FROM inventory_events WHERE product_id = $1 AND tenant_id = $2`,
          [productId, tenantId]
        );
        await client.query(`COMMIT`);
        return liveQuery.rows[0].balance.toString();
      } else {
        const cacheQuery = await client.query(
          `SELECT current_quantity FROM products WHERE product_id = $1 AND tenant_id = $2`,
          [productId, tenantId]
        );
        await client.query(`COMMIT`);
        if (cacheQuery.rows.length === 0) {
          throw new Error('InventoryEngineError: Line item tracking target missing.');
        }
        return cacheQuery.rows[0].current_quantity.toString();
      }
    } catch (error) {
      await client.query(`ROLLBACK`);
      throw error;
    } finally {
      client.release();
    }
  }
}