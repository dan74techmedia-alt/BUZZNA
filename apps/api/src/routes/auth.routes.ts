// apps/api/src/routes/auth.routes.ts

import { Router } from 'express';
import { AuthController } from '../modules/auth/auth.controller';
import { validateRequest } from '../common/middleware/validation.middleware';
import { rateLimitMiddleware } from '../common/middleware/rate-limit.middleware';
import { 
  registerBusinessSchema, 
  loginSchema, 
  refreshTokenSchema 
} from '../modules/auth/auth.schema';

const router = Router();
const authController = new AuthController();

/**
 * Section 10: API Rate Limiting
 * Strict token-bucket algorithms on /auth (5 req/min) to prevent brute force attacks.
 */
const authRateLimiter = rateLimitMiddleware({
  windowMs: 60 * 1000, 
  max: 5,
  message: 'Too many authentication attempts, please try again after a minute.'
});

/**
 * POST /api/v1/auth/register-business
 * Creates tenant, root owner user, and initiates 14-day trial.
 */
router.post(
  '/register-business',
  authRateLimiter,
  validateRequest(registerBusinessSchema),
  authController.registerBusiness
);

/**
 * POST /api/v1/auth/login
 * Authenticate user and return sync snapshot.
 */
router.post(
  '/login',
  authRateLimiter,
  validateRequest(loginSchema),
  authController.login
);

/**
 * POST /api/v1/auth/refresh
 * Rotate short-lived access token using long-lived secure refresh token.
 */
router.post(
  '/refresh',
  authRateLimiter,
  validateRequest(refreshTokenSchema),
  authController.refresh
);

export default router;