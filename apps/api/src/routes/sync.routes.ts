import { Router } from 'express';
import * as syncController from '../modules/sync/sync.controller';
import { enforceLicenseWriteAccess } from '../common/middleware/license-lockdown.middleware';

const router = Router();

// Retrieve synchronization history and rejection logs
router.get('/history', syncController.getSyncHistory);
router.get('/rejections', syncController.getSyncRejections);

// Upload offline replication packet array from terminal IndexedDB stores.
// Implements the "Walkaway" Sync Protocol for conflict resolution.
router.post('/batches', enforceLicenseWriteAccess, syncController.uploadBatches);

export default router;