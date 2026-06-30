// ============================================================================
// BUZZNA D74 SHARED TYPES
// Single Source of Truth for API Monolith and PWA Frontend
// ============================================================================

export type LicenseStatus = 'TRIAL_ACTIVE' | 'PAYMENT_DUE' | 'GRACE_PERIOD' | 'SUSPENDED_NON_PAYMENT' | 'FULLY_ACTIVATED';
export type PaymentMethod = 'CASH' | 'MPESA' | 'DEBT';
export type PaymentStatus = 'PENDING' | 'COMPLETED_VERIFIED' | 'REFUNDED';
export type EventType = 'STOCK_ADD' | 'SALE_DISPATCH' | 'REFUND_RETURN' | 'MANUAL_ADJUSTMENT';

export interface BusinessTenant {
  tenantId: string; // UUID
  legalName: string;
  tradeName?: string;
  licenseStatus: LicenseStatus;
  licenseExpiresAt: string; // ISO-8601 Date String
}

export interface User {
  userId: string; // UUID
  tenantId: string; // UUID
  roleId: string; // UUID
  username: string;
  phoneNumber: string; // MSISDN E.164
}

export interface Product {
  productId: string; // UUID
  tenantId: string; // UUID
  barcode: string;
  costFloor: string; // Exact Numeric String (NUMERIC(12,2))
  retailPrice: string; // Exact Numeric String (NUMERIC(12,2))
  currentQuantity: string; // Cached Projection Only (NUMERIC(15,3))
}

export interface InventoryEvent {
  eventId: string; // UUID
  tenantId: string; // UUID
  productId: string; // UUID
  eventType: EventType;
  reasonCode?: string;
  quantityDelta: string; // Exact Numeric String (NUMERIC(15,3))
  terminalTimestamp: string; // ISO-8601 Date String
}

export interface SaleTransaction {
  transactionId: string; // UUID
  tenantId: string; // UUID
  sessionId: string; // UUID
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  grossTotal: string; // Exact Numeric String (NUMERIC(12,2))
  terminalTimestamp: string;
}

export interface TillSession {
  sessionId: string; // UUID
  tenantId: string; // UUID
  cashierUserId: string; // UUID
  openingFloat: string; // Exact Numeric String (NUMERIC(12,2))
  expectedCashBalance?: string;
  actualCashBalance?: string;
  status: 'OPEN' | 'REVIEW_REQUIRED' | 'CLOSED_VERIFIED';
}

export interface SyncEventPayload {
  syncId: string; // UUID for idempotency
  table: 'sales_transactions' | 'inventory_events' | 'till_sessions';
  operation: 'INSERT' | 'UPDATE';
  data: Record<string, any>;
  timestamp: string; // LWW Timestamp resolution
}

export interface SyncBatch {
  terminalId: string;
  tenantId: string;
  events: SyncEventPayload[];
}