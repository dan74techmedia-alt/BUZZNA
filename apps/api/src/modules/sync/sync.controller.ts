// apps/api/src/modules/sync/sync.controller.ts

import { Router, Request, Response } from 'express';
import { logger } from '../../common/logging/logger';
import { verifyTenantContext, getDbTransaction } from '../../common/middleware/tenant-transaction.middleware';
import { syncService } from './sync.service';
import { syncBatchSchema } from './sync.schema';

/**
 * Sync Controller
 *
 * Handles offline sync batch uploads and status queries
 */

export async function uploadSyncBatch(req: Request, res: Response): Promise<void> {
  try {
    const tenantContext = verifyTenantContext(req);

    const validated = syncBatchSchema.parse(req.body);

    const result = await syncService.processSyncBatch({
      ...validated,
      tenantId: tenantContext.tenantId,
      userId: tenantContext.userId || '',
    });

    // Get server snapshot for client cache update
    const snapshot = await syncService.getServerSnapshot(tenantContext.tenantId);

    res.status(200).json({
      success: true,
      data: {
        ...result,
        serverSnapshot: snapshot,
      },
    });
  } catch (error) {
    logger.error('Failed to upload sync batch', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: 'SYNC_FAILED',
      message: 'Failed to process sync batch',
    });
  }
}

export async function getSyncStatus(req: Request, res: Response): Promise<void> {
  try {
    const tenantContext = verifyTenantContext(req);
    const { batchId } = req.params;

    const status = await syncService.getSyncStatus(
      tenantContext.tenantId,
      batchId
    );

    res.status(200).json({
      success: true,
      data: status,
    });
  } catch (error) {
    logger.error('Failed to get sync status', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: 'FAILED',
      message: 'Failed to retrieve sync status',
    });
  }
}

export const syncRouter = Router();

syncRouter.post('/batches', uploadSyncBatch);
syncRouter.get('/batches/:batchId', getSyncStatus);

export default syncRouter;