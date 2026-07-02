// apps/api/src/common/middleware/tenant-transaction.middleware.ts

import { Request, Response, NextFunction } from 'express';
import { tenantContextStorage, TenantContextData } from '../tenant-context';
import { AppError } from '../errors/AppError';
import { logger } from '../logging/logger';

/**
 * Tenant Transaction Middleware (Layer 2 Security)
 *
 * CRITICAL ARCHITECTURAL LAYER
 *
 * PURPOSE:
 * - Extract tenant context from request object (populated by auth middleware)
 * - Store tenant context in AsyncLocalStorage for async boundary crossing
 * - Ensure every database query has access to current tenant_id
 * - Prevent connection pool leakage in PgBouncer by scoping tenant per-request
 *
 * EXECUTION ORDER:
 * 1. authMiddleware (extracts JWT, sets req.tenantId, req.user)
 * 2. THIS MIDDLEWARE (populates AsyncLocalStorage)
 * 3. All database queries (read from AsyncLocalStorage)
 *
 * CRITICAL RULES:
 * 1. EVERY query MUST be wrapped in: BEGIN; SET LOCAL app.current_tenant_id; COMMIT;
 * 2. Tenant context is NEVER taken from client headers (X-Tenant-ID, etc.)
 * 3. Only JWT claims are trusted as source of tenant identity
 * 4. All downstream handlers MUST access context via tenantContextStorage.getStore()
 *
 * ============================================================================
 */

declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
      user?: {
        userId: string;
        tenantId: string;
        roleId: string;
        username?: string;
        roleName?: string;
        permissions?: string[];
      };
    }
  }
}

export const tenantTransactionMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    // CRITICAL: Verify auth middleware has already run
    if (!req.tenantId || !req.user?.userId || !req.user?.roleId) {
      throw new AppError(
        'Tenant context not available. Auth middleware must execute before tenant-transaction middleware.',
        401
      );
    }

    // Extract tenant data from request (populated by auth middleware)
    const tenantContext: TenantContextData = {
      tenantId: req.tenantId,
      userId: req.user.userId,
      roleId: req.user.roleId,
    };

    // Store in AsyncLocalStorage - this is thread-local storage per request
    // All async operations within this request will have access to this context
    tenantContextStorage.run(tenantContext, () => {
      // Log that context was established
      logger.debug('Tenant transaction context established', {
        tenantId: tenantContext.tenantId,
        userId: tenantContext.userId,
        path: req.path,
        method: req.method,
      });

      // Continue to next middleware/handler
      next();
    });
  } catch (error) {
    logger.error('Tenant transaction middleware failed', {
      error: error instanceof Error ? error.message : String(error),
      path: req.path,
    });
    next(error);
  }
};
