// apps/api/src/config/daraja.ts

import axios, { AxiosInstance } from 'axios';
import { env } from './env';

/**
 * Safaricom Daraja M-Pesa API Client
 *
 * PURPOSE:
 * - Process M-Pesa payment requests from customers
 * - Query payment status
 * - Register webhook callbacks
 *
 * ENDPOINTS:
 * - OAuth: Generate access token
 * - STK Push: Initiate payment prompt on customer phone
 * - STK Query: Check payment status
 * - C2B Register: Register callback URL for payment notifications
 *
 * MODES:
 * - Development: sandbox.safaricom.co.ke (test credentials)
 * - Production: api.safaricom.co.ke (live credentials)
 *
 * ============================================================================
 */

const DARAJA_BASE_URL =
  env.NODE_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

/**
 * Axios instance for Daraja API calls
 */
export const darajaClient: AxiosInstance = axios.create({
  baseURL: DARAJA_BASE_URL,
  timeout: env.DARAJA_GLOBAL_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Daraja Configuration
 */
export const darajaConfig = {
  // API endpoints
  endpoints: {
    auth: '/oauth/v1/generate?grant_type=client_credentials',
    stkPush: '/mpesa/stkpush/v1/processrequest',
    stkQuery: '/mpesa/stkpushquery/v1/query',
    c2bRegister: '/mpesa/c2b/v1/registerurl',
    c2bSimulate: '/mpesa/c2b/v1/simulate',
    accountBalance: '/mpesa/accountbalance/v1/query',
  },

  // SMS whitelist for M-Pesa SMS parsing
  // Android app intercepts SMS from these senders
  smsWhitelist: env.MPESA_SENDER_SMS_WHITELIST,

  // Mode (test/live)
  mode: env.PAYSTACK_MODE,

  // Base URL
  baseUrl: DARAJA_BASE_URL,
};
