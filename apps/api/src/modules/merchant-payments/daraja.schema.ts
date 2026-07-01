// apps/api/src/modules/merchant-payments/daraja.schema.ts

import { z } from 'zod';

export const stkPushSchema = z.object({
  phoneNumber: z.string().min(9, 'Invalid phone number'),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be valid currency'),
  accountReference: z.string().min(3, 'Account reference required'),
  transactionDesc: z.string().min(3, 'Description required'),
});

export type StkPushInput = z.infer<typeof stkPushSchema>;