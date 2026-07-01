/**
 * ============================================================================
 * BUZZNA D74 - License Expiry Worker
 * ============================================================================
 *
 * PURPOSE:
 * - Monitor trial period expirations (TRIAL_ACTIVE)
 * - Monitor grace period expirations (GRACE_PERIOD)
 * - Auto-transition to next license status on expiry
 * - Send escalating notifications before transitions
 * - Audit all state changes
 *
 * SCHEDULED: Runs every 1 hour (checks all tenants)
 *
 * STATE TRANSITIONS HANDLED:
 * 1. TRIAL_ACTIVE + license_expires_at < NOW
 *    → Transition to PAYMENT_DUE (+ 3 days grace)
 *    → Trigger billing reminder job
 *
 * 2. PAYMENT_DUE + 3 days elapsed + NOT paid
 *    → Transition to GRACE_PERIOD (explicit 3-day period)
 *    → Send "payment required" email
 *
 * 3. GRACE_PERIOD + 3 days elapsed + NOT paid
 *    → Transition to SUSPENDED_NON_PAYMENT (read-only lock)
 *    → Send "account suspended" notification
 *    → Block all POS/inventory writes via middleware
 *
 * ============================================================================
 */

import { Worker, Job } from 'bullmq';
import { db, withTenant } from '../config/database';
import { queueConnectionConfig } from '../config/redis';
import { logger } from '../common/logging/logger';
import { queues } from '../config/queues';
import { tenancyService } from '../modules/tenancy/tenancy.service';
import { v4 as uuidv4 } from 'uuid';

/**
 * License expiry check result
 */
interface ExpiryCheckResult {
  tenant_id: string;
  legal_name: string;
  current_status: string;
  new_status: string;
  days_remaining: number;
  action: string;
}

/**
 * Fetch all tenants with expiring licenses
 *
 * Returns tenants where:
 * - TRIAL_ACTIVE and license_expires_at <= NOW
 * - PAYMENT_DUE and license_expires_at <= NOW
 * - GRACE_PERIOD and license_expires_at <= NOW
 */
async function getExpiringTenants(): Promise<
  Array<{
    tenant_id: string;
    legal_name: string;
    license_status: string;
    license_expires_at: Date;
    email: string;
  }>
> {
  try {
    const now = new Date();

    // Query without tenant context (system-level operation)
    const result = await db
      .selectFrom('businesses')
      .innerJoin('users', (join) =>
        join
          .onRef('users.tenant_id', '=', 'businesses.tenant_id')
          .on('users.role_id', '=', (qb) =>
            qb
              .selectFrom('roles')
              .select('role_id')
              .where('role_name', '=', 'OWNER')
              .limit(1)
          )
      )
      .select([
        'businesses.tenant_id',
        'businesses.legal_name',
        'businesses.license_status',
        'businesses.license_expires_at',
        'users.email',
      ])
      .where('businesses.license_status', 'in', [
        'TRIAL_ACTIVE',
        'PAYMENT_DUE',
        'GRACE_PERIOD',
      ])
      .where('businesses.license_expires_at', '<=', now)
      .where('businesses.is_active', '=', true)
      .execute();

    logger.info('Expiring tenants fetched', { count: result.length });
    return result as Array<{
      tenant_id: string;
      legal_name: string;
      license_status: string;
      license_expires_at: Date;
      email: string;
    }>;
  } catch (error) {
    logger.error('Failed to fetch expiring tenants', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Process single tenant license expiry
 *
 * Transitions license based on current status and elapsed time
 */
async function processExpiringTenant(
  tenant: {
    tenant_id: string;
    legal_name: string;
    license_status: string;
    license_expires_at: Date;
    email: string;
  }
): Promise<ExpiryCheckResult> {
  try {
    const currentStatus = tenant.license_status;
    let newStatus: string = currentStatus;
    let action: string = 'none';
    const daysRemaining = Math.ceil(
      (tenant.license_expires_at.getTime() - new Date().getTime()) /
        (1000 * 60 * 60 * 24)
    );

    logger.info('Processing expiring tenant', {
      tenant_id: tenant.tenant_id,
      currentStatus,
      daysRemaining,
    });

    // STATE TRANSITION LOGIC
    switch (currentStatus) {
      case 'TRIAL_ACTIVE':
        // Trial expired → Move to PAYMENT_DUE
        newStatus = 'PAYMENT_DUE';
        action = 'trial_expired_to_payment_due';

        // Set grace period expiry (now + 3 days)
        const graceExpiryDate = new Date();
        graceExpiryDate.setDate(graceExpiryDate.getDate() + 3);

        await tenancyService.updateLicenseStatus(
          tenant.tenant_id,
          'PAYMENT_DUE',
          'license-expiry-worker',
          `Trial period (14 days) has expired. Grace period ends ${graceExpiryDate.toLocaleDateString()}`
        );

        // Trigger billing reminder job
        await queues.billingReminders.add(
          'send-payment-due',
          { tenantId: tenant.tenant_id },
          { jobId: `payment-due-${tenant.tenant_id}` }
        );

        // Create attention card
        await db
          .insertInto('attention_cards')
          .values({
            card_id: uuidv4(),
            tenant_id: tenant.tenant_id,
            card_type: 'license_expired',
            title: 'Trial Period Ended - Payment Required',
            description: `Your BuzzNa trial has expired. You have 3 days to complete payment before your account is suspended.`,
            severity: 'high',
            status: 'active',
            action_url: '/billing',
            created_at: new Date(),
          })
          .execute();

        logger.warn('Trial expired, transitioned to PAYMENT_DUE', {
          tenant_id: tenant.tenant_id,
        });

        break;

      case 'PAYMENT_DUE':
        // Grace period expired (3 days) → Move to GRACE_PERIOD (explicit 3-day buffer)
        newStatus = 'GRACE_PERIOD';
        action = 'payment_due_to_grace_period';

        const finalExpiryDate = new Date();
        finalExpiryDate.setDate(finalExpiryDate.getDate() + 3);

        await tenancyService.updateLicenseStatus(
          tenant.tenant_id,
          'GRACE_PERIOD',
          'license-expiry-worker',
          `Entered 3-day grace period. Final deadline: ${finalExpiryDate.toLocaleDateString()}`
        );

        // Trigger billing reminder with escalating urgency
        await queues.billingReminders.add(
          'send-grace-period-warning',
          { tenantId: tenant.tenant_id },
          { jobId: `grace-period-${tenant.tenant_id}` }
        );

        logger.warn('Payment due period expired, transitioned to GRACE_PERIOD', {
          tenant_id: tenant.tenant_id,
        });

        break;

      case 'GRACE_PERIOD':
        // Grace period expired (3 days) → Move to SUSPENDED_NON_PAYMENT (read-only lock)
        newStatus = 'SUSPENDED_NON_PAYMENT';
        action = 'grace_period_expired_to_suspended';

        await tenancyService.updateLicenseStatus(
          tenant.tenant_id,
          'SUSPENDED_NON_PAYMENT',
          'license-expiry-worker',
          'Grace period expired. Account suspended. All operational writes blocked.'
        );

        // Create high-priority attention card
        await db
          .insertInto('attention_cards')
          .values({
            card_id: uuidv4(),
            tenant_id: tenant.tenant_id,
            card_type: 'account_suspended',
            title: 'Account Suspended - Payment Required Immediately',
            description: `Your BuzzNa account has been suspended due to non-payment. You can view reports but cannot process sales or edit inventory. Complete payment immediately to restore full access.`,
            severity: 'critical',
            status: 'active',
            action_url: '/billing/pay',
            created_at: new Date(),
          })
          .execute();

        logger.error('Grace period expired, account suspended', {
          tenant_id: tenant.tenant_id,
        });

        break;

      default:
        logger.warn('Unknown license status, no action taken', {
          tenant_id: tenant.tenant_id,
          status: currentStatus,
        });
    }

    return {
      tenant_id: tenant.tenant_id,
      legal_name: tenant.legal_name,
      current_status: currentStatus,
      new_status: newStatus,
      days_remaining: daysRemaining,
      action,
    };
  } catch (error) {
    logger.error('Failed to process expiring tenant', {
      tenant_id: tenant.tenant_id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Main job processor
 */
async function processLicenseExpiry(job: Job): Promise<void> {
  try {
    logger.info('Starting license expiry check job', { jobId: job.id });

    // Get all tenants with expired licenses
    const expiringTenants = await getExpiringTenants();

    if (expiringTenants.length === 0) {
      logger.info('No expiring licenses found');
      return;
    }

    logger.info('Found expiring tenants', { count: expiringTenants.length });

    // Process each expiring tenant
    const results: ExpiryCheckResult[] = [];
    for (const tenant of expiringTenants) {
      try {
        const result = await processExpiringTenant(tenant);
        results.push(result);
      } catch (error) {
        logger.error('Failed to process tenant expiry', {
          tenant_id: tenant.tenant_id,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with next tenant
      }
    }

    // Summary
    const transitionCounts = results.reduce(
      (acc, r) => {
        if (r.action === 'trial_expired_to_payment_due') acc.trialExpired++;
        if (r.action === 'payment_due_to_grace_period') acc.gracePeriodStarted++;
        if (r.action === 'grace_period_expired_to_suspended') acc.suspended++;
        return acc;
      },
      { trialExpired: 0, gracePeriodStarted: 0, suspended: 0 }
    );

    logger.info('License expiry job completed', {
      jobId: job.id,
      totalProcessed: results.length,
      transitions: transitionCounts,
    });
  } catch (error) {
    logger.error('License expiry job failed', {
      jobId: job.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Worker initialization
 */
export const licenseExpiryWorker = new Worker(
  'buzzna:license-expiry',
  processLicenseExpiry,
  {
    connection: queueConnectionConfig,
    concurrency: 1, // Serial processing
    settings: {
      lockDuration: 60000, // 60 second lock
      lockRenewTime: 30000, // Renew every 30 seconds
      maxStalledCount: 2,
      stalledInterval: 5000,
    },
  }
);

// Event listeners
licenseExpiryWorker.on('error', (error) => {
  logger.error('License expiry worker error', {
    error: error instanceof Error ? error.message : String(error),
  });
});

licenseExpiryWorker.on('failed', (job, error) => {
  logger.error('License expiry job failed', {
    jobId: job?.id,
    error: error instanceof Error ? error.message : String(error),
  });
});

export default licenseExpiryWorker;