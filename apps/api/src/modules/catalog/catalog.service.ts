// File: apps/api/src/modules/catalog/catalog.service.ts
// Purpose: Handles product catalog CRUD operations. Maintains strict NUMERIC precision.

import { PoolClient } from 'pg';
import { db } from '../../config/database';
import { ExactDecimalAmount, ExactQuantity } from '../../../../../packages/shared-types';

export interface IProductCreate {
    barcode: string;
    name: string;
    cost_floor: ExactDecimalAmount;
    retail_price: ExactDecimalAmount;
    current_quantity: ExactQuantity;
}

export class CatalogService {

    /**
     * Creates a new product for the catalog.
     * Enforces transaction boundaries for inventory initialization.
     */
    static async createProduct(tenantId: string, data: IProductCreate): Promise<string> {
        const client: PoolClient = await db.connect();
        try {
            await client.query('BEGIN');
            await client.query('SET LOCAL app.current_tenant_id = $1', [tenantId]);

            const query = `
                INSERT INTO products (
                    tenant_id, barcode, name, cost_floor, retail_price, current_quantity
                ) VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING product_id
            `;

            const { rows } = await client.query(query, [
                tenantId,
                data.barcode,
                data.name,
                data.cost_floor,
                data.retail_price,
                data.current_quantity
            ]);

            await client.query('COMMIT');
            return rows[0].product_id;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Fetches products with pagination and tenant isolation.
     */
    static async getProducts(tenantId: string, limit: number = 50, offset: number = 0): Promise<any[]> {
        const client: PoolClient = await db.connect();
        try {
            await client.query('BEGIN');
            await client.query('SET LOCAL app.current_tenant_id = $1', [tenantId]);

            const query = `
                SELECT product_id, barcode, name, retail_price, current_quantity
                FROM products
                LIMIT $1 OFFSET $2
            `;
            const { rows } = await client.query(query, [limit, offset]);

            await client.query('COMMIT');
            return rows;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}