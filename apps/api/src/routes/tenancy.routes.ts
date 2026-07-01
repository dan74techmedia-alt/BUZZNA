// apps/api/src/routes/tenancy.routes.ts

import { Router } from 'express';
import { TenancyController } from '../modules/tenancy/tenancy.controller';
import { authMiddleware } from '../common/middleware/auth.middleware';

const router = Router();
const tenancyController = new TenancyController();

/**
 * Layer 1 Security Enforcer:
 * All business/tenancy routes require a valid decoded Bearer JWT context.
 */
router.use(authMiddleware);

/**
 * GET /api/v1/business/me
 * Note: This endpoint explicitly bypasses the `licenseLockdownMiddleware`.
 * If a tenant's license is SUSPENDED_NON_PAYMENT, they still must be able 
 * to fetch their business profile to view their status and pay invoices.
 */
router.get('/me', tenancyController.getActiveBusinessProfile);

export default router;