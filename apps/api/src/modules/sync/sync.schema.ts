import { z } from 'zod';

/**
 * Validates individual client synchronization events.
 */
const clientSyncEventSchema = z.object({
  eventId: z.string().uuid({ message: 'Event ID must be a valid UUID' }),
  entityName: z.enum([
    'products', 
    'product_categories', 
    'inventory_events', 
    'sales_transactions', 
    'sale_items', 
    'expenses', 
    'customers', 
    'suppliers'
  ], {
    errorMap: () => ({ message: 'Invalid or unauthorized sync entity target' })
  }),
  entityId: z.string().uuid({ message: 'Entity ID must be a valid UUID' }),
  eventType: z.enum(['INSERT', 'UPDATE', 'DELETE'], {
    errorMap: () => ({ message: 'Event type must be INSERT, UPDATE, or DELETE' })
  }),
  payload: z.record(z.any(), {
    required_error: 'Mutation payload object is required'
  }),
  clientTimestamp: z.string().datetime({
    message: 'Client timestamp must be a valid ISO 8601 datetime string for LWW resolution'
  })
});

/**
 * Validates an incoming batch of offline-first replication packets.
 * Fulfills API Contract: POST /api/v1/sync/batches
 */
export const syncBatchSchema = z.object({
  body: z.object({
    events: z.array(clientSyncEventSchema)
      .max(500, { message: 'Sync batches cannot exceed 500 events to prevent memory exhaustion' })
  })
});

export type SyncBatchInput = z.infer<typeof syncBatchSchema>;
export type ClientSyncEventInput = z.infer<typeof clientSyncEventSchema>; 