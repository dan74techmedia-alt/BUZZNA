// apps/api/src/modules/billing/billing.service.ts

import { db, withTenant } from '../../config/database';
import { logger } from '../../common/logging/logger';
import { AppError } from '../../common/errors/AppError';
import axios from 'axios';
import crypto from 'crypto';
import { Decimal } from 'decimal.js';

interface InitiatePaymentPayload {
  planId: string;
  userEmail: string;
}

const SUBSCRIPTION_PLANS: Record<string, any> = {
  starter: {
    planId: 'plan_starter',
    name: 'Starter',
    priceKES: '999',
    billingCycle: 'monthly',
  },
  professional: {
    planId: 'plan_professional',
    name: 'Professional',
    priceKES: '2999',
    billingCycle: 'monthly',
  },
  enterprise: {
    planId: 'plan_enterprise',
    name: 'Enterprise',
    priceKES: '9999',
    billingCycle: 'monthly',
  },
};

export class BillingService {
  /**
   * Initialize Paystack payment for subscription upgrade
   */
  static async initializePaystackPayment(
    tenantId: string,
    payload: InitiatePaymentPayload
  ): Promise<{ authorizationUrl: string; accessCode: string; reference: string }> {
    try {
      const plan = SUBSCRIPTION_PLANS[payload.planId];
      if (!plan) {
        throw new AppError('Unknown subscription plan', 400);
      }

      const reference = `BN-${tenantId.substring(0, 8)}-${Date.now()}`;
      const priceInCents = Math.round(parseFloat(plan.priceKES) * 100);

      // Call Paystack API
      const response = await axios.post(
        'https://api.paystack.co/transaction/initialize',
        {
          email: payload.userEmail,
          amount: priceInCents,
          reference,
          metadata: {
            tenantId,
            planId: payload.planId,
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
        throw new Error(`Paystack error: ${response.data.message}`);
      }

      // Log invoice
      await withTenant(tenantId, async (trx) => {
        await trx
          .insertInto('invoices')
          .values({
            tenant_id: tenantId,
            invoice_number: reference,
            plan_id: payload.planId,
            amount_kes: plan.priceKES,
            status: 'PENDING',
            paystack_reference: reference,
            due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            created_at: new Date(),
          })
          .execute();
      });

      logger.info('[BillingService] Paystack payment initialized', {
        tenantId,
        planId: payload.planId,
        reference,
        amount: plan.priceKES,
      });

      return {
        authorizationUrl: response.data.data.authorization_url,
        accessCode: response.data.data.access_code,
        reference,
      };
    } catch (error) {
      logger.error('[BillingService] Failed to initialize payment', {
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error instanceof AppError ? error : new AppError('Failed to initialize payment', 500);
    }
  }

  /**
   * Verify Paystack payment (webhook callback)
   */
  static async verifyPaystackPayment(reference: string): Promise<{
    success: boolean;
    tenantId?: string;
  }> {
    try {
      // Check if already processed (idempotency)
      const existing = await db
        .selectFrom('payments')
        .selectAll()
        .where('paystack_reference', '=', reference)
        .where('status', '=', 'completed')
        .executeTakeFirst();

      if (existing) {
        logger.info('[BillingService] Payment already verified', {
          paystackReference: reference,
        });
        return {
          success: true,
          tenantId: existing.tenant_id,
        };
      }

      // Get invoice
      const invoice = await db
        .selectFrom('invoices')
        .selectAll()
        .where('paystack_reference', '=', reference)
        .executeTakeFirst();

      if (!invoice) {
        throw new AppError('Invoice not found', 404);
      }

      // Verify with Paystack API
      const response = await axios.get(
        `https://api.paystack.co/transaction/verify/${reference}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_LIVE_KEY}`,
          },
        }
      );

      if (!response.data.status || response.data.data.status !== 'success') {
        throw new Error('Payment verification failed');
      }

      // Update invoice and business license
      await withTenant(invoice.tenant_id, async (trx) => {
        // Mark invoice as paid
        await trx
          .updateTable('invoices')
          .set({
            status: 'paid',
            paid_at: new Date(),
          })
          .where('invoice_number', '=', invoice.invoice_number)
          .execute();

        // Record payment
        await trx
          .insertInto('payments')
          .values({
            tenant_id: invoice.tenant_id,
            invoice_id: invoice.invoice_id,
            amount_kes: invoice.amount_kes,
            payment_method: 'paystack',
            paystack_reference: reference,
            status: 'completed',
            received_at: new Date(),
          })
          .execute();

        // Update business license status
        let expiryDate = new Date();
        if (invoice.billing_cycle === 'monthly') {
          expiryDate.setMonth(expiryDate.getMonth() + 1);
        }

        await trx
          .updateTable('businesses')
          .set({
            license_status: 'FULLY_ACTIVATED',
            license_expires_at: expiryDate,
            subscription_plan: invoice.plan_id,
          })
          .where('tenant_id', '=', invoice.tenant_id)
          .execute();
      });

      logger.info('[BillingService] Payment verified', {
        reference,
        tenantId: invoice.tenant_id,
      });

      return {
        success: true,
        tenantId: invoice.tenant_id,
      };
    } catch (error) {
      logger.error('[BillingService] Payment verification failed', {
        reference,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error instanceof AppError ? error : new AppError('Payment verification failed', 500);
    }
  }

  /**
   * Get current subscription
   */
  static async getCurrentSubscription(tenantId: string): Promise<any> {
    return await withTenant(tenantId, async (trx) => {
      try {
        const business = await trx
          .selectFrom('businesses')
          .selectAll()
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst();

        if (!business) {
          throw new AppError('Business not found', 404);
        }

        const plan = SUBSCRIPTION_PLANS[business.subscription_plan] || SUBSCRIPTION_PLANS.starter;

        return {
          planId: business.subscription_plan,
          planName: plan.name,
          licenseStatus: business.license_status,
          licenseExpiresAt: business.license_expires_at,
        };
      } catch (error) {
        logger.error('[BillingService] Failed to get subscription', {
          tenantId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error instanceof AppError ? error : new AppError('Failed to get subscription', 500);
      }
    });
  }
}