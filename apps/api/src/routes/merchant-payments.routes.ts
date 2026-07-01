import { Router } from 'express';
import * as darajaController from '../modules/merchant-payments/daraja.controller';
import { enforceLicenseWriteAccess } from '../common/middleware/license-lockdown.middleware';

const router = Router();

// Fetch Daraja M-Pesa records and connections
router.get('/', darajaController.getMerchantPayments);
router.get('/connections', darajaController.getConnections);
router.get('/unmatched', darajaController.getUnmatchedPayments);

// Manage connections
router.post('/connections', enforceLicenseWriteAccess, darajaController.createConnection);

// Manually map unmatched Daraja M-Pesa records to a checkout sale
router.post('/:id/match', enforceLicenseWriteAccess, darajaController.matchPayment);

export default router;