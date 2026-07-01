// apps/api/src/modules/till/till.schema.ts

import { z } from 'zod';

export const openTillSchema = z.object({
  openingFloat: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be valid currency'),
});

export const closeTillSchema = z.object({
  actualCashBalance: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be valid currency'),
});

export type OpenTillInput = z.infer<typeof openTillSchema>;
export type CloseTillInput = z.infer<typeof closeTillSchema>;