// apps/api/src/modules/till/till.schema.ts
import { z } from 'zod';

export const openTillSchema = z.object({
  body: z.object({
    opening_float: z.number().min(0, 'Opening float cannot be negative'),
  }),
});

export const closeTillSchema = z.object({
  body: z.object({
    actual_cash_balance: z.number().min(0, 'Actual compiled cash balance count must be zero or positive'),
  }),
});

export type OpenTillDTO = z.infer<typeof openTillSchema>['body'];
export type CloseTillDTO = z.infer<typeof closeTillSchema>['body'];