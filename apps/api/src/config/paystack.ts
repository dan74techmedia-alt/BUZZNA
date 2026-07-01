import axios from 'axios';
import crypto from 'crypto';
import { env } from './env';

export const paystackClient = axios.create({
  baseURL: 'https://api.paystack.co',
  headers: {
    Authorization: `Bearer ${env.PAYSTACK_SECRET_LIVE_KEY}`,
    'Content-Type': 'application/json',
  },
});

/**
 * Validates incoming Paystack webhook requests to prevent forged payloads.
 */
export const verifyPaystackWebhookSignature = (
  signatureHeader: string,
  rawBody: string | Buffer
): boolean => {
  if (!signatureHeader) return false;

  const hash = crypto
    .createHmac('sha512', env.PAYSTACK_WEBHOOK_HMAC_SECRET)
    .update(rawBody)
    .digest('hex');

  return hash === signatureHeader;
};