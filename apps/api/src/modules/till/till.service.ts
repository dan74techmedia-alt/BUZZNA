// apps/api/src/modules/till/till.service.ts
import { db } from '../../config/database';
import { OpenTillDTO, CloseTillDTO } from './till.schema';

export class TillService {
  static async getActiveSession(tenantId: string, userId: string) {
    const result = await db.query(
      `SELECT till_session_id, cashier_user_id, status, opening_float, expected_cash_balance, opened_at
       FROM till_sessions
       WHERE tenant_id = $1 AND cashier_user_id = $2 AND status = 'OPEN';`,
      [tenantId, userId]
    );
    return result.rows[0] || null;
  }

  static async openSession(tenantId: string, userId: string, data: OpenTillDTO) {
    const active = await this.getActiveSession(tenantId, userId);
    if (active) {
      throw new Error('An active till session is already running for this user terminal');
    }

    const result = await db.query(
      `INSERT INTO till_sessions (tenant_id, cashier_user_id, status, opening_float, expected_cash_balance)
       VALUES ($1, $2, 'OPEN', $3, $3)
       RETURNING till_session_id, status, opening_float, expected_cash_balance, opened_at;`,
      [tenantId, userId, data.opening_float]
    );
    return result.rows[0];
  }

  /**
   * Blind Till Handover implementation rule: Cashier registers physical content counts 
   * without system revealing the expected values beforehand to secure integrity.
   */
  static async closeSession(tenantId: string, sessionId: string, data: CloseTillDTO) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_tenant_id', $1, true);`, [tenantId]);

      const sessionCheck = await client.query(
        `SELECT expected_cash_balance, status FROM till_sessions WHERE till_session_id = $1 AND tenant_id = $2 FOR UPDATE;`,
        [sessionId, tenantId]
      );

      if (sessionCheck.rows.length === 0 || sessionCheck.rows[0].status !== 'OPEN') {
        throw new Error('Till session does not exist or has already been completed');
      }

      const expected = parseFloat(sessionCheck.rows[0].expected_cash_balance);
      const discrepancy = data.actual_cash_balance - expected;

      const result = await client.query(
        `UPDATE till_sessions
         SET status = 'CLOSED', actual_cash_balance = $1, closed_at = NOW()
         WHERE till_session_id = $2
         RETURNING till_session_id, opening_float, expected_cash_balance, actual_cash_balance, closed_at;`,
        [data.actual_cash_balance, sessionId]
      );

      // If a major discrepancies trace occurs, append an immutable security tracking log
      if (Math.abs(discrepancy) > 0) {
        await client.query(
          `INSERT INTO security_events (tenant_id, event_type, severity, description)
           VALUES ($1, 'TILL_DISCREPANCY', $2, $3);`,
          [
            tenantId,
            Math.abs(discrepancy) > 500 ? 'HIGH' : 'LOW',
            `Till session ${sessionId} completed with cash variance delta of: ${discrepancy}`
          ]
        );
      }

      await client.query('COMMIT');
      return { ...result.rows[0], discrepancy };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}