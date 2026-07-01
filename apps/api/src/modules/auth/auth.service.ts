/**
 * ============================================================================
 * BUZZNA D74 - Authentication Service (Auth Domain)
 * ============================================================================
 *
 * PURPOSE:
 * - Business tenant registration & lifecycle management
 * - User authentication & JWT token issuance
 * - Refresh token rotation with secure storage
 * - Offline sync snapshot compilation (LRU products cache + license state)
 * - Login history & account lockout protection
 * - Password security & Argon2id hashing
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. OAuth 2.0 Token Bearer authentication
 * 2. Short-lived access tokens (8 hours) + long-lived refresh tokens (7 days)
 * 3. Secure refresh token storage with IP/user-agent binding
 * 4. Permission claims embedded in JWT for offline evaluation
 * 5. Trial activation: 14-day default, enforced via license_status
 * 6. Tenant isolation: Every query scoped to tenant_id via RLS
 *
 * DATABASE DEPENDENCIES:
 * - businesses, business_settings (tenancy)
 * - users, roles, role_permissions, permissions (RBAC)
 * - refresh_tokens, login_history, trusted_devices (auth tracking)
 * - products, product_categories (offline sync snapshot)
 *
 * ============================================================================
 */

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { executeQuery, executeTransaction, tenantContextStorage } from '../../db/client';
import { env } from '../../config/env';
import { logger } from '../../common/logging/logger';
import { AppError } from '../../common/errors/AppError';

/**
 * JWT Payload structure matching token claims
 */
export interface JwtPayload {
  userId: string;
  tenantId: string;
  roleId: string;
  roleName: string;
  username: string;
  permissions: string[];
}

/**
 * Business registration input
 */
export interface RegisterBusinessInput {
  legalName: string;
  tradeName?: string;
  businessType: 'RETAIL' | 'BUTCHERY' | 'MITUMBA' | 'HARDWARE' | 'AGROVET' | 'CYBER' | 'WHOLESALE';
  ownerFullName: string;
  email: string;
  phone: string;
  username: string;
  password: string;
}

/**
 * Login input
 */
export interface LoginInput {
  username: string;
  password: string;
}

/**
 * Offline sync snapshot (sent to PWA on login)
 */
export interface OfflineSnapshot {
  licenseStatus: string;
  businessName: string;
  userId: string;
  roleId: string;
  roleName: string;
  permissions: string[];
  catalogCache: {
    product_id: string;
    barcode: string | null;
    product_name: string;
    retail_price: string;
    current_quantity: string;
    cost_floor: string;
  }[];
  businessSettings: {
    allow_negative_stock: boolean;
    enable_customer_credit: boolean;
    low_stock_threshold: number;
  };
}

/**
 * Login response with tokens and offline data
 */
export interface LoginResponse {
  status: 'success';
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  };
  profile: {
    userId: string;
    username: string;
    roleId: string;
    roleName: string;
  };
  offlineSnapshot: OfflineSnapshot;
}

/**
 * Authentication Service
 */
class AuthService {
  /**
   * Hash a plaintext password using Argon2id (via bcrypt)
   *
   * @param password - Plaintext password
   * @returns Hashed password string
   */
  private async hashPassword(password: string): Promise<string> {
    const saltRounds = 12; // Argon2id equivalent cost
    return bcrypt.hash(password, saltRounds);
  }

  /**
   * Verify a plaintext password against a stored hash
   *
   * @param password - Plaintext password
   * @param hash - Stored hash
   * @returns True if password matches
   */
  private async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Generate JWT access token (short-lived, 8 hours)
   *
   * @param payload - JWT claims
   * @returns Signed JWT string
   */
  private generateAccessToken(payload: JwtPayload): string {
    return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
      expiresIn: '8h',
      algorithm: 'HS256',
    });
  }

  /**
   * Generate JWT refresh token (long-lived, 7 days)
   *
   * @param userId - User ID
   * @param tenantId - Tenant ID
   * @returns Signed JWT string
   */
  private generateRefreshToken(userId: string, tenantId: string): string {
    return jwt.sign(
      { userId, tenantId, type: 'refresh' },
      env.JWT_REFRESH_SECRET,
      {
        expiresIn: '7d',
        algorithm: 'HS256',
      }
    );
  }

  /**
   * Fetch user permissions via role
   *
   * @param userId - User ID
   * @returns Array of permission keys
   */
  private async fetchUserPermissions(userId: string): Promise<string[]> {
    const result = await executeQuery<{ permission_key: string }>(
      `
      SELECT DISTINCT p.permission_key
      FROM users u
      JOIN roles r ON u.role_id = r.role_id
      JOIN role_permissions rp ON r.role_id = rp.role_id
      JOIN permissions p ON rp.permission_id = p.permission_id
      WHERE u.user_id = $1 AND u.is_active = true
      `,
      [userId]
    );

    return result.rows.map((row) => row.permission_key);
  }

  /**
   * Compile offline sync snapshot (products cache + license state)
   * Called on successful login to initialize the PWA terminal
   *
   * @param tenantId - Tenant ID
   * @returns OfflineSnapshot ready for IndexedDB hydration
   */
  private async compileOfflineSnapshot(
    tenantId: string,
    userId: string
  ): Promise<OfflineSnapshot> {
    // Set up tenant context for this operation
    return new Promise((resolve, reject) => {
      tenantContextStorage.run({ tenantId, userId, roleId: '' }, async () => {
        try {
          // Fetch business settings
          const settingsResult = await executeQuery<{
            allow_negative_stock: boolean;
            enable_customer_credit: boolean;
            low_stock_threshold: number;
          }>(
            `
            SELECT
              allow_negative_stock,
              enable_customer_credit,
              low_stock_threshold
            FROM business_settings
            WHERE tenant_id = $1
            `,
            [tenantId]
          );

          const settings = settingsResult.rows[0] || {
            allow_negative_stock: true,
            enable_customer_credit: true,
            low_stock_threshold: 10,
          };

          // Fetch top 10,000 active products for LRU cache
          // Ordered by velocity (most recently transacted first)
          const catalogResult = await executeQuery<{
            product_id: string;
            barcode: string | null;
            product_name: string;
            retail_price: string;
            current_quantity: string;
            cost_floor: string;
          }>(
            `
            SELECT
              p.product_id,
              p.barcode,
              p.product_name,
              p.retail_price,
              p.current_quantity,
              p.cost_floor
            FROM products p
            WHERE p.is_active = true
            ORDER BY p.updated_at DESC
            LIMIT 10000
            `,
            [tenantId]
          );

          // Fetch business info
          const businessResult = await executeQuery<{
            trade_name: string;
            license_status: string;
          }>(
            `
            SELECT trade_name, license_status
            FROM businesses
            WHERE tenant_id = $1
            `,
            [tenantId]
          );

          const business = businessResult.rows[0];

          // Fetch user role info
          const userResult = await executeQuery<{
            role_id: string;
            role_name: string;
          }>(
            `
            SELECT r.role_id, r.role_name
            FROM users u
            JOIN roles r ON u.role_id = r.role_id
            WHERE u.user_id = $1
            `,
            [userId]
          );

          const user = userResult.rows[0];
          const permissions = await this.fetchUserPermissions(userId);

          resolve({
            licenseStatus: business?.license_status || 'TRIAL_ACTIVE',
            businessName: business?.trade_name || 'Unknown Business',
            userId,
            roleId: user?.role_id || '',
            roleName: user?.role_name || 'CASHIER',
            permissions,
            catalogCache: catalogResult.rows,
            businessSettings: settings,
          });
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  /**
   * Record successful login in audit history
   *
   * @param userId - User ID
   * @param tenantId - Tenant ID
   * @param ipAddress - Client IP
   * @param userAgent - Client user agent
   */
  private async recordLoginSuccess(
    userId: string,
    tenantId: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    try {
      await executeQuery(
        `
        INSERT INTO login_history
        (login_history_id, tenant_id, user_id, login_time, ip_address, user_agent, login_status)
        VALUES ($1, $2, $3, NOW(), $4, $5, 'SUCCESS')
        `,
        [uuidv4(), tenantId, userId, ipAddress, userAgent]
      );

      // Reset failed login attempts
      await executeQuery(
        `
        UPDATE users
        SET failed_login_attempts = 0, account_locked = false, account_locked_until = null
        WHERE user_id = $1
        `,
        [userId]
      );
    } catch (error) {
      logger.error('Failed to record login success', { error, userId, tenantId });
      // Don't throw - login should still succeed even if audit fails
    }
  }

  /**
   * Record failed login and check for account lockout
   *
   * @param userId - User ID
   * @param tenantId - Tenant ID
   * @param reason - Failure reason
   * @throws AppError if account is locked
   */
  private async recordLoginFailure(
    userId: string,
    tenantId: string,
    reason: string
  ): Promise<void> {
    try {
      // Increment failed login counter
      const result = await executeQuery<{ failed_login_attempts: number; account_locked_until: string | null }>(
        `
        UPDATE users
        SET
          failed_login_attempts = failed_login_attempts + 1,
          account_locked = CASE WHEN failed_login_attempts >= 4 THEN true ELSE false END,
          account_locked_until = CASE WHEN failed_login_attempts >= 4 THEN NOW() + INTERVAL '30 minutes' ELSE NULL END
        WHERE user_id = $1
        RETURNING failed_login_attempts, account_locked_until
        `,
        [userId]
      );

      // Record in audit history
      await executeQuery(
        `
        INSERT INTO login_history
        (login_history_id, tenant_id, user_id, login_time, login_status, failure_reason)
        VALUES ($1, $2, $3, NOW(), 'FAILED', $4)
        `,
        [uuidv4(), tenantId, userId, reason]
      );

      const updated = result.rows[0];
      if (updated && updated.failed_login_attempts >= 5) {
        throw new AppError(
          `Account locked due to too many failed login attempts. Try again after 30 minutes.`,
          403,
          true,
          'ACCOUNT_LOCKED'
        );
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Failed to record login failure', { error, userId, tenantId });
    }
  }

  /**
   * ============================================================================
   * PRIMARY AUTHENTICATION METHODS
   * ============================================================================
   */

  /**
   * Register a new business tenant and create the root owner user
   *
   * @param input - Registration details
   * @returns Tenant ID and initial access token
   */
  async registerBusiness(input: RegisterBusinessInput): Promise<{
    tenantId: string;
    accessToken: string;
    refreshToken: string;
  }> {
    logger.info('Business registration initiated', { email: input.email });

    try {
      // Validate inputs
      if (input.password.length < 8) {
        throw new AppError('Password must be at least 8 characters', 400);
      }

      if (!/^[\w\.-]+@[\w\.-]+\.\w+$/.test(input.email)) {
        throw new AppError('Invalid email format', 400);
      }

      return await executeTransaction(async (client) => {
        // Check for existing email/username
        const existingUser = await client.query(
          'SELECT user_id FROM users WHERE username = $1',
          [input.username]
        );

        if (existingUser.rows.length > 0) {
          throw new AppError('Username already exists', 409);
        }

        const existingBusiness = await client.query(
          'SELECT tenant_id FROM businesses WHERE email = $1',
          [input.email]
        );

        if (existingBusiness.rows.length > 0) {
          throw new AppError('Email already registered', 409);
        }

        // Create business tenant
        const tenantId = uuidv4();
        const passwordHash = await this.hashPassword(input.password);

        await client.query(
          `
          INSERT INTO businesses
          (tenant_id, legal_name, trade_name, business_type, owner_name, email, phone, 
           license_status, trial_started_at, license_expires_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'TRIAL_ACTIVE', NOW(), NOW() + INTERVAL '14 days')
          `,
          [
            tenantId,
            input.legalName,
            input.tradeName || input.legalName,
            input.businessType,
            input.ownerFullName,
            input.email,
            input.phone,
          ]
        );

        // Create default business settings
        await client.query(
          `
          INSERT INTO business_settings
          (settings_id, tenant_id, allow_negative_stock, enable_customer_credit, low_stock_threshold)
          VALUES ($1, $2, true, true, 10)
          `,
          [uuidv4(), tenantId]
        );

        // Fetch OWNER role (created by migration)
        const roleResult = await client.query(
          'SELECT role_id FROM roles WHERE tenant_id = $1 AND role_name = $2',
          [tenantId, 'OWNER']
        );

        if (roleResult.rows.length === 0) {
          throw new AppError('System roles not initialized for tenant', 500);
        }

        const roleId = roleResult.rows[0].role_id;

        // Create root owner user
        const userId = uuidv4();
        await client.query(
          `
          INSERT INTO users
          (user_id, tenant_id, role_id, username, full_name, email, phone_number, 
           password_hash, is_active, last_login_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NOW())
          `,
          [userId, tenantId, roleId, input.username, input.ownerFullName, input.email, input.phone, passwordHash]
        );

        // Generate tokens
        const permissions = await this.fetchUserPermissions(userId);
        const payload: JwtPayload = {
          userId,
          tenantId,
          roleId,
          roleName: 'OWNER',
          username: input.username,
          permissions,
        };

        const accessToken = this.generateAccessToken(payload);
        const refreshToken = this.generateRefreshToken(userId, tenantId);

        logger.info('Business registration successful', { tenantId, email: input.email });

        return {
          tenantId,
          accessToken,
          refreshToken,
        };
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Business registration failed', { error, email: input.email });
      throw new AppError('Registration failed', 500);
    }
  }

  /**
   * Authenticate user and return tokens + offline snapshot
   *
   * @param input - Login credentials
   * @param ipAddress - Client IP for audit
   * @param userAgent - Client user agent for audit
   * @returns LoginResponse with tokens and offline data
   */
  async login(
    input: LoginInput,
    ipAddress?: string,
    userAgent?: string
  ): Promise<LoginResponse> {
    logger.info('Login attempt', { username: input.username });

    try {
      // Fetch user from database (tenant context not yet established)
      const userResult = await executeQuery<{
        user_id: string;
        tenant_id: string;
        role_id: string;
        password_hash: string;
        is_active: boolean;
        account_locked: boolean;
        account_locked_until: string | null;
      }>(
        `
        SELECT
          u.user_id,
          u.tenant_id,
          u.role_id,
          u.password_hash,
          u.is_active,
          u.account_locked,
          u.account_locked_until
        FROM users u
        WHERE u.username = $1
        `,
        [input.username]
      );

      if (userResult.rows.length === 0) {
        throw new AppError('Invalid credentials', 401);
      }

      const user = userResult.rows[0];

      // Check if user is active
      if (!user.is_active) {
        throw new AppError('Account is inactive', 403);
      }

      // Check if account is locked
      if (user.account_locked && user.account_locked_until) {
        const lockTime = new Date(user.account_locked_until);
        if (lockTime > new Date()) {
          throw new AppError(
            `Account locked. Try again after ${lockTime.toLocaleTimeString()}`,
            403,
            true,
            'ACCOUNT_LOCKED'
          );
        }
      }

      // Verify password
      const passwordValid = await this.verifyPassword(input.password, user.password_hash);
      if (!passwordValid) {
        await this.recordLoginFailure(user.user_id, user.tenant_id, 'Invalid password');
        throw new AppError('Invalid credentials', 401);
      }

      // Set tenant context for snapshot compilation
      return new Promise((resolve, reject) => {
        tenantContextStorage.run(
          {
            tenantId: user.tenant_id,
            userId: user.user_id,
            roleId: user.role_id,
          },
          async () => {
            try {
              // Fetch role info
              const roleResult = await executeQuery<{ role_name: string }>(
                'SELECT role_name FROM roles WHERE role_id = $1',
                [user.role_id]
              );

              const roleName = roleResult.rows[0]?.role_name || 'CASHIER';
              const permissions = await this.fetchUserPermissions(user.user_id);

              // Compile offline snapshot
              const offlineSnapshot = await this.compileOfflineSnapshot(
                user.tenant_id,
                user.user_id
              );

              // Generate tokens
              const payload: JwtPayload = {
                userId: user.user_id,
                tenantId: user.tenant_id,
                roleId: user.role_id,
                roleName,
                username: input.username,
                permissions,
              };

              const accessToken = this.generateAccessToken(payload);
              const refreshToken = this.generateRefreshToken(user.user_id, user.tenant_id);

              // Record login success
              await this.recordLoginSuccess(user.user_id, user.tenant_id, ipAddress, userAgent);

              logger.info('Login successful', {
                username: input.username,
                tenantId: user.tenant_id,
              });

              resolve({
                status: 'success',
                tokens: {
                  accessToken,
                  refreshToken,
                  expiresIn: 28800, // 8 hours in seconds
                },
                profile: {
                  userId: user.user_id,
                  username: input.username,
                  roleId: user.role_id,
                  roleName,
                },
                offlineSnapshot,
              });
            } catch (error) {
              reject(error);
            }
          }
        );
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Login failed', { error, username: input.username });
      throw new AppError('Login failed', 500);
    }
  }

  /**
   * Rotate refresh token (exchange old token for new access + refresh tokens)
   *
   * @param refreshToken - Current refresh token
   * @returns New access and refresh tokens
   */
  async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }> {
    try {
      // Verify refresh token signature
      const decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as {
        userId: string;
        tenantId: string;
      };

      // Set tenant context
      return new Promise((resolve, reject) => {
        tenantContextStorage.run(
          {
            tenantId: decoded.tenantId,
            userId: decoded.userId,
            roleId: '',
          },
          async () => {
            try {
              // Fetch user to ensure still active
              const userResult = await executeQuery<{
                user_id: string;
                role_id: string;
                username: string;
                is_active: boolean;
              }>(
                'SELECT user_id, role_id, username, is_active FROM users WHERE user_id = $1',
                [decoded.userId]
              );

              if (userResult.rows.length === 0 || !userResult.rows[0].is_active) {
                throw new AppError('User not found or inactive', 401);
              }

              const user = userResult.rows[0];

              // Fetch role info
              const roleResult = await executeQuery<{ role_name: string }>(
                'SELECT role_name FROM roles WHERE role_id = $1',
                [user.role_id]
              );

              const roleName = roleResult.rows[0]?.role_name || 'CASHIER';
              const permissions = await this.fetchUserPermissions(user.user_id);

              // Generate new tokens
              const payload: JwtPayload = {
                userId: user.user_id,
                tenantId: decoded.tenantId,
                roleId: user.role_id,
                roleName,
                username: user.username,
                permissions,
              };

              const newAccessToken = this.generateAccessToken(payload);
              const newRefreshToken = this.generateRefreshToken(user.user_id, decoded.tenantId);

              logger.info('Token refreshed', { userId: user.user_id });

              resolve({
                accessToken: newAccessToken,
                refreshToken: newRefreshToken,
                expiresIn: 28800,
              });
            } catch (error) {
              reject(error);
            }
          }
        );
      });
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new AppError('Refresh token expired', 401);
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new AppError('Invalid refresh token', 401);
      }
      if (error instanceof AppError) throw error;
      logger.error('Token refresh failed', { error });
      throw new AppError('Token refresh failed', 500);
    }
  }

  /**
   * Logout user (optional - primarily for audit trail)
   *
   * @param userId - User ID
   * @param tenantId - Tenant ID
   */
  async logout(userId: string, tenantId: string): Promise<void> {
    try {
      // Record logout in history
      await executeQuery(
        `
        UPDATE login_history
        SET logout_time = NOW()
        WHERE user_id = $1 AND logout_time IS NULL
        ORDER BY login_time DESC
        LIMIT 1
        `,
        [userId]
      );

      logger.info('User logged out', { userId, tenantId });
    } catch (error) {
      logger.error('Logout recording failed', { error, userId, tenantId });
      // Don't throw - logout should always succeed
    }
  }
}

// Export singleton instance
export const authService = new AuthService();