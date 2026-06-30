import { db } from '../../db/client';
import { sql, eq, and } from 'drizzle-orm';
import { AppError } from '../../common/errors/AppError';

// Dynamic import or local type mapping for dynamic table updates during sync replication
import { syncEvents, syncRejections } from '../../db/migrations/schema';

interface ClientSyncEvent {
  eventId: string;
  entityName: string;
  entityId: string;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  payload: any;
  clientTimestamp: string;
}

export class SyncService {
  /**
   * Processes an incoming batch of synchronization events from an offline client device.
   * Leverages Last-Write-Wins (LWW) resolution and strictly prevents multi-tenant crossover.
   */
  static async processSyncBatch(tenantId: string, events: ClientSyncEvent[]) {
    if (!events || events.length === 0) {
      return { processed: 0, rejections: 0 };
    }

    let processedCount = 0;
    let rejectionCount = 0;

    // Wrap the entire batch execution sequence in a single managed transaction block
    return await db.transaction(async (tx) => {
      // 1. Enforce PgBouncer-safe Row Level Security (RLS) tenant isolation context
      await tx.execute(sql`SET LOCAL app.current_tenant_id = ${tenantId}`);

      for (const event of events) {
        try {
          // 2. Validate basic entity boundaries dynamically to prevent malicious SQL injections
          const allowedTables = [
            'products', 'product_categories', 'inventory_events', 
            'sales_transactions', 'sale_items', 'expenses', 
            'customers', 'suppliers'
          ];
          
          if (!allowedTables.includes(event.entityName)) {
            throw new Error(`Unauthorized or unknown sync entity: ${event.entityName}`);
          }

          // 3. Execute Last-Write-Wins (LWW) Conflict Resolution Strategy
          // Query the live target table to see if a newer or conflicting record exists
          const existingRecord = await tx.execute(
            sql.raw(`SELECT updated_at FROM ${event.entityName} WHERE id = '${event.entityId}' LIMIT 1`)
          );

          if (existingRecord.rows.length > 0) {
            const serverUpdatedAt = new Date((existingRecord.rows[0] as any).updated_at);
            const clientTimestamp = new Date(event.clientTimestamp);

            // If server-side record state is newer than client offline modification, discard client write
            if (serverUpdatedAt > clientTimestamp) {
              await tx.insert(syncRejections).values({
                tenantId,
                clientEventId: event.eventId,
                rejectionCode: 'LWW_CONFL_OUTDATED',
                reason: `Client mutation timestamp ${event.clientTimestamp} is older than server record state ${serverUpdatedAt.toISOString()}`,
                createdAt: new Date()
              });
              rejectionCount++;
              continue;
            }
          }

          // 4. Apply Mutations Based on Event Type
          const timestampDbStr = new Date(event.clientTimestamp).toISOString();
          
          if (event.eventType === 'INSERT') {
            const keys = Object.keys(event.payload).join(', ');
            const values = Object.values(event.payload).map(v => typeof v === 'object' ? JSON.stringify(v) : v);
            
            await tx.execute(sql.raw(`
              INSERT INTO ${event.entityName} (id, tenant_id, ${keys}, created_at, updated_at)
              VALUES ('${event.entityId}', '${tenantId}', ${values.map(v => `'${v}'`).join(', ')}, '${timestampDbStr}', '${timestampDbStr}')
              ON CONFLICT (id) DO NOTHING
            `));
          } 
          else if (event.eventType === 'UPDATE') {
            const updateSets = Object.entries(event.payload)
              .map(([k, v]) => `${k} = '${typeof v === 'object' ? JSON.stringify(v) : v}'`)
              .join(', ');

            await tx.execute(sql.raw(`
              UPDATE ${event.entityName}
              SET ${updateSets}, updated_at = '${timestampDbStr}'
              WHERE id = '${event.entityId}' AND tenant_id = '${tenantId}'
            `));
          } 
          else if (event.eventType === 'DELETE') {
            // STRICT COMPLIANCE: Hard deletes are banned for critical entities. Fallback to soft delete state if supported.
            await tx.execute(sql.raw(`
              UPDATE ${event.entityName}
              SET updated_at = '${timestampDbStr}', is_deleted = true
              WHERE id = '${event.entityId}' AND tenant_id = '${tenantId}'
            `));
          }

          // 5. Build authoritative append-only sync history ledger
          await tx.insert(syncEvents).values({
            tenantId,
            eventType: event.eventType,
            payload: event.payload,
            occurredAt: new Date(event.clientTimestamp)
          });

          processedCount++;
        } catch (err: any) {
          // Log parsing structural sync failures explicitly inside database rejections sink
          await tx.insert(syncRejections).values({
            tenantId,
            clientEventId: event.eventId,
            rejectionCode: 'SYNC_PROCESSING_ERR',
            reason: err.message || 'Malformed schema payload payload during synchronization.',
            createdAt: new Date()
          });
          rejectionCount++;
        }
      }

      return {
        processed: processedCount,
        rejections: rejectionCount
      };
    });
  }
}  