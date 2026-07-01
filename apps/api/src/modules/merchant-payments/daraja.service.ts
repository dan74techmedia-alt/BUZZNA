// apps/api/src/modules/merchant-payments/daraja.service.ts

import { db, withTenant } from '../../config/database';
import { logger } from '../../common/logging/logger';
import { AppError } from '../../common/errors/AppError';
import axios from 'axios';
import crypto from 'crypto';

interface StkPushPayload {
  phoneNumber: string;
  amount: string;
  accountReference: string;
  transactionDesc: string;
}

export class DarajaService {
  /**
   * Initiate STK push for M-Pesa payment
   */
  static async initiateSTKPush(
    tenantId: string,
    payload: StkPushPayload
  ): Promise<{
    merchantRequestID: string;
    checkoutRequestID: string;
    customerMessage: string;
  }> {
    try {
      // Get Daraja connection credentials
      const connection = await db
        .selectFrom('merchant_payment_connections')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('provider', '=', 'daraja')
        .where('status', '=', 'active')
        .executeTakeFirst();

      if (!connection) {
        throw new AppError('No active Daraja connection', 400);
      }

      // Normalize phone
      const phone = payload.phoneNumber.replace(/\D/g, '');
      const normalizedPhone = phone.length === 9 ? `254${phone}` : phone;

      // Get access token
      const tokenResponse = await axios.get(
        'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
        {
          headers: {
            Authorization: `Basic ${Buffer.from(
              `${connection.consumer_key}:${connection.consumer_secret}`
            ).toString('base64')}`,
          },
          timeout: 5000,
        }
      );

      const accessToken = tokenResponse.data.access_token;

      // Generate timestamp and password
      const timestamp = new Date()
        .toISOString()
        .replace(/[:-]/g, '')
        .slice(0, -5);

      const password = Buffer.from(
        `${connection.merchant_code}${connection.passkey}${timestamp}`
      ).toString('base64');

      // Call Daraja API
      const response = await axios.post(
        'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
        {
          BusinessShortCode: connection.merchant_code,
          Password: password,
          Timestamp: timestamp,
          TransactionType: 'CustomerPayBillOnline',
          Amount: Math.round(parseFloat(payload.amount)),
          PartyA: normalizedPhone,
          PartyB: connection.merchant_code,
          PhoneNumber: normalizedPhone,
          CallBackURL: `${process.env.API_BASE_URL}/api/v1/merchant-payments/daraja/callback`,
          AccountReference: payload.accountReference,
          TransactionDesc: payload.transactionDesc,
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 5000,
        }
      );

      if (response.data.ResponseCode !== '0') {
        throw new Error(`STK push failed: ${response.data.ResponseDescription}`);
      }

      // Log event
      await withTenant(tenantId, async (trx) => {
        await trx
          .insertInto('merchant_payment_events')
          .values({
            tenant_id: tenantId,
            event_type: 'stk_push_initiated',
            phone_number: normalizedPhone,
            amount: payload.amount,
            reference: response.data.CheckoutRequestID,
            merchant_request_id: response.data.MerchantRequestID,
            status: 'pending',
            received_at: new Date(),
          })
          .execute();
      });

      logger.info('[DarajaService] STK push initiated', {
        tenantId,
        phone: normalizedPhone,
        amount: payload.amount,
      });

      return {
        merchantRequestID: response.data.MerchantRequestID,
        checkoutRequestID: response.data.CheckoutRequestID,
        customerMessage: response.data.CustomerMessage,
      };
    } catch (error) {
      logger.error('[DarajaService] Failed to initiate STK push', {
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error instanceof AppError ? error : new AppError('Failed to initiate payment', 500);
    }
  }

  /**
   * Process STK callback from Daraja
   */
  static async processSTKCallback(payload: any): Promise<void> {
    try {
      const checkoutRequestID =
        payload?.Body?.stkCallback?.CheckoutRequestID;
      const resultCode = payload?.Body?.stkCallback?.ResultCode;

      if (!checkoutRequestID) {
        throw new Error('Missing CheckoutRequestID');
      }

      // Get tenant from event
      const event = await db
        .selectFrom('merchant_payment_events')
        .selectAll()
        .where('reference', '=', checkoutRequestID)
        .executeTakeFirst();

      if (!event) {
        logger.warn('Event not found for callback', {
          checkoutRequestID,
        });
        return;
      }

      // Check for duplicate processing
      const existing = await db
        .selectFrom('merchant_payment_events')
        .selectAll()
        .where('reference', '=', checkoutRequestID)
        .where('event_type', '=', 'stk_callback')
        .executeTakeFirst();

      if (existing) {
        logger.info('Callback already processed', {
          checkoutRequestID,
        });
        return;
      }

      // Process based on result code
      await withTenant(event.tenant_id, async (trx) => {
        if (resultCode === '0') {
          // Payment successful
          const callbackMetadata = payload?.Body?.stkCallback?.CallbackMetadata?.Item;
          const amount =
            callbackMetadata?.find((item: any) => item.Name === 'Amount')?.Value || 0;
          const mpesaCode =
            callbackMetadata?.find((item: any) => item.Name === 'MpesaReceiptNumber')
              ?.Value || '';

          await trx
            .insertInto('merchant_payment_events')
            .values({
              tenant_id: event.tenant_id,
              event_type: 'payment_confirmed',
              reference: checkoutRequestID,
              merchant_request_id: payload?.Body?.stkCallback?.MerchantRequestID,
              status: 'success',
              amount: amount.toString(),
              mpesa_receipt: mpesaCode.toString(),
              received_at: new Date(),
            })
            .execute();

          logger.info('Payment confirmed', {
            tenantId: event.tenant_id,
            checkoutRequestID,
            amount,
          });
        } else {
          // Payment failed
          await trx
            .insertInto('merchant_payment_events')
            .values({
              tenant_id: event.tenant_id,
              event_type: 'payment_failed',
              reference: checkoutRequestID,
              status: 'failed',
              error_message: payload?.Body?.stkCallback?.ResultDesc || 'Payment failed',
              received_at: new Date(),
            })
            .execute();
        }
      });
    } catch (error) {
      logger.error('[DarajaService] Failed to process callback', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}