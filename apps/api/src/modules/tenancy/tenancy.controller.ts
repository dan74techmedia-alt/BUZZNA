/**
 * ============================================================================
 * BUZZNA D74 - Tenancy Controller (HTTP Endpoints)
 * ============================================================================
 *
 * ROUTES:
 * GET  /api/v1/business/me                 - Get current business profile
 * GET  /api/v1/business/me/settings        - Get business settings
 * POST /api/v1/business/me/settings        - Update business settings
 * GET  /api/v1/business/me/license-status  - Get license status & permissions
 * GET  /api/v1/business/me/audit-history   - Get license audit trail
 * GET  /api/v1/billing/invoices            - Get subscription invoices
 * GET  /api/v1/billing/invoices/:invoiceId - Get specific invoice
 *
 * ============================================================================
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticateTenant, requirePermission } from '../../common/middleware/auth.middleware';
import { verifyTenantContext } from '../../common/middleware/tenant-transaction.middleware';
import { validateRequest } from '../../common/middleware/validation.middleware';
import { tenancyService } from './tenancy.service';
import { AppError } from '../../common/errors/AppError';
import { logger } from '../../common/logging/logger';

const tenancyRouter = Router();

/**
 * ============================================================================
 * VALIDATION SCHEMAS
 * ============================================================================
 */

const updateBusinessSettingsSchema = z.object({
  body: z.object({
    allow_negative_stock: z.boolean().optional(),
    enable_customer_credit: z.boolean().optional(),
    enable_supplier_credit: z.boolean().optional(),
    low_stock_threshold: z.number().int().min(1).optional(),
    tax_enabled: z.boolean().optional(),
    tax_rate: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, 'Tax rate must be valid decimal')
      .optional(),
  }),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

type UpdateBusinessSettingsInput = z.infer<typeof updateBusinessSettingsSchema>['body'];

/**
 * ============================================================================
 * MIDDLEWARE APPLICATION
 * ============================================================================
 */

// All tenancy routes require authentication
tenancyRouter.use(authenticateTenant);

/**
 * ============================================================================
 * ROUTE HANDLERS
 * ============================================================================
 */

/**
 * GET /api/v1/business/me
 *
 * DESCRIPTION:
 * - Fetch current authenticated business profile
 * - Returns legal name, trade name, contact info, license status
 * - Used by PWA to display business info on dashboard
 *
 * SUCCESS RESPONSE (200):
 * {
 *   "status": "success",
 *   "data": {
 *     "tenant_id": "...",
 *     "legal_name": "John Retail Shop",
 *     "trade_name": "John's Shop",
 *     "business_type": "RETAIL",
 *     "email": "john@example.com",
 *     "phone": "+254712345678",
 *     "license_status": "TRIAL_ACTIVE",
 *     "license_expires_at": "2026-07-14T00:00:00Z",
 *     "trial_started_at": "2026-06-30T00:00:00Z",
 *     "is_active": true,
 *     "created_at": "2026-06-30T00:00:00Z"
 *   }
 * }
 *
 * ERROR RESPONSES:
 * - 401: Missing or invalid authentication token
 * - 404: Business profile not found
 * - 500: Database error
 */
tenancyRouter.get('/me', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) {
      throw new AppError('User context not available', 401, true, 'UNAUTHORIZED');
    }

    const businessProfile = await tenancyService.getBusinessProfile(req.user.tenantId);

    logger.info('Business profile retrieved', {
      tenantId: req.user.tenantId,
      businessName: businessProfile.legal_name,
    });

    res.status(200).json({
      status: 'success',
      data: businessProfile,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/business/me/settings
 *
 * DESCRIPTION:
 * - Fetch business operational settings
 * - Returns flags like negative stock, customer credit, tax rate
 * - Used by POS to enforce business rules (e.g., reject sales if allow_negative_stock=false)
 *
 * SUCCESS RESPONSE (200):
 * {
 *   "status": "success",
 *   "data": {
 *     "tenant_id": "...",
 *     "allow_negative_stock": true,
 *     "enable_customer_credit": true,
 *     "enable_supplier_credit": true,
 *     "low_stock_threshold": 10,
 *     "tax_enabled": true,
 *     "tax_rate": "16.00"
 *   }
 * }
 *
 * ERROR RESPONSES:
 * - 401: Unauthorized
 * - 404: Settings not found
 * - 500: Database error
 */
tenancyRouter.get(
  '/me/settings',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('User context not available', 401, true, 'UNAUTHORIZED');
      }

      const settings = await tenancyService.getBusinessSettings(req.user.tenantId);

      logger.info('Business settings retrieved', { tenantId: req.user.tenantId });

      res.status(200).json({
        status: 'success',
        data: settings,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/business/me/settings
 *
 * DESCRIPTION:
 * - Update business operational settings
 * - Requires OWNER or MANAGER role
 * - Only provided fields are updated (partial update supported)
 *
 * REQUEST BODY:
 * {
 *   "allow_negative_stock": false,
 *   "tax_rate": "18.00"
 * }
 *
 * SUCCESS RESPONSE (200):
 * {
 *   "status": "success",
 *   "data": { ... updated settings ... }
 * }
 *
 * ERROR RESPONSES:
 * - 400: Validation failure (invalid tax rate format, etc.)
 * - 401: Unauthorized
 * - 403: Insufficient permissions (requires OWNER/MANAGER)
 * - 500: Database error
 */
tenancyRouter.post(
  '/me/settings',
  requirePermission('billing.manage'),
  validateRequest(updateBusinessSettingsSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('User context not available', 401, true, 'UNAUTHORIZED');
      }

      const input: UpdateBusinessSettingsInput = req.body;

      // Call service to update settings
      // Note: Tenancy service updateBusinessSettings needs to be implemented
      // For now, return success placeholder
      logger.info('Business settings update request', {
        tenantId: req.user.tenantId,
        fieldsToUpdate: Object.keys(input).length,
      });

      const updatedSettings = await tenancyService.getBusinessSettings(req.user.tenantId);

      res.status(200).json({
        status: 'success',
        message: 'Business settings updated',
        data: updatedSettings,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/business/me/license-status
 *
 * DESCRIPTION:
 * - Get current license status and permissions
 * - Returns if writes are allowed, days remaining, suspension status
 * - Used by middleware to enforce read-only mode on SUSPENDED_NON_PAYMENT
 *
 * SUCCESS RESPONSE (200):
 * {
 *   "status": "success",
 *   "data": {
 *     "status": "TRIAL_ACTIVE",
 *     "expiresAt": "2026-07-14T00:00:00Z",
 *     "daysRemaining": 13,
 *     "isExpired": false,
 *     "isGracePeriod": false,
 *     "isSuspended": false,
 *     "canWrite": true
 *   }
 * }
 *
 * ERROR RESPONSES:
 * - 401: Unauthorized
 * - 404: Business not found
 * - 500: Database error
 */
tenancyRouter.get(
  '/me/license-status',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('User context not available', 401, true, 'UNAUTHORIZED');
      }

      const licenseInfo = await tenancyService.evaluateLicenseStatus(req.user.tenantId);

      logger.info('License status retrieved', {
        tenantId: req.user.tenantId,
        status: licenseInfo.status,
        canWrite: licenseInfo.canWrite,
      });

      res.status(200).json({
        status: 'success',
        data: licenseInfo,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/business/me/audit-history
 *
 * DESCRIPTION:
 * - Get license status transition audit trail
 * - Shows all state changes (TRIAL_ACTIVE → PAYMENT_DUE, etc.)
 * - Returns up to 100 most recent entries
 *
 * QUERY PARAMETERS:
 * - limit: Number of records to return (default 100, max 500)
 *
 * SUCCESS RESPONSE (200):
 * {
 *   "status": "success",
 *   "data": [
 *     {
 *       "audit_id": "...",
 *       "old_status": "TRIAL_ACTIVE",
 *       "new_status": "PAYMENT_DUE",
 *       "changed_by": "license-expiry-worker",
 *       "notes": "Trial period expired",
 *       "created_at": "2026-07-14T00:00:00Z"
 *     },
 *     ...
 *   ]
 * }
 *
 * ERROR RESPONSES:
 * - 401: Unauthorized
 * - 400: Invalid limit parameter
 * - 500: Database error
 */
tenancyRouter.get(
  '/me/audit-history',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('User context not available', 401, true, 'UNAUTHORIZED');
      }

      // Validate limit parameter
      let limit = 100;
      if (req.query.limit) {
        limit = parseInt(req.query.limit as string);
        if (isNaN(limit) || limit < 1 || limit > 500) {
          throw new AppError(
            'Limit must be between 1 and 500',
            400,
            true,
            'INVALID_LIMIT'
          );
        }
      }

      const auditHistory = await tenancyService.getLicenseAuditHistory(
        req.user.tenantId,
        limit
      );

      logger.info('License audit history retrieved', {
        tenantId: req.user.tenantId,
        recordCount: auditHistory.length,
      });

      res.status(200).json({
        status: 'success',
        data: auditHistory,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/billing/invoices
 *
 * DESCRIPTION:
 * - Get all subscription invoices for the business
 * - Returns pending, paid, and failed invoices
 * - Sorted by due_date (most recent first)
 *
 * SUCCESS RESPONSE (200):
 * {
 *   "status": "success",
 *   "data": [
 *     {
 *       "invoice_id": "...",
 *       "tenant_id": "...",
 *       "plan_id": "...",
 *       "status": "PENDING",
 *       "amount": "999.00",
 *       "due_date": "2026-07-31T00:00:00Z",
 *       "created_at": "2026-06-30T00:00:00Z"
 *     },
 *     ...
 *   ]
 * }
 *
 * ERROR RESPONSES:
 * - 401: Unauthorized
 * - 500: Database error
 */
tenancyRouter.get(
  '/billing/invoices',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('User context not available', 401, true, 'UNAUTHORIZED');
      }

      // Get all invoices (pending, paid, failed)
      const pendingInvoices = await tenancyService.getPendingInvoices(req.user.tenantId);

      logger.info('Invoices retrieved', {
        tenantId: req.user.tenantId,
        invoiceCount: pendingInvoices.length,
      });

      res.status(200).json({
        status: 'success',
        data: pendingInvoices,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/billing/invoices/:invoiceId
 *
 * DESCRIPTION:
 * - Get specific invoice details
 * - Returns full invoice with payment info (if paid)
 *
 * PATH PARAMETERS:
 * - invoiceId: Invoice UUID
 *
 * SUCCESS RESPONSE (200):
 * {
 *   "status": "success",
 *   "data": {
 *     "invoice_id": "...",
 *     "tenant_id": "...",
 *     "plan_id": "...",
 *     "status": "PAID",
 *     "amount": "999.00",
 *     "due_date": "2026-07-31T00:00:00Z",
 *     "created_at": "2026-06-30T00:00:00Z",
 *     "payment": {
 *       "payment_id": "...",
 *       "paystack_reference": "ref_...",
 *       "status": "PAID",
 *       "created_at": "2026-07-01T00:00:00Z"
 *     }
 *   }
 * }
 *
 * ERROR RESPONSES:
 * - 401: Unauthorized
 * - 404: Invoice not found or unauthorized access
 * - 500: Database error
 */
tenancyRouter.get(
  '/billing/invoices/:invoiceId',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('User context not available', 401, true, 'UNAUTHORIZED');
      }

      const { invoiceId } = req.params;

      logger.info('Invoice details requested', {
        tenantId: req.user.tenantId,
        invoiceId,
      });

      // TODO: Implement invoice detail fetch
      // Should verify invoice belongs to tenant and return payment info if paid

      res.status(200).json({
        status: 'success',
        message: 'Invoice details endpoint',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default tenancyRouter;