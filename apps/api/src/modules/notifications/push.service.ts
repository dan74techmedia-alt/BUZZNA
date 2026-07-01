// apps/api/src/modules/notifications/push.service.ts

import { logger } from '../../common/logging/logger';
import { db } from '../../db/client';

/**
 * Push Notification Service
 *
 * Sends push notifications via Firebase Cloud Messaging (FCM)
 *
 * Architecture Rules:
 * - All push notifications logged to notification_events table
 * - Supports in-app and device notifications
 * - Respects user notification preferences
 * - Uses device tokens stored in database
 */

interface PushOptions {
  tenantId: string;
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  actionUrl?: string;
}

/**
 * Get device tokens for user
 */
async function getUserDeviceTokens(
  tenantId: string,
  userId: string
): Promise<string[]> {
  try {
    const devices = await db
      .selectFrom('user_devices' as any)
      .select('fcm_token')
      .where('tenant_id', '=', tenantId)
      .where('user_id', '=', userId)
      .where('fcm_token', 'is not', null)
      .where('push_notifications_enabled', '=', true)
      .execute();

    return devices
      .map((d: any) => d.fcm_token)
      .filter((token: string | null) => token !== null);
  } catch (error) {
    logger.error('Failed to get device tokens', {
      tenantId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Log push notification event
 */
async function logPushEvent(
  tenantId: string,
  userId: string,
  title: string,
  status: 'sent' | 'failed',
  error?: string
): Promise<void> {
  try {
    await db
      .insertInto('notification_events' as any)
      .values({
        tenant_id: tenantId,
        event_type: 'push_sent',
        channel: 'push',
        user_id: userId,
        subject: title,
        status,
        error_message: error,
        created_at: new Date(),
      })
      .execute();
  } catch (dbError) {
    logger.error('Failed to log push event', {
      userId,
      error: dbError instanceof Error ? dbError.message : String(dbError),
    });
  }
}

/**
 * Send push notification
 * 
 * Note: Firebase Cloud Messaging implementation would go here.
 * For now, this is a stub that logs to database.
 */
export async function sendPush(options: PushOptions): Promise<void> {
  try {
    const { tenantId, userId, title, body, data, actionUrl } = options;

    // Get device tokens
    const deviceTokens = await getUserDeviceTokens(tenantId, userId);

    if (deviceTokens.length === 0) {
      logger.info('No device tokens found for push notification', {
        tenantId,
        userId,
      });
      return;
    }

    // In production, call Firebase Cloud Messaging API
    // For now, just log
    logger.info('Push notification would be sent', {
      tenantId,
      userId,
      title,
      deviceCount: deviceTokens.length,
    });

    await logPushEvent(tenantId, userId, title, 'sent');
  } catch (error) {
    logger.error('Failed to send push notification', {
      userId: options.userId,
      error: error instanceof Error ? error.message : String(error),
    });

    await logPushEvent(
      options.tenantId,
      options.userId,
      options.title,
      'failed',
      error instanceof Error ? error.message : String(error)
    );

    throw error;
  }
}

export const pushService = {
  sendPush,
};

export default pushService;