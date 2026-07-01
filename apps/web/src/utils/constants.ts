/**
 * Global Constants
 * Centralized configuration to prevent magic strings and ensure
 * consistency across the PWA and sync engine.
 */

export const APP_CONSTANTS = {
  // Financial Constraints
  MAX_DECIMAL_PRECISION: 3,
  CURRENCY_CODE: 'KES',
  
  // UI Defaults
  ITEMS_PER_PAGE: 25,
  DEBOUNCE_MS: 300,
  
  // Sync Engine
  SYNC_RETRY_LIMIT: 3,
  SYNC_INTERVAL_MS: 5000,
  
  // Validation Patterns
  PHONE_REGEX: /^(\+254|0)[17]\d{8}$/, // Kenyan MSISDN
  
  // Storage Keys
  AUTH_TOKEN_KEY: 'buzzna_auth_token',
  TENANT_ID_KEY: 'buzzna_tenant_id',
};