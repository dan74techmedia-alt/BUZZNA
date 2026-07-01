import { Router } from 'express';
import * as notificationsController from '../modules/notifications/notifications.controller';

const router = Router();

// Fetch automated system alerts (e.g., Inventory Anomalies, Shift Discrepancies)
router.get('/', notificationsController.getNotifications);
router.get('/delivery-logs', notificationsController.getDeliveryLogs);

// Acknowledge/dismiss alerts
router.patch('/:id/acknowledge', notificationsController.acknowledgeNotification);

export default router;