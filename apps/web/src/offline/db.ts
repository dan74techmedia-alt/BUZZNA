// File Path: apps/web/src/offline/db.ts

import Dexie, { Table } from 'dexie';

/**
 * Audit-compliant structural footprint of an offline mutations log event.
 * Captures user transactions instantly in an append-only sequence prior to cloud broadcast.
 *
 * NOTE: Different modules of the app were authored against slightly different field
 * conventions (camelCase vs snake_case). To keep the offline engine cohesive we keep
 * the interface permissive and index both naming styles.
 */
export interface LocalSyncEvent {
  id?: number;
  clientEventId?: string;
  client_event_id?: string;
  eventType?: string;
  event_type?: string;
  entityName?: string;
  entity_type?: string;
  payload: any;
  occurredAt?: string;
  occurred_at?: string;
  created_at?: string;
  syncStatus?: 'PENDING' | 'SYNCING' | 'FAILED' | 'SYNCED';
  sync_status?: string;
  retryCount?: number;
  lastError?: string;
}

export interface CachedProduct {
  productId?: string;
  product_id?: string;
  barcode?: string;
  legalName?: string;
  name?: string;
  costFloor?: number | string;
  cost_floor?: number | string;
  retailPrice?: number | string;
  currentQuantity?: number | string;
  current_quantity?: number | string;
  updatedAt?: string;
}

export interface CachedCustomer {
  customerId?: string;
  customer_id?: string;
  fullName?: string;
  phoneNumber?: string;
  outstandingCredit?: number | string;
  currentDebtBalance?: number;
  creditLimit?: number;
  updatedAt?: string;
}

export interface BusinessSnapshot {
  id?: number;
  tenantId: string;
  legalName: string;
  tradeName?: string | null;
  licenseStatus: string;
  licenseExpiresAt?: string;
  permissions?: string[];
  cachedAt?: string;
}

export interface CurrentTillSession {
  id?: number;
  tillSessionId?: string;
  openedAt?: string;
  openingFloat?: number;
}

/**
 * BuzzNa D74 Authoritative High-Velocity Local Dexie Core Storage Engine.
 *
 * Tables are declared with the exact store names used across the codebase so that
 * both `db.products_cache` and legacy `localDb.productsCache` access styles resolve.
 */
export class BuzzNaDexieDatabase extends Dexie {
  // Canonical snake_case stores (used by pages, hooks, stores)
  public sync_queue!: Table<LocalSyncEvent, number>;
  public products_cache!: Table<CachedProduct, string>;
  public customers_cache!: Table<CachedCustomer, string>;
  public business_snapshot!: Table<BusinessSnapshot, number>;
  public current_till_session!: Table<CurrentTillSession, number>;

  constructor() {
    super('BuzzNaD74_LocalEngine');

    this.version(1).stores({
      sync_queue:
        '++id, clientEventId, client_event_id, syncStatus, sync_status, occurredAt, occurred_at, created_at, entity_type, event_type',
      products_cache: 'productId, product_id, barcode, name',
      customers_cache: 'customerId, customer_id, phoneNumber, fullName',
      business_snapshot: '++id, tenantId',
      current_till_session: '++id, tillSessionId',
    });
  }

  // ---- Legacy camelCase aliases (used by syncmanager.ts) --------------------
  get syncQueue(): Table<LocalSyncEvent, number> {
    return this.sync_queue;
  }
  get productsCache(): Table<CachedProduct, string> {
    return this.products_cache;
  }
  get customersCache(): Table<CachedCustomer, string> {
    return this.customers_cache;
  }

  /**
   * Resets and purges cache instances during explicit tenant or operator sign-out states.
   * Preserves any pending un-synchronized transactions to mitigate business data loss.
   */
  public async safetyPurgeCache(): Promise<void> {
    const pendingCount = await this.sync_queue
      .where('syncStatus')
      .equals('PENDING')
      .count();
    if (pendingCount > 0) {
      console.warn(
        `Safety cache purge bypassed: [${pendingCount}] mutations are currently queued for sync.`
      );
      return;
    }
    await this.products_cache.clear();
    await this.customers_cache.clear();
  }
}

// Single shared database context. Exported under both `db` and `localDb`.
export const db = new BuzzNaDexieDatabase();
export const localDb = db;
export default db;
