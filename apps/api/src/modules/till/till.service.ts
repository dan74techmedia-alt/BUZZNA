// apps/api/src/modules/till/till.service.ts

import { db, withTenant } from '../../config/database';
import { logger } from '../../common/logging/logger';
import { AppError } from '../../common/errors/AppError';
import { Decimal } from 'decimal.js';

interface OpenTillPayload {
  openingFloat: string;
}

interface CloseTillPayload {
  actualCashBalance: string;
}

export class TillService {
  /**
   * Open till session (single active session per cashier)
   */
  static async openTill(
    tenantId: string,
    userId: string,
    payload: OpenTillPayload
  ): Promise<{ sessionId: string; openingFloat: string }> {
    return await withTenant(tenantId, async (trx) => {
      try {
        // Check for existing open session
        const existing = await trx
          .selectFrom('till_sessions')
          .selectAll()
          .where('tenant_id', '=', tenantId)
          .where('cashier_user_id', '=', userId)
          .where('status', '=', 'OPEN')
          .executeTakeFirst();

        if (existing) {
          throw new AppError('Cashier already has an open till session', 400);
        }

        const openingFloat = new Decimal(payload.openingFloat);

        // Create till session
        const result = await trx
          .insertInto('till_sessions')
          .values({
            tenant_id: tenantId,
            cashier_user_id: userId,
            opening_float: openingFloat.toString(),
            expected_cash_balance: openingFloat.toString(),
            status: 'OPEN',
            opened_at: new Date(),
          })
          .returning('session_id')
          .executeTakeFirst();

        if (!result) {
          throw new Error('Failed to create till session');
        }

        logger.info('[TillService] Till opened', {
          tenantId,
          userId,
          sessionId: result.session_id,
          openingFloat: openingFloat.toString(),
        });

        return {
          sessionId: result.session_id,
          openingFloat: openingFloat.toString(),
        };
      } catch (error) {
        logger.error('[TillService] Failed to open till', {
          tenantId,
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error instanceof AppError ? error : new AppError('Failed to open till', 500);
      }
    });
  }

  /**
   * Close till session with blind balance entry
   * Blind Balance: Cashier enters actual cash without seeing expected balance
   */
  static async closeTill(
    tenantId: string,
    userId: string,
    sessionId: string,
    payload: CloseTillPayload
  ): Promise<{ status: string; discrepancy: string; variance: string }> {
    return await withTenant(tenantId, async (trx) => {
      try {
        // Get session
        const session = await trx
          .selectFrom('till_sessions')
          .selectAll()
          .where('tenant_id', '=', tenantId)
          .where('session_id', '=', sessionId)
          .where('cashier_user_id', '=', userId)
          .executeTakeFirst();

        if (!session) {
          throw new AppError('Till session not found', 404);
        }

        if (session.status !== 'OPEN') {
          throw new AppError('Till session is not open', 400);
        }

        const actualBalance = new Decimal(payload.actualCashBalance);
        const expectedBalance = new Decimal(session.expected_cash_balance);
        const variance = actualBalance.minus(expectedBalance);
        const varianceLimit = new Decimal(100); // Configurable limit

        // Check variance
        let closingStatus = 'CLOSED';
        if (variance.abs().greaterThan(varianceLimit)) {
          closingStatus = 'REVIEW_REQUIRED';
        }

        // Close session
        await trx
          .updateTable('till_sessions')
          .set({
            actual_cash_balance: actualBalance.toString(),
            expected_cash_balance: expectedBalance.toString(),
            variance: variance.toString(),
            status: closingStatus,
            closed_at: new Date(),
          })
          .where('session_id', '=', sessionId)
          .execute();

        // If variance exceeds limit, create attention card
        if (closingStatus === 'REVIEW_REQUIRED') {
          await trx
            .insertInto('attention_cards')
            .values({
              tenant_id: tenantId,
              card_type: 'till_discrepancy',
              title: 'Till Balance Discrepancy',
              description: `Variance of ${variance.toString()} detected. Expected: ${expectedBalance.toString()}, Actual: ${actualBalance.toString()}`,
              severity: 'high',
              status: 'active',
              metadata: JSON.stringify({
                sessionId,
                userId,
                variance: variance.toString(),
                expected: expectedBalance.toString(),
                actual: actualBalance.toString(),
              }),
              created_at: new Date(),
            })
            .execute();
        }

        logger.info('[TillService] Till closed', {
          tenantId,
          userId,
          sessionId,
          status: closingStatus,
          variance: variance.toString(),
        });

        return {
          status: closingStatus,
          discrepancy: variance.abs().toString(),
          variance: variance.toString(),
        };
      } catch (error) {
        logger.error('[TillService] Failed to close till', {
          tenantId,
          userId,
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error instanceof AppError ? error : new AppError('Failed to close till', 500);
      }
    });
  }

  /**
   * Get current till status
   */
  static async getTillStatus(
    tenantId: string,
    userId: string
  ): Promise<any | null> {
    return await withTenant(tenantId, async (trx) => {
      try {
        const session = await trx
          .selectFrom('till_sessions')
          .selectAll()
          .where('tenant_id', '=', tenantId)
          .where('cashier_user_id', '=', userId)
          .where('status', '=', 'OPEN')
          .executeTakeFirst();

        return session || null;
      } catch (error) {
        logger.error('[TillService] Failed to get till status', {
          tenantId,
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    });
  }
}