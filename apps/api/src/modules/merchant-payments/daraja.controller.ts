// apps/api/src/modules/merchant-payments/daraja.controller.ts

import { Router, Request, Response } from 'express';
import { logger } from '../../common/logging/logger';
import { AppError } from '../../common/errors/AppError';
import { verifyTenantContext, getDbTransaction } from '../../common/middleware/tenant-transaction.middleware';
import { darajaService } from './daraja.service';
import { stkPushSchema } from './daraja.schema';

/**
 * Daraja Controller
 *
 * Handles M-Pesa payment initiation and webhooks
 */

export async function initiateSTKPush(req: Request, res: Response): Promise<void> {
  try {
    const tenantContext = verifyTenantContext(req);

    const validated = stkPushSchema.parse({
      ...req.body,
      tenantId: tenantContext.tenantId,
    });

    const result = await darajaService.initiateSTKPush(validated);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('Failed to initiate STK push', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: 'STK_PUSH_FAILED',
      message: 'Failed to initiate payment',
    });
  }
}

export async function handleSTKCallback(req: Request, res: Response): Promise<void> {
  try {
    // Inject tenant context from webhook
    const payload = req.body;

    await darajaService.processSTKCallback(payload);

    // Always return 200 OK to acknowledge webhook
    res.status(200).json({
      success: true,
    });
  } catch (error) {
    logger.error('Failed to process STK callback', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Still return 200 to avoid Daraja retry
    res.status(200).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export async function queryPaymentStatus(req: Request, res: Response): Promise<void> {
  try {
    const tenantContext = verifyTenantContext(req);
    const { checkoutRequestID } = req.query as { checkoutRequestID: string };

    if (!checkoutRequestID) {
      return res.status(400).json({
        error: 'MISSING_PARAM',
        message: 'checkoutRequestID required',
      });
    }

    const status = await darajaService.queryPaymentStatus(
      tenantContext.tenantId,
      checkoutRequestID
    );

    res.status(200).json({
      success: true,
      data: status,
    });
  } catch (error) {
    logger.error('Failed to query payment status', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: 'FAILED',
      message: 'Failed to query payment status',
    });
  }
}

export const darajaRouter = Router();

darajaRouter.post('/stk-push', initiateSTKPush);
darajaRouter.post('/callback', handleSTKCallback);
darajaRouter.get('/status', queryPaymentStatus);

export default darajaRouter;