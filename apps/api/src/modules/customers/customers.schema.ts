// apps/api/src/modules/customers/customers.schema.ts

import { z } from 'zod';

export const createCustomerSchema = z.object({
  phoneNumber: z.string().min(9, 'Phone number too short'),
  fullName: z.string().min(2, 'Name required'),
  email: z.string().email('Invalid email').optional(),
  creditLimit: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be valid currency').optional(),
});

export const recordRepaymentSchema = z.object({
  customerId: z.string().uuid('Invalid customer ID'),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be valid currency'),
  paymentMethod: z.enum(['CASH', 'MPESA', 'CHECK']),
  reference: z.string().optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type RecordRepaymentInput = z.infer<typeof recordRepaymentSchema>;