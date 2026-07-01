import { Queue, ConnectionOptions } from 'bullmq';
import { env } from './env';

export const redisConnectionOptions: ConnectionOptions = {
  url: env.REDIS_URL,
  maxRetriesPerRequest: null, // Required by BullMQ
};

// Queue Definitions mapping directly to Section 9.1
export const queues = {
  subscriptionReminders: new Queue('subscription-reminders', { connection: redisConnectionOptions }),
  merchantReconciliation: new Queue('merchant-reconciliation', { connection: redisConnectionOptions }),
  projectionRebuild: new Queue('projection-rebuild', { connection: redisConnectionOptions }),
  reportExporter: new Queue('report-exporter', { connection: redisConnectionOptions }),
};