// apps/api/src/bootstrap/load-env.ts

import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load environment variables from the root of the api application
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform((val) => parseInt(val, 10)).default('3000'),
  DATABASE_URL: z.string().url({ message: "DATABASE_URL must be a valid connection string pointing to Neon PostgreSQL." }),
  REDIS_URL: z.string().url({ message: "REDIS_URL must be a valid Redis connection string." }),
  JWT_ACCESS_SECRET: z.string().min(32, { message: "JWT_ACCESS_SECRET must be at least 32 characters long for high entropy." }),
  JWT_REFRESH_SECRET: z.string().min(32, { message: "JWT_REFRESH_SECRET must be at least 32 characters long for high entropy." }),
  PAYSTACK_SECRET_LIVE_KEY: z.string().startsWith('sk_', { message: "Invalid Paystack secret key format format." }),
  PAYSTACK_WEBHOOK_HMAC_SECRET: z.string().min(16),
  DARAJA_GLOBAL_TIMEOUT_MS: z.string().transform((val) => parseInt(val, 10)).default('15000'),
  MPESA_SENDER_SMS_WHITELIST: z.string().transform((val) => val.split(',').map(s => s.trim())),
});

export type EnvConfig = z.infer<typeof environmentSchema>;

function validateEnvironment(): EnvConfig {
  const result = environmentSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Environment Variable Validation Errors Detected:');
    console.error(JSON.stringify(result.error.format(), null, 2));
    process.exit(1);
  }

  return result.data;
}

export const env = validateEnvironment();