// apps/api/src/routes/merchant-payments.routes.ts

import { Router } from 'express';
import { authMiddleware } from '../common/middleware/auth.middleware';
import { createWebhookVerificationMiddleware } from '../common/middleware/webhook-verification.middleware';
import {
  initiateSTKPush,
  handleSTKCallback,
  queryPaymentStatus,
} from '../modules/merchant-payments/daraja.controller';

/**
 * Merchant Payments Routes
 *
 * /api/v1/merchant-payments
 *   POST /stk-push - Initiate M-Pesa STK push
 *   POST /daraja/callback - Daraja webhook callback (signature verified)
 *   GET /status - Query payment status
 */

const router = Router();

// Daraja webhook verification
const darajaWebhookMiddleware = createWebhookVerificationMiddleware({
  provider: 'daraja',
  secretKey: process.env.DARAJA_WEBHOOK_SECRET || '',
  headerName: 'x-daraja-signature',
  idempotencyKeyField: 'Body.stkCallback.CheckoutRequestID',
  eventTypeField: 'Body.stkCallback.ResultCode',
});

// Protected endpoints
router.use(authMiddleware);

// Initiate STK push
router.post('/stk-push', initiateSTKPush);

// Query status
router.get('/status', queryPaymentStatus);

// Webhook callback (signature verified, idempotent)
router.post('/daraja/callback', darajaWebhookMiddleware, handleSTKCallback);

export default router;