/**
 * @file auth.controller.ts
 * @description HTTP Controller for the Authentication & Identity Domain.
 * @author Daniel Githinji (Dantyz) - Systems Architect
 * * Handles tenant registration, JWT issuance, and the compilation of the 
 * * offline sync snapshot required for the PWA terminal initialization.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { PoolClient } from 'pg';
import { logger } from '../../common/logging/logger';
import { dbPool, withTenantTransaction } from '../../index';

export const authRouter = Router();

// ============================================================================
// 1. ZOD COMPILE-TIME SCHEMAS (Validation Layer)
// ============================================================================
const loginSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters."),
  password: z.string().min(6, "Password must be at least 6 characters.")
});

// ============================================================================
// 2. ROUTE HANDLERS
// ============================================================================

/**
 * POST /api/v1/auth/login
 * @purpose Authenticate user, return JWT tokens, and generate the offline sync snapshot.
 */
authRouter.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  let client: PoolClient | null = null;

  try {
    const { username, password } = loginSchema.parse(req.body);
    client = await dbPool.connect();

    logger.info(`[Auth] Attempting login for user: ${username}`);

    // 1. Fetch User & Tenant Status
    const userResult = await client.query(`
      SELECT 
        u.user_id, u.tenant_id, u.role_id, u.username, u.password_hash, u.is_active,
        b.license_status, b.trade_name
      FROM users u
      JOIN businesses b ON u.tenant_id = b.tenant_id
      WHERE u.username = $1 AND u.is_active = true
    `, [username]);

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials or inactive account.' });
    }

    const user = userResult.rows[0];

    // 2. Verify Argon2id / Bcrypt string
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    // 3. Generate Layer 1 JWT Tokens
    const accessToken = jwt.sign(
      {
        tenant_id: user.tenant_id,
        user_id: user.user_id,
        role_id: user.role_id,
        username: user.username
      },
      process.env.JWT_ACCESS_SECRET!,
      { expiresIn: '8h' } // Short-lived access token
    );

    const refreshToken = jwt.sign(
      { user_id: user.user_id },
      process.env.JWT_REFRESH_SECRET!,
      { expiresIn: '7d' } // Long-lived secure refresh token
    );

    // 4. Compile Offline Sync Snapshot (Products LRU Cache & License State)
    // Runs inside the Layer 2 isolated transaction wrapper to prevent tenant data leakage
    const snapshot = await withTenantTransaction(user.tenant_id, async (txClient) => {
      // Fetch top fastest-moving inventory items for the LRU cache (Top 80%)
      const catalogResult = await txClient.query(`
        SELECT product_id, barcode, name, retail_price, current_quantity 
        FROM products 
        WHERE is_active = true 
        LIMIT 10000
      `);

      return {
        licenseStatus: user.license_status,
        businessName: user.trade_name,
        catalogCache: catalogResult.rows
      };
    });

    logger.info(`[Auth] Login successful. Issuing snapshot for tenant: ${user.tenant_id}`);

    // 5. Response
    res.status(200).json({
      status: 'success',
      tokens: {
        accessToken,
        refreshToken
      },
      profile: {
        userId: user.user_id,
        username: user.username,
        roleId: user.role_id
      },
      offlineSnapshot: snapshot
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ status: 'error', issues: error.errors });
    }
    logger.error(`[Auth] System error during login execution:`, { error });
    next(error);
  } finally {
    if (client) client.release();
  }
});

/**
 * POST /api/v1/auth/register-business
 * @purpose Create tenant, root owner user, and start initial 14-day trial.
 */
authRouter.post('/register-business', async (req: Request, res: Response, next: NextFunction) => {
  // Stubbed for Phase 1 deployment. 
  // Focus remains on bridging the Login -> Offline Sync path first.
  res.status(501).json({ message: "Tenant registration sequence pending implementation." });
});