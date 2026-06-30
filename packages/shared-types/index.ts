// File: packages/shared-types/index.ts
// Purpose: Single source of truth for exact DB schema enums and interfaces across API and PWA.

export enum LicenseStatusEnum {
    TRIAL_ACTIVE = 'TRIAL_ACTIVE',
    PAYMENT_DUE = 'PAYMENT_DUE',
    GRACE_PERIOD = 'GRACE_PERIOD',
    SUSPENDED_NON_PAYMENT = 'SUSPENDED_NON_PAYMENT',
    FULLY_ACTIVATED = 'FULLY_ACTIVATED'
}

export enum SaleStatusEnum {
    DRAFT = 'DRAFT',
    PENDING = 'PENDING',
    COMPLETED_VERIFIED = 'COMPLETED_VERIFIED',
    REFUNDED = 'REFUNDED',
    VOIDED = 'VOIDED'
}

export enum TillStatusEnum {
    OPEN = 'OPEN',
    REVIEW_REQUIRED = 'REVIEW_REQUIRED',
    CLOSED = 'CLOSED'
}

export enum SyncStatusEnum {
    SYNC_PENDING = 'SYNC_PENDING',
    SYNC_SUCCESS = 'SYNC_SUCCESS',
    SYNC_PARTIAL = 'SYNC_PARTIAL',
    SYNC_FAILED = 'SYNC_FAILED'
}

export enum RoleMatrixEnum {
    OWNER = 'Owner',
    MANAGER = 'Manager',
    CASHIER = 'Cashier',
    ACCOUNTANT = 'Accountant'
}

export interface ITenantContext {
    tenantId: string;
    userId: string;
    role: RoleMatrixEnum;
    licenseStatus: LicenseStatusEnum;
}

// Decimal Integrity Validation (Mapped to NUMERIC 15,2 and 15,3 in Postgres)
export type ExactDecimalAmount = string; // Stored and transmitted as string to prevent JS floating point loss
export type ExactQuantity = string;