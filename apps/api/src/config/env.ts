// apps/api/src/config/env.ts

import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file (if exists)
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

/**
 * Environment Validation Schema
 * Ensures all required variables are present and correctly typed
 * CRITICAL for production deployment
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().transform((val) => parseInt(val, 10)).default('3000'),

  // Database
  DATABASE_URL: z
    .string()
    .url('DATABASE_URL must be a valid Neon PostgreSQL connection string'),

  // Redis (for caching and BullMQ)
  REDIS_URL: z
    .string()
    .url('REDIS_URL must be a valid Redis connection string'),

  // JWT Secrets (minimum 32 chars for cryptographic security)
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters (use: openssl rand -base64 32)'),

  JWT_REFRESH_SECRET: z
    .string()
    .min(32, 'JWT_REFRESH_SECRET must be at least 32 characters (use: openssl rand -base64 32)'),

  // Paystack Integration (payment processing)
  PAYSTACK_SECRET_KEY: z
    .string()
    .startsWith('sk_', 'PAYSTACK_SECRET_KEY must start with sk_'),

  PAYSTACK_WEBHOOK_HMAC_SECRET: z
    .string()
    .min(10, 'PAYSTACK_WEBHOOK_HMAC_SECRET must be at least 10 characters'),

  PAYSTACK_MODE: z
    .enum(['test', 'live'])
    .default('test'),

  // Safaricom Daraja M-Pesa Integration
  DARAJA_GLOBAL_TIMEOUT_MS: z
    .string()
    .transform((val) => parseInt(val, 10))
    .default('30000'),

  MPESA_SENDER_SMS_WHITELIST: z
    .string()
    .default('MPESA')
    .transform((val) => val.split(',').map((s) => s.trim())),

  // CORS Configuration
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173,http://localhost:3000')
    .transform((val) => val.split(',').map((s) => s.trim())),

  // Logging
  LOG_LEVEL: z
    .enum(['debug', 'info', 'warn', 'error'])
    .default('info'),
});

/**
 * Parse and validate environment variables
 */
const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error('❌ Environment Variable Validation Errors:');
  console.error('━'.repeat(80));
  result.error.issues.forEach((issue) => {
    const path = issue.path.join('.');
    const message = issue.message;
    console.error(`  ${path}: ${message}`);
  });
  console.error('━'.repeat(80));
  console.error('\nCreate a .env file in the root directory. Copy from .env.example');
  console.error('Example: cp .env.example .env && nano .env');
  process.exit(1);
}

export const env = result.data;

/**
 * Runtime assertions for critical configuration
 */
if (env.NODE_ENV === 'production') {
  if (!env.PAYSTACK_SECRET_KEY.startsWith('sk_live_')) {
    throw new Error('FATAL: Production deployment requires PAYSTACK_SECRET_KEY starting with sk_live_');
  }
}
