import { z } from 'zod';

/**
 * Validates outbound SMS requests passing through the notification subsystem.
 * Strictly enforces E.164 MSISDN formatting standard for sub-Saharan channels.
 */
export const sendSmsSchema = z.object({
  phoneNumber: z
    .string()
    .regex(/^\+?[1-9]\d{1,14}$/, {
      message: 'Invalid phone number format. Must comply with strict E.164/MSISDN standard alignment.',
    }),
  message: z
    .string()
    .min(1, 'SMS communication text payload cannot be empty.')
    .max(480, 'SMS transmission window capped at a maximum of 3 combined GSM text segments (480 characters).'),
});

/**
 * Validates system email generation attributes for B2B billing alerts.
 */
export const sendEmailSchema = z.object({
  to: z.string().email('Invalid target recipient email address format alignment.'),
  subject: z.string().min(1, 'Email subject heading cannot evaluate to empty.').max(200),
  body: z.string().min(1, 'Email structured HTML/prose body payload is required.'),
});

/**
 * Validates structural persistence parameters for generating real-time system Attention Cards.
 */
export const createAttentionCardSchema = z.object({
  cardType: z.enum(['INVENTORY_ANOMALY', 'TILL_DISCREPANCY', 'BILLING_GRACE_WARNING', 'SECURITY_BREACH_ALERT']),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  title: z.string().min(1, 'Attention card heading text cannot be empty.').max(100),
  message: z.string().min(1, 'Attention card granular description is required.'),
  metadata: z.record(z.any()).optional().default({}),
});

export type SendSmsInput = z.infer<typeof sendSmsSchema>;
export type SendEmailInput = z.infer<typeof sendEmailSchema>;
export type CreateAttentionCardInput = z.infer<typeof createAttentionCardSchema>;