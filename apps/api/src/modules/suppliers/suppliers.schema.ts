// apps/api/src/modules/suppliers/suppliers.schema.ts
import { z } from 'zod';

export const createSupplierSchema = z.object({
  body: z.object({
    company_name: z.string().min(2, 'Company name is required').max(255),
    contact_name: z.string().max(255).optional(),
    phone_number: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid MSISDN format').optional(),
  }),
});

export type CreateSupplierDTO = z.infer<typeof createSupplierSchema>['body'];