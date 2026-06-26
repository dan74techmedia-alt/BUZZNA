import { Response, Router } from 'express';
import { sql } from 'kysely';
import { db, withTenant } from '../../config/database';
import { restockSchema } from './inventory.schema';
import { AuthenticatedRequest, enforceTenantContext } from '../../common/middleware/tenant-context';
import { AutomationEngine } from '../automation/automation.service';

export const inventoryRouter = Router();

// Apply tenant context enforcement to all routes
inventoryRouter.use(enforceTenantContext);

// --- RESTock Endpoint ---
inventoryRouter.post('/restocks', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = restockSchema.parse(req.body);
    const tenantId = req.user!.tenantId;
    const userId = req.user!.userId;

    const result = await withTenant(tenantId, async (trx) => {
      // 1. Append the authoritative log row
      const event = await trx.insertInto('inventory_events')
        .values({
          tenant_id: tenantId,
          product_id: data.productId,
          event_type: 'STOCK_ADD',
          reason_code: data.reasonCode || 'RESTOCK',
          quantity_delta: data.quantityDelta.toString(),
          unit_buying_price: data.unitBuyingPrice?.toString() || null,
          unit_selling_price: data.unitSellingPrice?.toString() || null,
          actor_user_id: userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // 2. Update Product Quantity (UI Projection Cache)
      await trx.updateTable('products')
        .set((eb) => ({
          current_quantity: sql`current_quantity + ${data.quantityDelta}`,
        }))
        .where('product_id', '=', data.productId)
        .execute();

      return event;
    });

    res.status(201).json({ message: 'Restock event logged', data: result });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to process restock' });
  }
});

// --- Internal Helper: Stock Deduction ---
/**
 * Processes a stock deduction and triggers automation hooks
 * Logic uses fire-and-forget for the AutomationEngine to ensure performance
 */
export async function processStockDeduction(
  tenantId: string, 
  productId: string, 
  quantitySold: number
): Promise<void> {
  // 1. Perform Deduction
  // Assumes a centralized deduction service exists or direct DB query
  const newQuantity = await db.updateTable('products')
    .set((eb) => ({
      current_quantity: sql`current_quantity - ${quantitySold}`,
    }))
    .where('product_id', '=', productId)
    .returning('current_quantity')
    .executeTakeFirstOrThrow();

  // 2. Fetch product details for context
  const product = await db.selectFrom('products')
    .selectAll()
    .where('product_id', '=', productId)
    .executeTakeFirstOrThrow();

  // 3. Fire-and-forget Automation Engine (Async)
  AutomationEngine.processEvent(tenantId, 'LOW_STOCK', {
    product_id: productId,
    product_name: product.name,
    current_quantity: Number(newQuantity.current_quantity),
    supplier_id: product.primary_supplier_id
  }).catch((err) => console.error(`[Automation Error]: ${err.message}`));
}