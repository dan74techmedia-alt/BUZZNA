// File: apps/api/src/modules/inventory/inventory.service.ts
// Purpose: Core event-sourced inventory management. 
// Every stock change MUST trigger an event log.

import { PoolClient } from 'pg';
import { db } from '../../config/database';
import { IInventoryEventInput, InventoryEventType } from './inventory.schema';

export class InventoryService {

    /**
     * Records an inventory event and updates the product projection atomically.
     * This ensures the event log is always the source of truth.
     */
    static async recordEvent(tenantId: string, data: IInventoryEventInput): Promise<void> {
        const client: PoolClient = await db.connect();
        try {
            await client.query('BEGIN');
            await client.query('SET LOCAL app.current_tenant_id = $1', [tenantId]);

            // 1. Insert the immutable event record
            await client.query(`
                INSERT INTO inventory_events (
                    tenant_id, product_id, event_type, quantity_delta, reason, created_at
                ) VALUES ($1, $2, $3, $4, $5, now())
            `, [tenantId, data.product_id, data.event_type, data.quantity_delta, data.reason || '']);

            // 2. Update the product projection (current_quantity)
            // The database constraint handles the logic for current_quantity.
            const updateResult = await client.query(`
                UPDATE products 
                SET current_quantity = current_quantity + $1
                WHERE product_id = $2 AND tenant_id = $3
                RETURNING current_quantity
            `, [data.quantity_delta, data.product_id, tenantId]);

            if (updateResult.rowCount === 0) {
                throw new Error('INVENTORY_ERROR: Product not found or access denied.');
            }

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Retrieves the event history for auditability.
     */
    static async getEventHistory(tenantId: string, productId: string): Promise<any[]> {
        const client: PoolClient = await db.connect();
        try {
            await client.query('BEGIN');
            await client.query('SET LOCAL app.current_tenant_id = $1', [tenantId]);

            const { rows } = await client.query(`
                SELECT event_type, quantity_delta, reason, created_at
                FROM inventory_events
                WHERE product_id = $1
                ORDER BY created_at DESC
            `, [productId]);

            await client.query('COMMIT');
            return rows;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}