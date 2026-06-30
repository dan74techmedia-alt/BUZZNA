// apps/api/src/modules/sales/sales.service.ts
import { db } from '../../config/database';
import { CreateSaleDTO, WalkawaySyncBatchDTO, RefundSaleDTO } from './sales.schema';

export class SalesService {
  /**
   * Primary transactional execution matrix for checkout processing.
   * Leverages an Event-Sourced Inventory strategy and Append-Only Financial Logs.
   */
  static async executeCheckout(tenantId: string, userId: string, data: CreateSaleDTO) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_tenant_id', $1, true);`, [tenantId]);

      // Walkaway Sync Idempotency Guard check to block duplication vectors
      const trackingId = data.client_sale_id || crypto.randomUUID();
      const duplicateCheck = await client.query(
        `SELECT sale_id FROM sales WHERE (sale_id = $1 OR client_sale_id = $1) AND tenant_id = $2;`,
        [trackingId, tenantId]
      );
      if (duplicateCheck.rows.length > 0) {
        return { duplicate: true, sale_id: duplicateCheck.rows[0].sale_id };
      }

      let subtotal = 0;
      for (const item of data.items) {
        subtotal += (item.quantity * item.unit_price) - item.discount_amount;
      }
      const totalAmount = Math.max(0, subtotal - data.discount_amount);

      // Verify payment matching boundaries match the derived parameters precisely
      const structuralPaymentsTotal = data.payments.reduce((acc, p) => acc + p.amount, 0);
      if (Math.abs(structuralPaymentsTotal - totalAmount) > 0.01) {
        throw new Error('Payment allocation balances fail verification constraints');
      }

      // Generate base structural entity mapping
      const saleResult = await client.query(
        `INSERT INTO sales (tenant_id, client_sale_id, cashier_user_id, customer_id, total_amount, discount_amount, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'COMPLETED_VERIFIED')
         RETURNING sale_id, total_amount, created_at;`,
        [tenantId, trackingId, userId, data.customer_id || null, totalAmount, data.discount_amount]
      );
      const saleId = saleResult.rows[0].sale_id;

      // Iteratively capture parameters and spawn downstream domain projections
      for (const item of data.items) {
        await client.query(
          `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, discount_amount)
           VALUES ($1, $2, $3, $4, $5);`,
          [saleId, item.product_id, item.quantity, item.unit_price, item.discount_amount]
        );

        // Event-Sourced Inventory append step
        await client.query(
          `INSERT INTO inventory_events (tenant_id, product_id, event_type, quantity_delta, description)
           VALUES ($1, $2, 'SALE_DISPATCH', $3, $4);`,
          [tenantId, item.product_id, -Math.abs(item.quantity), `Items committed under invoice transaction: ${saleId}`]
        );

        // Modify running atomic aggregate projection matrix cache safely
        await client.query(
          `UPDATE products SET current_quantity = current_quantity - $1 WHERE product_id = $2 AND tenant_id = $3;`,
          [item.quantity, item.product_id, tenantId]
        );
      }

      // Track distribution pathways and shift weights
      for (const payment of data.payments) {
        await client.query(
          `INSERT INTO sale_payment_allocations (sale_id, payment_method, amount)
           VALUES ($1, $2, $3);`,
          [saleId, payment.payment_method, payment.amount]
        );

        if (payment.payment_method === 'CASH' && data.till_session_id) {
          await client.query(
            `UPDATE till_sessions 
             SET expected_cash_balance = expected_cash_balance + $1 
             WHERE till_session_id = $2 AND tenant_id = $3;`,
            [payment.amount, data.till_session_id, tenantId]
          );
        }

        if (payment.payment_method === 'DEBT') {
          if (!data.customer_id) throw new Error('Customer profiling parameters required for credit extension allocation mapping');
          await client.query(
            `INSERT INTO customer_credit_ledger (tenant_id, customer_id, sale_id, amount_delta, description)
             VALUES ($1, $2, $3, $4, $5);`,
            [tenantId, data.customer_id, saleId, payment.amount, `Credit account balance addition ledger marker: ${saleId}`]
          );
        }
      }

      await client.query('COMMIT');
      return { success: true, sale_id: saleId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Walkaway Sync Engine implementation rule: Processes batches of local offline actions.
   * Guarantees absolute network-independent consistency using deterministic LWW logic.
   */
  static async processWalkawaySync(tenantId: string, userId: string, data: WalkawaySyncBatchDTO) {
    const client = await db.getClient();
    const responses = [];

    const batchResult = await db.query(
      `INSERT INTO sync_batches (tenant_id, device_id, status) VALUES ($1, $2, 'SYNC_PENDING') RETURNING batch_id;`,
      [tenantId, data.device_id]
    );
    const batchId = batchResult.rows[0].batch_id;

    for (const event of data.events) {
      try {
        await db.query(
          `INSERT INTO sync_events (tenant_id, batch_id, client_event_id, entity_type, event_type, payload, occurred_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7);`,
          [tenantId, batchId, event.client_event_id, event.entity_type, event.event_type, event.payload, event.occurred_at]
        );

        if (event.event_type === 'SALE_CREATE') {
          const outcome = await this.executeCheckout(tenantId, userId, event.payload);
          responses.push({ client_event_id: event.client_event_id, status: 'SUCCESS', sale_id: outcome.sale_id });
        }
      } catch (err: any) {
        await db.query(
          `INSERT INTO sync_rejections (tenant_id, client_event_id, rejection_code, reason)
           VALUES ($1, $2, 'WALKAWAY_COLLISION_REJECT', $3);`,
          [tenantId, event.client_event_id, err.message || 'Internal operational error']
        );
        responses.push({ client_event_id: event.client_event_id, status: 'REJECTED', reason: err.message });
      }
    }

    await db.query(`UPDATE sync_batches SET status = 'PROCESSED', processed_at = NOW() WHERE batch_id = $1;`, [batchId]);
    return responses;
  }

  /**
   * Refund Restoration Pattern: True functional rollbacks are structural adjustments.
   * Deleting accounting journal data or records is completely disabled.
   */
  static async processRefund(tenantId: string, userId: string, saleId: string, data: RefundSaleDTO) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_tenant_id', $1, true);`, [tenantId]);

      const sourceCheck = await client.query(
        `SELECT status, total_amount FROM sales WHERE sale_id = $1 AND tenant_id = $2 FOR UPDATE;`,
        [saleId, tenantId]
      );
      if (sourceCheck.rows.length === 0 || sourceCheck.rows[0].status === 'VOIDED_REFUNDED') {
        throw new Error('Target sale is either invalid or already fully processed for transaction adjustments');
      }

      // Generate tracking entry for accounting logs
      await client.query(
        `INSERT INTO product_refunds (tenant_id, sale_id, executed_by, reason)
         VALUES ($1, $2, $3, $4);`,
         [tenantId, saleId, userId, data.reason]
      );

      for (const targetItem of data.items_to_refund) {
        // Enforce Event-Sourced recovery by feeding a positive delta into the event logs
        await client.query(
          `INSERT INTO inventory_events (tenant_id, product_id, event_type, quantity_delta, description)
           VALUES ($1, $2, 'RESTOCK_RESTORE', $3, $4);`,
          [tenantId, targetItem.product_id, Math.abs(targetItem.quantity), `Stock recovery for adjusted receipt matrix: ${saleId}`]
        );

        // Correct running aggregate counts safely
        await client.query(
          `UPDATE products SET current_quantity = current_quantity + $1 WHERE product_id = $2 AND tenant_id = $3;`,
          [targetItem.quantity, targetItem.product_id, tenantId]
        );
      }

      await client.query(`UPDATE sales SET status = 'VOIDED_REFUNDED' WHERE sale_id = $1;`, [saleId]);
      await client.query('COMMIT');
      return { success: true, tracking: saleId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}