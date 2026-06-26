import { Router, Request, Response } from 'express';
import { syncEventSchema } from '../automation/automation.schema';
import { db } from '../../config/database';

export const syncRouter = Router();

// Endpoint for the offline PWA to push batched events
syncRouter.post('/batch', async (req: Request, res: Response) => {
  const tenantId = req.headers['x-tenant-id'] as string;
  const events = req.body.events; // Expecting an array of events

  if (!Array.isArray(events)) {
    return res.status(400).json({ error: 'Events must be an array' });
  }

  const processedIds: string[] = [];
  const rejectedEvents: any[] = [];

  for (const event of events) {
    try {
      // 1. Validate individual event
      const parsedEvent = syncEventSchema.parse(event);

      // 2. Insert into sync_events
      await db('sync_events').insert({
        tenant_id: tenantId,
        event_type: parsedEvent.event_type,
        payload: JSON.stringify(parsedEvent.payload),
        occurred_at: parsedEvent.occurred_at
      });

      processedIds.push(parsedEvent.client_event_id);
    } catch (error: any) {
      // 3. Log into sync_rejections if validation or insert fails
      await db('sync_rejections').insert({
        tenant_id: tenantId,
        client_event_id: event.client_event_id || 'UNKNOWN',
        rejection_code: error.name === 'ZodError' ? 'VALIDATION_FAILED' : 'DB_ERROR',
        reason: error.message
      });
      rejectedEvents.push(event.client_event_id);
    }
  }

  // Idempotent response: tell the client what succeeded so they can clear their IndexedDB queues
  res.status(200).json({
    message: 'Sync batch processed',
    acknowledged: processedIds,
    rejected: rejectedEvents
  });
});