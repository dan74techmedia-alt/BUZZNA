import { Router } from 'express';
import * as authController from '../modules/auth/auth.controller';
import { requireAuth } from '../common/middleware/auth.middleware';

const router = Router();

/**
 * Public Routes
 */
// Create tenant, root owner user, and start initial 14-day trial
router.post('/register-business', authController.registerBusiness);

// Authenticate user, returns JWT tokens and offline sync snapshot
router.post('/login', authController.login);

// Rotate short-lived access token using long-lived secure refresh token
router.post('/refresh', authController.refreshToken);

/**
 * Protected Routes
 */
// Fetch active business profile and SaaS entitlement snapshot parameters
// Note: Mapped to /me but frequently mounted on /api/v1/business/me via index.ts or here.
router.get('/me', requireAuth, authController.getMe);
router.post('/logout', requireAuth, authController.logout);

export default router;