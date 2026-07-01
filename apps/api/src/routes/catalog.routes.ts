import { Router } from 'express';
import * as catalogController from '../modules/catalog/catalog.controller';
import { enforceLicenseWriteAccess } from '../common/middleware/license-lockdown.middleware';

const router = Router();

// Get catalog items (Read operations remain available even if payment is due)
router.get('/', catalogController.getProducts);
router.get('/:id', catalogController.getProductById);
router.get('/categories', catalogController.getCategories);

// Create catalog item. Requires catalog.manage permission rule and active license
router.post('/', enforceLicenseWriteAccess, catalogController.createProduct);
router.put('/:id', enforceLicenseWriteAccess, catalogController.updateProduct);

// Category Management
router.post('/categories', enforceLicenseWriteAccess, catalogController.createCategory);
router.put('/categories/:id', enforceLicenseWriteAccess, catalogController.updateCategory);

export default router;