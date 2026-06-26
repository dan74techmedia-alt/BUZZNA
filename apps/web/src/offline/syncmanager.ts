import { localDb } from './db';
import { api } from '../lib/api'; // Your Axios/Fetch wrapper

export class SyncManager {
  private isSyncing = false;

  /**
   * Pushes local pending events to the backend.
   * Can be triggered on network reconnect or via a setInterval loop.
   */
  static async pushPendingEvents(): Promise<void> {
    if (this.isSyncing || !navigator.onLine) return;
    this.isSyncing = true;

    try {
      // 1. Fetch chronologically sorted pending events
      const pendingEvents = await localDb.sync_queue
        .where('syncStatus')
        .equals('PENDING')
        .sortBy('occurredAt');

      if (pendingEvents.length === 0) {
        this.isSyncing = false;
        return;
      }

      // 2. Format payload according to Phase 4 / Phase 5 API Contract [cite: 95]
      const tenantId = localStorage.getItem('buzzna_tenant_id');
      const deviceId = localStorage.getItem('buzzna_device_id') || 'UNKNOWN_DEVICE';
      
      const payload = {
        deviceId,
        entitlementVersion: 1,
        events: pendingEvents.map(evt => ({
          client_event_id: evt.clientEventId,
          event_type: evt.eventType,
          payload: evt.payload,
          occurred_at: evt.occurredAt
        }))
      };

      // 3. POST to backend (the sync_events table)
      const response = await api.post('/api/v1/sync/batch', payload, {
        headers: { 'x-tenant-id': tenantId }
      });

      const { acknowledged, rejected } = response.data;

      // 4. Move acknowledged events out of the active queue and into history
      await localDb.transaction('rw', localDb.sync_queue, localDb.sync_history, async () => {
        for (const clientId of acknowledged) {
          const evt = await localDb.sync_queue.get(clientId);
          if (evt) {
            await localDb.sync_history.add({ ...evt, syncStatus: 'SYNCED', syncedAt: new Date().toISOString() });
            await localDb.sync_queue.delete(clientId);
          }
        }

        // 5. Handle strict Rejections (e.g., TENANT_SUSPENDED logic) [cite: 139]
        for (const clientId of rejected) {
           await localDb.sync_queue.update(clientId, { syncStatus: 'REJECTED' });
           // In a real app, you'd trigger a React context update here to show the Attention Card [cite: 141]
        }
      });

      console.log(`[Sync Engine] Successfully pushed ${acknowledged.length} events.`);

    } catch (error) {
      console.error('[Sync Engine Error] Network or API failure during batch push:', error);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Helper to write a new event locally without blocking the UI thread.
   */
  static async queueEvent(entityType: string, eventType: string, payload: any) {
    const newEvent = {
      clientEventId: crypto.randomUUID(),
      entityType,
      eventType,
      occurredAt: new Date().toISOString(),
      payload,
      syncStatus: 'PENDING' as const
    };
    
    await localDb.sync_queue.add(newEvent);
    
    // Attempt background sync immediately if online
    if (navigator.onLine) {
        this.pushPendingEvents();
    }
  }
}