// apps/api/src/modules/inventory/inventory.schema.ts

import { z } from 'zod';

export const adjustStockSchema = z.object({
  productId: z.string().uuid('Invalid product ID'),
  quantityDelta: z.string().regex(/^\d+(\.\d{1,3})?$/, 'Must be a valid decimal quantity'),
  eventType: z.enum(['STOCK_ADD', 'SALE_DISPATCH', 'DAMAGE', 'SPOILAGE', 'THEFT_LOSS', 'RESTOCK_RESTORE', 'COUNT_ADJUSTMENT']),
  reasonCode: z.string().optional(),
  description: z.string().max(500).optional(),
});

export type AdjustStockInput = z.infer<typeof adjustStockSchema>;