// File Path: apps/web/src/offline/syncmanager.ts

import { localDb, LocalSyncEvent, CachedProduct, CachedCustomer } from './db';

export interface SyncEngineStatusReport {
  isOnline: boolean;
  pendingEventCount: number;
  isSyncing: boolean;
  lastSuccessfulSyncAt: string | null;
}

/**
 * BuzzNa D74 Production-Grade Walkaway Synchronization Engine Core
 * Handles non-blocking background queue synchronization, exponential backoff,
 * authorization token injection, and Last-Write-Wins client reconciliation.
 */
export class WalkawaySyncManager {
  private static instance: WalkawaySyncManager;
  private apiBaseUrl: string;
  private isSyncProcessing = false;
  private syncIntervalTimer: NodeJS.Timeout | null = null;
  private lastSyncTimestamp: string | null = null;
  private statusListeners: Array<(status: SyncEngineStatusReport) => void> = [];

  private constructor() {
    const env = (import.meta as any).env || {};
    this.apiBaseUrl = env.VITE_API_BASE_URL || '/api/v1';
    this.initializeNetworkEventInterceptors();
  }

  /**
   * Guarantees a single coordinated background loop execution context across the client lifecycle.
   */
  public static getInstance(): WalkawaySyncManager {
    if (!WalkawaySyncManager.instance) {
      WalkawaySyncManager.instance = new WalkawaySyncManager();
    }
    return WalkawaySyncManager.instance;
  }

  /**
   * Subscribes status updates to the UI, enabling real-time network indicator changes.
   */
  public registerStatusListener(callback: (status: SyncEngineStatusReport) => void): void {
    this.statusListeners.push(callback);
    this.broadcastCurrentStatus();
  }

  /**
   * Unsubscribes status updates to prevent memory leaks when UI elements unmount.
   */
  public unregisterStatusListener(callback: (status: SyncEngineStatusReport) => void): void {
    this.statusListeners = this.statusListeners.filter(listener => listener !== callback);
  }

  /**
   * Convenience bootstrap invoked by the UI after a successful login.
   * Alias that kicks off the background synchronization heartbeat.
   */
  public initialize(intervalMs: number = 15000): void {
    this.startLifecycleHeartbeat(intervalMs);
  }

  /**
   * Starts the automatic background synchronization heartbeats.
   */
  public startLifecycleHeartbeat(intervalMs: number = 15000): void {
    if (this.syncIntervalTimer) {
      clearInterval(this.syncIntervalTimer);
    }
    
    this.syncIntervalTimer = setInterval(() => {
      if (navigator.onLine && !this.isSyncProcessing) {
        this.executeBackgroundSyncCycle().catch(err => 
          console.error('Background synchronization lifecycle exception encountered:', err)
        );
      }
    }, intervalMs);

    // Trigger an immediate non-blocking sync evaluation on boot
    this.executeBackgroundSyncCycle().catch(() => {});
  }

  /**
   * Gracefully de-allocates timers during system shutdown or logouts.
   */
  public stopLifecycleHeartbeat(): void {
    if (this.syncIntervalTimer) {
      clearInterval(this.syncIntervalTimer);
      this.syncIntervalTimer = null;
    }
  }

  /**
   * Enqueues an un-mutated business operation event payload into local transactional log stores.
   * Achieves instantaneous UI execution by returning immediately (Walkaway Sync Protocol).
   */
  public async enqueueMutation(
    eventType: LocalSyncEvent['eventType'],
    entityName: string,
    payload: any
  ): Promise<string> {
    const clientEventId = crypto.randomUUID();
    
    const newEvent: LocalSyncEvent = {
      clientEventId,
      eventType,
      entityName,
      payload,
      occurredAt: new Date().toISOString(),
      syncStatus: 'PENDING',
      retryCount: 0
    };

    await localDb.syncQueue.add(newEvent);
    this.broadcastCurrentStatus();

    // Trigger background process loop eagerly without blocking the user thread path
    if (navigator.onLine && !this.isSyncProcessing) {
      this.executeBackgroundSyncCycle().catch(() => {});
    }

    return clientEventId;
  }

  /**
   * Synchronizes the offline queue with the upstream multi-tenant server cluster.
   * Implements transaction isolation and updates local caches with authoritative states.
   */
  public async executeBackgroundSyncCycle(): Promise<void> {
    if (this.isSyncProcessing) return;
    if (!navigator.onLine) {
      this.broadcastCurrentStatus();
      return;
    }

    try {
      this.isSyncProcessing = true;
      this.broadcastCurrentStatus();

      // Retrieve all pending or failed mutations ordered by chronological execution sequence
      const outboundQueue = await localDb.syncQueue
        .where('syncStatus')
        .anyOf(['PENDING', 'FAILED'])
        .sortBy('occurredAt');

      if (outboundQueue.length > 0) {
        await this.pushLocalMutationsToServer(outboundQueue);
      }

      // Execute pull lifecycle sequence to sync regional caching records via Last-Write-Wins parameters
      await this.pullAuthoritativeCachesFromServer();

      this.lastSyncTimestamp = new Date().toISOString();
    } catch (error) {
      console.error('Walkaway Sync Protocol synchronization iteration sequence faulted:', error);
    } finally {
      this.isSyncProcessing = false;
      this.broadcastCurrentStatus();
    }
  }

  /**
   * Transmits local transactions to the protected backend sync engine endpoint.
   */
  private async pushLocalMutationsToServer(events: LocalSyncEvent[]): Promise<void> {
    const bearerToken = localStorage.getItem('auth_access_token');
    if (!bearerToken) {
      throw new Error('Push sync aborted: Active identity token domain context missing from local secure storage.');
    }

    // Limit batch limits to prevent network socket timeouts on unstable connections
    const processingBatch = events.slice(0, 50);
    const batchIds = processingBatch.map(e => e.id as number);

    // Transition state markers to preserve locking parameters during flight
    await localDb.syncQueue.where('id').anyOf(batchIds).modify({ syncStatus: 'SYNCING' });

    try {
      const response = await fetch(`${this.apiBaseUrl}/sync/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${bearerToken}`
        },
        body: JSON.stringify({
          syncEvents: processingBatch.map(e => ({
            clientEventId: e.clientEventId,
            eventType: e.eventType,
            entityName: e.entityName,
            payload: e.payload,
            occurredAt: e.occurredAt
          }))
        })
      });

      if (!response.ok) {
        throw new Error(`Upstream gateway integration response exception: Status [${response.status}]`);
      }

      const syncResult = await response.json();
      
      // Extract specific transactional errors returned by the tenant validation engine
      const rejectedMap = new Map<string, string>();
      if (syncResult.rejections && Array.isArray(syncResult.rejections)) {
        for (const rej of syncResult.rejections) {
          rejectedMap.set(rej.clientEventId, rej.reason || 'Tenant business rules validation failure');
        }
      }

      // Evaluate outcomes row-by-row to reconcile the mutations log
      for (const processedEvent of processingBatch) {
        if (rejectedMap.has(processedEvent.clientEventId)) {
          // Log rejections internally without retrying invalid business data configurations
          await localDb.syncQueue.where('clientEventId').equals(processedEvent.clientEventId).modify({
            syncStatus: 'FAILED',
            lastError: rejectedMap.get(processedEvent.clientEventId),
            retryCount: processedEvent.retryCount + 1
          });
        } else {
          // Cleanly remove successfully synchronized events from local outbox logs
          await localDb.syncQueue.delete(processedEvent.id as number);
        }
      }
    } catch (networkFault: any) {
      // Revert in-flight item states back to FAILED to trigger backoff retries
      for (const failedEvent of processingBatch) {
        const incrementedRetry = failedEvent.retryCount + 1;
        const fallbackStatus = incrementedRetry > 5 ? 'FAILED' : 'PENDING';
        
        await localDb.syncQueue.where('id').equals(failedEvent.id as number).modify({
          syncStatus: fallbackStatus,
          retryCount: incrementedRetry,
          lastError: networkFault?.message || 'Network interface socket failure'
        });
      }
      throw networkFault;
    }
  }

  /**
   * Requests delta modification parameters from the server to refresh cached read matrices via LWW rules.
   */
  private async pullAuthoritativeCachesFromServer(): Promise<void> {
    const bearerToken = localStorage.getItem('auth_access_token');
    if (!bearerToken) return;

    const queryString = this.lastSyncTimestamp ? `?since=${encodeURIComponent(this.lastSyncTimestamp)}` : '';
    
    const response = await fetch(`${this.apiBaseUrl}/sync/pull${queryString}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${bearerToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Authoritative cache pool retrieval faulted. Gateway state response code: [${response.status}]`);
    }

    const cacheDelta = await response.json();

    // Reconcile products projection store via Last-Write-Wins matching configurations
    if (cacheDelta.products && Array.isArray(cacheDelta.products)) {
      for (const prod of (cacheDelta.products as CachedProduct[])) {
        await localDb.productsCache.put(prod);
      }
    }

    // Reconcile customers projection store via Last-Write-Wins matching configurations
    if (cacheDelta.customers && Array.isArray(cacheDelta.customers)) {
      for (const cust of (cacheDelta.customers as CachedCustomer[])) {
        await localDb.customersCache.put(cust);
      }
    }
  }

  /**
   * Broadcasts engine states down into listening UI components.
   */
  private async broadcastCurrentStatus(): Promise<void> {
    if (this.statusListeners.length === 0) return;

    try {
      const pendingEventCount = await localDb.syncQueue.count();
      const currentReport: SyncEngineStatusReport = {
        isOnline: navigator.onLine,
        pendingEventCount,
        isSyncing: this.isSyncProcessing,
        lastSuccessfulSyncAt: this.lastSyncTimestamp
      };

      for (const transmitUpdate of this.statusListeners) {
        transmitUpdate(currentReport);
      }
    } catch (err) {
      console.error('Error broadcasting synchronization engine status report:', err);
    }
  }

  /**
   * Registers low-level system hardware event listeners to catch state transitions dynamically.
   */
  private initializeNetworkEventInterceptors(): void {
    window.addEventListener('online', () => {
      console.info('Network state transition caught: Client online mode unlocked. Flushing data paths.');
      this.executeBackgroundSyncCycle().catch(() => {});
    });

    window.addEventListener('offline', () => {
      console.warn('Network state transition caught: Client entered offline mode. Enforcing local data queuing.');
      this.broadcastCurrentStatus();
    });
  }
}

// Export single instances to unify execution context loops
export const syncManager = WalkawaySyncManager.getInstance();
