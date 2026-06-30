import { z } from 'zod';

// ============================================================================
// BUZZNA D74 SHARED VALIDATION SCHEMAS
// Enforces API Contracts and Offline Data Integrity
// ============================================================================

// Reusable Exact String Numeric Validators
const currencyAmountSchema = z.string().regex(/^-?\d+(\.\d{1,2})?$/, {
  message: 'Currency amounts must be valid strings with up to 2 decimal places.',
});

const inventoryQuantitySchema = z.string().regex(/^-?\d+(\.\d{1,3})?$/, {
  message: 'Inventory quantities must be valid strings with up to 3 decimal places.',
});

// 1. Catalog & Product Validations
export const createProductSchema = z.object({
  barcode: z.string().min(3).max(50),
  costFloor: currencyAmountSchema,
  retailPrice: currencyAmountSchema,
}).refine(
  (data) => parseFloat(data.retailPrice) >= parseFloat(data.costFloor),
  { message: "Retail price cannot fall below the designated cost floor.", path: ["retailPrice"] }
);

// 2. Event-Sourced Inventory Validations
export const inventoryEventSchema = z.object({
  productId: z.string().uuid(),
  eventType: z.enum(['STOCK_ADD', 'SALE_DISPATCH', 'REFUND_RETURN', 'MANUAL_ADJUSTMENT']),
  reasonCode: z.string().max(100).optional(),
  quantityDelta: inventoryQuantitySchema,
  terminalTimestamp: z.string().datetime(),
});

// 3. Sales & Till Validations
export const tillHandoverSchema = z.object({
  sessionId: z.string().uuid(),
  actualCashEntered: currencyAmountSchema, // Blind balance entry
});

export const saleItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: inventoryQuantitySchema,
  unitPrice: currencyAmountSchema,
  subTotal: currencyAmountSchema,
});

export const createSaleSchema = z.object({
  sessionId: z.string().uuid(),
  paymentMethod: z.enum(['CASH', 'MPESA', 'DEBT']),
  grossTotal: currencyAmountSchema,
  items: z.array(saleItemSchema).min(1, 'A checkout manifest must contain at least one item.'),
  terminalTimestamp: z.string().datetime(),
});

// 4. Synchronization Validations
export const syncEventSchema = z.object({
  syncId: z.string().uuid(),
  table: z.enum(['sales_transactions', 'inventory_events', 'till_sessions']),
  operation: z.enum(['INSERT', 'UPDATE']),
  data: z.record(z.any()), // Specific payload validation handled downstream by module services
  timestamp: z.string().datetime(),
});

export const syncBatchSchema = z.object({
  terminalId: z.string().uuid(),
  events: z.array(syncEventSchema),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type InventoryEventInput = z.infer<typeof inventoryEventSchema>;
export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type SyncBatchInput = z.infer<typeof syncBatchSchema>;