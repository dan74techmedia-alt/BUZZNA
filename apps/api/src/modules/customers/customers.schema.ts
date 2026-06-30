// apps/api/src/modules/customers/customers.schema.ts
import { z } from 'zod';

export const createCustomerSchema = z.object({
  body: z.object({
    full_name: z.string().min(2, 'Name is required').max(255),
    phone_number: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid MSISDN format').optional(),
  }),
});

export const updateCustomerSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid Customer ID format'),
  }),
  body: z.object({
    full_name: z.string().min(2).max(255).optional(),
    phone_number: z.string().regex(/^\+?[1-9]\d{1,14}$/).optional(),
    is_active: z.boolean().optional(),
  }),
});

export const recordRepaymentSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid Customer ID format'),
  }),
  body: z.object({
    amount: z.number().positive('Repayment amount must be strictly positive'),
    payment_method: z.enum(['CASH', 'MPESA', 'BANK_TRANSFER']),
  }),
});

export type CreateCustomerDTO = z.infer<typeof createCustomerSchema>['body'];
export type UpdateCustomerDTO = z.infer<typeof updateCustomerSchema>['body'];
export type RecordRepaymentDTO = z.infer<typeof recordRepaymentSchema>['body'];