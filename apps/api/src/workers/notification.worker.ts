// apps/api/src/workers/notification.worker.ts

import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis';
import { logger } from '../common/logging/logger';
import { emailService } from '../modules/notifications/email.service';
import { smsService } from '../modules/notifications/sms.service';

interface NotificationJob {
  tenantId: string;
  type: 'email' | 'sms' | 'push';
  to: string;
  subject?: string;
  message: string;
  template?: string;
  data?: Record<string, any>;
}

async function processNotification(job: Job<NotificationJob>): Promise<void> {
  try {
    const { type, to, message, subject, template, data } = job.data;

    if (type === 'email') {
      await emailService.sendEmail({
        to,
        subject: subject || 'Notification',
        template: template || 'generic',
        data: data || { message },
      });
    } else if (type === 'sms') {
      await smsService.sendSMS({
        to,
        message,
        tenantId: job.data.tenantId,
      });
    }

    logger.info('Notification sent', {
      jobId: job.id,
      type,
      to,
    });
  } catch (error) {
    logger.error('Notification job failed', {
      jobId: job.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export const notificationWorker = new Worker(
  'buzzna:notifications',
  processNotification,
  {
    connection: redis,
    concurrency: 5,
  }
);

export default notificationWorker;