// apps/api/src/modules/suppliers/suppliers.service.ts
import { db } from '../../config/database';
import { CreateSupplierDTO } from './suppliers.schema';

export class SuppliersService {
  static async listSuppliers(tenantId: string) {
    return await db.query(`
      SELECT supplier_id, company_name, contact_name, phone_number, created_at, updated_at
      FROM suppliers
      WHERE tenant_id = $1
      ORDER BY company_name ASC;
    `, [tenantId]);
  }

  static async createSupplier(tenantId: string, data: CreateSupplierDTO) {
    const result = await db.query(`
      INSERT INTO suppliers (tenant_id, company_name, contact_name, phone_number)
      VALUES ($1, $2, $3, $4)
      RETURNING supplier_id, company_name, contact_name, phone_number, created_at;
    `, [tenantId, data.company_name, data.contact_name || null, data.phone_number || null]);
    return result.rows[0];
  }
}