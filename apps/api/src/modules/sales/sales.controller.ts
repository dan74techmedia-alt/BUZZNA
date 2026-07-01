// apps/api/src/modules/sales/sales.controller.ts

import { Router, Request, Response } from 'express';
import { logger } from '../../common/logging/logger';
import { AppError } from '../../common/errors/AppError';
import { verifyTenantContext, getDbTransaction } from '../../common/middleware/tenant-transaction.middleware';
import { salesService } from './sales.service';
import { validateRequest } from '../../common/middleware/validation.middleware';
import { createSaleSchema, refundSchema } from './sales.schema';

/**
 * Sales Controller
 *
 * Handles POS checkout, refunds, voids
 * All operations enforce tenant isolation and append-only ledger
 */

export async function createSale(req: Request, res: Response): Promise<void> {
  try {
    const tenantContext = verifyTenantContext(req);
    const trx = getDbTransaction(req);

    // Validate request
    const validated = createSaleSchema.parse(req.body);

    // Create sale (includes inventory dispatch, payment allocation)
    const sale = await salesService.createSale(
      tenantContext.tenantId,
      tenantContext.userId || '',
      validated,
      trx
    );

    logger.info('Sale created', {
      tenantId: tenantContext.tenantId,
      transactionId: sale.transaction_id,
      total: sale.gross_total,
    });

    res.status(201).json({
      success: true,
      data: sale,
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        error: error.code,
        message: error.message,
      });
    } else {
      logger.error('Failed to create sale', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({
        error: 'SALE_CREATION_FAILED',
        message: 'Failed to create sale',
      });
    }
  }
}

export async function refundSale(req: Request, res: Response): Promise<void> {
  try {
    const tenantContext = verifyTenantContext(req);
    const trx = getDbTransaction(req);

    const { saleId } = req.params;

    // Validate request
    const validated = refundSchema.parse(req.body);

    // Process refund
    const refund = await salesService.refundSale(
      tenantContext.tenantId,
      saleId,
      tenantContext.userId || '',
      validated,
      trx
    );

    logger.info('Sale refunded', {
      tenantId: tenantContext.tenantId,
      saleId,
      refundAmount: refund.amount_kes,
    });

    res.status(200).json({
      success: true,
      data: refund,
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        error: error.code,
        message: error.message,
      });
    } else {
      logger.error('Failed to refund sale', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({
        error: 'REFUND_FAILED',
        message: 'Failed to process refund',
      });
    }
  }
}

export async function getSaleDetails(req: Request, res: Response): Promise<void> {
  try {
    const tenantContext = verifyTenantContext(req);
    const { saleId } = req.params;

    const sale = await salesService.getSaleDetails(
      tenantContext.tenantId,
      saleId
    );

    res.status(200).json({
      success: true,
      data: sale,
    });
  } catch (error) {
    logger.error('Failed to get sale details', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: 'FAILED',
      message: 'Failed to retrieve sale',
    });
  }
}

export const salesRouter = Router();

salesRouter.post('/', createSale);
salesRouter.post('/:saleId/refund', refundSale);
salesRouter.get('/:saleId', getSaleDetails);

export default salesRouter;