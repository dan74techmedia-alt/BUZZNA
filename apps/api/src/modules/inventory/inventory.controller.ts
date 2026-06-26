import { Response, Router } from 'express';
import { sql } from 'kysely';
import { withTenant } from '../../config/database';
import { restockSchema } from './inventory.schema';
import { AuthenticatedRequest, enforceTenantContext } from '../../common/middleware/tenant-context';

export const inventoryRouter = Router();
inventoryRouter.use(enforceTenantContext);

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

      // 2. Automated Transaction Hook for UI Projection Cache Rebuild
      // This strictly follows the rule of projecting from events rather than isolated updates
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