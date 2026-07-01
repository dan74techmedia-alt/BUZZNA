// apps/api/src/modules/billing/paystack.controller.ts

import { Router, Request, Response } from 'express';
import { logger } from '../../common/logging/logger';
import { createWebhookVerificationMiddleware } from '../../common/middleware/webhook-verification.middleware';
import { billingService } from './billing.service';
import { notificationsService } from '../notifications/notifications.service';

/**
 * Paystack Webhook Controller
 *
 * Handles payment confirmations from Paystack
 * Webhook is signature-verified and idempotent
 */

export async function handlePaystackWebhook(req: Request, res: Response): Promise<void> {
  try {
    const payload = req.body;

    // Extract reference from Paystack payload
    const reference = payload?.data?.reference;

    if (!reference) {
      logger.warn('Paystack webhook missing reference');
      return res.status(400).json({
        error: 'MISSING_REFERENCE',
      });
    }

    // Verify payment
    const result = await billingService.verifyPaystackPayment(reference);

    if (!result.success) {
      logger.warn('Paystack payment verification failed', {
        reference,
      });
      return res.status(200).json({
        success: false,
      });
    }

    logger.info('Paystack payment verified and processed', {
      reference,
      tenantId: result.tenantId,
      planId: result.planId,
    });

    res.status(200).json({
      success: true,
    });
  } catch (error) {
    logger.error('Paystack webhook processing failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    // Return 200 to acknowledge receipt (Paystack will retry if 4xx/5xx)
    res.status(200).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export const paystackRouter = Router();

// Webhook verification middleware (signature + idempotency)
const paystackWebhookMiddleware = createWebhookVerificationMiddleware({
  provider: 'paystack',
  secretKey: process.env.PAYSTACK_WEBHOOK_HMAC_SECRET || '',
  headerName: 'x-paystack-signature',
  idempotencyKeyField: 'data.reference',
  eventTypeField: 'event',
});

// Webhook endpoint (no auth required, signature verified)
paystackRouter.post('/webhook', paystackWebhookMiddleware, handlePaystackWebhook);

export default paystackRouter;