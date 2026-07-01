// apps/api/src/modules/suppliers/suppliers.schema.ts

import { z } from 'zod';

export const createSupplierSchema = z.object({
  businessName: z.string().min(2, 'Business name required'),
  phoneNumber: z.string().min(9, 'Phone number required'),
  email: z.string().email('Invalid email').optional(),
  paymentTerms: z.string().optional(),
  creditLimit: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be valid currency').optional(),
});

export const recordPurchaseSchema = z.object({
  supplierId: z.string().uuid('Invalid supplier ID'),
  productId: z.string().uuid('Invalid product ID'),
  quantity: z.string().regex(/^\d+(\.\d{1,3})?$/, 'Must be valid quantity'),
  unitCost: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be valid currency'),
  invoiceNumber: z.string().optional(),
  dueDate: z.string().datetime().optional(),
});

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type RecordPurchaseInput = z.infer<typeof recordPurchaseSchema>;