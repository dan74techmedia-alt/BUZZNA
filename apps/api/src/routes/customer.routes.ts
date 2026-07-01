import { Router } from 'express';
import * as customersController from '../modules/customers/customers.controller';
import { enforceLicenseWriteAccess } from '../common/middleware/license-lockdown.middleware';

const router = Router();

// Customer profiles and neighborhood debt books (Read-only)
router.get('/', customersController.getCustomers);
router.get('/:id', customersController.getCustomerById);
router.get('/:id/ledger', customersController.getCustomerLedger);

// Create or update customer profiles
router.post('/', enforceLicenseWriteAccess, customersController.createCustomer);
router.put('/:id', enforceLicenseWriteAccess, customersController.updateCustomer);

// Record customer debt repayments
router.post('/:id/repayments', enforceLicenseWriteAccess, customersController.recordRepayment);

export default router;