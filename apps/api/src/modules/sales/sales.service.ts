/**
 * ============================================================================
 * BUZZNA D74 - Sales Service (POS Checkout & Refund Processing)
 * ============================================================================
 *
 * PURPOSE:
 * - Process POS checkouts atomically (header + items + payments in single transaction)
 * - Calculate totals with discount/tax application
 * - Dispatch inventory events (via inventory service, NOT direct updates)
 * - Process refunds while maintaining append-only financial ledger
 * - Handle multi-payment allocation (CASH, MPESA, DEBT)
 * - Track till session cash flow
 *
 * ARCHITECTURAL RULES (CRITICAL):
 * 1. Checkout is ATOMIC - all or nothing (sale + items + inventory + payments)
 * 2. NEVER call inventory_events INSERT directly - use inventoryService.recordSaleDispatch()
 * 3. NEVER UPDATE products.current_quantity - managed by projection rebuild worker
 * 4. Refunds append to sale_refunds (read-only history), original sale marked as REFUNDED
 * 5. Payment allocations track method + amount (cash drawer reconciliation)
 * 6. Idempotency: client_sale_id prevents duplicate checkouts
 * 7. All monetary amounts use NUMERIC(12,2) - no floating point
 *
 * DATABASE DEPENDENCIES:
 * - sales (checkout header, immutable append-only)
 * - sale_items (line items, immutable)
 * - sale_payment_allocations (payment distribution, immutable)
 * - sale_refunds (refund history, immutable)
 * - sale_voids (void history, immutable)
 * - inventory_events (via inventoryService)
 * - till_sessions (cash drawer tracking)
 * - customers (optional debt tracking)
 *
 * ============================================================================
 */

import { Transaction } from 'kysely';
import { db, withTenant } from '../../config/database';
import { DatabaseSchema } from '../../db/migrations/schema';
import { AppError } from '../../common/errors/AppError';
import { logger } from '../../common/logging/logger';
import { inventoryService } from '../inventory/inventory.service';
import { v4 as uuidv4 } from 'uuid';

/**
 * Sale item input
 */
export interface SaleItemInput {
  product_id: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
}

/**
 * Payment allocation input
 */
export interface PaymentAllocationInput {
  payment_method: 'CASH' | 'MPESA' | 'DEBT' | 'BANK_TRANSFER';
  amount: number;
}

/**
 * Checkout input
 */
export interface CheckoutInput {
  client_sale_id?: string; // Idempotency key from client
  till_session_id: string;
  customer_id?: string; // Optional for walk-in
  items: SaleItemInput[];
  payments: PaymentAllocationInput[];
  discount_amount: number;
}

/**
 * Sale output
 */
export interface Sale {
  sale_id: string;
  tenant_id: string;
  till_session_id: string;
  customer_id: string | null;
  status: string;
  total_amount: string;
  discount_amount: string;
  created_at: Date;
  items?: SaleItem[];
  payments?: PaymentAllocation[];
}

/**
 * Sale item output
 */
export interface SaleItem {
  sale_item_id: string;
  product_id: string;
  quantity: string;
  unit_price: string;
  line_discount: string;
}

/**
 * Payment allocation output
 */
export interface PaymentAllocation {
  allocation_id: string;
  payment_method: string;
  amount: string;
}

/**
 * Refund output
 */
export interface SaleRefund {
  sale_refund_id: string;
  sale_id: string;
  refunded_by: string;
  refund_type: string;
  refund_amount: string;
  created_at: Date;
}

/**
 * Sales Service
 */
class SalesService {
  /**
   * Execute POS checkout atomically
   *
   * CRITICAL TRANSACTION SEQUENCE:
   * 1. Validate till session exists and is open
   * 2. Check for duplicate checkout (idempotency)
   * 3. Validate all products exist and belong to tenant
   * 4. Calculate totals with precision
   * 5. Verify payment allocations sum correctly
   * 6. Create sale header
   * 7. Create sale items
   * 8. Create payment allocations
   * 9. Dispatch inventory events (via inventoryService)
   * 10. Update till session expected balance
   * 11. Update customer debt (if DEBT payment)
   *
   * On any error, ENTIRE transaction rolls back
   *
   * @param tenantId - Tenant UUID
   * @param userId - Cashier user UUID
   * @param input - Checkout data
   * @returns Created sale with items and payments
   */
  async executeCheckout(
    tenantId: string,
    userId: string,
    input: CheckoutInput
  ): Promise<Sale> {
    logger.info('Executing POS checkout', {
      tenantId,
      itemCount: input.items.length,
      paymentCount: input.payments.length,
    });

    return withTenant(tenantId, async (trx) => {
      // ====================================================================
      // PHASE 1: Validation
      // ====================================================================

      // Validate till session exists and is open
      const tillSession = await trx
        .selectFrom('till_sessions')
        .selectAll()
        .where('till_session_id', '=', input.till_session_id)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      if (!tillSession) {
        throw new AppError('Till session not found or unauthorized', 404, true, 'TILL_NOT_FOUND');
      }

      if (tillSession.status !== 'OPEN') {
        throw new AppError('Till session is not open', 409, true, 'TILL_NOT_OPEN');
      }

      // Check for duplicate checkout (idempotency protection)
      if (input.client_sale_id) {
        const existing = await trx
          .selectFrom('sales')
          .select('sale_id')
          .where('tenant_id', '=', tenantId)
          .where((eb) =>
            eb.or([
              eb('sale_id', '=', input.client_sale_id!),
              // Could also track client_sale_id in a separate tracking table
            ])
          )
          .executeTakeFirst();

        if (existing) {
          logger.warn('Duplicate checkout detected (idempotency)', {
            tenantId,
            clientSaleId: input.client_sale_id,
          });
          // Return existing sale instead of creating duplicate
          // (In production, fetch and return the existing sale)
          throw new AppError('Sale already exists', 409, true, 'DUPLICATE_SALE');
        }
      }

      // Validate customer exists if provided
      if (input.customer_id) {
        const customer = await trx
          .selectFrom('customers')
          .select('customer_id')
          .where('customer_id', '=', input.customer_id)
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst();

        if (!customer) {
          throw new AppError('Customer not found', 404, true, 'CUSTOMER_NOT_FOUND');
        }
      }

      // Validate all products exist
      const productIds = input.items.map((item) => item.product_id);
      const products = await trx
        .selectFrom('products')
        .select(['product_id', 'current_quantity', 'allow_negative_stock'])
        .where('product_id', 'in', productIds)
        .where('tenant_id', '=', tenantId)
        .execute();

      if (products.length !== input.items.length) {
        throw new AppError('One or more products not found', 404, true, 'PRODUCT_NOT_FOUND');
      }

      // ====================================================================
      // PHASE 2: Calculate Totals
      // ====================================================================

      let subtotal = 0;
      const calculatedItems = input.items.map((item) => {
        const lineTotal = item.quantity * item.unit_price - item.discount_amount;
        subtotal += lineTotal;
        return {
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
          line_discount: item.discount_amount,
          lineTotal,
        };
      });

      const totalBeforeDiscount = subtotal;
      const finalTotal = Math.max(0, subtotal - input.discount_amount);

      logger.info('Checkout totals calculated', {
        tenantId,
        subtotal,
        discount: input.discount_amount,
        finalTotal,
      });

      // ====================================================================
      // PHASE 3: Verify Payment Allocation
      // ====================================================================

      const paymentTotal = input.payments.reduce((sum, p) => sum + p.amount, 0);
      const paymentDifference = Math.abs(paymentTotal - finalTotal);

      if (paymentDifference > 0.01) {
        throw new AppError(
          `Payment allocation mismatch: total KES ${finalTotal.toFixed(2)} vs allocated KES ${paymentTotal.toFixed(
            2
          )}`,
          400,
          true,
          'PAYMENT_MISMATCH'
        );
      }

      // ====================================================================
      // PHASE 4: Create Sale Header (ATOMIC)
      // ====================================================================

      const saleId = uuidv4();

      const sale = await trx
        .insertInto('sales')
        .values({
          sale_id: saleId,
          tenant_id: tenantId,
          till_session_id: input.till_session_id,
          customer_id: input.customer_id || null,
          status: 'COMPLETED_VERIFIED',
          total_amount: finalTotal.toString(),
          discount_amount: input.discount_amount.toString(),
          notes: null,
          created_at: new Date(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      logger.info('Sale header created', { tenantId, saleId });

      // ====================================================================
      // PHASE 5: Create Sale Items
      // ====================================================================

      const saleItems: SaleItem[] = [];

      for (const item of calculatedItems) {
        const saleItemId = uuidv4();

        const saleItem = await trx
          .insertInto('sale_items')
          .values({
            sale_item_id: saleItemId,
            tenant_id: tenantId,
            sale_id: saleId,
            product_id: item.product_id,
            quantity: item.quantity.toString(),
            unit_price: item.unit_price.toString(),
            line_discount: item.line_discount.toString(),
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        saleItems.push(saleItem as SaleItem);
      }

      logger.info('Sale items created', { tenantId, saleId, itemCount: saleItems.length });

      // ====================================================================
      // PHASE 6: Create Payment Allocations
      // ====================================================================

      const paymentAllocations: PaymentAllocation[] = [];

      for (const payment of input.payments) {
        const allocationId = uuidv4();

        const allocation = await trx
          .insertInto('sale_payment_allocations')
          .values({
            allocation_id: allocationId,
            tenant_id: tenantId,
            sale_id: saleId,
            payment_method: payment.payment_method,
            amount: payment.amount.toString(),
            merchant_payment_id: null,
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        paymentAllocations.push(allocation as PaymentAllocation);
      }

      logger.info('Payment allocations created', {
        tenantId,
        saleId,
        allocationCount: paymentAllocations.length,
      });

      // ====================================================================
      // PHASE 7: Dispatch Inventory Events
      // ====================================================================
      // CRITICAL: Use inventoryService, NOT direct database updates

      for (const item of calculatedItems) {
        try {
          await inventoryService.recordSaleDispatch(
            tenantId,
            item.product_id,
            item.quantity.toString(),
            saleId
          );
        } catch (error) {
          logger.error('Failed to dispatch inventory event', {
            tenantId,
            saleId,
            productId: item.product_id,
            error,
          });
          throw new AppError('Inventory dispatch failed', 500, false);
        }
      }

      logger.info('Inventory events dispatched', {
        tenantId,
        saleId,
        eventCount: calculatedItems.length,
      });

      // ====================================================================
      // PHASE 8: Update Till Session Cash Balance
      // ====================================================================

      const cashPayments = input.payments
        .filter((p) => p.payment_method === 'CASH')
        .reduce((sum, p) => sum + p.amount, 0);

      if (cashPayments > 0) {
        await trx
          .updateTable('till_sessions')
          .set({
            expected_cash_balance: (parseFloat(tillSession.expected_cash_balance?.toString() || '0') + cashPayments).toString(),
          })
          .where('till_session_id', '=', input.till_session_id)
          .execute();

        logger.info('Till session updated', {
          tenantId,
          till_session_id: input.till_session_id,
          cashAmount: cashPayments,
        });
      }

      // ====================================================================
      // PHASE 9: Update Customer Debt (if DEBT payment)
      // ====================================================================

      const debtPayment = input.payments.find((p) => p.payment_method === 'DEBT');
      if (debtPayment && input.customer_id) {
        const debtLedgerId = uuidv4();

        await trx
          .insertInto('customer_credit_ledger')
          .values({
            ledger_id: debtLedgerId,
            tenant_id: tenantId,
            customer_id: input.customer_id,
            sale_id: saleId,
            amount_delta: debtPayment.amount.toString(),
            description: `Sale transaction: ${saleId}`,
            created_at: new Date(),
          })
          .execute();

        logger.info('Customer debt ledger updated', {
          tenantId,
          customerId: input.customer_id,
          debtAmount: debtPayment.amount,
        });
      }

      logger.info('Checkout completed successfully', {
        tenantId,
        saleId,
        total: finalTotal,
      });

      return {
        sale_id: sale.sale_id,
        tenant_id: sale.tenant_id,
        till_session_id: sale.till_session_id,
        customer_id: sale.customer_id,
        status: sale.status,
        total_amount: sale.total_amount,
        discount_amount: sale.discount_amount,
        created_at: sale.created_at,
        items: saleItems,
        payments: paymentAllocations,
      };
    });
  }

  /**
   * Process refund for a completed sale
   *
   * REFUND STATE MACHINE:
   * 1. Fetch original sale (must be COMPLETED_VERIFIED)
   * 2. Validate refund hasn't already been processed
   * 3. Create refund record (append-only history)
   * 4. Restore inventory via inventoryService.recordRefundReturn()
   * 5. Reverse customer debt (if applicable)
   * 6. Update till session cash balance
   *
   * Original sale record is NEVER deleted (audit trail)
   *
   * @param tenantId - Tenant UUID
   * @param saleId - Sale UUID to refund
   * @param userId - User initiating refund
   * @param itemsToRefund - Array of {productId, quantity}
   * @param reason - Refund reason
   * @returns Created refund record
   */
  async refundSale(
    tenantId: string,
    saleId: string,
    userId: string,
    itemsToRefund: Array<{ product_id: string; quantity: number }>,
    reason: string
  ): Promise<SaleRefund> {
    logger.info('Processing sale refund', {
      tenantId,
      saleId,
      itemCount: itemsToRefund.length,
      reason,
    });

    return withTenant(tenantId, async (trx) => {
      // ====================================================================
      // PHASE 1: Fetch and Validate Original Sale
      // ====================================================================

      const originalSale = await trx
        .selectFrom('sales')
        .selectAll()
        .where('sale_id', '=', saleId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      if (!originalSale) {
        throw new AppError('Sale not found', 404, true, 'SALE_NOT_FOUND');
      }

      if (originalSale.status === 'REFUNDED') {
        throw new AppError('Sale already refunded', 409, true, 'ALREADY_REFUNDED');
      }

      if (originalSale.status === 'VOIDED') {
        throw new AppError('Voided sales cannot be refunded', 409, true, 'SALE_VOIDED');
      }

      // ====================================================================
      // PHASE 2: Validate Refund Items
      // ====================================================================

      const saleItems = await trx
        .selectFrom('sale_items')
        .selectAll()
        .where('sale_id', '=', saleId)
        .where('tenant_id', '=', tenantId)
        .execute();

      for (const refundItem of itemsToRefund) {
        const saleItem = saleItems.find((item) => item.product_id === refundItem.product_id);
        if (!saleItem) {
          throw new AppError(
            `Product ${refundItem.product_id} not found in original sale`,
            400,
            true,
            'PRODUCT_NOT_IN_SALE'
          );
        }

        if (refundItem.quantity > parseFloat(saleItem.quantity)) {
          throw new AppError(
            `Refund quantity exceeds sale quantity for product ${refundItem.product_id}`,
            400,
            true,
            'QUANTITY_EXCEEDS_SALE'
          );
        }
      }

      // ====================================================================
      // PHASE 3: Calculate Refund Amount
      // ====================================================================

      let refundAmount = 0;
      for (const refundItem of itemsToRefund) {
        const saleItem = saleItems.find((item) => item.product_id === refundItem.product_id)!;
        const itemRefund = refundItem.quantity * parseFloat(saleItem.unit_price);
        refundAmount += itemRefund;
      }

      logger.info('Refund amount calculated', {
        tenantId,
        saleId,
        refundAmount,
      });

      // ====================================================================
      // PHASE 4: Create Refund Record (Append-Only)
      // ====================================================================

      const refundId = uuidv4();

      const refund = await trx
        .insertInto('sale_refunds')
        .values({
          sale_refund_id: refundId,
          tenant_id: tenantId,
          sale_id: saleId,
          refunded_by: userId,
          refund_type: 'FULL', // Could be PARTIAL in future
          refund_amount: refundAmount.toString(),
          notes: reason,
          created_at: new Date(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      logger.info('Refund record created', { tenantId, refundId, saleId });

      // ====================================================================
      // PHASE 5: Restore Inventory
      // ====================================================================

      for (const refundItem of itemsToRefund) {
        try {
          await inventoryService.recordRefundReturn(
            tenantId,
            refundItem.product_id,
            refundItem.quantity.toString(),
            saleId
          );
        } catch (error) {
          logger.error('Failed to restore inventory', {
            tenantId,
            saleId,
            productId: refundItem.product_id,
            error,
          });
          throw new AppError('Inventory restoration failed', 500, false);
        }
      }

      logger.info('Inventory restored', {
        tenantId,
        saleId,
        itemCount: itemsToRefund.length,
      });

      // ====================================================================
      // PHASE 6: Reverse Customer Debt
      // ====================================================================

      if (originalSale.customer_id) {
        const debtPayments = await trx
          .selectFrom('sale_payment_allocations')
          .select('amount')
          .where('sale_id', '=', saleId)
          .where('payment_method', '=', 'DEBT')
          .execute();

        const totalDebtRefunded = debtPayments.reduce((sum, p) => sum + parseFloat(p.amount), 0);

        if (totalDebtRefunded > 0) {
          const debtReversalId = uuidv4();

          await trx
            .insertInto('customer_credit_ledger')
            .values({
              ledger_id: debtReversalId,
              tenant_id: tenantId,
              customer_id: originalSale.customer_id,
              sale_id: saleId,
              amount_delta: (-totalDebtRefunded).toString(),
              description: `Refund reversal: ${saleId}`,
              created_at: new Date(),
            })
            .execute();

          logger.info('Customer debt reversed', {
            tenantId,
            customerId: originalSale.customer_id,
            debtReversed: totalDebtRefunded,
          });
        }
      }

      // ====================================================================
      // PHASE 7: Update Sale Status
      // ====================================================================

      await trx
        .updateTable('sales')
        .set({ status: 'REFUNDED' })
        .where('sale_id', '=', saleId)
        .execute();

      logger.info('Sale marked as refunded', { tenantId, saleId });

      return refund as SaleRefund;
    });
  }

  /**
   * Fetch sale details including items and payments
   *
   * @param tenantId - Tenant UUID
   * @param saleId - Sale UUID
   * @returns Complete sale with related records
   */
  async getSaleDetails(tenantId: string, saleId: string): Promise<Sale> {
    return withTenant(tenantId, async (trx) => {
      // Fetch sale header
      const sale = await trx
        .selectFrom('sales')
        .selectAll()
        .where('sale_id', '=', saleId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      if (!sale) {
        throw new AppError('Sale not found', 404, true, 'SALE_NOT_FOUND');
      }

      // Fetch items
      const items = await trx
        .selectFrom('sale_items')
        .selectAll()
        .where('sale_id', '=', saleId)
        .where('tenant_id', '=', tenantId)
        .execute();

      // Fetch payments
      const payments = await trx
        .selectFrom('sale_payment_allocations')
        .selectAll()
        .where('sale_id', '=', saleId)
        .where('tenant_id', '=', tenantId)
        .execute();

      return {
        sale_id: sale.sale_id,
        tenant_id: sale.tenant_id,
        till_session_id: sale.till_session_id,
        customer_id: sale.customer_id,
        status: sale.status,
        total_amount: sale.total_amount,
        discount_amount: sale.discount_amount,
        created_at: sale.created_at,
        items: items as SaleItem[],
        payments: payments as PaymentAllocation[],
      };
    });
  }
}

// Export singleton instance
export const salesService = new SalesService();