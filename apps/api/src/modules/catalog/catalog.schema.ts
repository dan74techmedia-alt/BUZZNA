import { z } from 'zod';

export const createProductSchema = z.object({
  name: z.string().min(2),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  unitOfMeasure: z.string().default('Pcs'),
  costFloor: z.number().min(0),
  defaultSellingPrice: z.number().min(0),
  categoryId: z.string().uuid().optional(),
});