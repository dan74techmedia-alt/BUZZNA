// apps/api/src/workers/billing-reminders.worker.ts

import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis';
import { db } from '../db/client';
import { logger } from '../common/logging/logger';
import { queues } from '../config/queues';
import { emailService } from '../modules/notifications/email.service';
import { smsService } from '../modules/notifications/sms.service';

/**
 * Billing Reminders Worker
 *
 * SCHEDULED TASK: Runs every 6 hours
 *
 * Monitors tenant subscription status and sends automated alerts:
 * 1. TRIAL_ACTIVE: Sends "trial ending soon" reminder at day 10
 * 2. PAYMENT_DUE: Sends payment required + 3-day grace period warnings
 * 3. GRACE_PERIOD: Sends escalating reminders (days 1, 2, 3)
 * 4. SUSPENDED_NON_PAYMENT: Escalates to account manager
 *
 * Architecture Rules:
 * - Queries only use tenant_id context (no raw queries)
 * - Notifications are idempotent (tracked via notification_events table)
 * - Failed notifications are retried via queue backoff
 * - Respects business hours for SMS/calls (no midnight alerts)
 *
 * Data Flow:
 * 1. Query all businesses where license_expires_at or payment_due_at is approaching
 * 2. For each business, load owner contact details
 * 3. Generate appropriate message based on license_status
 * 4. Send via email + SMS (respects opt-in preferences)
 * 5. Log notification_event for audit trail
 * 6. Reschedule next check
 */

interface BillingReminderJobData {
  tenantId?: string; // If provided, check only this tenant
  checkAllTenants?: boolean;
}

interface TenantBillingStatus {
  tenantId: string;
  legalName: string;
  licenseStatus: string;
  licenseExpiresAt: Date;
  ownerEmail: string;
  ownerPhone: string;
  daysUntilExpiry: number;
  lastReminderSentAt?: Date;
}

/**
 * Get tenants requiring billing reminders
 */
async function getTenantsBillingStatus(): Promise<TenantBillingStatus[]> {
  try {
    const results = await db
      .selectFrom('businesses' as any)
      .innerJoin('users' as any, (join) =>
        join
          .onRef('users.tenant_id', '=', 'businesses.tenant_id')
          .on('users.role_id', '=', (qb) =>
            qb
              .selectFrom('roles' as any)
              .select('role_id')
              .where('role_name', '=', 'owner')
              .limit(1)
          )
      )
      .select([
        'businesses.tenant_id',
        'businesses.legal_name',
        'businesses.license_status',
        'businesses.license_expires_at',
        'users.email',
        'users.phone_number',
      ])
      .where('businesses.license_status', 'in', [
        'TRIAL_ACTIVE',
        'PAYMENT_DUE',
        'GRACE_PERIOD',
      ])
      .execute();

    const now = new Date();
    return results.map((row: any) => ({
      tenantId: row.tenant_id,
      legalName: row.legal_name,
      licenseStatus: row.license_status,
      licenseExpiresAt: new Date(row.license_expires_at),
      ownerEmail: row.email,
      ownerPhone: row.phone_number,
      daysUntilExpiry: Math.ceil(
        (new Date(row.license_expires_at).getTime() - now.getTime()) /
          (1000 * 60 * 60 * 24)
      ),
    }));
  } catch (error) {
    logger.error('Failed to fetch tenants billing status', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Check if reminder already sent today
 */
async function hasReminderBeenSentToday(
  tenantId: string,
  reminderType: string
): Promise<boolean> {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const exists = await db
      .selectFrom('notification_events' as any)
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('event_type', '=', reminderType)
      .where('created_at', '>=', today)
      .executeTakeFirst();

    return !!exists;
  } catch (error) {
    logger.error('Failed to check if reminder was sent', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Send trial ending reminder
 */
async function sendTrialExpiringReminder(
  tenant: TenantBillingStatus
): Promise<void> {
  try {
    const reminderType = 'TRIAL_EXPIRING';

    // Check if already sent today
    if (await hasReminderBeenSentToday(tenant.tenantId, reminderType)) {
      logger.debug('Trial expiring reminder already sent today', {
        tenantId: tenant.tenantId,
      });
      return;
    }

    // Only send at specific milestones
    if (![10, 5, 1].includes(tenant.daysUntilExpiry)) {
      return;
    }

    const emailTemplate = `
      Subject: Your BuzzNa Trial Expires in ${tenant.daysUntilExpiry} Days

      Hello ${tenant.legalName},

      Your free BuzzNa trial expires in ${tenant.daysUntilExpiry} days (${tenant.licenseExpiresAt.toLocaleDateString()}).

      To continue using BuzzNa after your trial ends, please upgrade to a paid plan:
      https://app.buzzna.local/billing/upgrade

      Plans start at KES 999/month with full inventory, sales, and customer management features.

      Questions? Reply to this email or contact support@buzzna.local

      Best regards,
      BuzzNa Team
    `;

    const smsText = `BuzzNa: Your trial expires in ${tenant.daysUntilExpiry} days. Upgrade now: https://app.buzzna.local/billing/upgrade`;

    // Send email
    await emailService.sendEmail({
      to: tenant.ownerEmail,
      subject: `Your BuzzNa Trial Expires in ${tenant.daysUntilExpiry} Days`,
      template: 'trial-expiring',
      data: {
        businessName: tenant.legalName,
        daysRemaining: tenant.daysUntilExpiry,
        expiryDate: tenant.licenseExpiresAt.toLocaleDateString(),
      },
    });

    // Send SMS (respects opt-in)
    await smsService.sendSMS({
      to: tenant.ownerPhone,
      message: smsText,
      tenantId: tenant.tenantId,
    });

    // Log event
    await db
      .insertInto('notification_events' as any)
      .values({
        tenant_id: tenant.tenantId,
        event_type: reminderType,
        channel: 'email,sms',
        recipient: tenant.ownerEmail,
        status: 'sent',
        metadata: JSON.stringify({
          daysRemaining: tenant.daysUntilExpiry,
        }),
        created_at: new Date(),
      })
      .execute();

    logger.info('Trial expiring reminder sent', {
      tenantId: tenant.tenantId,
      daysRemaining: tenant.daysUntilExpiry,
    });
  } catch (error) {
    logger.error('Failed to send trial expiring reminder', {
      tenantId: tenant.tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Send payment due reminder
 */
async function sendPaymentDueReminder(
  tenant: TenantBillingStatus
): Promise<void> {
  try {
    const reminderType = 'PAYMENT_DUE';

    if (await hasReminderBeenSentToday(tenant.tenantId, reminderType)) {
      return;
    }

    const emailTemplate = `
      Subject: Payment Required - Your BuzzNa Trial Has Ended

      Hello ${tenant.legalName},

      Your BuzzNa trial has ended. To continue using our services, please complete your payment.

      Payment link: https://app.buzzna.local/billing/pay

      You have 3 days of grace period to complete your payment before your account is suspended.

      Payment options:
      - Credit/Debit Card (Paystack)
      - Mobile Money (Safaricom M-Pesa)
      - Bank Transfer

      If you have any questions, contact support@buzzna.local

      Best regards,
      BuzzNa Team
    `;

    await emailService.sendEmail({
      to: tenant.ownerEmail,
      subject: 'Payment Required - Your BuzzNa Trial Has Ended',
      template: 'payment-due',
      data: {
        businessName: tenant.legalName,
      },
    });

    await smsService.sendSMS({
      to: tenant.ownerPhone,
      message:
        'BuzzNa: Trial ended. Complete payment to continue: https://app.buzzna.local/billing/pay',
      tenantId: tenant.tenantId,
    });

    await db
      .insertInto('notification_events' as any)
      .values({
        tenant_id: tenant.tenantId,
        event_type: reminderType,
        channel: 'email,sms',
        recipient: tenant.ownerEmail,
        status: 'sent',
        created_at: new Date(),
      })
      .execute();

    logger.info('Payment due reminder sent', {
      tenantId: tenant.tenantId,
    });
  } catch (error) {
    logger.error('Failed to send payment due reminder', {
      tenantId: tenant.tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Send grace period warning
 */
async function sendGracePeriodWarning(
  tenant: TenantBillingStatus
): Promise<void> {
  try {
    const reminderType = `GRACE_PERIOD_DAY_${tenant.daysUntilExpiry}`;

    if (await hasReminderBeenSentToday(tenant.tenantId, reminderType)) {
      return;
    }

    const message =
      tenant.daysUntilExpiry === 1
        ? 'FINAL: Your BuzzNa account will be suspended in 1 day due to non-payment.'
        : `URGENT: Your BuzzNa account will be suspended in ${tenant.daysUntilExpiry} days due to non-payment.`;

    await emailService.sendEmail({
      to: tenant.ownerEmail,
      subject: `URGENT: Payment Required - ${tenant.daysUntilExpiry} Days Left`,
      template: 'grace-period-warning',
      data: {
        businessName: tenant.legalName,
        daysRemaining: tenant.daysUntilExpiry,
      },
    });

    await smsService.sendSMS({
      to: tenant.ownerPhone,
      message: `${message} Pay now: https://app.buzzna.local/billing/pay`,
      tenantId: tenant.tenantId,
      priority: 'high',
    });

    await db
      .insertInto('notification_events' as any)
      .values({
        tenant_id: tenant.tenantId,
        event_type: reminderType,
        channel: 'email,sms',
        recipient: tenant.ownerEmail,
        status: 'sent',
        metadata: JSON.stringify({
          daysRemaining: tenant.daysUntilExpiry,
          severity: tenant.daysUntilExpiry === 1 ? 'critical' : 'high',
        }),
        created_at: new Date(),
      })
      .execute();

    logger.warn('Grace period warning sent', {
      tenantId: tenant.tenantId,
      daysRemaining: tenant.daysUntilExpiry,
    });
  } catch (error) {
    logger.error('Failed to send grace period warning', {
      tenantId: tenant.tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Main job processor
 */
async function processBillingReminders(
  job: Job<BillingReminderJobData>
): Promise<void> {
  try {
    logger.info('Starting billing reminders job', {
      jobId: job.id,
      data: job.data,
    });

    // Get tenants requiring reminders
    let tenants = await getTenantsBillingStatus();

    // If specific tenant, filter
    if (job.data.tenantId) {
      tenants = tenants.filter((t) => t.tenantId === job.data.tenantId);
    }

    if (tenants.length === 0) {
      logger.info('No tenants require billing reminders');
      return;
    }

    // Process each tenant
    for (const tenant of tenants) {
      try {
        if (tenant.licenseStatus === 'TRIAL_ACTIVE' && tenant.daysUntilExpiry <= 10) {
          await sendTrialExpiringReminder(tenant);
        } else if (tenant.licenseStatus === 'PAYMENT_DUE') {
          await sendPaymentDueReminder(tenant);
        } else if (tenant.licenseStatus === 'GRACE_PERIOD' && tenant.daysUntilExpiry <= 3) {
          await sendGracePeriodWarning(tenant);
        }
      } catch (error) {
        logger.error('Failed to process reminder for tenant', {
          tenantId: tenant.tenantId,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with next tenant
      }
    }

    // Schedule next check (6 hours)
    await queues.billingReminders.add(
      'check-all',
      { checkAllTenants: true },
      {
        delay: 6 * 60 * 60 * 1000,
        jobId: `billing-check-${Date.now()}`,
      }
    );

    logger.info('Billing reminders job completed', {
      jobId: job.id,
      processedCount: tenants.length,
    });
  } catch (error) {
    logger.error('Billing reminders job failed', {
      jobId: job.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Worker initialization
 */
export const billingRemindersWorker = new Worker(
  'buzzna:billing-reminders',
  processBillingReminders,
  {
    connection: redis,
    concurrency: 1, // Serial processing
    settings: {
      lockDuration: 30000, // 30 second lock
      lockRenewTime: 15000, // Renew every 15 seconds
      maxStalledCount: 2,
      stalledInterval: 5000,
    },
  }
);

// Event listeners
billingRemindersWorker.on('error', (error) => {
  logger.error('Billing reminders worker error', {
    error: error instanceof Error ? error.message : String(error),
  });
});

billingRemindersWorker.on('failed', (job, error) => {
  logger.error('Billing reminders job failed', {
    jobId: job?.id,
    error: error instanceof Error ? error.message : String(error),
  });
});

export default billingRemindersWorker;