// apps/api/src/bootstrap/app.ts

import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { logger } from '../common/logging/logger';
import { compressionMiddleware } from '../common/middleware/compression.middleware';
import { cacheMiddleware } from '../common/middleware/cache.middleware';
import { requestIdMiddleware } from '../common/middleware/request-id.middleware';
import { errorHandler } from '../common/errors/errorHandler';
import { authMiddleware } from '../common/middleware/auth.middleware';
import { tenantTransactionMiddleware } from '../common/middleware/tenant-transaction.middleware';
import { rbacMiddleware } from '../common/middleware/rbac.middleware';
import { licenseCheckMiddleware } from '../common/middleware/license-lockdown.middleware';
import { rateLimitMiddleware } from '../common/middleware/rate-limit.middleware';
import { validationMiddleware } from '../common/middleware/validation.middleware';
import { auditMiddleware } from '../common/middleware/audit.middleware';
import { idempotencyMiddleware } from '../common/middleware/idempotency.middleware';
import { registerRoutes } from '../routes/index';

/**
 * Bootstrap Express Application
 *
 * Creates and configures the Express server with:
 * 1. Security middleware (CORS, Helmet)
 * 2. Request processing (compression, JSON parsing)
 * 3. Monitoring (request ID, audit logging)
 * 4. Authentication & authorization
 * 5. Business logic (tenant context, RLS)
 * 6. Performance (caching, rate limiting)
 * 7. Error handling
 *
 * Middleware execution order matters!
 */

export function createApp(): Express {
  const app = express();

  // ==========================================================================
  // PHASE 1: Security & Request Preparation
  // ==========================================================================

  // Security headers
  app.use(helmet());

  // CORS - Allow only trusted origins
  app.use(
    cors({
      origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:5173'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Tenant-ID',
        'Idempotency-Key',
        'X-Request-ID',
      ],
    })
  );

  // Compression (gzip/brotli for large responses)
  app.use(compressionMiddleware);

  // Request ID for tracing
  app.use(requestIdMiddleware);

  // ==========================================================================
  // PHASE 2: Request Body Parsing
  // ==========================================================================

  // JSON body parsing
  app.use(express.json({ limit: '10mb' }));

  // URL-encoded forms
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

  // ==========================================================================
  // PHASE 3: Rate Limiting (Early to prevent abuse)
  // ==========================================================================

  app.use(rateLimitMiddleware);

  // ==========================================================================
  // PHASE 4: Audit Logging
  // ==========================================================================

  app.use(auditMiddleware);

  // ==========================================================================
  // PHASE 5: Authentication (JWT extraction)
  // ==========================================================================

  // Auth middleware - extracts JWT and populates req.tenantContext
  app.use(authMiddleware);

  // ==========================================================================
  // PHASE 6: Tenant Context & RLS (CRITICAL)
  // ==========================================================================

  // Wrap database operations in BEGIN; SET LOCAL app.current_tenant_id;
  // This MUST run after auth but before any database queries
  app.use(tenantTransactionMiddleware);

  // ==========================================================================
  // PHASE 7: Idempotency (Detect duplicate requests)
  // ==========================================================================

  // Detect and cache duplicate requests
  app.use(idempotencyMiddleware);

  // ==========================================================================
  // PHASE 8: Request Validation
  // ==========================================================================

  app.use(validationMiddleware);

  // ==========================================================================
  // PHASE 9: Response Caching (ETag, cache headers)
  // ==========================================================================

  app.use(cacheMiddleware());

  // ==========================================================================
  // PHASE 10: Authorization (RBAC)
  // ==========================================================================

  // Role-based access control (attached to routes, not globally)
  // Individual routes apply: rbacMiddleware(['owner', 'manager'])

  // ==========================================================================
  // PHASE 11: License Enforcement
  // ==========================================================================

  // Check if subscription is active/suspended
  // Blocks writes if license_status = SUSPENDED_NON_PAYMENT
  app.use(licenseCheckMiddleware);

  // ==========================================================================
  // PHASE 12: API Routes
  // ==========================================================================

  registerRoutes(app);

  // ==========================================================================
  // PHASE 13: 404 Handling
  // ==========================================================================

  app.use((req: Request, res: Response) => {
    res.status(404).json({
      error: 'NOT_FOUND',
      message: `Route not found: ${req.method} ${req.path}`,
    });
  });

  // ==========================================================================
  // PHASE 14: Global Error Handler
  // ==========================================================================

  app.use(errorHandler);

  logger.info('Express app created and configured');

  return app;
}

export default createApp;