import axios from 'axios';
import { env } from './env';

const DARAJA_BASE_URL = env.NODE_ENV === 'production' 
  ? 'https://api.safaricom.co.ke' 
  : 'https://sandbox.safaricom.co.ke';

export const darajaClient = axios.create({
  baseURL: DARAJA_BASE_URL,
  timeout: env.DARAJA_GLOBAL_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const darajaConfig = {
  endpoints: {
    auth: '/oauth/v1/generate?grant_type=client_credentials',
    stkPush: '/mpesa/stkpush/v1/processrequest',
    stkQuery: '/mpesa/stkpushquery/v1/query',
    c2bRegister: '/mpesa/c2b/v1/registerurl',
  },
  smsWhitelist: env.MPESA_SENDER_SMS_WHITELIST.split(',').map(s => s.trim()),
};