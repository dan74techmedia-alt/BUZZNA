// apps/api/src/modules/billing/billing.service.ts

import { db } from '../../db/client';
import { logger } from '../../common/logging/logger';
import axios from 'axios';
import crypto from 'crypto';
import { notificationsService } from '../notifications/notifications.service';

/**
 * Billing Service
 *
 * MANAGES PLATFORM MONETIZATION VIA PAYSTACK
 *
 * Handles:
 * 1. Subscription initiation (trial → paid)
 * 2. Invoice generation and tracking
 * 3. Payment verification via Paystack webhooks
 * 4. License status enforcement
 * 5. Billing history and receipts
 *
 * Architecture Rules:
 * - Completely isolated from client merchant payments (Daraja)
 * - All charges use NUMERIC(15,2) for precision
 * - Payment status tracked via idempotency keys (Paystack reference)
 * - Never double-charge on webhook retry
 * - Failed charges create attention cards
 */

export interface SubscriptionPlan {
  planId: string;
  name: string;
  priceKES: string; // NUMERIC as string
  billingCycle: 'monthly' | 'annual';
  features: string[];
}

const SUBSCRIPTION_PLANS: Record<string, SubscriptionPlan> = {
  starter: {
    planId: 'plan_starter',
    name: 'Starter',
    priceKES: '999',
    billingCycle: 'monthly',
    features: ['POS', 'Inventory', 'Basic Reports'],
  },
  professional: {
    planId: 'plan_professional',
    name: 'Professional',
    priceKES: '2999',
    billingCycle: 'monthly',
    features: ['All Starter', 'Customer Management', 'Advanced Analytics', 'API Access'],
  },
  enterprise: {
    planId: 'plan_enterprise',
    name: 'Enterprise',
    priceKES: '9999',
    billingCycle: 'monthly',
    features: ['All Professional', 'Custom Integration', 'Dedicated Support', 'SLA'],
  },
};

/**
 * Initialize payment to upgrade from trial
 */
export async function initializePaystackPayment(
  tenantId: string,
  planId: string,
  userEmail: string
): Promise<{ authorizationUrl: string; accessCode: string; reference: string }> {
  try {
    const plan = Object.values(SUBSCRIPTION_PLANS).find((p) => p.planId === planId);
    if (!plan) {
      throw new Error(`Unknown subscription plan: ${planId}`);
    }

    const reference = `BN-${tenantId.substring(0, 8)}-${Date.now()}`;
    const priceInCents = Math.round(parseFloat(plan.priceKES) * 100);

    // Call Paystack API
    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email: userEmail,
        amount: priceInCents,
        reference,
        metadata: {
          tenantId,
          planId,
          billingCycle: plan.billingCycle,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_LIVE_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.data.status) {
      throw new Error(`Paystack initialization failed: ${response.data.message}`);
    }

    // Log invoice
    await db
      .insertInto('invoices' as any)
      .values({
        tenant_id: tenantId,
        invoice_number: reference,
        plan_id: planId,
        amount_kes: plan.priceKES,
        status: 'pending',
        billing_cycle: plan.billingCycle,
        paystack_reference: reference,
        due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        created_at: new Date(),
      })
      .execute();

    logger.info('Paystack payment initialized', {
      tenantId,
      planId,
      reference,
      amount: plan.priceKES,
    });

    return {
      authorizationUrl: response.data.data.authorization_url,
      accessCode: response.data.data.access_code,
      reference,
    };
  } catch (error) {
    logger.error('Failed to initialize Paystack payment', {
      tenantId,
      planId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Verify payment from Paystack webhook
 */
export async function verifyPaystackPayment(
  paystackReference: string
): Promise<{
  success: boolean;
  tenantId?: string;
  planId?: string;
}> {
  try {
    // Check if already verified
    const existingPayment = await db
      .selectFrom('payments' as any)
      .selectAll()
      .where('paystack_reference', '=', paystackReference)
      .where('status', '=', 'completed')
      .executeTakeFirst();

    if (existingPayment) {
      logger.info('Payment already verified (idempotency)', {
        paystackReference,
        tenantId: existingPayment.tenant_id,
      });
      return {
        success: true,
        tenantId: existingPayment.tenant_id,
        planId: existingPayment.plan_id,
      };
    }

    // Get invoice
    const invoice = await db
      .selectFrom('invoices' as any)
      .selectAll()
      .where('paystack_reference', '=', paystackReference)
      .executeTakeFirst();

    if (!invoice) {
      throw new Error(`Invoice not found for reference: ${paystackReference}`);
    }

    // Call Paystack API to verify
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${paystackReference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_LIVE_KEY}`,
        },
      }
    );

    if (!response.data.status || response.data.data.status !== 'success') {
      logger.warn('Paystack payment verification failed', {
        paystackReference,
        status: response.data.data.status,
      });
      return { success: false };
    }

    // Update invoice status
    await db
      .updateTable('invoices' as any)
      .set({
        status: 'paid',
        paid_at: new Date(),
      })
      .where('invoice_number', '=', invoice.invoice_number)
      .execute();

    // Log payment
    await db
      .insertInto('payments' as any)
      .values({
        tenant_id: invoice.tenant_id,
        invoice_id: invoice.invoice_id,
        amount_kes: invoice.amount_kes,
        payment_method: 'paystack',
        paystack_reference: paystackReference,
        status: 'completed',
        received_at: new Date(),
      })
      .execute();

    // Update business license status
    const plan = SUBSCRIPTION_PLANS[invoice.plan_id] || SUBSCRIPTION_PLANS.starter;

    let expiryDate = new Date();
    if (invoice.billing_cycle === 'monthly') {
      expiryDate.setMonth(expiryDate.getMonth() + 1);
    } else if (invoice.billing_cycle === 'annual') {
      expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    }

    await db
      .updateTable('businesses' as any)
      .set({
        license_status: 'FULLY_ACTIVATED',
        license_expires_at: expiryDate,
        subscription_plan: invoice.plan_id,
      })
      .where('tenant_id', '=', invoice.tenant_id)
      .execute();

    // Send confirmation email
    await notificationsService.sendNotification({
      tenantId: invoice.tenant_id,
      recipients: [response.data.data.customer.email],
      type: 'success',
      title: 'Payment Received',
      message: `Your BuzzNa subscription has been activated. Enjoy ${plan.name} plan benefits!`,
      channels: ['email'],
    });

    logger.info('Paystack payment verified successfully', {
      paystackReference,
      tenantId: invoice.tenant_id,
      planId: invoice.plan_id,
    });

    return {
      success: true,
      tenantId: invoice.tenant_id,
      planId: invoice.plan_id,
    };
  } catch (error) {
    logger.error('Failed to verify Paystack payment', {
      paystackReference,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get subscription plans
 */
export async function getSubscriptionPlans(): Promise<SubscriptionPlan[]> {
  return Object.values(SUBSCRIPTION_PLANS);
}

/**
 * Get billing history for tenant
 */
export async function getBillingHistory(
  tenantId: string,
  limit: number = 50
): Promise<any[]> {
  try {
    return await db
      .selectFrom('invoices' as any)
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
  } catch (error) {
    logger.error('Failed to get billing history', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get current subscription
 */
export async function getCurrentSubscription(tenantId: string): Promise<any> {
  try {
    const business = await db
      .selectFrom('businesses' as any)
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!business) {
      throw new Error('Business not found');
    }

    const plan = SUBSCRIPTION_PLANS[business.subscription_plan] || SUBSCRIPTION_PLANS.starter;

    return {
      planId: business.subscription_plan,
      planName: plan.name,
      licenseStatus: business.license_status,
      licenseExpiresAt: business.license_expires_at,
      features: plan.features,
    };
  } catch (error) {
    logger.error('Failed to get current subscription', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export const billingService = {
  initializePaystackPayment,
  verifyPaystackPayment,
  getSubscriptionPlans,
  getBillingHistory,
  getCurrentSubscription,
  SUBSCRIPTION_PLANS,
};

export default billingService;