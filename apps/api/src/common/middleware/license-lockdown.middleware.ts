/**
 * ============================================================================
 * BUZZNA D74 - License Lockdown Middleware
 * ============================================================================
 *
 * PURPOSE:
 * - Enforce license status policies on HTTP requests
 * - Block operational writes on SUSPENDED_NON_PAYMENT
 * - Allow reads always (dashboard, reports accessible even when suspended)
 * - Prevent access to billing/payment endpoints on non-suspended accounts
 *
 * ARCHITECTURAL RULES:
 * 1. SUSPENDED_NON_PAYMENT + write request → 403 Forbidden
 * 2. SUSPENDED_NON_PAYMENT + read request → 200 OK (allow analytics access)
 * 3. SUSPENDED_NON_PAYMENT → Only /billing/* endpoints are writable
 * 4. Other statuses (TRIAL_ACTIVE, GRACE_PERIOD) → All operations allowed
 * 5. FULLY_ACTIVATED → All operations allowed
 *
 * WRITE METHODS: POST, PUT, PATCH, DELETE
 * READ METHODS: GET, HEAD, OPTIONS
 *
 * ALLOWED PATHS DURING SUSPENSION:
 * - GET /api/v1/business/* (view-only)
 * - GET /api/v1/billing/* (view invoices)
 * - POST /api/v1/billing/paystack/webhook (payment processing)
 * - POST /api/v1/auth/logout
 *
 * BLOCKED PATHS DURING SUSPENSION:
 * - POST /api/v1/sales (POS checkout)
 * - POST /api/v1/inventory/* (stock management)
 * - POST /api/v1/till/open (shift management)
 * - Any POST/PUT/PATCH/DELETE on operational domains
 *
 * ============================================================================
 */

import { Request, Response, NextFunction } from 'express';
import { tenancyService } from '../../modules/tenancy/tenancy.service';
import { AppError } from '../errors/AppError';
import { logger } from '../logging/logger';

/**
 * Express Request with license info
 */
interface RequestWithLicense extends Request {
  licenseInfo?: {
    status: string;
    canWrite: boolean;
    isSuspended: boolean;
  };
}

/**
 * Check if request is a write operation
 */
function isWriteOperation(method: string): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
}

/**
 * Check if path should be accessible during suspension
 */
function isAllowedDuringSuspension(path: string, method: string): boolean {
  // Always allow reads on any path
  if (!isWriteOperation(method)) {
    return true;
  }

  // Allow specific write paths during suspension
  const allowedWritePaths = [
    '/api/v1/billing/paystack/webhook', // Webhook for payment processing
    '/api/v1/billing/payment-verify', // Manual payment verification
    '/api/v1/auth/logout', // User can logout
    '/api/v1/business/me/audit-history', // Can view own history
  ];

  return allowedWritePaths.some((allowedPath) => path.includes(allowedPath));
}

/**
 * License Lockdown Middleware
 *
 * Evaluates current license status and enforces read-only mode if suspended
 *
 * EXECUTION ORDER IN APP:
 * 1. authenticateTenant (extract & validate JWT)
 * 2. tenantTransactionMiddleware (establish DB transaction)
 * 3. licenseCheckMiddleware (THIS - enforce suspension)
 * 4. Route handlers (POS, inventory, etc.)
 *
 * @throws AppError(403) if write attempted on suspended account
 */
export const licenseCheckMiddleware = async (
  req: RequestWithLicense,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Skip middleware for public endpoints (health check, etc.)
    if (req.path === '/health' || req.path === '/metrics' || req.method === 'OPTIONS') {
      return next();
    }

    // Skip if no user context (shouldn't happen after auth middleware)
    if (!req.user) {
      return next();
    }

    // Evaluate current license status
    const licenseInfo = await tenancyService.evaluateLicenseStatus(req.user.tenantId);

    // Attach license info to request for downstream use
    req.licenseInfo = {
      status: licenseInfo.status,
      canWrite: licenseInfo.canWrite,
      isSuspended: licenseInfo.isSuspended,
    };

    logger.debug('License check evaluated', {
      tenantId: req.user.tenantId,
      licenseStatus: licenseInfo.status,
      isWrite: isWriteOperation(req.method),
      isSuspended: licenseInfo.isSuspended,
      path: req.path,
    });

    // ====================================================================
    // ENFORCEMENT LOGIC
    // ====================================================================

    // If account is suspended AND attempting write
    if (licenseInfo.isSuspended && isWriteOperation(req.method)) {
      // Check if this is an allowed exception path
      if (!isAllowedDuringSuspension(req.path, req.method)) {
        logger.warn('Write operation rejected on suspended account', {
          tenantId: req.user.tenantId,
          userId: req.user.userId,
          method: req.method,
          path: req.path,
          licenseStatus: licenseInfo.status,
        });

        throw new AppError(
          'Account suspended due to non-payment. All operational writes are blocked. ' +
            'Please complete your payment to restore full access. ' +
            'Navigate to Billing > Pay Now to resume operations.',
          403,
          true,
          'ACCOUNT_SUSPENDED'
        );
      }

      logger.info('Allowed write on suspended account (exception path)', {
        tenantId: req.user.tenantId,
        path: req.path,
      });
    }

    // If account is in grace period, allow writes but warn
    if (licenseInfo.isGracePeriod && isWriteOperation(req.method)) {
      res.setHeader(
        'X-License-Warning',
        `Grace period expires in ${licenseInfo.daysRemaining} days. Complete payment to avoid suspension.`
      );

      logger.info('Write operation on grace period account', {
        tenantId: req.user.tenantId,
        daysRemaining: licenseInfo.daysRemaining,
      });
    }

    // Continue to next middleware
    next();
  } catch (error) {
    if (error instanceof AppError) {
      // Log suspension attempts
      if (error.statusCode === 403) {
        logger.warn('License lockdown triggered', {
          tenantId: req.user?.tenantId,
          userId: req.user?.userId,
          path: req.path,
          method: req.method,
          message: error.message,
        });
      }
      return next(error);
    }

    logger.error('License check middleware error', {
      tenantId: req.user?.tenantId,
      error: error instanceof Error ? error.message : String(error),
    });

    next(error);
  }
};

/**
 * Helper middleware to send license status in response headers
 * Useful for PWA to display suspension/grace period UI
 */
export const attachLicenseHeaders = (
  req: RequestWithLicense,
  res: Response,
  next: NextFunction
): void => {
  if (req.licenseInfo) {
    res.setHeader('X-License-Status', req.licenseInfo.status);
    res.setHeader('X-License-Suspended', req.licenseInfo.isSuspended ? 'true' : 'false');
    res.setHeader('X-License-Can-Write', req.licenseInfo.canWrite ? 'true' : 'false');
  }
  next();
};

export default licenseCheckMiddleware;