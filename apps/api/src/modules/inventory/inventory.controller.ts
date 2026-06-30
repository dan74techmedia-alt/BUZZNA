// File: apps/api/src/modules/inventory/inventory.controller.ts
// Purpose: Exposes inventory management endpoints to the frontend.

import { Request, Response } from 'express';
import { InventoryService } from './inventory.service';
import { ITenantContext } from '../../../../packages/shared-types';

export class InventoryController {
    
    static async handleStockAdjustment(req: Request, res: Response) {
        const { tenantId } = req.body.context as ITenantContext;
        const { product_id, event_type, quantity_delta, reason } = req.body;

        try {
            await InventoryService.recordEvent(tenantId, {
                product_id,
                event_type,
                quantity_delta,
                reason
            });
            
            res.status(201).json({ success: true, message: 'Inventory event recorded successfully.' });
        } catch (error) {
            res.status(400).json({ success: false, error: (error as Error).message });
        }
    }

    static async getHistory(req: Request, res: Response) {
        const { tenantId } = req.body.context as ITenantContext;
        const { productId } = req.params;

        try {
            const history = await InventoryService.getEventHistory(tenantId, productId);
            res.json({ success: true, data: history });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Failed to fetch event history.' });
        }
    }
}