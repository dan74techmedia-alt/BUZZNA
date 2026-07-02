// apps/api/src/common/tenant-context.ts

import { AsyncLocalStorage } from 'async_hooks';

/**
 * Tenant context object stored in AsyncLocalStorage
 * Ensures proper tenant isolation across async boundaries
 */
export interface TenantContextData {
  tenantId: string;
  userId: string;
  roleId: string;
}

/**
 * Global AsyncLocalStorage instance for tenant context
 * CRITICAL: This is the SINGLE SOURCE OF TRUTH for tenant isolation
 * All database queries must read from this context via tenantContextStorage.getStore()
 */
export const tenantContextStorage = new AsyncLocalStorage<TenantContextData>();

/**
 * Helper to run code within a tenant context
 * Used by middleware to wrap request handlers
 */
export function runWithTenantContext<T>(
  context: TenantContextData,
  callback: () => Promise<T>
): Promise<T> {
  return tenantContextStorage.run(context, callback);
}

/**
 * Helper to get current tenant context
 * Throws error if context is not available (safeguard)
 */
export function getCurrentTenantContext(): TenantContextData {
  const context = tenantContextStorage.getStore();
  if (!context) {
    throw new Error(
      'CRITICAL: Tenant context not available. ' +
      'Ensure auth.middleware.ts has been applied before this route.'
    );
  }
  return context;
}
