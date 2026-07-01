/**
 * @file catalog.controller.ts
 * @description HTTP Controller for the Catalog & Product Management Domain.
 * @author Daniel Githinji (Dantyz) - Systems Architect
 * * Owns item listings and metadata. Strictly banned from altering stock quantities.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { logger } from '../../common/logging/logger';
import { CatalogService } from './catalog.service';

export const catalogRouter = Router();

// ============================================================================
// 1. ZOD COMPILE-TIME SCHEMAS (Validation Layer)
// ============================================================================
const createProductSchema = z.object({
  name: z.string().min(2, "Product name must be at least 2 characters."),
  barcode: z.string().optional(),
  sku: z.string().optional(),
  unitOfMeasure: z.string().default('Pcs'),
  costFloor: z.number().nonnegative("Cost floor cannot be negative."),
  defaultSellingPrice: z.number().nonnegative("Selling price cannot be negative."),
  categoryId: z.string().uuid("Invalid Category ID format.").optional()
});

// ============================================================================
// 2. ROUTE HANDLERS
// ============================================================================

/**
 * POST /api/v1/products
 * @purpose Create a new catalog item.
 */
catalogRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId!; // Context bound globally by Layer 1 Security
    
    // Validate request payload
    const validatedData = createProductSchema.parse(req.body);

    logger.info(`[Catalog] Creating new product '${validatedData.name}' for tenant: ${tenantId}`);

    // Map validated payload to domain service contract
    const productPayload = {
      name: validatedData.name,
      barcode: validatedData.barcode,
      sku: validatedData.sku,
      unitOfMeasure: validatedData.unitOfMeasure,
      // Align with CreateProductPayload expected property names
      costFloor: validatedData.costFloor,
      defaultSellingPrice: validatedData.defaultSellingPrice,
      categoryId: validatedData.categoryId
    };

    // Delegate database execution to the Domain Service
    const newProduct = await CatalogService.createProduct(tenantId, productPayload);

    res.status(201).json({
      status: 'success',
      message: 'Catalog item created successfully.',
      data: newProduct
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Validation failed', 
        issues: error.errors 
      });
    }
    
    logger.error(`[Catalog] Failed to create product for tenant ${req.tenantId}`, { error });
    next(error);
  }
});