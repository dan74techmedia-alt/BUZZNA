/**
 * @file inventory.service.ts
 * @description Domain Service for Event-Sourced Inventory Operations.
 * @author Daniel Githinji (Dantyz) - Systems Architect
 * * Executes database transactions for the inventory domain, ensuring all
 * * operations append to the authoritative ledger rather than updating stock directly.
 */

import {logger} from '../../common/logging/logger';
import { withTenantTransaction } from '../../index';

// Type definition based on the Zod schema from the controller
interface RestockItemPayload {
  productId: string;
  quantityDelta: number;
  unitBuyingPrice?: number;
  unitSellingPrice?: number;
  reasonCode: string;
}

export class InventoryService {
  /**
   * Appends a batch of restock events to the immutable inventory ledger.
   * Enforces Layer 2 RLS security by executing within the tenant-bound transaction wrapper.
   * * @param tenantId UUID of the operating business
   * @param userId UUID of the user committing the action
   * @param items Array of validated restock items
   * @returns Array of inserted inventory_events rows
   */
  static async processRestock(
    tenantId: string, 
    userId: string, 
    items: RestockItemPayload[]
  ) {
    logger.info(`[InventoryService] Committing ${items.length} restock events to ledger for tenant: ${tenantId}`);

    return await withTenantTransaction(tenantId, async (client) => {
      const insertedEvents = [];

      for (const item of items) {
        // Source: BUZZNA D74 Architecture - "Authoritative Ledger Sourcing: Inventory integer/decimal fields MUST NEVER be manipulated directly via update queries." [cite: 211]
        // We strictly append to the inventory_events table. The materialized views or Projection Worker will handle the UI current_quantity cache later.
        
        const query = `
          INSERT INTO inventory_events (
            tenant_id, 
            product_id, 
            event_type, 
            reason_code, 
            quantity_delta, 
            unit_buying_price, 
            unit_selling_price, 
            actor_user_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *;
        `;

        const values = [
          tenantId,
          item.productId,
          'STOCK_ADD',                           // event_type [cite: 68]
          item.reasonCode,                       // reason_code (e.g., INITIAL_COUNT) [cite: 68]
          item.quantityDelta,                    // quantity_delta [cite: 68]
          item.unitBuyingPrice || null,
          item.unitSellingPrice || null,
          userId
        ];

        const result = await client.query(query, values);
        insertedEvents.push(result.rows[0]);
      }

      logger.info(`[InventoryService] Successfully appended ${insertedEvents.length} ledger events.`);
      return insertedEvents;
    });
  }
}