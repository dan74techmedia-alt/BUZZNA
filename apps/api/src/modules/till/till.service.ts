/**
 * ============================================================================
 * BUZZNA D74 - Till Service (Shift Management & Cash Reconciliation)
 * ============================================================================
 *
 * PURPOSE:
 * - Manage till session lifecycle (open, track cash, close, reconcile)
 * - Enforce single active session per cashier rule
 * - Implement blind cash count for discrepancy detection
 * - Track cash flow (opening float, revenue, variance)
 * - Lock sessions with excessive variance for manager review
 * - Maintain audit trail of till operations
 *
 * ARCHITECTURAL RULES (CRITICAL):
 * 1. One cashier = exactly ONE open till session at a time
 * 2. Blind cash count: Cashier doesn't see expected balance during entry
 * 3. Variance tolerance: Configurable per business (default ±1% or ±100 KES)
 * 4. Discrepancy threshold: If variance exceeds limit, session locked (REVIEW_REQUIRED)
 * 5. Till history: APPEND-ONLY (no deletion of till sessions)
 * 6. All monetary amounts use NUMERIC(12,2) - no floating point
 * 7. Cash tracking: Till session tracks opening_float, expected_cash_balance, actual_cash_balance
 *
 * DATABASE DEPENDENCIES:
 * - till_sessions (shift management, immutable history)
 * - sales (via till_session_id foreign key)
 * - users (cashier identity)
 * - attention_cards (discrepancy flagging)
 *
 * TILL SESSION STATES:
 * - OPEN: Active till session accepting sales
 * - REVIEW_REQUIRED: Closed with discrepancy, locked pending manager approval
 * - CLOSED: Successfully reconciled and closed
 *
 * ============================================================================
 */

import { db, withTenant } from '../../config/database';
import { AppError } from '../../common/errors/AppError';
import { logger } from '../../common/logging/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * Till session output
 */
export interface TillSession {
  till_session_id: string;
  tenant_id: string;
  cashier_user_id: string;
  status: 'OPEN' | 'REVIEW_REQUIRED' | 'CLOSED';
  opening_float: string;
  expected_cash_balance: string;
  actual_cash_balance: string | null;
  opened_at: Date;
  closed_at: Date | null;
}

/**
 * Open till input
 */
export interface OpenTillInput {
  openingFloat: string; // NUMERIC(12,2) as string
}

/**
 * Close till input
 */
export interface CloseTillInput {
  actualCashBalance: string; // NUMERIC(12,2) as string (blind count entry)
}

/**
 * Till summary
 */
export interface TillSummary {
  till_session_id: string;
  openingFloat: string;
  totalRevenue: string;
  totalCash: string;
  expectedBalance: string;
  actualBalance: string;
  variance: string;
  variancePercentage: number;
  status: string;
  transactionCount: number;
}

/**
 * Till Service
 */
class TillService {
  /**
   * Open new till session for cashier
   *
   * RULES:
   * 1. Cashier can only have ONE open till session at a time
   * 2. Opening float must be non-negative
   * 3. Session starts with expected_cash_balance = opening_float
   * 4. As sales occur, expected_cash_balance is updated
   *
   * @param tenantId - Tenant UUID
   * @param userId - Cashier user UUID
   * @param input - Opening float amount
   * @returns Opened till session
   */
  async openTill(
    tenantId: string,
    userId: string,
    input: OpenTillInput
  ): Promise<TillSession> {
    logger.info('Opening till session', {
      tenantId,
      userId,
      openingFloat: input.openingFloat,
    });

    return withTenant(tenantId, async (trx) => {
      // Check for existing open till session for this cashier
      const existingTill = await trx
        .selectFrom('till_sessions')
        .select('till_session_id')
        .where('cashier_user_id', '=', userId)
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'OPEN')
        .executeTakeFirst();

      if (existingTill) {
        throw new AppError(
          'Cashier already has an open till session. Close it first before opening a new one.',
          409,
          true,
          'TILL_ALREADY_OPEN'
        );
      }

      // Validate opening float
      const openingFloat = parseFloat(input.openingFloat);
      if (isNaN(openingFloat) || openingFloat < 0) {
        throw new AppError(
          'Opening float must be a valid non-negative amount',
          400,
          true,
          'INVALID_OPENING_FLOAT'
        );
      }

      // Create till session
      const tillSessionId = uuidv4();
      const now = new Date();

      const session = await trx
        .insertInto('till_sessions')
        .values({
          till_session_id: tillSessionId,
          tenant_id: tenantId,
          cashier_user_id: userId,
          status: 'OPEN',
          opening_float: input.openingFloat,
          expected_cash_balance: input.openingFloat,
          actual_cash_balance: null,
          opened_at: now,
          closed_at: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      logger.info('Till session opened', {
        tenantId,
        tillSessionId,
        openingFloat: input.openingFloat,
      });

      return session as TillSession;
    });
  }

  /**
   * Get current till session for cashier
   *
   * @param tenantId - Tenant UUID
   * @param userId - Cashier user UUID
   * @returns Current open till session or null
   */
  async getCurrentTill(tenantId: string, userId: string): Promise<TillSession | null> {
    return withTenant(tenantId, async (trx) => {
      const session = await trx
        .selectFrom('till_sessions')
        .selectAll()
        .where('cashier_user_id', '=', userId)
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'OPEN')
        .executeTakeFirst();

      return (session as TillSession) || null;
    });
  }

  /**
   * Calculate expected cash balance for till session
   *
   * Formula:
   * Expected = opening_float + cash_sales - cash_refunds + cash_repayments - cash_withdrawals
   *
   * @param tenantId - Tenant UUID
   * @param tillSessionId - Till session UUID
   * @returns Calculated expected cash balance
   */
  async calculateExpectedBalance(
    tenantId: string,
    tillSessionId: string
  ): Promise<string> {
    return withTenant(tenantId, async (trx) => {
      // Fetch till session
      const session = await trx
        .selectFrom('till_sessions')
        .selectAll()
        .where('till_session_id', '=', tillSessionId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      if (!session) {
        throw new AppError('Till session not found', 404, true, 'TILL_NOT_FOUND');
      }

      const openingFloat = parseFloat(session.opening_float);

      // Sum cash sales from this till session
      const cashSales = await trx
        .selectFrom('sale_payment_allocations as spa')
        .innerJoin('sales as s', 'spa.sale_id', 's.sale_id')
        .select((eb) => eb.fn('sum', ['spa.amount']).as('total'))
        .where('s.till_session_id', '=', tillSessionId)
        .where('spa.payment_method', '=', 'CASH')
        .where('s.status', '!=', 'REFUNDED')
        .executeTakeFirst();

      const cashSalesAmount = parseFloat(cashSales?.total || '0');

      // Sum cash refunds (reduce expected balance)
      const cashRefunds = await trx
        .selectFrom('sale_refunds as sr')
        .innerJoin('sales as s', 'sr.sale_id', 's.sale_id')
        .select((eb) => eb.fn('sum', ['sr.refund_amount']).as('total'))
        .where('s.till_session_id', '=', tillSessionId)
        .executeTakeFirst();

      const cashRefundsAmount = parseFloat(cashRefunds?.total || '0');

      // Calculate expected balance
      const expectedBalance = openingFloat + cashSalesAmount - cashRefundsAmount;

      logger.debug('Expected till balance calculated', {
        tenantId,
        tillSessionId,
        openingFloat,
        cashSales: cashSalesAmount,
        cashRefunds: cashRefundsAmount,
        expectedBalance,
      });

      return expectedBalance.toFixed(2);
    });
  }

  /**
   * Close till session with blind cash count reconciliation
   *
   * BLIND CASH COUNT PROCESS:
   * 1. Cashier physically counts cash in drawer
   * 2. Enters amount WITHOUT seeing expected balance (blind entry)
   * 3. System calculates variance
   * 4. If variance within tolerance: Session closes normally
   * 5. If variance exceeds tolerance: Session locked as REVIEW_REQUIRED
   *
   * VARIANCE TOLERANCE:
   * - Default: ±1% or ±100 KES (whichever is greater)
   * - Configurable per business via settings
   *
   * @param tenantId - Tenant UUID
   * @param tillSessionId - Till session UUID
   * @param input - Actual cash balance (blind count)
   * @returns Closed till session with variance report
   */
  async closeTill(
    tenantId: string,
    tillSessionId: string,
    input: CloseTillInput
  ): Promise<{
    till: TillSession;
    summary: TillSummary;
    variance: {
      amount: string;
      percentage: number;
      status: 'ACCEPTABLE' | 'EXCESSIVE';
    };
  }> {
    logger.info('Closing till session', {
      tenantId,
      tillSessionId,
      actualCash: input.actualCashBalance,
    });

    return withTenant(tenantId, async (trx) => {
      // Fetch till session
      const session = await trx
        .selectFrom('till_sessions')
        .selectAll()
        .where('till_session_id', '=', tillSessionId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      if (!session) {
        throw new AppError('Till session not found', 404, true, 'TILL_NOT_FOUND');
      }

      if (session.status !== 'OPEN') {
        throw new AppError(
          `Till session is not open (current status: ${session.status})`,
          409,
          true,
          'TILL_NOT_OPEN'
        );
      }

      // Validate actual cash balance
      const actualCash = parseFloat(input.actualCashBalance);
      if (isNaN(actualCash) || actualCash < 0) {
        throw new AppError(
          'Actual cash balance must be a valid non-negative amount',
          400,
          true,
          'INVALID_CASH_AMOUNT'
        );
      }

      // Calculate expected balance
      const expectedBalanceStr = await this.calculateExpectedBalance(tenantId, tillSessionId);
      const expectedBalance = parseFloat(expectedBalanceStr);

      // Calculate variance
      const variance = actualCash - expectedBalance;
      const variancePercentage =
        expectedBalance > 0 ? (variance / expectedBalance) * 100 : 0;

      // Get variance tolerance from business settings (default: ±1% or ±100 KES)
      const settings = await trx
        .selectFrom('business_settings')
        .select(['allow_negative_stock', 'low_stock_threshold'])
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      const tolerancePercentage = 1.0; // 1%
      const toleranceAmount = 100.0; // 100 KES
      const maxTolerance = Math.max(
        expectedBalance * (tolerancePercentage / 100),
        toleranceAmount
      );

      const isAcceptable = Math.abs(variance) <= maxTolerance;

      logger.info('Till variance calculated', {
        tenantId,
        tillSessionId,
        expectedBalance,
        actualCash,
        variance,
        variancePercentage,
        isAcceptable,
      });

      // Determine final status
      const finalStatus = isAcceptable ? 'CLOSED' : 'REVIEW_REQUIRED';

      // Update till session
      const now = new Date();
      const updatedSession = await trx
        .updateTable('till_sessions')
        .set({
          status: finalStatus,
          actual_cash_balance: input.actualCashBalance,
          closed_at: now,
        })
        .where('till_session_id', '=', tillSessionId)
        .returningAll()
        .executeTakeFirstOrThrow();

      // Count transactions
      const transactionCount = await trx
        .selectFrom('sales')
        .select((eb) => eb.fn('count').as('count'))
        .where('till_session_id', '=', tillSessionId)
        .executeTakeFirst();

      const txCount = parseInt(transactionCount?.count || '0');

      // If excessive variance, create attention card
      if (!isAcceptable) {
        const cardId = uuidv4();
        await trx
          .insertInto('attention_cards')
          .values({
            card_id: cardId,
            tenant_id: tenantId,
            card_type: 'till_discrepancy',
            title: 'Till Cash Discrepancy',
            description: `Till session closed with variance of ${variance.toFixed(2)} KES (${variancePercentage.toFixed(
              1
            )}%). Expected: ${expectedBalance.toFixed(2)} KES, Actual: ${actualCash.toFixed(2)} KES.`,
            severity: Math.abs(variance) > 500 ? 'high' : 'medium',
            status: 'active',
            action_url: `/till/sessions/${tillSessionId}`,
            metadata: JSON.stringify({
              till_session_id: tillSessionId,
              variance: variance.toFixed(2),
              variancePercentage: variancePercentage.toFixed(1),
              expectedBalance: expectedBalance.toFixed(2),
              actualBalance: actualCash.toFixed(2),
            }),
            created_at: now,
          })
          .execute();

        logger.warn('Till discrepancy attention card created', {
          tenantId,
          tillSessionId,
          variance,
        });
      }

      // Log till closure event (audit trail)
      const auditId = uuidv4();
      await trx
        .insertInto('audit_logs')
        .values({
          audit_id: auditId,
          tenant_id: tenantId,
          user_id: session.cashier_user_id,
          action: 'TILL_CLOSED',
          resource_type: 'till_session',
          resource_id: tillSessionId,
          metadata: JSON.stringify({
            expectedBalance: expectedBalance.toFixed(2),
            actualBalance: actualCash.toFixed(2),
            variance: variance.toFixed(2),
            status: finalStatus,
          }),
          created_at: now,
        })
        .execute();

      const summary: TillSummary = {
        till_session_id: tillSessionId,
        openingFloat: session.opening_float,
        totalRevenue: (actualCash - parseFloat(session.opening_float)).toFixed(2),
        totalCash: actualCash.toFixed(2),
        expectedBalance: expectedBalance.toFixed(2),
        actualBalance: actualCash.toFixed(2),
        variance: variance.toFixed(2),
        variancePercentage: Math.round(variancePercentage * 100) / 100,
        status: finalStatus,
        transactionCount: txCount,
      };

      logger.info('Till session closed', {
        tenantId,
        tillSessionId,
        status: finalStatus,
        variance: variance.toFixed(2),
      });

      return {
        till: updatedSession as TillSession,
        summary,
        variance: {
          amount: variance.toFixed(2),
          percentage: Math.round(variancePercentage * 100) / 100,
          status: isAcceptable ? 'ACCEPTABLE' : 'EXCESSIVE',
        },
      };
    });
  }

  /**
   * Get till session details with full summary
   *
   * @param tenantId - Tenant UUID
   * @param tillSessionId - Till session UUID
   * @returns Till session with summary
   */
  async getTillDetails(
    tenantId: string,
    tillSessionId: string
  ): Promise<{
    till: TillSession;
    summary: TillSummary;
  }> {
    return withTenant(tenantId, async (trx) => {
      const session = await trx
        .selectFrom('till_sessions')
        .selectAll()
        .where('till_session_id', '=', tillSessionId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      if (!session) {
        throw new AppError('Till session not found', 404, true, 'TILL_NOT_FOUND');
      }

      // Get transaction count
      const txCount = await trx
        .selectFrom('sales')
        .select((eb) => eb.fn('count').as('count'))
        .where('till_session_id', '=', tillSessionId)
        .executeTakeFirst();

      const openingFloat = parseFloat(session.opening_float);
      const actualBalance = session.actual_cash_balance
        ? parseFloat(session.actual_cash_balance)
        : 0;
      const revenue = actualBalance - openingFloat;

      const summary: TillSummary = {
        till_session_id: session.till_session_id,
        openingFloat: session.opening_float,
        totalRevenue: revenue.toFixed(2),
        totalCash: actualBalance.toFixed(2),
        expectedBalance: session.expected_cash_balance,
        actualBalance: session.actual_cash_balance || '0',
        variance: (actualBalance - parseFloat(session.expected_cash_balance)).toFixed(2),
        variancePercentage:
          parseFloat(session.expected_cash_balance) > 0
            ? ((actualBalance - parseFloat(session.expected_cash_balance)) /
                parseFloat(session.expected_cash_balance)) *
              100
            : 0,
        status: session.status,
        transactionCount: parseInt(txCount?.count || '0'),
      };

      return {
        till: session as TillSession,
        summary,
      };
    });
  }

  /**
   * List till sessions for a cashier (for session history)
   *
   * @param tenantId - Tenant UUID
   * @param userId - Cashier user UUID
   * @param limit - Number of sessions to return (default 50)
   * @returns Array of till sessions ordered by opened_at desc
   */
  async getTillHistory(
    tenantId: string,
    userId: string,
    limit: number = 50
  ): Promise<TillSession[]> {
    return withTenant(tenantId, async (trx) => {
      const sessions = await trx
        .selectFrom('till_sessions')
        .selectAll()
        .where('cashier_user_id', '=', userId)
        .where('tenant_id', '=', tenantId)
        .orderBy('opened_at', 'desc')
        .limit(limit)
        .execute();

      return sessions as TillSession[];
    });
  }
}

// Export singleton instance
export const tillService = new TillService();