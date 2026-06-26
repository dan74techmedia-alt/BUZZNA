import Dexie, { Table } from 'dexie';

// Define the shape of our sync events (maps to your backend schema)
export interface SyncEvent {
  clientEventId: string; // UUID generated locally
  entityType: 'SALE' | 'INVENTORY_EVENT' | 'EXPENSE' | 'TILL_SESSION';
  eventType: string;
  occurredAt: string; // ISO DateTime
  payload: any;
  syncStatus: 'PENDING' | 'SYNCED' | 'REJECTED';
}

export class BuzzNaDatabase extends Dexie {
  products_cache!: Table<any, string>;
  customers_cache!: Table<any, string>;
  business_snapshot!: Table<any, string>;
  sync_queue!: Table<SyncEvent, string>;
  sync_history!: Table<any, string>;
  current_till_session!: Table<any, string>;

  constructor() {
    super('BuzzNaD74_LocalDB');
    
    // Define the schema (only indexed fields need to be specified here)
    this.version(1).stores({
      products_cache: 'product_id, category_id, sku, barcode', // For zero-latency lookups 
      customers_cache: 'customer_id, phone_number',
      business_snapshot: 'tenant_id',
      sync_queue: 'clientEventId, entityType, syncStatus, occurredAt', // Chronological outbound pipeline 
      sync_history: 'clientEventId, syncStatus',
      current_till_session: 'till_session_id, status'
    });
  }
}

export const localDb = new BuzzNaDatabase();