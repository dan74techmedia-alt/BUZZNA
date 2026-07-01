import { Router } from 'express';
import * as tillController from '../modules/till/till.controller';
import { enforceLicenseWriteAccess } from '../common/middleware/license-lockdown.middleware';

const router = Router();

// Fetch active or historical till sessions
router.get('/', tillController.getTillSessions);
router.get('/active', tillController.getActiveSession);

// Open physical till session by providing a starting float amount.
router.post('/open', enforceLicenseWriteAccess, tillController.openTill);

// Blind Balance Discrepancy Gate: Submit physical cash balance at end of shift.
router.post('/:id/close', enforceLicenseWriteAccess, tillController.closeTill);

export default router;