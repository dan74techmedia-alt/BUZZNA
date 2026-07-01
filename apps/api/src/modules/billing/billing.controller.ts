// apps/api/src/modules/billing/billing.controller.ts

import { Router, Request, Response } from 'express';
import { logger } from '../../common/logging/logger';
import { verifyTenantContext } from '../../common/middleware/tenant-transaction.middleware';
import { billingService } from './billing.service';
import { billingSchema } from './billing.schema';

/**
 * Billing Controller
 *
 * Handles subscription upgrades, payment initiation, billing history
 */

export async function initializePayment(req: Request, res: Response): Promise<void> {
  try {
    const tenantContext = verifyTenantContext(req);

    const validated = billingSchema.initiatePaymentSchema.parse(req.body);

    // Get user email
    const user = await db
      .selectFrom('users' as any)
      .select('email')
      .where('tenant_id', '=', tenantContext.tenantId)
      .where('user_id', '=', tenantContext.userId)
      .executeTakeFirst();

    if (!user) {
      return res.status(404).json({
        error: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }

    const payment = await billingService.initializePaystackPayment(
      tenantContext.tenantId,
      validated.planId,
      user.email
    );

    res.status(200).json({
      success: true,
      data: payment,
    });
  } catch (error) {
    logger.error('Failed to initialize payment', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: 'PAYMENT_INIT_FAILED',
      message: 'Failed to initialize payment',
    });
  }
}

export async function getSubscriptionPlans(req: Request, res: Response): Promise<void> {
  try {
    const plans = await billingService.getSubscriptionPlans();

    res.status(200).json({
      success: true,
      data: plans,
    });
  } catch (error) {
    logger.error('Failed to get subscription plans', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: 'FAILED',
      message: 'Failed to retrieve plans',
    });
  }
}

export async function getBillingHistory(req: Request, res: Response): Promise<void> {
  try {
    const tenantContext = verifyTenantContext(req);

    const history = await billingService.getBillingHistory(
      tenantContext.tenantId
    );

    res.status(200).json({
      success: true,
      data: history,
    });
  } catch (error) {
    logger.error('Failed to get billing history', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: 'FAILED',
      message: 'Failed to retrieve billing history',
    });
  }
}

export async function getCurrentSubscription(req: Request, res: Response): Promise<void> {
  try {
    const tenantContext = verifyTenantContext(req);

    const subscription = await billingService.getCurrentSubscription(
      tenantContext.tenantId
    );

    res.status(200).json({
      success: true,
      data: subscription,
    });
  } catch (error) {
    logger.error('Failed to get current subscription', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: 'FAILED',
      message: 'Failed to retrieve subscription',
    });
  }
}

export const billingRouter = Router();

billingRouter.post('/initialize-payment', initializePayment);
billingRouter.get('/plans', getSubscriptionPlans);
billingRouter.get('/history', getBillingHistory);
billingRouter.get('/current', getCurrentSubscription);

export default billingRouter;