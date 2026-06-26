import { Request, Response, Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { db } from '../../config/database';
import { env } from '../../config/env';
import { registerBusinessSchema, loginSchema } from './auth.schema';

export const authRouter = Router();

authRouter.post('/register-business', async (req: Request, res: Response) => {
  try {
    const data = registerBusinessSchema.parse(req.body);
    const hashedPassword = await bcrypt.hash(data.password, 12); // Argon2/Bcrypt requirement

    // We use a raw transaction here because we are establishing the tenant, 
    // so we cannot wrap it in the RLS middleware yet.
    const result = await db.transaction().execute(async (trx) => {
      // 1. Create the Business (Tenant)
      const business = await trx.insertInto('businesses')
        .values({
          legal_name: data.legalName,
          trade_name: data.tradeName || null,
          onboarding_segment: data.onboardingSegment,
          license_status: 'TRIAL_ACTIVE',
          license_expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14-day trial
        })
        .returning('tenant_id')
        .executeTakeFirstOrThrow();

      // 2. Create the Owner Role (System Default)
      const role = await trx.insertInto('roles')
        .values({
          tenant_id: business.tenant_id,
          role_name: 'Owner',
          is_system_default: true,
        })
        .returning('role_id')
        .executeTakeFirstOrThrow();

      // 3. Create the Owner User Account
      const user = await trx.insertInto('users')
        .values({
          tenant_id: business.tenant_id,
          role_id: role.role_id,
          username: data.username,
          password_hash: hashedPassword,
          full_name: data.ownerFullName,
          is_active: true,
        })
        .returning(['user_id', 'username'])
        .executeTakeFirstOrThrow();

      return { tenantId: business.tenant_id, userId: user.user_id };
    });

    res.status(201).json({ message: 'Business registered successfully', data: result });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Registration failed' });
  }
});

authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = loginSchema.parse(req.body);

    const user = await db.selectFrom('users')
      .selectAll()
      .where('username', '=', username)
      .where('is_active', '=', true)
      .executeTakeFirst();

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate short-lived Access Token
    const accessToken = jwt.sign(
      { userId: user.user_id, tenantId: user.tenant_id, roleId: user.role_id },
      env.JWT_ACCESS_SECRET,
      { expiresIn: '1h' }
    );

    // Generate Refresh Token
    const refreshToken = jwt.sign(
      { userId: user.user_id },
      env.JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    // Store refresh token in DB mapped to user
    await db.insertInto('refresh_tokens')
      .values({
        user_id: user.user_id,
        token_hash: await bcrypt.hash(refreshToken, 10),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
      .execute();

    res.status(200).json({
      accessToken,
      refreshToken, // In production, this should be set as an HttpOnly cookie
      user: { id: user.user_id, name: user.full_name, tenantId: user.tenant_id }
    });
  } catch (error: any) {
    res.status(400).json({ error: 'Login failed' });
  }
});