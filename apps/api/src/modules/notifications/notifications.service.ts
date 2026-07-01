// apps/api/src/modules/notifications/notifications.service.ts

import { db } from '../../db/client';
import { logger } from '../../common/logging/logger';
import { queues } from '../../config/queues';
import { emailService } from './email.service';
import { smsService } from './sms.service';
import { pushService } from './push.service';

/**
 * Notifications Service
 *
 * High-level notification orchestration
 * Routes notifications to appropriate channels (email, SMS, push)
 */

export interface NotificationPayload {
  tenantId: string;
  userId?: string;
  recipients?: string[]; // Email addresses or phone numbers
  type:
    | 'info'
    | 'warning'
    | 'error'
    | 'success'
    | 'alert';
  title: string;
  message: string;
  channels?: ('email' | 'sms' | 'push')[];
  data?: Record<string, any>;
  actionUrl?: string;
}

/**
 * Send multi-channel notification
 */
export async function sendNotification(
  payload: NotificationPayload
): Promise<void> {
  try {
    const {
      tenantId,
      userId,
      recipients = [],
      title,
      message,
      channels = ['email', 'push'],
      data = {},
      actionUrl,
    } = payload;

    // Queue email notifications
    if (channels.includes('email') && recipients.length > 0) {
      for (const email of recipients.filter((r) => r.includes('@'))) {
        await queues.notifications.add(
          'send-email',
          {
            tenantId,
            type: 'email',
            to: email,
            subject: title,
            message,
            template: 'generic',
            data: { message, ...data },
          },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
          }
        );
      }
    }

    // Queue SMS notifications
    if (channels.includes('sms') && recipients.length > 0) {
      for (const phone of recipients.filter((r) => !r.includes('@'))) {
        await queues.notifications.add(
          'send-sms',
          {
            tenantId,
            type: 'sms',
            to: phone,
            message,
          },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
          }
        );
      }
    }

    // Queue push notifications
    if (channels.includes('push') && userId) {
      await queues.notifications.add(
        'send-push',
        {
          tenantId,
          userId,
          title,
          body: message,
          data,
          actionUrl,
        },
        {
          attempts: 2,
          backoff: { type: 'fixed', delay: 3000 },
        }
      );
    }

    logger.info('Notification queued', {
      tenantId,
      title,
      channels: channels.join(','),
      recipientCount: recipients.length,
    });
  } catch (error) {
    logger.error('Failed to queue notification', {
      title: payload.title,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Send alert to business owner
 */
export async function sendOwnerAlert(
  tenantId: string,
  title: string,
  message: string,
  severity: 'info' | 'warning' | 'error'
): Promise<void> {
  try {
    // Get owner email
    const owner = await db
      .selectFrom('users' as any)
      .select('email')
      .where('tenant_id', '=', tenantId)
      .where('role_id', '=', (qb) =>
        qb
          .selectFrom('roles' as any)
          .select('role_id')
          .where('role_name', '=', 'owner')
          .limit(1)
      )
      .executeTakeFirst();

    if (!owner) {
      logger.warn('No owner found for tenant', {
        tenantId,
      });
      return;
    }

    await sendNotification({
      tenantId,
      recipients: [owner.email],
      type: severity,
      title,
      message,
      channels: ['email'],
    });
  } catch (error) {
    logger.error('Failed to send owner alert', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get notification history for user
 */
export async function getNotificationHistory(
  tenantId: string,
  userId?: string,
  limit: number = 50
): Promise<any[]> {
  try {
    let query = db
      .selectFrom('notification_events' as any)
      .selectAll()
      .where('tenant_id', '=', tenantId);

    if (userId) {
      query = query.where('user_id', '=', userId);
    }

    const events = await query
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();

    return events;
  } catch (error) {
    logger.error('Failed to get notification history', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Mark notification as read
 */
export async function markNotificationAsRead(
  notificationId: string
): Promise<void> {
  try {
    await db
      .updateTable('notification_events' as any)
      .set({
        read_at: new Date(),
      })
      .where('event_id', '=', notificationId)
      .execute();
  } catch (error) {
    logger.error('Failed to mark notification as read', {
      notificationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export const notificationsService = {
  sendNotification,
  sendOwnerAlert,
  getNotificationHistory,
  markNotificationAsRead,
};

export default notificationsService;