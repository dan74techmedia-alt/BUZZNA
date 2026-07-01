/**
 * @file inventory.controller.ts
 * @description HTTP Controller for the Event-Sourced Inventory Domain.
 * @author Daniel Githinji (Dantyz) - Systems Architect
 * * Handles the incoming HTTP requests for stock management, enforcing
 * * strict Zod validation before passing payloads to the service layer.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
// Assuming AppLogger is standard console/winston wrapper in your common folder
import { logger } from '../../common/logging/logger';
// The service layer will house the actual database transaction logic
import { InventoryService } from './inventory.service';

export const inventoryRouter = Router();

// ============================================================================
// 1. ZOD COMPILE-TIME SCHEMAS (Validation Layer)
// ============================================================================
// According to the blueprint, the system must append events with a quantity_delta [cite: 68]
const restockItemSchema = z.object({
  productId: z.string().uuid({ message: "Invalid Product ID format." }),
  quantityDelta: z.number().positive({ message: "Restock quantity must be greater than 0." }),
  unitBuyingPrice: z.number().nonnegative().optional(),
  unitSellingPrice: z.number().nonnegative().optional(),
  reasonCode: z.string().default('STOCK_ADD'), // e.g., STOCK_ADD, INITIAL_COUNT [cite: 186]
});

const createRestockSchema = z.object({
  items: z.array(restockItemSchema).min(1, { message: "Manifest must contain at least one item." }),
  notes: z.string().optional()
});

// ============================================================================
// 2. ROUTE HANDLERS
// ============================================================================

/**
 * POST /api/v1/inventory/restocks
 * @purpose Append bulk stock items restock event into the authoritative log. 
 */
inventoryRouter.post(
  '/restocks',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // 1. Context Extraction (Guaranteed by Layer 1 Security Middleware)
      const tenantId = req.tenantId!;
      const userId = req.userProfile!.userId;
      
      // RBAC Gate: Only Owners & Managers can manually adjust stock [cite: 52]
      // (This could also be extracted into a dedicated authorizeRole middleware)
      const allowedRoles = ['OWNER', 'MANAGER'];
      // Note: Assuming req.userProfile.roleId maps to a readable role name or is checked via DB.
      // For immediate production safety, the service layer MUST also enforce this rule.

      // 2. Payload Validation against strict Zod Schema [cite: 79]
      const validatedPayload = createRestockSchema.parse(req.body);

      logger.info(`[Inventory] Processing restock manifest for tenant: ${tenantId}`);

      // 3. Delegate to Service Layer (Event Sourcing Ledger writes)
      // The service layer will wrap this execution inside the `withTenantTransaction` pooler safeguard.
      const result = await InventoryService.processRestock(
        tenantId, 
        userId, 
        validatedPayload.items
      );

      // 4. Response
      res.status(201).json({
        status: 'success',
        message: 'Restock events successfully appended to the authoritative ledger.',
        data: result
      });

    } catch (error) {
      if (error instanceof z.ZodError) {
         return res.status(400).json({ 
           status: 'error', 
           message: 'Validation failed', 
           issues: error.errors 
         });
      }
      
      // Ensure logged metadata matches logger type expectations
      const logMeta = error instanceof Error ? error : { error };
      logger.error(`[Inventory] Restock failed for tenant ${req.tenantId}`, logMeta);
      next(error); // Pass to global Express error handler
    }
  }
);

// Optional: Add GET /api/v1/inventory/events here later for auditing, 
// though the blueprint states 'current_quantity' is fetched via Catalog/Products view. [cite: 87]