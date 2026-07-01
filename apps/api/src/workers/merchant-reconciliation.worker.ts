/**
 * ============================================================================
 * BUZZNA D74 - Merchant Reconciliation Worker
 * ============================================================================
 *
 * PURPOSE:
 * - Matches unlinked Safaricom M-Pesa receipts with pending POS sales
 * - Reconciles merchant revenue streams (Daraja payments vs checkout totals)
 * - Updates payment matching status
 * - Flags unmatched payments for manual review
 *
 * SCHEDULED: Runs every 30 minutes
 *
 * FLOW:
 * 1. Query unmatched merchant_payments (status = PENDING)
 * 2. Query unmatched sale_payment_allocations (payment_method = MPESA, not yet reconciled)
 * 3. Use heuristic matching:
 *    - Amount match (±5 KES tolerance for fees)
 *    - Timestamp proximity (within 5 minutes)
 *    - Customer phone/name if available
 * 4. Create payment_matches records
 * 5. Flag low-confidence matches for manual review
 *
 * ============================================================================
 */

import { Worker, Job } from 'bullmq';
import { db, withTenant } from '../config/database';
import { queueConnectionConfig } from '../config/redis';
import { logger } from '../common/logging/logger';
import { v4 as uuidv4 } from 'uuid';

interface MerchantPayment {
  payment_id: string;
  tenant_id: string;
  phone_number: string;
  amount: string;
  mpesa_code: string;
  received_at: Date;
}

interface PendingSale {
  allocation_id: string;
  sale_id: string;
  tenant_id: string;
  amount: string;
  created_at: Date;
}

interface MatchResult {
  merchant_payment_id: string;
  sale_allocation_id: string;
  confidence: number;
  matched_at: Date;
}

/**
 * Get unmatched merchant payments
 */
async function getUnmatchedMerchantPayments(tenantId: string): Promise<MerchantPayment[]> {
  try {
    const payments = await db
      .selectFrom('merchant_payments')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'PENDING')
      .where('matched_at', 'is', null)
      .orderBy('received_at', 'desc')
      .limit(100)
      .execute();

    return payments as MerchantPayment[];
  } catch (error) {
    logger.error('Failed to fetch unmatched merchant payments', { error });
    throw error;
  }
}

/**
 * Get unmatched MPESA sales allocations
 */
async function getUnmatchedMPESASales(tenantId: string): Promise<PendingSale[]> {
  try {
    const sales = await db
      .selectFrom('sale_payment_allocations')
      .select([
        'allocation_id',
        'sale_id',
        'tenant_id',
        'amount',
        'created_at',
      ])
      .where('tenant_id', '=', tenantId)
      .where('payment_method', '=', 'MPESA')
      .where('merchant_payment_id', 'is', null)
      .orderBy('created_at', 'desc')
      .limit(100)
      .execute();

    return sales as PendingSale[];
  } catch (error) {
    logger.error('Failed to fetch unmatched MPESA sales', { error });
    throw error;
  }
}

/**
 * Calculate match confidence score
 *
 * Factors:
 * - Amount match (exact or within tolerance)
 * - Timestamp proximity
 * - Phone number match
 */
function calculateConfidence(
  payment: MerchantPayment,
  sale: PendingSale
): number {
  let confidence = 0;

  // Amount matching (50% of score)
  const amountDiff = Math.abs(
    parseFloat(payment.amount) - parseFloat(sale.amount)
  );
  const maxAmountTolerance = 5; // 5 KES tolerance for fees

  if (amountDiff === 0) {
    confidence += 50; // Exact match
  } else if (amountDiff <= maxAmountTolerance) {
    confidence += 40; // Within tolerance
  } else if (amountDiff <= 50) {
    confidence += 20; // Likely match but verify
  }

  // Timestamp proximity (30% of score)
  const timeDiffMs = Math.abs(
    payment.received_at.getTime() - sale.created_at.getTime()
  );
  const maxTimeDiff = 5 * 60 * 1000; // 5 minutes

  if (timeDiffMs <= 60000) {
    confidence += 30; // Within 1 minute
  } else if (timeDiffMs <= maxTimeDiff) {
    confidence += 20; // Within 5 minutes
  } else if (timeDiffMs <= 15 * 60 * 1000) {
    confidence += 10; // Within 15 minutes
  }

  // Phone number match (20% of score) - would require customer data
  // Placeholder for future enhancement
  confidence += 0;

  return confidence;
}

/**
 * Match payments and sales
 */
async function matchPaymentsToSales(
  tenantId: string
): Promise<MatchResult[]> {
  try {
    const payments = await getUnmatchedMerchantPayments(tenantId);
    const sales = await getUnmatchedMPESASales(tenantId);

    const matches: MatchResult[] = [];

    for (const payment of payments) {
      let bestMatch: PendingSale | null = null;
      let bestConfidence = 0;

      // Find best matching sale
      for (const sale of sales) {
        const confidence = calculateConfidence(payment, sale);

        // Consider it a match if confidence >= 60%
        if (confidence >= 60 && confidence > bestConfidence) {
          bestMatch = sale;
          bestConfidence = confidence;
        }
      }

      if (bestMatch) {
        matches.push({
          merchant_payment_id: payment.payment_id,
          sale_allocation_id: bestMatch.allocation_id,
          confidence: bestConfidence,
          matched_at: new Date(),
        });

        // Remove matched sale from pool to avoid duplicate matches
        sales.splice(sales.indexOf(bestMatch), 1);

        logger.info('Payment matched to sale', {
          tenantId,
          paymentId: payment.payment_id,
          saleId: bestMatch.sale_id,
          confidence: bestConfidence,
        });
      }
    }

    return matches;
  } catch (error) {
    logger.error('Failed to match payments to sales', { error });
    throw error;
  }
}

/**
 * Record matches in database
 */
async function recordMatches(
  tenantId: string,
  matches: MatchResult[]
): Promise<void> {
  for (const match of matches) {
    try {
      // Update merchant_payment status
      await db
        .updateTable('merchant_payments')
        .set({
          matched_at: match.matched_at,
          status: match.confidence >= 90 ? 'MATCHED' : 'REVIEW_REQUIRED',
        })
        .where('payment_id', '=', match.merchant_payment_id)
        .execute();

      // Link allocation to payment
      await db
        .updateTable('sale_payment_allocations')
        .set({
          merchant_payment_id: match.merchant_payment_id,
        })
        .where('allocation_id', '=', match.sale_allocation_id)
        .execute();

      // Create match record for audit
      await db
        .insertInto('payment_matches')
        .values({
          match_id: uuidv4(),
          tenant_id: tenantId,
          merchant_payment_id: match.merchant_payment_id,
          sale_allocation_id: match.sale_allocation_id,
          confidence_score: match.confidence.toString(),
          matched_at: match.matched_at,
          created_at: new Date(),
        })
        .execute();

      logger.debug('Match recorded', {
        tenantId,
        matchId: match.merchant_payment_id,
        confidence: match.confidence,
      });
    } catch (error) {
      logger.error('Failed to record match', {
        tenantId,
        error,
      });
    }
  }
}

/**
 * Main job processor
 */
async function processMerchantReconciliation(job: Job): Promise<void> {
  try {
    logger.info('Starting merchant reconciliation job', { jobId: job.id });

    // Get all active tenants
    const tenants = await db
      .selectFrom('businesses')
      .select('tenant_id')
      .where('is_active', '=', true)
      .execute();

    let totalMatches = 0;
    let totalHighConfidence = 0;

    for (const tenant of tenants) {
      try {
        logger.info('Reconciling merchant payments for tenant', {
          tenantId: tenant.tenant_id,
        });

        const matches = await matchPaymentsToSales(tenant.tenant_id);
        await recordMatches(tenant.tenant_id, matches);

        totalMatches += matches.length;
        totalHighConfidence += matches.filter(
          (m) => m.confidence >= 90
        ).length;
      } catch (error) {
        logger.error('Failed to reconcile tenant payments', {
          tenantId: tenant.tenant_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info('Merchant reconciliation job completed', {
      jobId: job.id,
      totalMatches,
      highConfidence: totalHighConfidence,
    });
  } catch (error) {
    logger.error('Merchant reconciliation job failed', {
      jobId: job.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Worker initialization
 */
export const merchantReconciliationWorker = new Worker(
  'buzzna:merchant-reconciliation',
  processMerchantReconciliation,
  {
    connection: queueConnectionConfig,
    concurrency: 1,
    settings: {
      lockDuration: 120000,
      lockRenewTime: 60000,
      maxStalledCount: 2,
      stalledInterval: 30000,
    },
  }
);

merchantReconciliationWorker.on('error', (error) => {
  logger.error('Merchant reconciliation worker error', { error });
});

export default merchantReconciliationWorker;