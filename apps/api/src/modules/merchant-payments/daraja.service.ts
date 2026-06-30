import { db } from '../../db/client';
import { sql, eq, and } from 'drizzle-orm';
import { 
  merchantPayments, 
  salesTransactions, 
  matches 
} from '../../db/migrations/schema';
import { AppError } from '../../common/errors/AppError';

export class DarajaService {
  /**
   * Processes incoming Safaricom Daraja C2B/B2C webhooks.
   * Enforces idempotency guards to prevent double-crediting during network retries.
   */
  static async processDarajaWebhook(tenantId: string, payload: any) {
    // 1. Wrap query in strict transaction block for PgBouncer safety
    return await db.transaction(async (tx) => {
      
      // 2. Inject local PostgreSQL Row-Level Security (RLS) tenant context
      await tx.execute(sql`SET LOCAL app.current_tenant_id = ${tenantId}`);

      const receiptNumber = payload.TransID; // Safaricom transaction receipt
      const amount = parseFloat(payload.TransAmount);
      const phoneString = payload.MSISDN;

      // 3. Idempotency Guard: Check if this exact receipt was already processed
      const existingPayment = await tx
        .select()
        .from(merchantPayments)
        .where(eq(merchantPayments.receiptNumber, receiptNumber))
        .limit(1);

      if (existingPayment.length > 0) {
        // Return 200 OK to acknowledge Safaricom but ignore the duplicate locally
        return { status: 'ignored_duplicate', receiptNumber };
      }

      // 4. Append the new payment to the unlinked transaction pool
      const [newPayment] = await tx
        .insert(merchantPayments)
        .values({
          tenantId,
          receiptNumber,
          amount,
          senderPhone: phoneString,
          status: 'UNMATCHED',
          providerTimestamp: new Date(payload.TransTime)
        })
        .returning();

      return { status: 'ingested', paymentId: newPayment.id };
    });
  }

  /**
   * Manually maps an unmatched Daraja M-Pesa record to a pending POS checkout sale.
   * Fulfills API Contract: POST /api/v1/merchant-payments/:id/match
   */
  static async matchPaymentToSale(tenantId: string, paymentId: string, transactionId: string) {
    return await db.transaction(async (tx) => {
      // 1. Enforce RLS tenant context
      await tx.execute(sql`SET LOCAL app.current_tenant_id = ${tenantId}`);

      // 2. Load and validate the unmatched M-Pesa payment
      const paymentResult = await tx
        .select()
        .from(merchantPayments)
        .where(eq(merchantPayments.id, paymentId))
        .limit(1);

      if (!paymentResult.length) {
        throw new AppError('Payment record not found or unauthorized access attempt.', 404);
      }

      const payment = paymentResult[0];
      if (payment.status === 'MATCHED') {
        throw new AppError('Conflict: This M-Pesa payment is already matched.', 409);
      }

      // 3. Load and validate the target pending sale transaction
      const saleResult = await tx
        .select()
        .from(salesTransactions)
        .where(
          and(
            eq(salesTransactions.transactionId, transactionId),
            eq(salesTransactions.paymentMethod, 'MPESA')
          )
        )
        .limit(1);

      if (!saleResult.length) {
        throw new AppError('Target sale transaction not found or does not accept M-Pesa.', 404);
      }

      const sale = saleResult[0];
      if (sale.paymentStatus === 'COMPLETED_VERIFIED') {
        throw new AppError('Conflict: Target sale is already verified.', 409);
      }

      // 4. Create authoritative match ledger record (Append-Only)
      await tx.insert(matches).values({
        tenantId,
        paymentId,
        transactionId,
        matchType: 'MANUAL',
        matchedAt: new Date()
      });

      // 5. Update Payment and Sale States
      await tx.update(merchantPayments)
        .set({ status: 'MATCHED' })
        .where(eq(merchantPayments.id, paymentId));

      await tx.update(salesTransactions)
        .set({ paymentStatus: 'COMPLETED_VERIFIED' })
        .where(eq(salesTransactions.transactionId, transactionId));

      return {
        success: true,
        message: 'Daraja payment successfully matched and verified against sale.',
        transactionId
      };
    });
  }
} 