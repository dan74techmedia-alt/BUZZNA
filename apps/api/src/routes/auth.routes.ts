// apps/api/src/routes/auth.routes.ts

import { Router } from 'express';
import {
  registerBusiness,
  login,
  refreshToken,
  logout,
} from '../modules/auth/auth.controller';

const router = Router();

// Public endpoints
router.post('/register', registerBusiness);
router.post('/login', login);
router.post('/refresh', refreshToken);

// Protected endpoint
router.post('/logout', logout);

export default router;