// apps/api/src/modules/sales/sales.schema.ts
import { z } from 'zod';

const saleItemInputSchema = z.object({
  product_id: z.string().uuid('Invalid product ID formatting'),
  quantity: z.number().positive('Quantity must be strictly positive'),
  unit_price: z.number().nonnegative('Unit price cannot be negative'),
  discount_amount: z.number().min(0).default(0),
});

const paymentAllocationInputSchema = z.object({
  payment_method: z.enum(['CASH', 'MPESA', 'DEBT', 'BANK_TRANSFER']),
  amount: z.number().positive('Allocation amount must be greater than zero'),
});

export const createSaleSchema = z.object({
  body: z.object({
    client_sale_id: z.string().uuid('Client Event/Sale ID must be a unique UUID format').optional(),
    customer_id: z.string().uuid('Invalid Customer ID formatting').optional(),
    till_session_id: z.string().uuid('Invalid Till Session ID formatting').optional(),
    items: z.array(saleItemInputSchema).min(1, 'Sales records require at least 1 line item configuration'),
    payments: z.array(paymentAllocationInputSchema).min(1, 'Allocation mapping details are required'),
    discount_amount: z.number().min(0).default(0),
  }),
});

export const walkawaySyncBatchSchema = z.object({
  body: z.object({
    device_id: z.string().min(3, 'Device hardware fingerprint tracking string required'),
    events: z.array(z.object({
      client_event_id: z.string().uuid(),
      entity_type: z.literal('SALE'),
      event_type: z.enum(['SALE_CREATE', 'SALE_REFUND']),
      payload: z.any(),
      occurred_at: z.string().datetime(),
    })).min(1, 'Sync payload requires an array of operational entries'),
  }),
});

export const refundSaleSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid transaction target identifier'),
  }),
  body: z.object({
    reason: z.string().min(5, 'A rigorous operational verification reason is mandatory').max(255),
    items_to_refund: z.array(z.object({
      product_id: z.string().uuid(),
      quantity: z.number().positive(),
    })).min(1, 'Identify lines slate for reversal processing'),
  }),
});

export type CreateSaleDTO = z.infer<typeof createSaleSchema>['body'];
export type WalkawaySyncBatchDTO = z.infer<typeof walkawaySyncBatchSchema>['body'];
export type RefundSaleDTO = z.infer<typeof refundSaleSchema>['body'];