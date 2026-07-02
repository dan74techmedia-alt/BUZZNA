// apps/api/src/config/paystack.ts

import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import { env } from './env';

/**
 * Paystack API Client
 *
 * PURPOSE:
 * - Handle BuzzNa platform subscription billing
 * - Process payment collection from business owners
 * - Manage invoices and license enforcement
 *
 * CRITICAL SEPARATION:
 * - Paystack handles PLATFORM fees (BuzzNa D74 subscription)
 * - Daraja M-Pesa handles CLIENT merchant revenue (retail sales)
 * - These must NEVER be mixed (architectural rule #2 from docs)
 *
 * ============================================================================
 */

/**
 * Axios instance for Paystack API calls
 * Uses live/test key from environment
 */
export const paystackClient: AxiosInstance = axios.create({
  baseURL: 'https://api.paystack.co',
  headers: {
    Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
});

/**
 * Verify webhook signature from Paystack
 *
 * CRITICAL: Prevents forged payment notifications
 * Paystack signs all webhooks using HMAC-SHA512
 *
 * @param signatureHeader - x-paystack-signature header from webhook
 * @param rawBody - Raw request body (must be exact bytes)
 * @returns true if signature is valid, false otherwise
 */
export function verifyPaystackWebhookSignature(
  signatureHeader: string | undefined,
  rawBody: string | Buffer
): boolean {
  if (!signatureHeader) {
    return false;
  }

  try {
    const hash = crypto
      .createHmac('sha512', env.PAYSTACK_WEBHOOK_HMAC_SECRET)
      .update(rawBody)
      .digest('hex');

    return hash === signatureHeader;
  } catch (error) {
    return false;
  }
}

/**
 * Paystack API endpoints
 */
export const paystackEndpoints = {
  initializeTransaction: '/transaction/initialize',
  verifyTransaction: '/transaction/verify/:reference',
  createInvoice: '/invoice',
  getInvoice: '/invoice/:id',
  createRecipient: '/transferrecipient',
  initiateTransfer: '/transfer',
};
