// apps/api/src/modules/merchant-payments/daraja.service.ts

import { db } from '../../db/client';
import { logger } from '../../common/logging/logger';
import axios from 'axios';
import crypto from 'crypto';

/**
 * Daraja Service
 *
 * MANAGES CLIENT M-PESA PAYMENTS VIA SAFARICOM DARAJA API
 *
 * Completely separate from platform billing (Paystack).
 * Handles customer payment collection for retail sales.
 *
 * Workflow:
 * 1. Terminal initiates STK push to customer phone
 * 2. Customer enters M-Pesa PIN on their phone
 * 3. Safaricom confirms payment via webhook
 * 4. BuzzNa server marks payment as verified
 * 5. Till session completes sale
 *
 * Architecture Rules:
 * - M-Pesa credentials encrypted in merchant_payment_connections table
 * - Daraja keys never logged or exposed
 * - All transactions idempotent (CheckoutRequestID is unique)
 * - Payment amounts use NUMERIC(15,2) for precision
 */

export interface StkPushRequest {
  tenantId: string;
  phoneNumber: string;
  amount: string; // NUMERIC as string
  accountReference: string;
  transactionDesc: string;
  callbackUrl?: string;
}

export interface StkPushResponse {
  merchantRequestID: string;
  checkoutRequestID: string;
  responseCode: string;
  responseDescription: string;
  customerMessage: string;
}

/**
 * Get Daraja credentials for tenant
 */
async function getDarajaCredentials(tenantId: string): Promise<{
  consumerKey: string;
  consumerSecret: string;
  shortCode: string;
  passkey: string;
}> {
  try {
    const connection = await db
      .selectFrom('merchant_payment_connections' as any)
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('provider', '=', 'daraja')
      .where('status', '=', 'active')
      .executeTakeFirst();

    if (!connection) {
      throw new Error('No active Daraja connection found for tenant');
    }

    // Decrypt credentials (implementation depends on encryption library)
    // For now, assume they're stored encrypted
    return {
      consumerKey: connection.consumer_key,
      consumerSecret: connection.consumer_secret,
      shortCode: connection.merchant_code,
      passkey: connection.passkey,
    };
  } catch (error) {
    logger.error('Failed to get Daraja credentials', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get Daraja access token
 */
async function getDarajaAccessToken(
  consumerKey: string,
  consumerSecret: string
): Promise<string> {
  try {
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

    const response = await axios.get(
      'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
      {
        headers: {
          Authorization: `Basic ${auth}`,
        },
        timeout: parseInt(process.env.DARAJA_GLOBAL_TIMEOUT_MS || '5000'),
      }
    );

    if (!response.data.access_token) {
      throw new Error('Failed to get Daraja access token');
    }

    return response.data.access_token;
  } catch (error) {
    logger.error('Failed to get Daraja access token', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Initiate STK push (M-Pesa prompt on customer phone)
 */
export async function initiateSTKPush(
  request: StkPushRequest
): Promise<StkPushResponse> {
  try {
    const credentials = await getDarajaCredentials(request.tenantId);
    const accessToken = await getDarajaAccessToken(
      credentials.consumerKey,
      credentials.consumerSecret
    );

    // Normalize phone to international format
    const phone = request.phoneNumber.replace(/\D/g, '');
    const normalizedPhone = phone.length === 9 ? `254${phone}` : phone;

    // Generate timestamp
    const timestamp = new Date()
      .toISOString()
      .replace(/[:-]/g, '')
      .slice(0, -5);

    // Generate password (base64 of shortcode + passkey + timestamp)
    const password = Buffer.from(
      `${credentials.shortCode}${credentials.passkey}${timestamp}`
    ).toString('base64');

    const response = await axios.post(
      'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
      {
        BusinessShortCode: credentials.shortCode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.round(parseFloat(request.amount)),
        PartyA: normalizedPhone,
        PartyB: credentials.shortCode,
        PhoneNumber: normalizedPhone,
        CallBackURL: request.callbackUrl || `${process.env.API_BASE_URL}/webhooks/daraja`,
        AccountReference: request.accountReference,
        TransactionDesc: request.transactionDesc,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: parseInt(process.env.DARAJA_GLOBAL_TIMEOUT_MS || '5000'),
      }
    );

    if (response.data.ResponseCode !== '0') {
      throw new Error(
        `STK push failed: ${response.data.ResponseDescription}`
      );
    }

    // Log merchant payment event
    await db
      .insertInto('merchant_payment_events' as any)
      .values({
        tenant_id: request.tenantId,
        event_type: 'stk_push_initiated',
        phone_number: normalizedPhone,
        amount: request.amount,
        reference: response.data.CheckoutRequestID,
        merchant_request_id: response.data.MerchantRequestID,
        status: 'pending',
        received_at: new Date(),
      })
      .execute();

    logger.info('STK push initiated', {
      tenantId: request.tenantId,
      checkoutRequestID: response.data.CheckoutRequestID,
      amount: request.amount,
    });

    return {
      merchantRequestID: response.data.MerchantRequestID,
      checkoutRequestID: response.data.CheckoutRequestID,
      responseCode: response.data.ResponseCode,
      responseDescription: response.data.ResponseDescription,
      customerMessage: response.data.CustomerMessage,
    };
  } catch (error) {
    logger.error('Failed to initiate STK push', {
      tenantId: request.tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Process STK callback from Daraja
 */
export async function processSTKCallback(payload: any): Promise<void> {
  try {
    const checkoutRequestID =
      payload?.Body?.stkCallback?.CheckoutRequestID;
    const resultCode = payload?.Body?.stkCallback?.ResultCode;
    const merchantRequestID =
      payload?.Body?.stkCallback?.MerchantRequestID;

    if (!checkoutRequestID) {
      throw new Error('Missing CheckoutRequestID in callback');
    }

    // Check for existing processing
    const existing = await db
      .selectFrom('merchant_payment_events' as any)
      .selectAll()
      .where('reference', '=', checkoutRequestID)
      .where('event_type', '=', 'stk_callback')
      .executeTakeFirst();

    if (existing) {
      logger.info('STK callback already processed (idempotency)', {
        checkoutRequestID,
      });
      return;
    }

    const event: Record<string, any> = {
      tenant_id: payload?.tenant_id,
      event_type: 'stk_callback',
      reference: checkoutRequestID,
      merchant_request_id: merchantRequestID,
      received_at: new Date(),
    };

    if (resultCode === '0') {
      // Payment successful
      const callbackMetadata = payload?.Body?.stkCallback?.CallbackMetadata?.Item;
      const amount =
        callbackMetadata?.find((item: any) => item.Name === 'Amount')?.Value || 0;
      const mpesaCode =
        callbackMetadata?.find((item: any) => item.Name === 'MpesaReceiptNumber')
          ?.Value || '';
      const phoneNumber =
        callbackMetadata?.find((item: any) => item.Name === 'PhoneNumber')?.Value || '';

      event.event_type = 'payment_confirmed';
      event.status = 'success';
      event.amount = amount.toString();
      event.phone_number = phoneNumber.toString();
      event.mpesa_receipt = mpesaCode.toString();
    } else {
      // Payment failed or cancelled
      event.status = 'failed';
      event.error_message = payload?.Body?.stkCallback?.ResultDesc || 'Payment failed';
    }

    // Store callback event
    await db
      .insertInto('merchant_payment_events' as any)
      .values(event)
      .execute();

    logger.info('STK callback processed', {
      checkoutRequestID,
      status: event.status,
    });
  } catch (error) {
    logger.error('Failed to process STK callback', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Query payment status
 */
export async function queryPaymentStatus(
  tenantId: string,
  checkoutRequestID: string
): Promise<{
  status: 'pending' | 'success' | 'failed' | 'unknown';
  amount?: string;
  mpesaReceipt?: string;
}> {
  try {
    const event = await db
      .selectFrom('merchant_payment_events' as any)
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('reference', '=', checkoutRequestID)
      .orderBy('received_at', 'desc')
      .executeTakeFirst();

    if (!event) {
      return { status: 'unknown' };
    }

    return {
      status: event.status as 'pending' | 'success' | 'failed',
      amount: event.amount,
      mpesaReceipt: event.mpesa_receipt,
    };
  } catch (error) {
    logger.error('Failed to query payment status', {
      tenantId,
      checkoutRequestID,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export const darajaService = {
  initiateSTKPush,
  processSTKCallback,
  queryPaymentStatus,
};

export default darajaService;