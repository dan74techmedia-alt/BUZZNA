// apps/api/src/modules/sync/sync.service.ts

import { db } from '../../db/client';
import { logger } from '../../common/logging/logger';

/**
 * Sync Service
 *
 * OFFLINE-FIRST DATA SYNCHRONIZATION ENGINE
 *
 * Handles bidirectional sync between offline terminals and cloud.
 *
 * Workflow:
 * 1. Terminal queues transactions in local IndexedDB (offline)
 * 2. When connectivity restored, uploads sync batch
 * 3. Server validates each transaction
 * 4. If conflicts detected (LWW = Last-Write-Wins), resolves
 * 5. Applies transactions to database
 * 6. Returns server state snapshot for terminal cache update
 *
 * Architecture Rules:
 * - Transactions are immutable once uploaded
 * - Conflicts resolved via timestamp (LWW strategy)
 * - Negative inventory allowed (walkaway protocol)
 * - Sync is idempotent (batchId prevents duplicates)
 * - Back-dated writes rejected (server clock is authority)
 */

export interface SyncBatch {
  batchId: string;
  tenantId: string;
  terminalId: string;
  userId: string;
  events: SyncEvent[];
  createdAt: Date;
  clientTimestamp: Date;
}

export interface SyncEvent {
  eventId: string;
  eventType: string; // 'sale', 'inventory_adjustment', 'payment', etc.
  resourceType: string;
  resourceId: string;
  operation: 'create' | 'update' | 'delete';
  data: Record<string, any>;
  timestamp: Date;
  checksum?: string;
}

/**
 * Validate sync batch
 */
async function validateSyncBatch(batch: SyncBatch): Promise<{
  valid: boolean;
  errors: string[];
}> {
  const errors: string[] = [];

  // Validate batch metadata
  if (!batch.batchId || !batch.tenantId || !batch.terminalId) {
    errors.push('Missing required batch metadata');
  }

  if (!batch.events || batch.events.length === 0) {
    errors.push('Batch contains no events');
  }

  // Validate events
  for (const event of batch.events || []) {
    if (!event.eventId || !event.eventType) {
      errors.push(`Invalid event: missing eventId or eventType`);
      continue;
    }

    // Check for back-dated writes (server clock is authority)
    const eventTime = new Date(event.timestamp);
    const now = new Date();
    const hoursDiff = Math.abs(now.getTime() - eventTime.getTime()) / (1000 * 60 * 60);

    if (hoursDiff > 24) {
      errors.push(
        `Event ${event.eventId} is too old (${hoursDiff.toFixed(0)}h). Possible clock tampering.`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Check for sync batch conflicts (LWW resolution)
 */
async function detectConflicts(
  batch: SyncBatch
): Promise<{
  conflicts: Array<{
    eventId: string;
    resourceId: string;
    reason: string;
  }>;
}> {
  const conflicts: Array<{
    eventId: string;
    resourceId: string;
    reason: string;
  }> = [];

  for (const event of batch.events) {
    try {
      // Check if resource already exists with newer timestamp
      const existing = await db
        .selectFrom(event.resourceType as any)
        .selectAll()
        .where('tenant_id', '=', batch.tenantId)
        .where('${event.resourceType.slice(0, -1)}_id' as any, '=', event.resourceId)
        .executeTakeFirst();

      if (existing && new Date(existing.updated_at) > new Date(event.timestamp)) {
        conflicts.push({
          eventId: event.eventId,
          resourceId: event.resourceId,
          reason: 'Existing resource has newer timestamp (LWW)',
        });
      }
    } catch (error) {
      logger.debug('Conflict check failed for event', {
        eventId: event.eventId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { conflicts };
}

/**
 * Process sync batch
 */
export async function processSyncBatch(batch: SyncBatch): Promise<{
  success: boolean;
  processedCount: number;
  rejectedCount: number;
  rejections: Array<{
    eventId: string;
    reason: string;
  }>;
}> {
  try {
    // Check if batch already processed
    const existing = await db
      .selectFrom('sync_batches' as any)
      .selectAll()
      .where('tenant_id', '=', batch.tenantId)
      .where('batch_id', '=', batch.batchId)
      .executeTakeFirst();

    if (existing && existing.status === 'completed') {
      logger.info('Sync batch already processed (idempotency)', {
        batchId: batch.batchId,
      });
      return {
        success: true,
        processedCount: batch.events.length,
        rejectedCount: 0,
        rejections: [],
      };
    }

    // Validate batch
    const validation = await validateSyncBatch(batch);
    if (!validation.valid) {
      logger.warn('Sync batch validation failed', {
        batchId: batch.batchId,
        errors: validation.errors,
      });

      await db
        .insertInto('sync_batches' as any)
        .values({
          tenant_id: batch.tenantId,
          batch_id: batch.batchId,
          terminal_id: batch.terminalId,
          user_id: batch.userId,
          status: 'rejected',
          error_message: validation.errors.join('; '),
          event_count: batch.events.length,
          received_at: new Date(),
        })
        .execute();

      return {
        success: false,
        processedCount: 0,
        rejectedCount: batch.events.length,
        rejections: validation.errors.map((err, i) => ({
          eventId: batch.events[i]?.eventId || `unknown-${i}`,
          reason: err,
        })),
      };
    }

    // Detect conflicts
    const { conflicts } = await detectConflicts(batch);

    // Store batch
    await db
      .insertInto('sync_batches' as any)
      .values({
        tenant_id: batch.tenantId,
        batch_id: batch.batchId,
        terminal_id: batch.terminalId,
        user_id: batch.userId,
        status: 'completed',
        event_count: batch.events.length,
        conflict_count: conflicts.length,
        received_at: new Date(),
      })
      .execute();

    // Process non-conflicting events
    let processedCount = 0;
    for (const event of batch.events) {
      const hasConflict = conflicts.some((c) => c.eventId === event.eventId);

      if (!hasConflict) {
        try {
          // Store sync event (immutable)
          await db
            .insertInto('sync_events' as any)
            .values({
              tenant_id: batch.tenantId,
              batch_id: batch.batchId,
              event_id: event.eventId,
              event_type: event.eventType,
              resource_type: event.resourceType,
              resource_id: event.resourceId,
              operation: event.operation,
              data: JSON.stringify(event.data),
              timestamp: new Date(event.timestamp),
              processed_at: new Date(),
            })
            .execute();

          processedCount++;
        } catch (error) {
          logger.error('Failed to process sync event', {
            eventId: event.eventId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    logger.info('Sync batch processed', {
      batchId: batch.batchId,
      tenantId: batch.tenantId,
      processedCount,
      conflictCount: conflicts.length,
    });

    return {
      success: true,
      processedCount,
      rejectedCount: conflicts.length,
      rejections: conflicts.map((c) => ({
        eventId: c.eventId,
        reason: c.reason,
      })),
    };
  } catch (error) {
    logger.error('Failed to process sync batch', {
      batchId: batch.batchId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get sync status
 */
export async function getSyncStatus(
  tenantId: string,
  batchId: string
): Promise<any> {
  try {
    return await db
      .selectFrom('sync_batches' as any)
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('batch_id', '=', batchId)
      .executeTakeFirst();
  } catch (error) {
    logger.error('Failed to get sync status', {
      tenantId,
      batchId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get server state snapshot for offline cache
 */
export async function getServerSnapshot(tenantId: string): Promise<any> {
  try {
    // Get catalog snapshot
    const products = await db
      .selectFrom('products' as any)
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .execute();

    // Get customers snapshot
    const customers = await db
      .selectFrom('customers' as any)
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .execute();

    // Get business settings
    const business = await db
      .selectFrom('businesses' as any)
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    return {
      timestamp: new Date(),
      products,
      customers,
      business,
    };
  } catch (error) {
    logger.error('Failed to get server snapshot', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export const syncService = {
  processSyncBatch,
  getSyncStatus,
  getServerSnapshot,
};

export default syncService;