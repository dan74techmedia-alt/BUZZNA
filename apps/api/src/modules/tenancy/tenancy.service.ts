/**
 * ============================================================================
 * BUZZNA D74 - Tenancy Service (Multi-Tenant Lifecycle & License Management)
 * ============================================================================
 *
 * PURPOSE:
 * - Manage business tenant lifecycle (registration → trial → payment → active)
 * - Enforce license status policies (read-only, write-blocking, feature lockdowns)
 * - Track subscription invoices and payments via Paystack
 * - Implement grace period and automatic suspension logic
 * - Audit all license state transitions
 *
 * ARCHITECTURAL RULES (CRITICAL):
 * 1. TRIAL_ACTIVE: 14-day free trial, all features enabled
 * 2. PAYMENT_DUE: Trial expired, 3-day grace period to pay
 * 3. GRACE_PERIOD: Within 3-day window, POS/inventory writes allowed
 * 4. SUSPENDED_NON_PAYMENT: Reads allowed, all writes blocked (read-only mode)
 * 5. FULLY_ACTIVATED: Paid subscription, perpetual access
 * 6. License expiry checked on every API call via middleware
 * 7. Trial period: 14 days from registration (start_date + 14 days)
 * 8. All business settings immutable once set (append-only for audit)
 *
 * LICENSE STATE MACHINE:
 *
 * TRIAL_ACTIVE (0-14 days)
 *   ├─ [Day 10] → Send "trial ending" reminder
 *   ├─ [Day 14] → Transition to PAYMENT_DUE
 *   └─ [User upgrades] → FULLY_ACTIVATED
 *
 * PAYMENT_DUE (3-day grace period)
 *   ├─ [Hour 1] → Send "payment required" email
 *   ├─ [Day 1] → Transition to GRACE_PERIOD
 *   ├─ [User pays] → FULLY_ACTIVATED
 *   └─ [Day 3] → Transition to SUSPENDED_NON_PAYMENT
 *
 * GRACE_PERIOD (3 days)
 *   ├─ POS/inventory writes allowed (3-day buffer)
 *   ├─ Send escalating daily warnings
 *   ├─ [User pays] → FULLY_ACTIVATED
 *   └─ [3 days elapsed] → SUSPENDED_NON_PAYMENT
 *
 * SUSPENDED_NON_PAYMENT (read-only lock)
 *   ├─ All writes blocked via middleware
 *   ├─ Dashboard/reports readable
 *   ├─ Users can only access billing page
 *   └─ [User pays] → FULLY_ACTIVATED
 *
 * FULLY_ACTIVATED (indefinite)
 *   └─ All features enabled, no expiry check
 *
 * DATABASE DEPENDENCIES:
 * - businesses (tenant record with license_status, license_expires_at)
 * - business_settings (immutable configuration snapshot)
 * - subscription_plans (pricing tiers)
 * - subscription_invoices (billing records)
 * - subscription_payments (payment history)
 * - license_audit_logs (state transition history)
 *
 * ============================================================================
 */

import { db, withTenant } from '../../config/database';
import { AppError } from '../../common/errors/AppError';
import { logger } from '../../common/logging/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * License status type
 */
export type LicenseStatus =
  | 'TRIAL_ACTIVE'
  | 'PAYMENT_DUE'
  | 'GRACE_PERIOD'
  | 'SUSPENDED_NON_PAYMENT'
  | 'FULLY_ACTIVATED';

/**
 * Business profile output
 */
export interface BusinessProfile {
  tenant_id: string;
  legal_name: string;
  trade_name: string | null;
  business_type: string;
  email: string;
  phone: string;
  license_status: LicenseStatus;
  license_expires_at: Date;
  trial_started_at: Date;
  is_active: boolean;
  created_at: Date;
}

/**
 * Business settings output
 */
export interface BusinessSettings {
  tenant_id: string;
  allow_negative_stock: boolean;
  enable_customer_credit: boolean;
  enable_supplier_credit: boolean;
  low_stock_threshold: number;
  tax_enabled: boolean;
  tax_rate: string;
}

/**
 * License status info
 */
export interface LicenseInfo {
  status: LicenseStatus;
  expiresAt: Date;
  daysRemaining: number;
  isExpired: boolean;
  isGracePeriod: boolean;
  isSuspended: boolean;
  canWrite: boolean; // Controls operational writes
}

/**
 * Subscription invoice
 */
export interface SubscriptionInvoice {
  invoice_id: string;
  tenant_id: string;
  plan_id: string;
  status: 'PENDING' | 'PAID' | 'FAILED';
  amount: string;
  due_date: Date;
  created_at: Date;
}

/**
 * Tenancy Service
 */
class TenancyService {
  /**
   * Fetch business profile (tenant record)
   *
   * @param tenantId - Tenant UUID
   * @returns Business profile with license info
   */
  async getBusinessProfile(tenantId: string): Promise<BusinessProfile> {
    logger.info('Fetching business profile', { tenantId });

    return withTenant(tenantId, async (trx) => {
      const business = await trx
        .selectFrom('businesses')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      if (!business) {
        throw new AppError('Business profile not found', 404, true, 'BUSINESS_NOT_FOUND');
      }

      return business as BusinessProfile;
    });
  }

  /**
   * Fetch business settings
   *
   * @param tenantId - Tenant UUID
   * @returns Business settings
   */
  async getBusinessSettings(tenantId: string): Promise<BusinessSettings> {
    logger.info('Fetching business settings', { tenantId });

    return withTenant(tenantId, async (trx) => {
      const settings = await trx
        .selectFrom('business_settings')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      if (!settings) {
        throw new AppError('Business settings not found', 404, true, 'SETTINGS_NOT_FOUND');
      }

      return settings as BusinessSettings;
    });
  }

  /**
   * Evaluate current license status and permissions
   *
   * This function determines:
   * - Current license status (TRIAL_ACTIVE, PAYMENT_DUE, SUSPENDED, etc.)
   * - Days remaining until expiry
   * - Whether operational writes are allowed
   * - Whether account is in grace period
   *
   * @param tenantId - Tenant UUID
   * @returns License info object
   */
  async evaluateLicenseStatus(tenantId: string): Promise<LicenseInfo> {
    logger.debug('Evaluating license status', { tenantId });

    return withTenant(tenantId, async (trx) => {
      const business = await trx
        .selectFrom('businesses')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      if (!business) {
        throw new AppError('Business not found', 404, true, 'BUSINESS_NOT_FOUND');
      }

      const now = new Date();
      const expiryDate = new Date(business.license_expires_at);
      const daysRemaining = Math.ceil(
        (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );
      const isExpired = daysRemaining <= 0;

      // Determine permissions based on status
      let canWrite = true;
      let isGracePeriod = false;
      let isSuspended = false;

      const status = business.license_status as LicenseStatus;

      switch (status) {
        case 'TRIAL_ACTIVE':
          canWrite = !isExpired;
          break;
        case 'PAYMENT_DUE':
          canWrite = daysRemaining > 0; // 3-day grace period
          isGracePeriod = true;
          break;
        case 'GRACE_PERIOD':
          canWrite = daysRemaining > 0; // Within grace window
          isGracePeriod = true;
          break;
        case 'SUSPENDED_NON_PAYMENT':
          canWrite = false; // Read-only mode
          isSuspended = true;
          break;
        case 'FULLY_ACTIVATED':
          canWrite = true; // Perpetual access
          break;
        default:
          canWrite = false;
      }

      logger.debug('License status evaluated', {
        tenantId,
        status,
        daysRemaining,
        canWrite,
        isSuspended,
      });

      return {
        status,
        expiresAt: expiryDate,
        daysRemaining,
        isExpired,
        isGracePeriod,
        isSuspended,
        canWrite,
      };
    });
  }

  /**
   * Update license status (state transition)
   *
   * Used by:
   * - License expiry worker (auto-transition TRIAL → PAYMENT_DUE)
   * - Billing worker (handle grace periods)
   * - Payment processor (PAYMENT_DUE → FULLY_ACTIVATED)
   *
   * NEVER call directly from API routes (use worker/webhook context)
   *
   * @param tenantId - Tenant UUID
   * @param newStatus - New license status
   * @param changedBy - User/system identifier making change
   * @param notes - Optional transition reason
   */
  async updateLicenseStatus(
    tenantId: string,
    newStatus: LicenseStatus,
    changedBy: string,
    notes?: string
  ): Promise<void> {
    logger.info('Updating license status', {
      tenantId,
      newStatus,
      changedBy,
    });

    return withTenant(tenantId, async (trx) => {
      // Fetch current status for audit
      const business = await trx
        .selectFrom('businesses')
        .select('license_status')
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      if (!business) {
        throw new AppError('Business not found', 404, true, 'BUSINESS_NOT_FOUND');
      }

      const oldStatus = business.license_status as LicenseStatus;

      // Validate state transition
      const validTransitions: Record<LicenseStatus, LicenseStatus[]> = {
        TRIAL_ACTIVE: ['PAYMENT_DUE', 'FULLY_ACTIVATED'],
        PAYMENT_DUE: ['GRACE_PERIOD', 'FULLY_ACTIVATED', 'SUSPENDED_NON_PAYMENT'],
        GRACE_PERIOD: ['FULLY_ACTIVATED', 'SUSPENDED_NON_PAYMENT'],
        SUSPENDED_NON_PAYMENT: ['FULLY_ACTIVATED'],
        FULLY_ACTIVATED: [], // No transitions from active
      };

      if (!validTransitions[oldStatus]?.includes(newStatus)) {
        throw new AppError(
          `Invalid license state transition: ${oldStatus} → ${newStatus}`,
          400,
          true,
          'INVALID_TRANSITION'
        );
      }

      // Update business license status
      const expiryDate = newStatus === 'FULLY_ACTIVATED' ? null : new Date();

      await trx
        .updateTable('businesses')
        .set({
          license_status: newStatus,
          license_expires_at: expiryDate,
          updated_at: new Date(),
        })
        .where('tenant_id', '=', tenantId)
        .execute();

      // Log state transition in audit trail
      const auditId = uuidv4();
      await trx
        .insertInto('license_audit_logs')
        .values({
          audit_id: auditId,
          tenant_id: tenantId,
          old_status: oldStatus,
          new_status: newStatus,
          changed_by: changedBy,
          notes: notes || null,
          created_at: new Date(),
        })
        .execute();

      logger.info('License status updated and audited', {
        tenantId,
        oldStatus,
        newStatus,
        auditId,
      });
    });
  }

  /**
   * Create subscription invoice for billing cycle
   *
   * Called by billing worker when invoice is generated
   * Invoice status progresses: PENDING → PAID or FAILED
   *
   * @param tenantId - Tenant UUID
   * @param planId - Subscription plan UUID
   * @param amount - Invoice amount (NUMERIC(12,2))
   * @param dueDate - Payment due date
   * @returns Created invoice
   */
  async createInvoice(
    tenantId: string,
    planId: string,
    amount: string,
    dueDate: Date
  ): Promise<SubscriptionInvoice> {
    logger.info('Creating subscription invoice', {
      tenantId,
      planId,
      amount,
      dueDate,
    });

    return withTenant(tenantId, async (trx) => {
      const invoiceId = uuidv4();

      const invoice = await trx
        .insertInto('subscription_invoices')
        .values({
          invoice_id: invoiceId,
          tenant_id: tenantId,
          plan_id: planId,
          status: 'PENDING',
          amount,
          due_date: dueDate,
          created_at: new Date(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      logger.info('Invoice created', { tenantId, invoiceId });
      return invoice as SubscriptionInvoice;
    });
  }

  /**
   * Record payment against invoice
   *
   * Called by Paystack webhook when payment is confirmed
   * Updates invoice status to PAID and transitions license to FULLY_ACTIVATED
   *
   * @param tenantId - Tenant UUID
   * @param invoiceId - Invoice UUID
   * @param paystackReference - Paystack transaction reference (idempotency key)
   * @param amount - Payment amount
   * @returns Updated invoice
   */
  async recordPayment(
    tenantId: string,
    invoiceId: string,
    paystackReference: string,
    amount: string
  ): Promise<SubscriptionInvoice> {
    logger.info('Recording subscription payment', {
      tenantId,
      invoiceId,
      paystackReference,
      amount,
    });

    return withTenant(tenantId, async (trx) => {
      // Fetch invoice
      const invoice = await trx
        .selectFrom('subscription_invoices')
        .selectAll()
        .where('invoice_id', '=', invoiceId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      if (!invoice) {
        throw new AppError('Invoice not found', 404, true, 'INVOICE_NOT_FOUND');
      }

      // Verify amount matches (prevent overpayment issues)
      const invoiceAmount = parseFloat(invoice.amount);
      const paymentAmount = parseFloat(amount);

      if (Math.abs(invoiceAmount - paymentAmount) > 0.01) {
        throw new AppError(
          `Payment amount mismatch: invoice ${invoiceAmount.toFixed(2)} vs payment ${paymentAmount.toFixed(
            2
          )}`,
          400,
          true,
          'AMOUNT_MISMATCH'
        );
      }

      // Check for duplicate payment (Paystack webhook idempotency)
      const existingPayment = await trx
        .selectFrom('subscription_payments')
        .select('payment_id')
        .where('invoice_id', '=', invoiceId)
        .where('paystack_reference', '=', paystackReference)
        .executeTakeFirst();

      if (existingPayment) {
        logger.warn('Duplicate payment detected (idempotency)', {
          tenantId,
          invoiceId,
          paystackReference,
        });
        // Return existing payment, don't duplicate
        throw new AppError('Payment already recorded', 409, true, 'DUPLICATE_PAYMENT');
      }

      // Record payment
      const paymentId = uuidv4();

      await trx
        .insertInto('subscription_payments')
        .values({
          payment_id: paymentId,
          tenant_id: tenantId,
          invoice_id: invoiceId,
          paystack_reference: paystackReference,
          amount,
          status: 'PAID',
          created_at: new Date(),
        })
        .execute();

      // Update invoice status to PAID
      const updatedInvoice = await trx
        .updateTable('subscription_invoices')
        .set({ status: 'PAID' })
        .where('invoice_id', '=', invoiceId)
        .returningAll()
        .executeTakeFirstOrThrow();

      // Transition license to FULLY_ACTIVATED
      await this.updateLicenseStatus(
        tenantId,
        'FULLY_ACTIVATED',
        'paystack-webhook',
        `Payment confirmed via Paystack reference: ${paystackReference}`
      );

      logger.info('Payment recorded and license activated', {
        tenantId,
        invoiceId,
        paymentId,
      });

      return updatedInvoice as SubscriptionInvoice;
    });
  }

  /**
   * Get pending invoices for a tenant
   *
   * @param tenantId - Tenant UUID
   * @returns Array of pending invoices
   */
  async getPendingInvoices(tenantId: string): Promise<SubscriptionInvoice[]> {
    logger.info('Fetching pending invoices', { tenantId });

    return withTenant(tenantId, async (trx) => {
      const invoices = await trx
        .selectFrom('subscription_invoices')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'PENDING')
        .orderBy('due_date', 'asc')
        .execute();

      return invoices as SubscriptionInvoice[];
    });
  }

  /**
   * Check if write operation is allowed for tenant
   *
   * Used by license-lockdown middleware to determine if POS/inventory writes should be blocked
   * Returns false if tenant is SUSPENDED_NON_PAYMENT
   *
   * @param tenantId - Tenant UUID
   * @returns True if writes allowed, false if read-only
   */
  async canWriteData(tenantId: string): Promise<boolean> {
    const licenseInfo = await this.evaluateLicenseStatus(tenantId);
    return licenseInfo.canWrite;
  }

  /**
   * Get all active businesses (for billing worker)
   *
   * Used by workers to find tenants requiring license status updates
   *
   * @returns Array of business records
   */
  async getAllActiveTenants(): Promise<
    Array<{
      tenant_id: string;
      license_status: LicenseStatus;
      license_expires_at: Date;
    }>
  > {
    return withTenant('00000000-0000-0000-0000-000000000000', async (trx) => {
      // Use system tenant context (or fetch without RLS for this operation)
      const businesses = await trx
        .selectFrom('businesses')
        .select(['tenant_id', 'license_status', 'license_expires_at'])
        .where('is_active', '=', true)
        .execute();

      return businesses as Array<{
        tenant_id: string;
        license_status: LicenseStatus;
        license_expires_at: Date;
      }>;
    }).catch((error) => {
      logger.error('Failed to fetch all active tenants', { error });
      return [];
    });
  }

  /**
   * Get license audit history for a tenant
   *
   * Used for compliance and troubleshooting
   *
   * @param tenantId - Tenant UUID
   * @param limit - Number of records to return (default 100)
   * @returns Array of audit log records
   */
  async getLicenseAuditHistory(
    tenantId: string,
    limit: number = 100
  ): Promise<
    Array<{
      audit_id: string;
      old_status: LicenseStatus;
      new_status: LicenseStatus;
      changed_by: string;
      notes: string | null;
      created_at: Date;
    }>
  > {
    return withTenant(tenantId, async (trx) => {
      const logs = await trx
        .selectFrom('license_audit_logs')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .orderBy('created_at', 'desc')
        .limit(limit)
        .execute();

      return logs as Array<{
        audit_id: string;
        old_status: LicenseStatus;
        new_status: LicenseStatus;
        changed_by: string;
        notes: string | null;
        created_at: Date;
      }>;
    });
  }
}

// Export singleton instance
export const tenancyService = new TenancyService();