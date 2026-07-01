// apps/api/src/modules/customers/customers.controller.ts
import { Router, Request, Response, NextFunction } from 'express';
import { CustomersService } from './customers.service';
import { validate } from '../../common/middleware/validation.middleware';
import { createCustomerSchema, recordRepaymentSchema } from './customers.schema';
import { requireAuth } from '../../common/middleware/auth.middleware';
import { enforceLicense } from '../../common/middleware/license-lockdown.middleware';

const router = Router();

// Secure all routes within this module
router.use(requireAuth);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.user!.tenant_id;
    const customers = await CustomersService.listCustomers(tenantId);
    res.status(200).json({ data: customers.rows });
  } catch (error) {
    next(error);
  }
});

router.post('/', enforceLicense(['TRIAL_ACTIVE', 'FULLY_ACTIVATED']), validate(createCustomerSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.user!.tenant_id;
    const customer = await CustomersService.createCustomer(tenantId, req.body);
    res.status(201).json({ data: customer });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/repayments', enforceLicense(['TRIAL_ACTIVE', 'FULLY_ACTIVATED', 'PAYMENT_DUE']), validate(recordRepaymentSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.user!.tenant_id;
    const userId = req.user!.user_id;
    const customerId = req.params.id;
    
    const result = await CustomersService.recordRepayment(tenantId, customerId, userId, req.body);
    res.status(201).json({ data: result });
  } catch (error) {
    next(error);
  }
});

export const CustomersController = router;

export function getCustomerLedger(arg0: string, getCustomerLedger: any) {
    throw new Error('Function not implemented.');
}
