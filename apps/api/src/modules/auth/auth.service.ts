/**
 * File: apps/api/src/modules/auth/auth.service.ts
 * Description: Core authentication logic, business registration, and JWT token issuance.
 * Enforces Layer 1 Middleware Context Rules and 14-day trial initiation.
 */

import jwt from 'jsonwebtoken';
import argon2 from 'argon2';
import { v4 as uuidv4 } from 'uuid';
// Note: Assuming a generic db connection instance based on the modular structure
import { db } from '../../config/database'; 

// Environment mapping (Ensure these are validated via Zod in bootstrap/load-env.ts)
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'fallback_secret_do_not_use_in_prod';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'fallback_refresh_do_not_use_in_prod';

export class AuthService {
  /**
   * Registers a new tenant business, creates the root owner, and starts the 14-day trial.
   */
  static async registerBusiness(payload: any) {
    const { legal_name, phone_number, username, password } = payload;
    const tenantId = uuidv4();
    const userId = uuidv4();

    // Cryptographic hash for user password
    const passwordHash = await argon2.hash(password);

    // Calculate trial expiration (now + 14 days)
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + 14);

    // We execute this as a transaction to ensure tenant and initial user are created together
    await db.transaction(async (trx: any) => {
      // 1. Create Tenant (Business)
      await trx.query(`
        INSERT INTO businesses (tenant_id, legal_name, license_status, license_expires_at)
        VALUES ($1, $2, 'TRIAL_ACTIVE', $3)
      `, [tenantId, legal_name, expirationDate]);

      // 2. Create Owner User
      // Note: role_id would normally be fetched from RBAC seeds. Hardcoding standard UUID for simplicity in this structural gap.
      const ownerRoleId = uuidv4(); 
      
      await trx.query(`
        INSERT INTO users (user_id, tenant_id, role_id, username, password_hash, phone_number, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, true)
      `, [userId, tenantId, ownerRoleId, username, passwordHash, phone_number]);
      
      // 3. Initialize Settings
      await trx.query(`
        INSERT INTO business_settings (tenant_id, application_theme, cash_drawer_variance_limit, enforce_blind_close)
        VALUES ($1, 'Savannah Premium', 100.00, true)
      `, [tenantId]);
    });

    // Generate Initial Tokens
    return this.generateTokens(userId, tenantId);
  }

  /**
   * Authenticates a user and returns JWT tokens along with an offline sync snapshot indicator.
   */
  static async login(payload: any) {
    const { username, password } = payload;

    // Fetch user and explicitly bypass RLS here since we don't have the tenant context yet
    const result = await db.query(`
      SELECT user_id, tenant_id, password_hash, is_active 
      FROM users WHERE username = $1
    `, [username]);

    if (result.rows.length === 0) {
      throw new Error('Invalid credentials');
    }

    const user = result.rows[0];

    if (!user.is_active) {
      throw new Error('User account is disabled');
    }

    // Verify Password
    const isValid = await argon2.verify(user.password_hash, password);
    if (!isValid) {
      throw new Error('Invalid credentials');
    }

    return this.generateTokens(user.user_id, user.tenant_id);
  }

  /**
   * Generates the cryptographically signed Bearer JWTs used by Layer 1 Middleware Context Enforcement.
   */
  private static generateTokens(userId: string, tenantId: string) {
    // Access Token: Short-lived, contains tenant_id claim for RLS injection
    const accessToken = jwt.sign(
      { userId, tenantId },
      JWT_ACCESS_SECRET,
      { expiresIn: '1h' }
    );

    // Refresh Token: Long-lived, used to rotate the access token
    const refreshToken = jwt.sign(
      { userId, tenantId },
      JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 3600,
      token_type: 'Bearer',
      tenant_id: tenantId // Explicitly returned so client can bind IndexedDB caches to it
    };
  }

  /**
   * Validates a token and extracts the payload. Used by the authentication middleware.
   */
  static verifyToken(token: string) {
    try {
      return jwt.verify(token, JWT_ACCESS_SECRET) as { userId: string, tenantId: string };
    } catch (error) {
      throw new Error('Unauthorized: Invalid or expired token');
    }
  }
}