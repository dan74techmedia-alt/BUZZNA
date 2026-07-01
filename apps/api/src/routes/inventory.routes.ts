import { Router } from 'express';
import * as inventoryController from '../modules/inventory/inventory.controller';
import { enforceLicenseWriteAccess } from '../common/middleware/license-lockdown.middleware';

const router = Router();

// Read operations for inventory projections (Read-only access is preserved during suspensions)
router.get('/', inventoryController.getInventory);
router.get('/events', inventoryController.getInventoryEvents);

// Append bulk stock items restock event into the authoritative log.
// Directly targets the immutable inventory_events table.
router.post('/restocks', enforceLicenseWriteAccess, inventoryController.processRestock);

// Physical shelf verification counts
router.post('/stock-counts', enforceLicenseWriteAccess, inventoryController.initiateStockCount);
router.post('/stock-counts/:id/approve', enforceLicenseWriteAccess, inventoryController.approveStockCount);

export default router;