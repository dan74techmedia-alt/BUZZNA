// apps/api/src/modules/catalog/catalog.service.ts

import { executeIsolatedTenantQuery, executeIsolatedTenantTransaction } from '../../db/client';
import { AppError } from '../../common/errors/AppError';
import { logger } from '../../common/logging/logger';

export interface ProductData {
  barcode?: string;
  name: string;
  category_id?: string;
  cost_floor: number;
  retail_price: number;
}

export class CatalogService {
  /**
   * Creates a new product catalog item. 
   * Initial current_quantity is implicitly 0 until an inventory_event (e.g., STOCK_ADD) is recorded.
   */
  static async createProduct(tenantId: string, productData: ProductData) {
    return executeIsolatedTenantTransaction(tenantId, async (client) => {
      // 1. Verify barcode uniqueness within the tenant's catalog
      if (productData.barcode) {
        const checkQuery = `SELECT product_id FROM products WHERE tenant_id = $1 AND barcode = $2 LIMIT 1;`;
        const checkResult = await client.query(checkQuery, [tenantId, productData.barcode]);
        if (checkResult.rows.length > 0) {
          throw new AppError('A product with this barcode already exists in your catalog.', 409);
        }
      }

      // 2. Insert the product with strict decimal numeric casting
      const insertQuery = `
        INSERT INTO products (tenant_id, barcode, name, category_id, cost_floor, retail_price, current_quantity)
        VALUES ($1, $2, $3, $4, $5, $6, 0)
        RETURNING product_id, barcode, name, cost_floor, retail_price, current_quantity, created_at;
      `;
      
      const values = [
        tenantId,
        productData.barcode || null,
        productData.name,
        productData.category_id || null,
        productData.cost_floor,
        productData.retail_price
      ];

      const result = await client.query(insertQuery, values);
      logger.info(`Product [${result.rows[0].product_id}] created successfully for Tenant ID: ${tenantId}`);
      return result.rows[0];
    });
  }

  /**
   * Retrieves the catalog for local caching operations (LRU strategies on low-end devices).
   */
  static async getCatalog(tenantId: string, limit = 1000, offset = 0) {
    return executeIsolatedTenantQuery(tenantId, async (client) => {
      const query = `
        SELECT product_id, barcode, name, category_id, cost_floor, retail_price, current_quantity, updated_at
        FROM products 
        WHERE tenant_id = $1
        ORDER BY name ASC
        LIMIT $2 OFFSET $3;
      `;
      const result = await client.query(query, [tenantId, limit, offset]);
      return result.rows;
    });
  }
  
  /**
   * Updates basic catalog metadata (Name, Pricing). 
   * Strictly ignores current_quantity modifications.
   */
  static async updateProductPricing(tenantId: string, productId: string, retailPrice: number, costFloor: number) {
    return executeIsolatedTenantTransaction(tenantId, async (client) => {
      if (retailPrice < costFloor) {
        throw new AppError('Retail price cannot be set below the established cost floor.', 400);
      }

      const query = `
        UPDATE products 
        SET retail_price = $1, cost_floor = $2, updated_at = NOW()
        WHERE tenant_id = $3 AND product_id = $4
        RETURNING product_id, retail_price, cost_floor;
      `;
      const result = await client.query(query, [retailPrice, costFloor, tenantId, productId]);
      
      if (result.rows.length === 0) {
        throw new AppError('Product not found or access restricted.', 404);
      }
      return result.rows[0];
    });
  }
}