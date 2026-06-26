import { z } from 'zod';

export const openTillSchema = z.object({
  openingFloat: z.number().min(0, "Opening float cannot be negative"),
});