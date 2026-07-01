import { Router } from 'express';
import * as salesController from '../modules/sales/sales.controller';
import { enforceLicenseWriteAccess } from '../common/middleware/license-lockdown.middleware';

const router = Router();

// Read historical sales manifests
router.get('/', salesController.getSales);
router.get('/:id', salesController.getSaleById);

// Finalize checkout manifest (writes header, items, and allocations simultaneously).
// Strictly blocked if the tenant is in SUSPENDED_NON_PAYMENT state.
router.post('/', enforceLicenseWriteAccess, salesController.createSale);

// Process structural partial or full sale item return refunds.
// Executes the Master Refund & Inventory Restoration Recipe.
router.post('/:id/refund', enforceLicenseWriteAccess, salesController.refundSale);

// Void a sale completely (appending a void event, no row deletion)
router.post('/:id/void', enforceLicenseWriteAccess, salesController.voidSale);

export default router;