// apps/api/src/routes/sync.routes.ts

import { Router } from 'express';
import { authMiddleware } from '../common/middleware/auth.middleware';
import { idempotencyMiddleware } from '../common/middleware/idempotency.middleware';
import {
  uploadSyncBatch,
  getSyncStatus,
} from '../modules/sync/sync.controller';

/**
 * Sync Routes
 *
 * /api/v1/sync
 *   POST /batches - Upload offline sync batch (idempotent)
 *   GET /batches/:batchId - Check sync batch status
 */

const router = Router();

// All sync operations require auth
router.use(authMiddleware);

// Upload sync batch - MUST be idempotent (may be retried)
router.post(
  '/batches',
  idempotencyMiddleware,
  uploadSyncBatch
);

// Get sync batch status
router.get('/batches/:batchId', getSyncStatus);

export default router;