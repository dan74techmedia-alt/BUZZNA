// apps/api/src/routes/catalog.routes.ts

import { Router } from 'express';
import { authMiddleware } from '../common/middleware/auth.middleware';
import { rbacMiddleware } from '../common/middleware/rbac.middleware';
import {
  createProduct,
  listProducts,
  updateProduct,
  deleteProduct,
} from '../modules/catalog/catalog.controller';

const router = Router();

router.use(authMiddleware);

// Catalog management (owner/manager only)
router.post('/', rbacMiddleware(['owner', 'manager']), createProduct);
router.get('/', listProducts); // All authenticated users
router.put('/:productId', rbacMiddleware(['owner', 'manager']), updateProduct);
router.delete('/:productId', rbacMiddleware(['owner', 'manager']), deleteProduct);

export default router;