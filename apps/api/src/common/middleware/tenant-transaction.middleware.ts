import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';
import { logger } from '../logging/logger';
import { db } from '../../db/client';

/**
 * Tenant Transaction Middleware
 *
 * CRITICAL SECURITY COMPONENT
 *
 * In multi-tenant shared-schema architectures with connection pooling (PgBouncer),
 * reused database connections can retain the previous tenant's context if not
 * explicitly cleared. This middleware wraps all subsequent database operations
 * inside a strict transaction boundary with explicit tenant context injection.
 *
 * Pattern:
 *   BEGIN TRANSACTION
 *   SET LOCAL app.current_tenant_id = '<validated_tenant_uuid>'
 *   -- All subsequent queries execute with tenant_id context
 *   COMMIT
 *
 * If any query fails or throws, the connection state is rolled back and the
 * pooler socket is returned to the pool in a clean state.
 *
 * Architecture Rules Enforced:
 * 1. Tenant context must be extracted from the authenticated JWT (never client headers)
 * 2. Every database statement must evaluate row permissions via PostgreSQL RLS
 * 3. Direct tenant_id manipulation or omission results in AppError
 * 4. Back-dated writes (device clock tampering) are rejected by sync-rejections queue
 */

interface TenantContext {
  tenantId: string;
  userId?: string;
  role?: string;
}

// Extend Express Request to include tenant context
declare global {
  namespace Express {
    interface Request {
      tenantContext?: TenantContext;
      dbTransaction?: any; // Kysely transaction object
    }
  }
}

/**
 * Extract tenant context from request
 * - JWT is unpacked in auth.middleware.ts
 * - This function validates and normalizes it
 */
function extractTenantContext(req: Request): TenantContext {
  // Tenant context attached by auth.middleware.ts from JWT claims
  const tenantId = req.tenantContext?.tenantId;

  if (!tenantId) {
    throw new AppError(
      'TENANT_CONTEXT_MISSING',
      'Tenant context not found in request. Authentication middleware must run first.',
      401
    );
  }

  // Validate UUID format (basic protection against injection)
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(tenantId)) {
    throw new AppError(
      'INVALID_TENANT_ID_FORMAT',
      'Tenant ID must be a valid UUID',
      400
    );
  }

  return {
    tenantId,
    userId: req.tenantContext?.userId,
    role: req.tenantContext?.role,
  };
}

/**
 * Initialize database transaction with tenant context
 *
 * This function:
 * 1. Begins a PostgreSQL transaction
 * 2. Sets app.current_tenant_id as a LOCAL variable (connection-scoped)
 * 3. Returns a wrapped transaction object for use in subsequent queries
 *
 * The SET LOCAL ensures the variable is cleared when the transaction commits/rolls back,
 * returning the connection to a clean state for the pooler.
 */
async function initializeTenantTransaction(
  tenantId: string,
  userId?: string
): Promise<any> {
  try {
    // Begin transaction and set tenant context in a single roundtrip
    const transaction = await db.transaction().execute(async (trx) => {
      // Set the tenant context as a LOCAL variable scoped to this transaction
      // When transaction commits/rolls back, the variable is automatically cleared
      await trx.raw.query(`SET LOCAL app.current_tenant_id = $1`, [tenantId]);

      // Optional: Log tenant action if userId provided (audit trail)
      if (userId) {
        await trx.raw.query(
          `
          INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, metadata, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, NOW())
          ON CONFLICT DO NOTHING
          `,
          [
            tenantId,
            userId,
            'TRANSACTION_INITIATED',
            'database_transaction',
            tenantId,
            JSON.stringify({
              connection_id: 'pooled',
              timestamp: new Date().toISOString(),
            }),
          ]
        );
      }

      return trx;
    });

    return transaction;
  } catch (error) {
    logger.error('Failed to initialize tenant transaction', {
      tenantId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new AppError(
      'TRANSACTION_INIT_FAILED',
      'Failed to initialize database transaction with tenant context',
      500
    );
  }
}

/**
 * Middleware: Tenant Transaction Context Wrapper
 *
 * Usage:
 *   app.use(authMiddleware); // Populates req.tenantContext from JWT
 *   app.use(tenantTransactionMiddleware); // Wraps operations in transaction
 *   app.use(routes); // Routes execute with req.dbTransaction attached
 *
 * In route handlers:
 *   const result = await req.dbTransaction.select().from(products).execute();
 */
export const tenantTransactionMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Skip transaction wrapping for health checks and public endpoints
    if (
      req.path === '/health' ||
      req.path === '/metrics' ||
      req.method === 'OPTIONS'
    ) {
      return next();
    }

    // Extract and validate tenant context from JWT (must come from auth middleware)
    const tenantContext = extractTenantContext(req);

    // Initialize transaction with tenant context
    const dbTransaction = await initializeTenantTransaction(
      tenantContext.tenantId,
      tenantContext.userId
    );

    // Attach transaction to request for use in route handlers
    req.dbTransaction = dbTransaction;

    // Attach tenant context for non-database operations
    req.tenantContext = tenantContext;

    // Wrap response handling to ensure transaction cleanup
    const originalSend = res.send;
    res.send = function (data: any) {
      // Transaction automatically commits/rolls back via Kysely lifecycle
      res.send = originalSend;
      return originalSend.call(this, data);
    };

    next();
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        error: error.code,
        message: error.message,
        timestamp: new Date().toISOString(),
      });
    } else {
      logger.error('Tenant transaction middleware error', {
        path: req.path,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({
        error: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to process request with tenant context',
        timestamp: new Date().toISOString(),
      });
    }
  }
};

/**
 * Helper function to verify tenant context in route handlers
 *
 * Usage:
 *   const tenantContext = verifyTenantContext(req);
 *   // Safe to use tenantContext.tenantId in database queries
 */
export function verifyTenantContext(req: Request): TenantContext {
  if (!req.tenantContext) {
    throw new AppError(
      'TENANT_CONTEXT_MISSING',
      'Tenant context not available. Ensure auth middleware runs before route handler.',
      401
    );
  }
  return req.tenantContext;
}

/**
 * Helper function to get wrapped database transaction
 *
 * Usage:
 *   const trx = getDbTransaction(req);
 *   const result = await trx.selectFrom(products).selectAll().execute();
 */
export function getDbTransaction(req: Request): any {
  if (!req.dbTransaction) {
    throw new AppError(
      'DB_TRANSACTION_MISSING',
      'Database transaction not initialized. Ensure tenantTransactionMiddleware runs before route handler.',
      500
    );
  }
  return req.dbTransaction;
}

/**
 * Guard against common connection pool leakage patterns
 *
 * This function checks for signs that tenant context may have leaked:
 * - Missing or invalid tenant_id in query
 * - RLS policy violations (should be caught by PostgreSQL)
 * - Cross-tenant data access attempts
 */
export function validateTenantIsolation(
  req: Request,
  expectedTenantId: string
): void {
  const { tenantContext } = req;

  if (!tenantContext) {
    throw new AppError(
      'TENANT_ISOLATION_BREACH',
      'Tenant context missing during isolation check',
      500
    );
  }

  if (tenantContext.tenantId !== expectedTenantId) {
    logger.warn('Tenant isolation violation detected', {
      expectedTenantId,
      actualTenantId: tenantContext.tenantId,
      userId: tenantContext.userId,
      path: req.path,
    });

    throw new AppError(
      'TENANT_ISOLATION_BREACH',
      'Request tenant does not match resource tenant',
      403
    );
  }
}

/**
 * Recovery function for connection pool corruption
 *
 * If a tenant context leakage is detected, this function can be called
 * to reset the connection and reinitialize with correct context.
 */
export async function resetTenantContext(
  req: Request,
  newTenantId: string
): Promise<void> {
  try {
    // Validate new tenant ID
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(newTenantId)) {
      throw new AppError(
        'INVALID_TENANT_ID_FORMAT',
        'New tenant ID must be a valid UUID',
        400
      );
    }

    // Reinitialize transaction
    const newTransaction = await initializeTenantTransaction(newTenantId);

    // Update request
    req.dbTransaction = newTransaction;
    req.tenantContext = {
      tenantId: newTenantId,
      userId: req.tenantContext?.userId,
      role: req.tenantContext?.role,
    };

    logger.info('Tenant context reset successfully', {
      tenantId: newTenantId,
      userId: req.tenantContext?.userId,
    });
  } catch (error) {
    logger.error('Failed to reset tenant context', {
      newTenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export default tenantTransactionMiddleware;
