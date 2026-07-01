/**
 * ============================================================================
 * BUZZNA D74 - Authentication Controller (HTTP Request Handlers)
 * ============================================================================
 *
 * PURPOSE:
 * - Handle HTTP requests for business registration, login, token refresh, logout
 * - Compile and return offline sync snapshots on successful authentication
 * - Implement rate limiting for brute-force protection
 * - Validate request payloads against Zod schemas
 * - Extract client IP and user-agent for audit trails
 *
 * MIDDLEWARE DEPENDENCIES (must be applied in order):
 * 1. express.json() - Parse JSON request body
 * 2. authRateLimiter - Rate limit: 5 requests/minute
 * 3. validateRequest(schema) - Zod payload validation
 * 4. errorHandler - Catch and format errors
 *
 * ROUTES:
 * POST /api/v1/auth/register       - Register new business tenant
 * POST /api/v1/auth/login          - Authenticate user and return tokens + snapshot
 * POST /api/v1/auth/refresh        - Rotate refresh token
 * POST /api/v1/auth/logout         - Logout (optional, mainly for audit)
 *
 * ============================================================================
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authService, LoginInput, RegisterBusinessInput } from './auth.service';
import { authenticateTenant, requirePermission } from '../../common/middleware/auth.middleware';
import { authRateLimiter } from '../../common/middleware/rate-limit.middleware';
import { validateRequest } from '../../common/middleware/validation.middleware';
import { AppError } from '../../common/errors/AppError';
import { logger } from '../../common/logging/logger';

const authRouter = Router();

/**
 * ============================================================================
 * ZOD VALIDATION SCHEMAS
 * ============================================================================
 */

/**
 * Business Registration Schema
 */
const registerBusinessSchema = z.object({
  body: z.object({
    legalName: z
      .string()
      .min(2, 'Legal business name must be at least 2 characters')
      .max(200, 'Legal business name cannot exceed 200 characters'),

    tradeName: z
      .string()
      .max(200, 'Trade name cannot exceed 200 characters')
      .optional(),

    businessType: z.enum(
      ['RETAIL', 'BUTCHERY', 'MITUMBA', 'HARDWARE', 'AGROVET', 'CYBER', 'WHOLESALE'],
      {
        errorMap: () => ({
          message: 'Business type must be one of: RETAIL, BUTCHERY, MITUMBA, HARDWARE, AGROVET, CYBER, WHOLESALE',
        }),
      }
    ),

    ownerFullName: z
      .string()
      .min(2, 'Owner name must be at least 2 characters')
      .max(150, 'Owner name cannot exceed 150 characters'),

    email: z
      .string()
      .email('Must provide a valid email address')
      .max(150, 'Email cannot exceed 150 characters'),

    phone: z
      .string()
      .regex(/^\+?[1-9]\d{1,14}$/, 'Phone must be a valid E.164 format (e.g., +254712345678)'),

    username: z
      .string()
      .min(4, 'Username must be at least 4 characters')
      .max(80, 'Username cannot exceed 80 characters')
      .regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain alphanumeric, underscore, and hyphen characters'),

    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
      .regex(/[0-9]/, 'Password must contain at least one numeric digit')
      .regex(/[!@#$%^&*]/, 'Password must contain at least one special character (!@#$%^&*)'),
  }),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

/**
 * Login Schema
 */
const loginSchema = z.object({
  body: z.object({
    username: z
      .string()
      .min(4, 'Username must be at least 4 characters')
      .max(80, 'Username cannot exceed 80 characters'),

    password: z
      .string()
      .min(8, 'Password must be at least 8 characters'),
  }),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

/**
 * Refresh Token Schema
 */
const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z
      .string()
      .min(10, 'Refresh token is invalid'),
  }),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

/**
 * ============================================================================
 * ROUTE HANDLERS
 * ============================================================================
 */

/**
 * POST /api/v1/auth/register
 *
 * DESCRIPTION:
 * - Create a new business tenant and initialize root owner user
 * - Automatically activate 14-day trial period
 * - Seed default roles (OWNER, MANAGER, CASHIER, ACCOUNTANT)
 * - Return initial JWT tokens
 *
 * REQUEST BODY:
 * {
 *   "legalName": "John's Retail Shop",
 *   "tradeName": "John's Shop",
 *   "businessType": "RETAIL",
 *   "ownerFullName": "John Doe",
 *   "email": "john@example.com",
 *   "phone": "+254712345678",
 *   "username": "john_owner",
 *   "password": "SecurePass123!"
 * }
 *
 * SUCCESS RESPONSE (200):
 * {
 *   "status": "success",
 *   "tenantId": "550e8400-e29b-41d4-a716-446655440000",
 *   "tokens": {
 *     "accessToken": "eyJhbGc...",
 *     "refreshToken": "eyJhbGc...",
 *     "expiresIn": 28800
 *   },
 *   "message": "Business registration successful. Trial period started for 14 days."
 * }
 *
 * ERROR RESPONSES:
 * - 400: Validation failure (invalid email, weak password, etc.)
 * - 409: Duplicate email or username
 * - 500: Database or system error
 */
authRouter.post(
  '/register',
  authRateLimiter,
  validateRequest(registerBusinessSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input: RegisterBusinessInput = {
        legalName: req.body.legalName,
        tradeName: req.body.tradeName,
        businessType: req.body.businessType,
        ownerFullName: req.body.ownerFullName,
        email: req.body.email,
        phone: req.body.phone,
        username: req.body.username,
        password: req.body.password,
      };

      logger.info('Business registration request received', {
        email: input.email,
        businessType: input.businessType,
      });

      // Call auth service to create tenant
      const result = await authService.registerBusiness(input);

      logger.info('Business registered successfully', {
        tenantId: result.tenantId,
        email: input.email,
      });

      res.status(201).json({
        status: 'success',
        message: 'Business registration successful. Trial period activated for 14 days.',
        tenantId: result.tenantId,
        tokens: {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresIn: 28800, // 8 hours in seconds
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/auth/login
 *
 * DESCRIPTION:
 * - Authenticate user with username and password
 * - Verify account status and license (TRIAL_ACTIVE, SUSPENDED_NON_PAYMENT, etc.)
 * - Return JWT tokens (access + refresh)
 * - Compile offline sync snapshot (products cache + permissions)
 * - Record login attempt in audit history
 * - Enforce account lockout after 5 failed attempts
 *
 * REQUEST BODY:
 * {
 *   "username": "john_owner",
 *   "password": "SecurePass123!"
 * }
 *
 * SUCCESS RESPONSE (200):
 * {
 *   "status": "success",
 *   "tokens": {
 *     "accessToken": "eyJhbGc...",
 *     "refreshToken": "eyJhbGc...",
 *     "expiresIn": 28800
 *   },
 *   "profile": {
 *     "userId": "550e8400-e29b-41d4-a716-446655440000",
 *     "username": "john_owner",
 *     "roleId": "550e8400-e29b-41d4-a716-446655440001",
 *     "roleName": "OWNER"
 *   },
 *   "offlineSnapshot": {
 *     "licenseStatus": "TRIAL_ACTIVE",
 *     "businessName": "John's Shop",
 *     "userId": "550e8400-e29b-41d4-a716-446655440000",
 *     "roleId": "550e8400-e29b-41d4-a716-446655440001",
 *     "roleName": "OWNER",
 *     "permissions": ["dashboard.view", "catalog.manage", ...],
 *     "catalogCache": [
 *       {
 *         "product_id": "...",
 *         "barcode": "123456789",
 *         "product_name": "Widget",
 *         "retail_price": "1000.00",
 *         "current_quantity": "50.000",
 *         "cost_floor": "500.00"
 *       },
 *       ...
 *     ],
 *     "businessSettings": {
 *       "allow_negative_stock": true,
 *       "enable_customer_credit": true,
 *       "low_stock_threshold": 10
 *     }
 *   }
 * }
 *
 * ERROR RESPONSES:
 * - 400: Validation failure
 * - 401: Invalid credentials or expired refresh token
 * - 403: Account locked, account inactive, or subscription suspended
 * - 429: Too many login attempts (rate limited)
 * - 500: Database error
 */
authRouter.post(
  '/login',
  authRateLimiter,
  validateRequest(loginSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input: LoginInput = {
        username: req.body.username,
        password: req.body.password,
      };

      // Extract client context for audit trail
      const ipAddress = req.ip || req.socket.remoteAddress;
      const userAgent = req.get('user-agent');

      logger.info('Login attempt', {
        username: input.username,
        ip: ipAddress,
      });

      // Call auth service to authenticate
      const response = await authService.login(input, ipAddress, userAgent);

      logger.info('Login successful', {
        username: input.username,
        userId: response.profile.userId,
      });

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/auth/refresh
 *
 * DESCRIPTION:
 * - Exchange a refresh token for new access + refresh tokens
 * - Verify user is still active and tenant is not suspended
 * - Implement token rotation strategy (each refresh returns new refresh token)
 * - This allows seamless session continuation without re-login
 *
 * REQUEST BODY:
 * {
 *   "refreshToken": "eyJhbGc..."
 * }
 *
 * SUCCESS RESPONSE (200):
 * {
 *   "status": "success",
 *   "tokens": {
 *     "accessToken": "eyJhbGc...",
 *     "refreshToken": "eyJhbGc...",
 *     "expiresIn": 28800
 *   }
 * }
 *
 * ERROR RESPONSES:
 * - 400: Validation failure
 * - 401: Refresh token expired or invalid
 * - 403: User or tenant not found / inactive
 * - 500: System error
 */
authRouter.post(
  '/refresh',
  validateRequest(refreshTokenSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { refreshToken } = req.body;

      logger.info('Token refresh request received');

      // Call auth service to refresh tokens
      const result = await authService.refreshAccessToken(refreshToken);

      logger.info('Token refresh successful');

      res.status(200).json({
        status: 'success',
        tokens: {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresIn: result.expiresIn,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/auth/logout
 *
 * DESCRIPTION:
 * - Log out the authenticated user
 * - Record logout timestamp in audit history
 * - This is primarily for audit trail purposes (tokens will still be valid until expiry)
 * - Frontend should discard tokens on logout
 *
 * AUTHENTICATION: Required (Bearer JWT in Authorization header)
 *
 * SUCCESS RESPONSE (200):
 * {
 *   "status": "success",
 *   "message": "Logout successful"
 * }
 *
 * ERROR RESPONSES:
 * - 401: Missing or invalid authentication token
 * - 500: Database error during logout
 */
authRouter.post(
  '/logout',
  authenticateTenant,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Extract user context from authenticated request
      if (!req.user) {
        throw new AppError('User context not available', 401);
      }

      logger.info('Logout request received', {
        userId: req.user.userId,
        tenantId: req.user.tenantId,
      });

      // Call auth service to record logout
      await authService.logout(req.user.userId, req.user.tenantId);

      logger.info('User logged out successfully', {
        userId: req.user.userId,
      });

      res.status(200).json({
        status: 'success',
        message: 'Logout successful. Discard tokens on the client.',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/auth/me
 *
 * DESCRIPTION:
 * - Fetch current authenticated user's profile
 * - Verify JWT is still valid
 * - Return user metadata (userId, username, roleId, permissions)
 * - Useful for PWA terminal to confirm session validity on startup
 *
 * AUTHENTICATION: Required (Bearer JWT in Authorization header)
 *
 * SUCCESS RESPONSE (200):
 * {
 *   "status": "success",
 *   "profile": {
 *     "userId": "550e8400-e29b-41d4-a716-446655440000",
 *     "username": "john_owner",
 *     "tenantId": "550e8400-e29b-41d4-a716-446655440001",
 *     "roleId": "550e8400-e29b-41d4-a716-446655440002",
 *     "roleName": "OWNER",
 *     "permissions": ["dashboard.view", "catalog.manage", ...]
 *   }
 * }
 *
 * ERROR RESPONSES:
 * - 401: Missing or invalid authentication token
 * - 500: Database error
 */
authRouter.get(
  '/me',
  authenticateTenant,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('User context not available', 401);
      }

      res.status(200).json({
        status: 'success',
        profile: {
          userId: req.user.userId,
          username: req.user.username,
          tenantId: req.user.tenantId,
          roleId: req.user.roleId,
          roleName: req.user.roleName,
          permissions: req.user.permissions,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default authRouter;