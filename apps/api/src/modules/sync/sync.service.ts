// apps/api/src/modules/sync/sync.service.ts

import { db, withTenant } from '../../config/database';
import { logger } from '../../common/logging/logger';
import { AppError } from '../../common/errors/AppError';
import crypto from 'crypto';

interface SyncEvent {
  eventId: string;
  eventType: string;
  resourceType: string;
  resourceId: string;
  operation: 'create' | 'update' | 'delete';
  data: Record<string, any>;
  timestamp: Date;
}

interface SyncBatch {
  batchId: string;
  terminalId: string;
  userId: string;
  events: SyncEvent[];
  createdAt: Date;
  clientTimestamp: Date;
}

export class SyncService {
  /**
   * Validate sync batch
   */
  private static validateBatch(batch: SyncBatch): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!batch.batchId || !batch.terminalId) {
      errors.push('Missing batch metadata');
    }

    if (!batch.events || batch.events.length === 0) {
      errors.push('Batch contains no events');
    }

    // Check for back-dated writes
    for (const event of batch.events || []) {
      const eventTime = new Date(event.timestamp);
      const now = new Date();
      const hoursDiff = Math.abs(now.getTime() - eventTime.getTime()) / (1000 * 60 * 60);

      if (hoursDiff > 24) {
        errors.push(
          `Event ${event.eventId} is too old. Possible clock tampering.`
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Process sync batch (LWW conflict resolution)
   */
  static async processSyncBatch(
    tenantId: string,
    batch: SyncBatch
  ): Promise<{
    success: boolean;
    processedCount: number;
    rejectedCount: number;
    rejections: Array<{ eventId: string; reason: string }>;
  }> {
    try {
      // Validate batch
      const validation = this.validateBatch(batch);
      if (!validation.valid) {
        logger.warn('[SyncService] Batch validation failed', {
          batchId: batch.batchId,
          errors: validation.errors,
        });

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

      // Check for duplicate batch
      const existing = await db
        .selectFrom('sync_batches')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('batch_id', '=', batch.batchId)
        .executeTakeFirst();

      if (existing && existing.status === 'processed') {
        logger.info('[SyncService] Batch already processed', {
          batchId: batch.batchId,
        });
        return {
          success: true,
          processedCount: batch.events.length,
          rejectedCount: 0,
          rejections: [],
        };
      }

      // Store batch
      await withTenant(tenantId, async (trx) => {
        await trx
          .insertInto('sync_batches')
          .values({
            tenant_id: tenantId,
            batch_id: batch.batchId,
            terminal_id: batch.terminalId,
            user_id: batch.userId,
            status: 'processed',
            event_count: batch.events.length,
            received_at: new Date(),
          })
          .onConflict((oc) =>
            oc.column('batch_id').doUpdateSet({
              status: 'processed',
              received_at: new Date(),
            })
          )
          .execute();

        // Process events
        let processedCount = 0;
        for (const event of batch.events) {
          try {
            // Store sync event (append-only, idempotent)
            await trx
              .insertInto('sync_events')
              .values({
                tenant_id: tenantId,
                batch_id: batch.batchId,
                event_id: event.eventId,
                event_type: event.eventType,
                resource_type: event.resourceType,
                resource_id: event.resourceId,
                operation: event.operation,
                data: JSON.stringify(event.data),
                timestamp: event.timestamp,
                processed_at: new Date(),
              })
              .onConflict((oc) =>
                oc.column('event_id').doNothing()
              )
              .execute();

            processedCount++;
          } catch (error) {
            logger.error('[SyncService] Failed to process event', {
              eventId: event.eventId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        logger.info('[SyncService] Batch processed', {
          tenantId,
          batchId: batch.batchId,
          processedCount,
        });
      });

      return {
        success: true,
        processedCount: batch.events.length,
        rejectedCount: 0,
        rejections: [],
      };
    } catch (error) {
      logger.error('[SyncService] Failed to process batch', {
        tenantId,
        batchId: batch.batchId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError('Failed to process sync batch', 500);
    }
  }

  /**
   * Get server snapshot for offline cache
   */
  static async getServerSnapshot(tenantId: string): Promise<any> {
    return await withTenant(tenantId, async (trx) => {
      try {
        // Get products
        const products = await trx
          .selectFrom('products')
          .select([
            'product_id',
            'barcode',
            'name',
            'current_quantity',
            'retail_price',
          ])
          .where('tenant_id', '=', tenantId)
          .where('is_active', '=', true)
          .execute();

        // Get customers
        const customers = await trx
          .selectFrom('customers')
          .select([
            'customer_id',
            'phone_number',
            'full_name',
          ])
          .where('tenant_id', '=', tenantId)
          .where('is_active', '=', true)
          .execute();

        // Get business
        const business = await trx
          .selectFrom('businesses')
          .select([
            'tenant_id',
            'legal_name',
            'license_status',
          ])
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst();

        return {
          timestamp: new Date(),
          products,
          customers,
          business,
        };
      } catch (error) {
        logger.error('[SyncService] Failed to get snapshot', {
          tenantId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new AppError('Failed to get snapshot', 500);
      }
    });
  }
}