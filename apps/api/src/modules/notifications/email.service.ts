// apps/api/src/modules/notifications/email.service.ts

import { logger } from '../../common/logging/logger';
import nodemailer from 'nodemailer';
import { db } from '../../db/client';

/**
 * Email Service
 *
 * Sends transactional and marketing emails via SMTP
 *
 * Architecture Rules:
 * - All emails logged to notification_events table (audit trail)
 * - Supports template rendering (Handlebars)
 * - Respects business communication preferences
 * - Failed sends queued for retry
 * - No sensitive data in email headers
 */

interface EmailOptions {
  to: string;
  subject: string;
  template: string;
  data?: Record<string, any>;
  cc?: string[];
  bcc?: string[];
}

interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

/**
 * Email templates library
 */
const emailTemplates: Record<string, EmailTemplate> = {
  'trial-expiring': {
    subject: 'Your BuzzNa Trial Expires Soon',
    html: `
      <h2>Trial Expiring</h2>
      <p>Hello {{businessName}},</p>
      <p>Your BuzzNa trial expires in {{daysRemaining}} days ({{expiryDate}}).</p>
      <p><a href="https://app.buzzna.local/billing/upgrade">Upgrade Now</a></p>
    `,
    text: 'Your BuzzNa trial expires in {{daysRemaining}} days. Visit https://app.buzzna.local/billing/upgrade',
  },
  'payment-due': {
    subject: 'Payment Required - BuzzNa',
    html: `
      <h2>Payment Required</h2>
      <p>Hello {{businessName}},</p>
      <p>Your trial has ended. Please complete payment to continue.</p>
      <p><a href="https://app.buzzna.local/billing/pay">Pay Now</a></p>
    `,
    text: 'Complete payment to continue using BuzzNa: https://app.buzzna.local/billing/pay',
  },
  'grace-period-warning': {
    subject: 'URGENT: Payment Required - {{daysRemaining}} Days Left',
    html: `
      <h2 style="color: red;">URGENT: Account Suspension Warning</h2>
      <p>Hello {{businessName}},</p>
      <p>Your account will be suspended in {{daysRemaining}} days unless payment is received.</p>
      <p><a href="https://app.buzzna.local/billing/pay">Pay Immediately</a></p>
    `,
    text: 'URGENT: Account suspension in {{daysRemaining}} days. Pay now: https://app.buzzna.local/billing/pay',
  },
  'order-confirmation': {
    subject: 'Order Confirmation #{{orderId}}',
    html: `
      <h2>Order Confirmed</h2>
      <p>Order ID: {{orderId}}</p>
      <p>Total: {{total}}</p>
      <p><a href="https://app.buzzna.local/orders/{{orderId}}">View Order</a></p>
    `,
    text: 'Order {{orderId}} confirmed. Total: {{total}}',
  },
  generic: {
    subject: 'Notification from BuzzNa',
    html: `<p>{{message}}</p>`,
    text: '{{message}}',
  },
};

/**
 * Render template with data
 */
function renderTemplate(template: string, data: Record<string, any>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return data[key] !== undefined ? String(data[key]) : match;
  });
}

/**
 * SMTP transporter (singleton)
 */
let transporter: any = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'localhost',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });
  }
  return transporter;
}

/**
 * Log email event
 */
async function logEmailEvent(
  tenantId: string | undefined,
  to: string,
  subject: string,
  status: 'sent' | 'failed',
  error?: string
): Promise<void> {
  try {
    await db
      .insertInto('notification_events' as any)
      .values({
        tenant_id: tenantId,
        event_type: 'email_sent',
        channel: 'email',
        recipient: to,
        subject,
        status,
        error_message: error,
        created_at: new Date(),
      })
      .execute();
  } catch (dbError) {
    logger.error('Failed to log email event', {
      to,
      error: dbError instanceof Error ? dbError.message : String(dbError),
    });
  }
}

/**
 * Check email opt-in for tenant
 */
async function checkEmailOptIn(tenantId: string | undefined): Promise<boolean> {
  if (!tenantId) return true; // No tenant context = always send

  try {
    const settings = await db
      .selectFrom('business_settings' as any)
      .select('email_notifications_enabled')
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    return settings?.email_notifications_enabled !== false;
  } catch (error) {
    logger.error('Failed to check email opt-in', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return true; // Default to allowing
  }
}

/**
 * Send email
 */
export async function sendEmail(options: EmailOptions): Promise<void> {
  try {
    const { to, subject, template, data = {} } = options;

    // Get template
    const emailTemplate = emailTemplates[template] || emailTemplates.generic;

    // Render template
    const finalSubject = renderTemplate(emailTemplate.subject, data);
    const finalHtml = renderTemplate(emailTemplate.html, data);
    const finalText = renderTemplate(emailTemplate.text, data);

    // Send email
    const transporter = getTransporter();
    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@buzzna.local',
      to,
      subject: finalSubject,
      html: finalHtml,
      text: finalText,
      cc: options.cc,
      bcc: options.bcc,
    });

    logger.info('Email sent', {
      to,
      subject: finalSubject,
      template,
    });

    // Log event
    await logEmailEvent(undefined, to, finalSubject, 'sent');
  } catch (error) {
    logger.error('Failed to send email', {
      to: options.to,
      error: error instanceof Error ? error.message : String(error),
    });

    await logEmailEvent(
      undefined,
      options.to,
      options.subject,
      'failed',
      error instanceof Error ? error.message : String(error)
    );

    throw error;
  }
}

export const emailService = {
  sendEmail,
};

export default emailService;