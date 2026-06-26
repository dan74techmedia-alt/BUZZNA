import { Response, Router } from 'express';
import { sql, ExpressionBuilder } from 'kysely';
import { withTenant } from '../../config/database';
import { createSaleSchema } from './sales.schema';
import { AuthenticatedRequest, enforceTenantContext } from '../../common/middleware/tenant-context';
import { DB } from '../../database/types'; // Ensure this path points to your actual DB interface definition

export const salesRouter = Router();
salesRouter.use(enforceTenantContext);

salesRouter.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = createSaleSchema.parse(req.body);
    const tenantId = req.user!.tenantId;
    const userId = req.user!.userId;

    const saleTotal = data.items.reduce((sum, item) => sum + (item.quantity * item.unitPrice) - item.lineDiscount, 0);
    const discountTotal = data.items.reduce((sum, item) => sum + item.lineDiscount, 0);

    const saleResult = await withTenant(tenantId, async (trx) => {
      // 1. Write Header Manifest
      const sale = await trx.insertInto('sales')
        .values({
          tenant_id: tenantId,
          till_session_id: data.tillSessionId,
          customer_id: data.customerId || null,
          status: 'FINALIZED',
          total_amount: saleTotal.toString(),
          discount_amount: discountTotal.toString(),
          notes: data.notes || null,
        })
        .returning('sale_id')
        .executeTakeFirstOrThrow();

      // 2. Write Sale Items & Deduct Inventory via Event Log
      for (const item of data.items) {
        await trx.insertInto('sale_items')
          .values({
            tenant_id: tenantId,
            sale_id: sale.sale_id,
            product_id: item.productId,
            quantity: item.quantity.toString(),
            unit_price: item.unitPrice.toString(),
            line_discount: item.lineDiscount.toString(),
          })
          .execute();

        // Append Event Sourced Inventory Deduction
        await trx.insertInto('inventory_events')
          .values({
            tenant_id: tenantId,
            product_id: item.productId,
            event_type: 'SALE_DISPATCH',
            quantity_delta: (-Math.abs(item.quantity)).toString(), 
            unit_selling_price: item.unitPrice.toString(),
            actor_user_id: userId,
          })
          .execute();

        // Project cached inventory
        // Explicitly typed 'eb' to satisfy strict TypeScript requirements
        await trx.updateTable('products')
          .set((eb: ExpressionBuilder<DB, 'products'>) => ({
            current_quantity: sql`current_quantity - ${item.quantity}`,
          }))
          .where('product_id', '=', item.productId)
          .execute();
      }

      // 3. Write Payment Allocations
      let cashTotal = 0;
      for (const payment of data.paymentAllocations) {
        await trx.insertInto('sale_payment_allocations')
          .values({
            tenant_id: tenantId,
            sale_id: sale.sale_id,
            payment_method: payment.paymentMethod,
            amount: payment.amount.toString(),
            merchant_payment_id: payment.merchantPaymentId || null,
          })
          .execute();
          
        if (payment.paymentMethod === 'CASH') {
            cashTotal += payment.amount;
        }
      }

      // 4. Update Till Expected Balance
      if (cashTotal > 0) {
        // Explicitly typed 'eb'
        await trx.updateTable('till_sessions')
          .set((eb: ExpressionBuilder<DB, 'till_sessions'>) => ({
            expected_cash_balance: sql`expected_cash_balance + ${cashTotal}`,
          }))
          .where('till_session_id', '=', data.tillSessionId)
          .execute();
      }

      return sale.sale_id;
    });

    res.status(201).json({ message: 'Sale finalized successfully', saleId: saleResult });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to process sale manifest' });
  }
});