import { z } from 'zod';
import dotenv from 'dotenv';

// Load raw environment variables before validation
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().transform((val) => parseInt(val, 10)).default('3000'),
  DATABASE_URL: z.string().url("Must be a valid Neon PostgreSQL connection string"),
  REDIS_URL: z.string().url("Must be a valid Redis connection string for BullMQ"),
  
  JWT_ACCESS_SECRET: z.string().min(32, "JWT Secret must be cryptographically secure (32+ chars)"),
  JWT_REFRESH_SECRET: z.string().min(32, "Refresh Secret must be cryptographically secure (32+ chars)"),
  
  PAYSTACK_SECRET_LIVE_KEY: z.string().startsWith('sk_live_', "Must be a valid Paystack live secret key"),
  PAYSTACK_WEBHOOK_HMAC_SECRET: z.string().min(10, "Webhook secret is required for verifying Paystack signatures"),
  
  DARAJA_GLOBAL_TIMEOUT_MS: z.string().transform((val) => parseInt(val, 10)).default('30000'),
  MPESA_SENDER_SMS_WHITELIST: z.string().default('MPESA'), // Comma separated if multiple
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error("❌ Invalid environment variables:");
  parsedEnv.error.issues.forEach((issue) => {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  });
  process.exit(1);
}

export const env = parsedEnv.data; 