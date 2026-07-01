// apps/api/src/routes/billing.routes.ts (UPDATED with Paystack webhook)

import { Router } from 'express';
import { authMiddleware } from '../common/middleware/auth.middleware';
import { rbacMiddleware } from '../common/middleware/rbac.middleware';
import { 
  initializePayment,
  getSubscriptionPlans,
  getBillingHistory,
  getCurrentSubscription,
} from '../modules/billing/billing.controllers';
import { paystackRouter } from '../modules/billing/paystack.controller';

/**
 * Billing Routes (Updated)
 *
 * /api/v1/billing
 *   GET /plans - List subscription plans (public)
 *   POST /initialize-payment - Start Paystack checkout (auth required)
 *   GET /history - Billing history (owner/accountant)
 *   GET /current - Current subscription status (auth required)
 *   POST /paystack/webhook - Paystack callback (signature verified, no auth)
 */

const router = Router();

// Public endpoints - no auth required
router.get('/plans', getSubscriptionPlans);

// Paystack webhook (signature verified, no auth)
router.use('/paystack', paystackRouter);

// Protected endpoints - require auth
router.use(authMiddleware);

// Initialize payment
router.post(
  '/initialize-payment',
  rbacMiddleware(['owner', 'accountant']),
  initializePayment
);

// Get billing history
router.get(
  '/history',
  rbacMiddleware(['owner', 'accountant']),
  getBillingHistory
);

// Get current subscription
router.get(
  '/current',
  rbacMiddleware(['owner', 'manager', 'cashier']),
  getCurrentSubscription
);

export default router;