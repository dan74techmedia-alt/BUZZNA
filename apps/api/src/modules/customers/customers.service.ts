// apps/api/src/modules/customers/customers.service.ts
import { db } from '../../config/database';
import { CreateCustomerDTO, UpdateCustomerDTO, RecordRepaymentDTO } from './customers.schema';

export class CustomersService {
  /**
   * Retrieves all customers and their current debt balance.
   */
  static async listCustomers(tenantId: string) {
    return await db.query(`
      SELECT 
        c.customer_id, c.full_name, c.phone_number, c.is_active, c.created_at,
        COALESCE(SUM(ccl.amount_delta), 0) as total_debt
      FROM customers c
      LEFT JOIN customer_credit_ledger ccl ON c.customer_id = ccl.customer_id
      WHERE c.tenant_id = $1
      GROUP BY c.customer_id
      ORDER BY c.full_name ASC;
    `, [tenantId]);
  }

  /**
   * Creates a new customer profile.
   */
  static async createCustomer(tenantId: string, data: CreateCustomerDTO) {
    const result = await db.query(`
      INSERT INTO customers (tenant_id, full_name, phone_number)
      VALUES ($1, $2, $3)
      RETURNING customer_id, full_name, phone_number, is_active, created_at;
    `, [tenantId, data.full_name, data.phone_number || null]);
    return result.rows[0];
  }

  /**
   * Records a repayment utilizing the authoritative append-only ledger pattern.
   * Direct updates to balances are architecturally prohibited.
   */
  static async recordRepayment(tenantId: string, customerId: string, userId: string, data: RecordRepaymentDTO) {
    // Transaction enforcement guarantees atomicity across the ledger and repayment log
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.current_tenant_id = '${tenantId}';`);

      // 1. Log to the repayment stream
      const repaymentResult = await client.query(`
        INSERT INTO customer_repayments (tenant_id, customer_id, amount, payment_method, recorded_by)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING repayment_id;
      `, [tenantId, customerId, data.amount, data.payment_method, userId]);

      // 2. Append a negative delta to the authoritative debt ledger
      await client.query(`
        INSERT INTO customer_credit_ledger (tenant_id, customer_id, amount_delta, description)
        VALUES ($1, $2, $3, $4);
      `, [tenantId, customerId, -Math.abs(data.amount), `Repayment via ${data.payment_method}`]);

      await client.query('COMMIT');
      return { success: true, repayment_id: repaymentResult.rows[0].repayment_id };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}