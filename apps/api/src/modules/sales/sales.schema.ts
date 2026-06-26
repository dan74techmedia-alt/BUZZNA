import { z } from 'zod';

export const createSaleSchema = z.object({
  saleDate: z.string().datetime().optional(),
  customerId: z.string().uuid().optional(),
  tillSessionId: z.string().uuid(), // Required to link the sale to the active float
  notes: z.string().max(1000).optional(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().positive(),
    unitPrice: z.number().nonnegative(),
    lineDiscount: z.number().min(0).default(0),
  })).min(1),
  paymentAllocations: z.array(z.object({
    paymentMethod: z.enum(['CASH','MPESA','BANK','DEBT']),
    amount: z.number().nonnegative(),
    merchantPaymentId: z.string().uuid().optional(),
  })).min(1)
});