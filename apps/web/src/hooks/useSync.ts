// apps/web/src/hooks/useSync.ts
import { useState, useEffect } from 'react';
import { useOffline } from './useOffline';
import { db } from '../offline/db';
import { authApi } from '../features/auth/authApi';

export const useSync = () => {
  const isOffline = useOffline();
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);

  // Re-calculate queue length reactively
  const updateQueueCount = async () => {
    const count = await db.sync_queue.count();
    setPendingSyncCount(count);
  };

  useEffect(() => {
    updateQueueCount();
    // Re-check every 10 seconds locally
    const interval = setInterval(updateQueueCount, 10000);
    return () => clearInterval(interval);
  }, []);

  const syncNow = async () => {
    if (isOffline || isSyncing) return;
    
    setIsSyncing(true);
    try {
      const packets = await db.sync_queue.orderBy('created_at').limit(100).toArray();
      
      if (packets.length === 0) {
        setIsSyncing(false);
        return;
      }

      // Architecture Rule: API Route Contract Mapping
      const payload = {
        device_id: navigator.userAgent, // Or generated terminal ID
        events: packets.map(p => ({
          client_event_id: p.client_event_id,
          entity_type: p.entity_type,
          event_type: p.event_type,
          payload: p.payload,
          occurred_at: p.occurred_at
        }))
      };

      await authApi.post('/api/v1/sync/batches', payload);

      // On success, wipe synced packets from local queue
      const packetIds = packets.map(p => p.id);
      await db.sync_queue.bulkDelete(packetIds);
      
      await updateQueueCount();
    } catch (error) {
      console.error('[Sync Engine] Batch upload failed. Retaining packets for next attempt.', error);
    } finally {
      setIsSyncing(false);
    }
  };

  // Auto-sync trigger when coming back online
  useEffect(() => {
    if (!isOffline && pendingSyncCount > 0) {
      syncNow();
    }
  }, [isOffline, pendingSyncCount]);

  return { isSyncing, pendingSyncCount, syncNow };
};