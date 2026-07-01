import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg'; // Neon PostgreSQL Connection Pooler

// Domain Module Router Imports
import { authRouter } from './modules/auth/auth.controller';
import { catalogRouter } from './modules/catalog/catalog.controller';
import { inventoryRouter } from './modules/inventory/inventory.controller';
import { tillRouter } from './modules/till/till.controller';
import { salesRouter } from './modules/sales/sales.controller';
import { syncRouter } from './modules/sync/sync.controller';
import { analyticsRouter } from './modules/analytics/analytics.controller';
// import { enforceLicenseLockdown } from './common/middleware/license-lockdown.middleware'; 

// ============================================================================
// 1. PHASE 0: ENVIRONMENT CONFIGURATION VALIDATION
// ============================================================================
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform((val) => parseInt(val, 10)).default('3000'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  PAYSTACK_SECRET_LIVE_KEY: z.string(),
  PAYSTACK_WEBHOOK_HMAC_SECRET: z.string(),
  DARAJA_GLOBAL_TIMEOUT_MS: z.string().transform((val) => parseInt(val, 10)).default('10000'),
  MPESA_SENDER_SMS_WHITELIST: z.string().default('MPESA'),
});

const env = envSchema.parse(process.env);
const dbPool = new Pool({ connectionString: env.DATABASE_URL });

// ============================================================================
// 2. EXTEND EXPRESS TYPES FOR CONTEXT SAFEGUARDING
// ============================================================================
declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
      userProfile?: {
        userId: string;
        roleId: string;
        username: string;
      };
    }
  }
}

const app = express();
app.use(express.json());

// ============================================================================
// 3. PUBLIC DOMAIN (No Authentication Required)
// ============================================================================
// Debugger Health-check Probe
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ONLINE', engine: 'BuzzNa D74 modular monolith compiler' });
});

// Auth endpoints must be exposed before Layer 1 Security intercepts the request [cite: 80]
app.use('/api/v1/auth', authRouter);

// ============================================================================
// 4. LAYER 1 SECURITY: MIDDLEWARE CONTEXT ENFORCEMENT
// ============================================================================
const enforceTenantContext = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access token missing or malformed.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as {
      tenant_id: string;
      user_id: string;
      role_id: string;
      username: string;
    };

    // Zero Client-Side Trust: Ignore header parameters, bind context securely [cite: 46]
    req.tenantId = decoded.tenant_id;
    req.userProfile = {
      userId: decoded.user_id,
      roleId: decoded.role_id,
      username: decoded.username,
    };

    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired context token signature.' });
  }
};

// Apply Layer 1 Security globally to all subsequent routes
app.use(enforceTenantContext);

// ============================================================================
// 5. LAYER 2 SECURITY: PGBOUNCER POOL LEAKAGE SAFEGUARD
// ============================================================================
async function withTenantTransaction<T>(
  tenantId: string,
  callback: (client: any) => Promise<T>
): Promise<T> {
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN;');
    await client.query(`SET LOCAL app.current_tenant_id = $1;`, [tenantId]);
    
    const result = await callback(client);
    
    await client.query('COMMIT;');
    return result;
  } catch (error) {
    await client.query('ROLLBACK;');
    throw error;
  } finally {
    client.release(); 
  }
}

// Export the db helper so domain services can utilize the secure transaction wrapper
export { dbPool, withTenantTransaction };

// ============================================================================
// 6. READ-ONLY & ACCOUNT MANAGEMENT DOMAIN (Exempt from Lockout)
// ============================================================================
app.use('/api/v1/analytics', analyticsRouter);

// ============================================================================
// 7. LICENSE ENFORCEMENT MIDDLEWARE
// ============================================================================
// Uncomment this once the license-lockdown.middleware.ts is fully implemented
// Evaluates business_snapshot to block execution for suspended accounts [cite: 96, 219]
// app.use(enforceLicenseLockdown);

// ============================================================================
// 8. CORE OPERATIONAL DOMAIN (Requires Active / Grace Period License)
// ============================================================================
app.use('/api/v1/products', catalogRouter);
app.use('/api/v1/inventory', inventoryRouter);
app.use('/api/v1/tills', tillRouter);
app.use('/api/v1/sales', salesRouter);
app.use('/api/v1/sync', syncRouter);

// ============================================================================
// 9. INITIALIZATION PROBE
// ============================================================================
const server = app.listen(env.PORT, () => {
  console.log(`================================================================`);
  console.log(` 🚀 BUZZNA D74 ENTERPRISE MULTI-TENANT OS ACTIVE              `);
  console.log(` 🚀 Listening on Port: ${env.PORT} in [${env.NODE_ENV}] environment `);
  console.log(`================================================================`);
});

export { app, server };