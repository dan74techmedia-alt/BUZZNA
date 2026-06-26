import { z } from 'zod';

export const restockSchema = z.object({
  productId: z.string().uuid(),
  quantityDelta: z.number().positive("Restock must be a positive number"),
  unitBuyingPrice: z.number().min(0).optional(),
  unitSellingPrice: z.number().min(0).optional(),
  reasonCode: z.string().optional(),
});