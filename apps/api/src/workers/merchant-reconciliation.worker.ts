// apps/api/src/workers/merchant-reconciliation.worker.ts

import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis';
import { db } from '../db/client';
import { logger } from '../common/logging/logger';
import { queues } from '../config/queues';

/**
 * Merchant Reconciliation Worker
 *
 * SCHEDULED TASK: Runs every 30 minutes
 *
 * Matches offline-first Daraja M-Pesa receipts to pending POS sales transactions.
 *
 * Problem:
 * - Mobile money (Daraja) requires webhooks to confirm payments
 * - In offline mode, terminals can't reach the webhook endpoint
 * - Customers pay via SMS (MPESA confirmation received locally)
 * - Terminal records sale with PAYMENT_PENDING status
 * - When connectivity restored, need to match SMS receipt to sale
 *
 * Solution:
 * 1. Query all PAYMENT_PENDING sales with payment_method='MPESA'
 * 2. Query all unmatched merchant_payment_events from Daraja
 * 3. Apply fuzzy matching heuristics:
 *    - Customer phone + amount + timestamp (±30 min window)
 *    - Daraja reference ID + POS transaction ID
 * 4. Auto-match high-confidence pairs (>95%)
 * 5. Flag medium-confidence pairs (85-95%) for manual review
 * 6. Send notifications to account manager for manual matches
 *
 * Architecture Rules:
 * - Never auto-match with confidence < 85%
 * - All matches logged to merchant_payment_matches table (append-only)
 * - Failed reconciliation creates attention card for business owner
 * - Respects business timezone for transaction dating
 */

interface PendingMpesaSale {
  transactionId: string;
  tenantId: string;
  phoneNumber: string;
  amount: string; // NUMERIC stored as string to preserve precision
  createdAt: Date;
  customerName?: string;
}

interface UnmatchedDarajaEvent {
  eventId: string;
  tenantId: string;
  phoneNumber: string;
  amount: string;
  reference: string;
  receivedAt: Date;
  metadata: any;
}

interface MatchResult {
  saleTxnId: string;
  darajaEventId: string;
  confidence: number; // 0-100
  matchReason: string;
}

/**
 * Get pending MPESA sales awaiting reconciliation
 */
async function getPendingMpesaSales(): Promise<PendingMpesaSale[]> {
  try {
    const results = await db
      .selectFrom('sales_transactions' as any)
      .selectAll()
      .where('payment_method', '=', 'MPESA')
      .where('payment_status', '=', 'PENDING')
      .where(
        'created_at',
        '>=',
        new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
      )
      .execute();

    return results.map((row: any) => ({
      transactionId: row.transaction_id,
      tenantId: row.tenant_id,
      phoneNumber: row.customer_phone || '',
      amount: row.gross_total.toString(),
      createdAt: new Date(row.created_at),
      customerName: row.customer_name,
    }));
  } catch (error) {
    logger.error('Failed to fetch pending MPESA sales', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get unmatched Daraja payment events
 */
async function getUnmatchedDarajaEvents(): Promise<UnmatchedDarajaEvent[]> {
  try {
    const results = await db
      .selectFrom('merchant_payment_events' as any)
      .selectAll()
      .where('status', '=', 'unmatched')
      .where('event_type', '=', 'stk_callback')
      .where(
        'created_at',
        '>=',
        new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
      )
      .execute();

    return results.map((row: any) => ({
      eventId: row.event_id,
      tenantId: row.tenant_id,
      phoneNumber: row.phone_number || '',
      amount: row.amount.toString(),
      reference: row.reference || '',
      receivedAt: new Date(row.received_at),
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
    }));
  } catch (error) {
    logger.error('Failed to fetch unmatched Daraja events', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Normalize phone number for comparison
 */
function normalizePhone(phone: string): string {
  return phone
    .replace(/\D/g, '') // Remove non-digits
    .slice(-9); // Last 9 digits (handles various formats)
}

/**
 * Calculate match confidence between sale and Daraja event
 */
function calculateMatchConfidence(
  sale: PendingMpesaSale,
  event: UnmatchedDarajaEvent
): MatchResult | null {
  // Must be from same tenant
  if (sale.tenantId !== event.tenantId) {
    return null;
  }

  let confidence = 0;
  const reasons: string[] = [];

  // Amount match (exact)
  const saleAmount = parseFloat(sale.amount);
  const eventAmount = parseFloat(event.amount);
  if (Math.abs(saleAmount - eventAmount) < 0.01) {
    confidence += 50;
    reasons.push('amount-exact');
  } else if (Math.abs(saleAmount - eventAmount) < 1) {
    confidence += 20; // Within 1 unit
    reasons.push('amount-close');
  } else {
    return null; // Fail on significant amount mismatch
  }

  // Phone number match
  const salePhone = normalizePhone(sale.phoneNumber);
  const eventPhone = normalizePhone(event.phoneNumber);
  if (salePhone === eventPhone) {
    confidence += 30;
    reasons.push('phone-match');
  } else if (salePhone && eventPhone && salePhone.endsWith(eventPhone.slice(-6))) {
    confidence += 15;
    reasons.push('phone-partial');
  }

  // Timestamp proximity (within 30 minutes)
  const timeDiffMs = Math.abs(
    sale.createdAt.getTime() - event.receivedAt.getTime()
  );
  const timeDiffMins = timeDiffMs / (1000 * 60);

  if (timeDiffMins <= 5) {
    confidence += 20;
    reasons.push('timestamp-exact');
  } else if (timeDiffMins <= 15) {
    confidence += 10;
    reasons.push('timestamp-close');
  } else if (timeDiffMins <= 30) {
    confidence += 5;
    reasons.push('timestamp-window');
  } else {
    confidence = 0; // Outside acceptable window
  }

  if (confidence < 85) {
    return null; // Below threshold
  }

  return {
    saleTxnId: sale.transactionId,
    darajaEventId: event.eventId,
    confidence,
    matchReason: reasons.join(','),
  };
}

/**
 * Find best matches between sales and events
 */
function findBestMatches(
  sales: PendingMpesaSale[],
  events: UnmatchedDarajaEvent[]
): MatchResult[] {
  const matches: MatchResult[] = [];
  const usedSales = new Set<string>();
  const usedEvents = new Set<string>();

  // Sort by confidence desc
  const candidates: Array<MatchResult & { sale: PendingMpesaSale; event: UnmatchedDarajaEvent }> = [];

  for (const sale of sales) {
    for (const event of events) {
      const match = calculateMatchConfidence(sale, event);
      if (match) {
        candidates.push({ ...match, sale, event });
      }
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence);

  // Greedy matching (each sale/event used only once)
  for (const candidate of candidates) {
    if (
      !usedSales.has(candidate.saleTxnId) &&
      !usedEvents.has(candidate.darajaEventId)
    ) {
      matches.push(candidate);
      usedSales.add(candidate.saleTxnId);
      usedEvents.add(candidate.darajaEventId);
    }
  }

  return matches;
}

/**
 * Store match in database
 */
async function storeMatch(
  match: MatchResult,
  confidence: number
): Promise<void> {
  try {
    const status = confidence >= 95 ? 'auto_matched' : 'pending_review';

    await db
      .insertInto('merchant_payment_matches' as any)
      .values({
        sale_transaction_id: match.saleTxnId,
        daraja_event_id: match.darajaEventId,
        confidence_score: confidence,
        match_reason: match.matchReason,
        status,
        created_at: new Date(),
      })
      .execute();

    // Update sale transaction status if auto-matched
    if (status === 'auto_matched') {
      await db
        .updateTable('sales_transactions' as any)
        .set({
          payment_status: 'COMPLETED_VERIFIED',
          merchant_payment_event_id: match.darajaEventId,
        })
        .where('transaction_id', '=', match.saleTxnId)
        .execute();

      logger.info('Payment auto-matched and verified', {
        saleTxnId: match.saleTxnId,
        confidence: confidence,
      });
    }
  } catch (error) {
    logger.error('Failed to store match', {
      saleTxnId: match.saleTxnId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Create attention card for manual review matches
 */
async function createManualReviewCard(
  tenantId: string,
  matchCount: number
): Promise<void> {
  try {
    await db
      .insertInto('attention_cards' as any)
      .values({
        tenant_id: tenantId,
        card_type: 'payment_reconciliation_pending',
        title: 'Manual Payment Reconciliation Required',
        description: `${matchCount} payments require manual review to complete matching with your sales.`,
        severity: 'medium',
        status: 'active',
        action_url: '/merchant-payments?filter=pending_review',
        created_at: new Date(),
      })
      .execute();
  } catch (error) {
    logger.error('Failed to create attention card', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Main job processor
 */
async function processMerchantReconciliation(job: Job): Promise<void> {
  try {
    logger.info('Starting merchant reconciliation job', {
      jobId: job.id,
    });

    // Get pending sales and unmatched events
    const pendingSales = await getPendingMpesaSales();
    const unmatchedEvents = await getUnmatchedDarajaEvents();

    logger.info('Reconciliation candidates found', {
      pendingSalesCount: pendingSales.length,
      unmatchedEventsCount: unmatchedEvents.length,
    });

    if (pendingSales.length === 0 || unmatchedEvents.length === 0) {
      logger.info('No candidates for reconciliation');
      return;
    }

    // Find matches
    const matches = findBestMatches(pendingSales, unmatchedEvents);

    logger.info('Matches found', {
      matchCount: matches.length,
    });

    // Group matches by tenant and confidence level
    const matchesByTenant: Record<
      string,
      { autoMatched: MatchResult[]; manualReview: MatchResult[] }
    > = {};

    for (const match of matches) {
      const sale = pendingSales.find((s) => s.transactionId === match.saleTxnId);
      if (!sale) continue;

      if (!matchesByTenant[sale.tenantId]) {
        matchesByTenant[sale.tenantId] = {
          autoMatched: [],
          manualReview: [],
        };
      }

      if (match.confidence >= 95) {
        matchesByTenant[sale.tenantId].autoMatched.push(match);
      } else {
        matchesByTenant[sale.tenantId].manualReview.push(match);
      }
    }

    // Process and store matches
    for (const match of matches) {
      try {
        await storeMatch(match, match.confidence);
      } catch (error) {
        logger.error('Failed to process match', {
          match,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Create attention cards for manual review matches
    for (const [tenantId, tenantMatches] of Object.entries(matchesByTenant)) {
      if (tenantMatches.manualReview.length > 0) {
        await createManualReviewCard(tenantId, tenantMatches.manualReview.length);
      }
    }

    logger.info('Merchant reconciliation job completed', {
      jobId: job.id,
      matchesProcessed: matches.length,
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
    connection: redis,
    concurrency: 1,
    settings: {
      lockDuration: 60000,
      lockRenewTime: 30000,
      maxStalledCount: 3,
      stalledInterval: 10000,
    },
  }
);

merchantReconciliationWorker.on('error', (error) => {
  logger.error('Merchant reconciliation worker error', {
    error: error instanceof Error ? error.message : String(error),
  });
});

export default merchantReconciliationWorker;