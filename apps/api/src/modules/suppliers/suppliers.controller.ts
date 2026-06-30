// apps/api/src/modules/suppliers/suppliers.controller.ts
import { Router, Request, Response, NextFunction } from 'express';
import { SuppliersService } from './suppliers.service';
import { validate } from '../../common/middleware/validation.middleware';
import { createSupplierSchema } from './suppliers.schema';
import { requireAuth } from '../../common/middleware/auth.middleware';
import { enforceLicense } from '../../common/middleware/license-lockdown.middleware';

const router = Router();

router.use(requireAuth);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.user!.tenant_id;
    const suppliers = await SuppliersService.listSuppliers(tenantId);
    res.status(200).json({ data: suppliers.rows });
  } catch (error) {
    next(error);
  }
});

router.post('/', enforceLicense(['TRIAL_ACTIVE', 'FULLY_ACTIVATED']), validate(createSupplierSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.user!.tenant_id;
    const supplier = await SuppliersService.createSupplier(tenantId, req.body);
    res.status(201).json({ data: supplier });
  } catch (error) {
    next(error);
  }
});

export const SuppliersController = router;