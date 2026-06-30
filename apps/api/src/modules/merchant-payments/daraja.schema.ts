import { z } from 'zod';

/**
 * Validates untrusted inbound webhooks from Safaricom Daraja API.
 * Ensures the payload matches the expected C2B/B2C structure before database insertion.
 */
export const darajaWebhookSchema = z.object({
  body: z.object({
    TransactionType: z.string().optional(),
    TransID: z.string({
      required_error: 'Safaricom Transaction ID (Receipt Number) is required'
    }),
    TransTime: z.string({
      required_error: 'Transaction timestamp is required'
    }),
    TransAmount: z.union([z.string(), z.number()], {
      required_error: 'Transaction amount is required'
    }),
    BusinessShortCode: z.string().optional(),
    BillRefNumber: z.string().optional(),
    InvoiceNumber: z.string().optional(),
    OrgAccountBalance: z.string().optional(),
    ThirdPartyTransID: z.string().optional(),
    MSISDN: z.string({
      required_error: 'Sender MSISDN (Phone Number) is required'
    }),
    FirstName: z.string().optional(),
    MiddleName: z.string().optional(),
    LastName: z.string().optional()
  })
});

/**
 * Validates request to manually match an orphaned M-Pesa payment to a pending POS sale.
 * Fulfills API Contract: POST /api/v1/merchant-payments/:id/match
 */
export const matchPaymentSchema = z.object({
  params: z.object({
    id: z.string({
      required_error: 'Payment ID parameter is required'
    }).uuid({ message: 'Payment ID must be a valid UUID' })
  }),
  body: z.object({
    transactionId: z.string({
      required_error: 'Target Sale Transaction ID is required'
    }).uuid({ message: 'Target Sale Transaction ID must be a valid UUID' })
  })
});

export type DarajaWebhookInput = z.infer<typeof darajaWebhookSchema>;
export type MatchPaymentInput = z.infer<typeof matchPaymentSchema>; 