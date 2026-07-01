/**
 * @file catalog.service.ts
 * @description Domain Service for Catalog Operations.
 * @author Daniel Githinji (Dantyz) - Systems Architect
 * * Executes database transactions for products, ensuring Layer 2 RLS isolation.
 */

import { logger } from '../../common/logging/logger';
import { withTenantTransaction } from '../../index';

interface CreateProductPayload {
  name: string;
  barcode?: string;
  sku?: string;
  unitOfMeasure: string;
  costFloor: number;
  defaultSellingPrice: number;
  categoryId?: string;
}

export class CatalogService {
  /**
   * Inserts a new product into the catalog.
   * @param tenantId UUID of the operating business
   * @param payload Validated product data
   */
  static async createProduct(tenantId: string, payload: CreateProductPayload) {
    return await withTenantTransaction(tenantId, async (client) => {
      const query = `
        INSERT INTO products (
          tenant_id, 
          name, 
          barcode, 
          sku, 
          unit_of_measure, 
          cost_floor, 
          default_selling_price, 
          category_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *;
      `;

      const values = [
        tenantId,
        payload.name,
        payload.barcode || null,
        payload.sku || null,
        payload.unitOfMeasure,
        payload.costFloor,
        payload.defaultSellingPrice,
        payload.categoryId || null
      ];

      const result = await client.query(query, values);
      
      logger.info(`[CatalogService] Product inserted with ID: ${result.rows[0].product_id}`);
      return result.rows[0];
    });
  }
}