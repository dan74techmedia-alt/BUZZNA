import { Response, Router } from 'express';
import { withTenant } from '../../config/database';
import { createProductSchema } from './catalog.schema';
import { AuthenticatedRequest, enforceTenantContext } from '../../common/middleware/tenant-context';

export const catalogRouter = Router();

// Apply the Layer 1 security middleware to all routes in this router
catalogRouter.use(enforceTenantContext);

catalogRouter.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = createProductSchema.parse(req.body);
    const tenantId = req.user!.tenantId;

    // Layer 2: Execute strictly within the RLS transaction wrapper
    const product = await withTenant(tenantId, async (trx) => {
      return await trx.insertInto('products')
        .values({
          tenant_id: tenantId,
          name: data.name,
          sku: data.sku || null,
          barcode: data.barcode || null,
          unit_of_measure: data.unitOfMeasure,
          cost_floor: data.costFloor.toString(), // Stored as NUMERIC string
          default_selling_price: data.defaultSellingPrice.toString(), // Stored as NUMERIC string
          current_quantity: '0.000', // Strictly initialized to zero. Must be altered via inventory_events.
          category_id: data.categoryId || null,
          is_active: true,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    });

    res.status(201).json({ message: 'Product created successfully', data: product });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to create product' });
  }
});