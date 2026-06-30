// File Path: apps/web/src/offline/db.ts

import Dexie, { Table } from 'dexie';

/**
 * Audit-compliant structural footprint of an offline mutations log event.
 * Captures user transactions instantly in an append-only sequence prior to cloud broadcast.
 */
export interface LocalSyncEvent {
  id?: number;                  // Auto-incremented local primary identity vector
  clientEventId: string;       // Cryptographically unique UUIDv4 identity assigned on client creation
  eventType: 'CREATE_SALE' | 'INVENTORY_ADJUST' | 'TILL_SESSION_UPDATE' | 'CUSTOMER_CREDIT_REPAY';
  entityName: string;          // Target database table mapping (e.g., 'sales', 'inventory_events')
  payload: any;                // Unmutated operational data payload block
  occurredAt: string;          // ISO-8601 millisecond-precise local timestamp string
  syncStatus: 'PENDING' | 'SYNCING' | 'FAILED';
  retryCount: number;          // Loop execution counter used to throttle backoff sequences
  lastError?: string;          // Textual debug trace from the latest remote sync failure
}

/**
 * Local projection caches enabling sub-millisecond LRU UI reads completely decoupled from internet connectivity.
 */
export interface CachedProduct {
  productId: string;
  barcode: string;
  legalName: string;
  costFloor: number;
  retailPrice: number;
  currentQuantity: number;
  updatedAt: string;
}

export interface CachedCustomer {
  customerId: string;
  fullName: string;
  phoneNumber: string;
  currentDebtBalance: number;
  creditLimit: number;
  updatedAt: string;
}

/**
 * BuzzNa D74 Authoritative High-Velocity Local Dexie Core Storage Engine
 */
export class BuzzNaDexieDatabase extends Dexie {
  public syncQueue!: Table<LocalSyncEvent, number>;
  public productsCache!: Table<CachedProduct, string>;
  public customersCache!: Table<CachedCustomer, string>;

  constructor() {
    super('BuzzNaD74_LocalEngine');
    
    // Explicit structural indexing definition across high-velocity lookups
    this.version(1).stores({
      syncQueue: '++id, clientEventId, eventType, syncStatus, occurredAt',
      productsCache: 'productId, barcode, legalName',
      customersCache: 'customerId, phoneNumber, fullName'
    });
  }

  /**
   * Resets and purges cache instances during explicit tenant or operator sign-out states.
   * Preserves any pending un-synchronized transactions to mitigate business data loss.
   */
  public async safetyPurgeCache(): Promise<void> {
    const pendingCount = await this.syncQueue.where('syncStatus').equals('PENDING').count();
    if (pendingCount > 0) {
      console.warn(`Safety cache purge bypassed: [${pendingCount}] mutations are currently queued for sync.`);
      return;
    }
    await this.productsCache.clear();
    await this.customersCache.clear();
  }
}

// Instantiate database context export vector
export const localDb = new BuzzNaDexieDatabase();