// apps/api/src/modules/notifications/sms.service.ts

import { logger } from '../../common/logging/logger';
import { db } from '../../db/client';
import axios from 'axios';

/**
 * SMS Service
 *
 * Sends transactional SMS via Safaricom Daraja API
 *
 * Architecture Rules:
 * - All SMS logged to notification_events table
 * - Respects opt-in preferences (MPESA_SENDER_SMS_WHITELIST)
 * - Supports priority levels (high/normal)
 * - Messages limited to 160 characters (GSM-7)
 * - No sensitive data in SMS
 */

interface SMSOptions {
  to: string;
  message: string;
  tenantId?: string;
  priority?: 'high' | 'normal';
}

/**
 * Check SMS opt-in for phone number
 */
async function checkSmsOptIn(
  tenantId: string | undefined,
  phone: string
): Promise<boolean> {
  if (!tenantId) return true;

  try {
    const customer = await db
      .selectFrom('customers' as any)
      .select('sms_notifications_enabled')
      .where('tenant_id', '=', tenantId)
      .where('phone_number', '=', normalizePhone(phone))
      .executeTakeFirst();

    return customer?.sms_notifications_enabled !== false;
  } catch (error) {
    logger.error('Failed to check SMS opt-in', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
}

/**
 * Normalize phone number to MSISDN format
 */
function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 9) {
    return `254${cleaned}`;
  } else if (cleaned.length === 12 && cleaned.startsWith('254')) {
    return cleaned;
  }
  return phone;
}

/**
 * Truncate message to 160 characters (GSM-7)
 */
function truncateMessage(message: string): string {
  if (message.length <= 160) return message;
  return message.substring(0, 157) + '...';
}

/**
 * Log SMS event
 */
async function logSmsEvent(
  tenantId: string | undefined,
  to: string,
  message: string,
  status: 'sent' | 'failed',
  error?: string
): Promise<void> {
  try {
    await db
      .insertInto('notification_events' as any)
      .values({
        tenant_id: tenantId,
        event_type: 'sms_sent',
        channel: 'sms',
        recipient: to,
        message: truncateMessage(message),
        status,
        error_message: error,
        created_at: new Date(),
      })
      .execute();
  } catch (dbError) {
    logger.error('Failed to log SMS event', {
      to,
      error: dbError instanceof Error ? dbError.message : String(dbError),
    });
  }
}

/**
 * Send SMS via Safaricom Daraja
 */
export async function sendSMS(options: SMSOptions): Promise<void> {
  try {
    const { to, message, tenantId, priority = 'normal' } = options;

    // Check opt-in
    const optedIn = await checkSmsOptIn(tenantId, to);
    if (!optedIn) {
      logger.info('SMS skipped - customer opted out', {
        to,
      });
      return;
    }

    // Normalize phone
    const normalizedPhone = normalizePhone(to);

    // Truncate message
    const finalMessage = truncateMessage(message);

    // Skip if message empty
    if (finalMessage.trim().length === 0) {
      logger.warn('SMS message empty after truncation', {
        to,
      });
      return;
    }

    // Call Daraja SMS API
    const response = await axios.post(
      `${process.env.DARAJA_BASE_URL || 'https://api.sandbox.safaricom.co.ke'}/sms/send`,
      {
        phone: normalizedPhone,
        message: finalMessage,
        shortCode: process.env.DARAJA_SHORT_CODE || 'BuzzNa',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.DARAJA_ACCESS_TOKEN}`,
        },
        timeout: parseInt(process.env.DARAJA_GLOBAL_TIMEOUT_MS || '5000'),
      }
    );

    if (response.data.success !== true) {
      throw new Error(`SMS API returned error: ${response.data.message}`);
    }

    logger.info('SMS sent', {
      to: normalizedPhone,
      messageLength: finalMessage.length,
      priority,
    });

    await logSmsEvent(tenantId, normalizedPhone, finalMessage, 'sent');
  } catch (error) {
    logger.error('Failed to send SMS', {
      to: options.to,
      error: error instanceof Error ? error.message : String(error),
    });

    await logSmsEvent(
      options.tenantId,
      options.to,
      options.message,
      'failed',
      error instanceof Error ? error.message : String(error)
    );

    throw error;
  }
}

export const smsService = {
  sendSMS,
};

export default smsService;