import { z } from 'zod';

/**
 * Validates request parameters for initializing a platform SaaS payment.
 */
export const initiateBillingSchema = z.object({
  body: z.object({
    planId: z.string({
      required_error: 'Subscription plan ID is required'
    }).uuid({ message: 'Plan ID must be a valid RFC4122 UUID' }),
    
    userEmail: z.string({
      required_error: 'User account email is required'
    }).email({ message: 'A valid enterprise administrator email address is required' })
  })
});

/**
 * Validates untrusted inbound webhooks originating from Paystack API edges.
 * Guarantees schema correctness before processing structural tier mutations.
 */
export const paystackWebhookSchema = z.object({
  body: z.object({
    event: z.string({
      required_error: 'Webhook event action indicator is required'
    }),
    data: z.object({
      reference: z.string({
        required_error: 'Paystack provider transaction reference tracking code is required'
      }),
      amount: z.number({
        required_error: 'Transaction denomination value is required'
      }).positive({ message: 'Transaction amount must be greater than zero' }),
      status: z.string({
        required_error: 'Payment transaction lifecycle state string is required'
      }),
      customer: z.object({
        email: z.string().email({ message: 'Customer record must contain valid email schema' })
      }),
      metadata: z.object({
        tenant_id: z.string().uuid({ message: 'Metadata tenant linkage must be a valid UUID string' }),
        plan_id: z.string().uuid({ message: 'Metadata subscription target tier must be a valid UUID string' })
      })
    })
  })
});

export type InitiateBillingInput = z.infer<typeof initiateBillingSchema>;
export type PaystackWebhookInput = z.infer<typeof paystackWebhookSchema>; 