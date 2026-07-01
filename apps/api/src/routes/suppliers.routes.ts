import { Router } from 'express';
import * as suppliersController from '../modules/suppliers/suppliers.controller';
import { enforceLicenseWriteAccess } from '../common/middleware/license-lockdown.middleware';

const router = Router();

// B2B Supply Lines mapping
router.get('/', suppliersController.getSuppliers);
router.get('/:id', suppliersController.getSupplierById);
router.get('/:id/transactions', suppliersController.getSupplierTransactions);

// Supplier Management
router.post('/', enforceLicenseWriteAccess, suppliersController.createSupplier);
router.put('/:id', enforceLicenseWriteAccess, suppliersController.updateSupplier);

// Record supplier payments or credits
router.post('/:id/transactions', enforceLicenseWriteAccess, suppliersController.recordTransaction);

export default router;