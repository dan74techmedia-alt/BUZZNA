// apps/api/src/routes/index.ts

import { Express, Router } from 'express';
import { logger } from '../common/logging/logger';

// Import all route modules
import authRoutes from './auth.routes';
import catalogRoutes from './catalog.routes';
import inventoryRoutes from './inventory.routes';
import salesRoutes from './sales.routes';
import customerRoutes from './customer.routes';
import supplierRoutes from './suppliers.routes';
import expensesRoutes from './expenses.routes';
import tillRoutes from './till.routes';
import billingRoutes from './billing.routes';
import merchantPaymentRoutes from './merchant-payments.routes';
import analyticsRoutes from './analytics.routes';
import notificationsRoutes from './notifications.routes';
import syncRoutes from './sync.routes';
import tenancyRoutes from './tenancy.routes';

/**
 * Register all API routes
 *
 * Route structure:
 * /api/v1/
 *   /auth - Authentication & registration
 *   /products - Product catalog management
 *   /inventory - Stock tracking & adjustments
 *   /sales - POS transactions & refunds
 *   /customers - Customer profiles & debt
 *   /suppliers - Supplier management
 *   /expenses - Capital expenditure tracking
 *   /till - Cash drawer management
 *   /billing - Subscription management
 *   /merchant-payments - M-Pesa reconciliation
 *   /analytics - Dashboards & reports
 *   /notifications - Alert management
 *   /sync - Offline sync batches
 *   /business - Tenancy & settings
 *
 * Middleware application order (CRITICAL):
 * 1. compression - Reduce bandwidth
 * 2. express.json - Parse JSON body
 * 3. validation - Schema validation
 * 4. auth - JWT extraction
 * 5. tenantTransaction - BEGIN; SET LOCAL app.current_tenant_id;
 * 6. idempotency - Detect duplicate requests
 * 7. cache - ETag and response caching
 * 8. webhookVerification - For webhook endpoints only
 * 9. rbac - Role-based access control
 */

export function registerRoutes(app: Express): void {
  try {
    // API v1 namespace
    const apiV1 = Router();

    // Health check (public, no auth)
    apiV1.get('/health', (req, res) => {
      res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      });
    });

    // Authentication routes (public registration, login)
    apiV1.use('/auth', authRoutes);

    // Protected routes (require auth + tenant context)
    apiV1.use('/products', catalogRoutes);
    apiV1.use('/inventory', inventoryRoutes);
    apiV1.use('/sales', salesRoutes);
    apiV1.use('/customers', customerRoutes);
    apiV1.use('/suppliers', supplierRoutes);
    apiV1.use('/expenses', expensesRoutes);
    apiV1.use('/till', tillRoutes);
    apiV1.use('/billing', billingRoutes);
    apiV1.use('/merchant-payments', merchantPaymentRoutes);
    apiV1.use('/analytics', analyticsRoutes);
    apiV1.use('/notifications', notificationsRoutes);
    apiV1.use('/sync', syncRoutes);
    apiV1.use('/business', tenancyRoutes);

    // Mount v1 routes
    app.use('/api/v1', apiV1);

    logger.info('All API routes registered', {
      routeCount: 13,
    });
  } catch (error) {
    logger.error('Failed to register routes', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export default registerRoutes;