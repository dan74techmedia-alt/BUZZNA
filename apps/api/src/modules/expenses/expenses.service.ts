// apps/api/src/modules/expenses/expenses.service.ts
import { db } from '../../config/database';
import { CreateExpenseCategoryDTO, CreateExpenseDTO } from './expenses.schema';

export class ExpensesService {
  static async listCategories(tenantId: string) {
    const result = await db.query(
      `SELECT category_id, name, created_at FROM expense_categories WHERE tenant_id = $1 ORDER BY name ASC;`,
      [tenantId]
    );
    return result.rows;
  }

  static async createCategory(tenantId: string, data: CreateExpenseCategoryDTO) {
    const result = await db.query(
      `INSERT INTO expense_categories (tenant_id, name) VALUES ($1, $2) RETURNING category_id, name, created_at;`,
      [tenantId, data.name]
    );
    return result.rows[0];
  }

  static async listExpenses(tenantId: string) {
    const result = await db.query(
      `SELECT e.expense_id, e.amount, e.description, e.created_at, c.name as category_name, u.username as recorded_by
       FROM expenses e
       JOIN expense_categories c ON e.category_id = c.category_id
       JOIN users u ON e.recorded_by = u.user_id
       WHERE e.tenant_id = $1
       ORDER BY e.created_at DESC;`,
      [tenantId]
    );
    return result.rows;
  }

  static async createExpense(tenantId: string, userId: string, data: CreateExpenseDTO) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_tenant_id', $1, true);`, [tenantId]);

      // If tied to an active till session, adjust the expected cash balance downward
      if (data.till_session_id) {
        const tillCheck = await client.query(
          `SELECT status FROM till_sessions WHERE till_session_id = $1 AND tenant_id = $2 FOR UPDATE;`,
          [data.till_session_id, tenantId]
        );

        if (tillCheck.rows.length === 0 || tillCheck.rows[0].status !== 'OPEN') {
          throw new Error('Target till session is either invalid or closed');
        }

        await client.query(
          `UPDATE till_sessions 
           SET expected_cash_balance = expected_cash_balance - $1 
           WHERE till_session_id = $2;`,
          [data.amount, data.till_session_id]
        );
      }

      const expenseResult = await client.query(
        `INSERT INTO expenses (tenant_id, category_id, till_session_id, amount, description, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING expense_id, amount, description, created_at;`,
        [tenantId, data.category_id, data.till_session_id || null, data.amount, data.description, userId]
      );

      await client.query('COMMIT');
      return expenseResult.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}