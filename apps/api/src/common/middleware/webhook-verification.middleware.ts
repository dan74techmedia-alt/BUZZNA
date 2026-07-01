// apps/api/src/common/middleware/webhook-verification.middleware.ts

import { Request, Response, NextFunction, Router } from 'express';
import crypto from 'crypto';
import { AppError } from '../errors/AppError';
import { logger } from '../logging/logger';
import { db } from '../../db/client';
import { getDbTransaction, verifyTenantContext } from './tenant-transaction.middleware';

/**
 * Webhook Verification Middleware
 *
 * CRITICAL IDEMPOTENCY & SECURITY COMPONENT
 *
 * External payment providers (Paystack, Daraja) can retry webhook deliveries
 * due to network timeouts or processing failures. Without idempotency protection,
 * duplicate webhook payloads can cause:
 * - Double-crediting of tenant accounts
 * - Duplicate inventory reversals
 * - Corrupted financial ledgers
 *
 * This middleware:
 * 1. Verifies webhook signature using provider-specific HMAC
 * 2. Extracts idempotency key (provider transaction/reference ID)
 * 3. Checks if webhook has already been processed (database lookup)
 * 4. Marks webhook as processed before executing business logic
 * 5. Returns cached response on duplicate delivery (prevents double-processing)
 *
 * Architecture Rules:
 * - Webhook processing must be idempotent (same payload = same result)
 * - Provider signatures must match before any processing occurs
 * - Idempotency keys must be globally unique (provider guarantees this)
 * - Failed webhook processing must NOT mark the webhook as processed
 */

interface WebhookConfig {
  provider: 'paystack' | 'daraja';
  secretKey: string;
  headerName: string;
  idempotencyKeyField: string;
  eventTypeField: string;
}

interface WebhookContext {
  provider: 'paystack' | 'daraja';
  idempotencyKey: string;
  eventType: string;
  tenantId: string;
  signature: string;
  payload: any;
  isRetry: boolean;
  cachedResponse?: any;
}

declare global {
  namespace Express {
    interface Request {
      webhookContext?: WebhookContext;
      rawBody?: Buffer;
    }
  }
}

/**
 * Capture raw request body for signature verification
 * Must be applied BEFORE express.json() middleware
 */
export function webhookRawBodyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  let rawBody = Buffer.alloc(0);

  req.on('data', (chunk: Buffer) => {
    rawBody = Buffer.concat([rawBody, chunk]);
  });

  req.on('end', () => {
    req.rawBody = rawBody;
    next();
  });
}

/**
 * Verify webhook signature using provider-specific HMAC
 */
function verifyWebhookSignature(
  payload: Buffer,
  signature: string,
  secretKey: string,
  provider: 'paystack' | 'daraja'
): boolean {
  try {
    if (provider === 'paystack') {
      // Paystack uses SHA512 HMAC
      const hash = crypto
        .createHmac('sha512', secretKey)
        .update(payload)
        .digest('hex');
      return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
    } else if (provider === 'daraja') {
      // Daraja uses SHA256 HMAC
      const hash = crypto
        .createHmac('sha256', secretKey)
        .update(payload)
        .digest('hex');
      return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
    }
    return false;
  } catch (error) {
    logger.error('Webhook signature verification failed', {
      provider,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Extract idempotency key from webhook payload
 */
function extractIdempotencyKey(
  payload: any,
  provider: 'paystack' | 'daraja'
): string {
  if (provider === 'paystack') {
    // Paystack reference: payload.data.reference or payload.reference
    return (
      payload?.data?.reference || payload?.reference || ''
    ).toString();
  } else if (provider === 'daraja') {
    // Daraja transaction ID: payload.Body.stkCallback.CheckoutRequestID
    return (
      payload?.Body?.stkCallback?.CheckoutRequestID ||
      payload?.Body?.trans?.id ||
      ''
    ).toString();
  }
  return '';
}

/**
 * Extract event type from webhook payload
 */
function extractEventType(
  payload: any,
  provider: 'paystack' | 'daraja'
): string {
  if (provider === 'paystack') {
    return payload?.event || 'charge.success';
  } else if (provider === 'daraja') {
    return payload?.Body?.stkCallback ? 'stk_callback' : 'unknown';
  }
  return 'unknown';
}

/**
 * Check if webhook has already been processed
 */
async function checkWebhookProcessed(
  tenantId: string,
  provider: string,
  idempotencyKey: string,
  trx: any
): Promise<{ processed: boolean; response?: any }> {
  try {
    const existing = await trx
      .selectFrom('webhook_idempotency' as any)
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('provider', '=', provider)
      .where('idempotency_key', '=', idempotencyKey)
      .executeTakeFirst();

    if (existing) {
      return {
        processed: true,
        response: existing.cached_response
          ? JSON.parse(existing.cached_response)
          : undefined,
      };
    }

    return { processed: false };
  } catch (error) {
    logger.error('Failed to check webhook idempotency', {
      tenantId,
      provider,
      idempotencyKey,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Mark webhook as processed with cached response
 */
async function markWebhookProcessed(
  tenantId: string,
  provider: string,
  idempotencyKey: string,
  eventType: string,
  signature: string,
  cachedResponse: any,
  trx: any
): Promise<void> {
  try {
    await trx
      .insertInto('webhook_idempotency' as any)
      .values({
        tenant_id: tenantId,
        provider,
        idempotency_key: idempotencyKey,
        event_type: eventType,
        signature,
        cached_response: JSON.stringify(cachedResponse),
        processed_at: new Date(),
        status: 'processed',
      })
      .execute();

    logger.info('Webhook marked as processed', {
      tenantId,
      provider,
      idempotencyKey,
      eventType,
    });
  } catch (error) {
    logger.error('Failed to mark webhook as processed', {
      tenantId,
      provider,
      idempotencyKey,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Create webhook verification middleware factory
 *
 * Usage:
 *   const paystackWebhookMiddleware = createWebhookVerificationMiddleware({
 *     provider: 'paystack',
 *     secretKey: process.env.PAYSTACK_WEBHOOK_HMAC_SECRET,
 *     headerName: 'x-paystack-signature',
 *     idempotencyKeyField: 'data.reference',
 *     eventTypeField: 'event'
 *   });
 *
 *   router.post('/webhook/paystack', paystackWebhookMiddleware, handler);
 */
export function createWebhookVerificationMiddleware(config: WebhookConfig) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      // Validate raw body exists
      if (!req.rawBody) {
        throw new AppError(
          'WEBHOOK_MISSING_BODY',
          'Webhook body not captured. Ensure webhookRawBodyMiddleware runs first.',
          400
        );
      }

      // Extract and verify signature
      const signature = req.headers[config.headerName] as string;
      if (!signature) {
        throw new AppError(
          'WEBHOOK_MISSING_SIGNATURE',
          `Missing webhook signature header: ${config.headerName}`,
          401
        );
      }

      const isValid = verifyWebhookSignature(
        req.rawBody,
        signature,
        config.secretKey,
        config.provider
      );

      if (!isValid) {
        logger.warn('Webhook signature verification failed', {
          provider: config.provider,
          signature: signature.substring(0, 20) + '...',
        });
        throw new AppError(
          'WEBHOOK_INVALID_SIGNATURE',
          'Webhook signature verification failed',
          401
        );
      }

      // Parse payload
      let payload;
      try {
        payload = JSON.parse(req.rawBody.toString('utf-8'));
      } catch {
        throw new AppError(
          'WEBHOOK_INVALID_JSON',
          'Webhook payload is not valid JSON',
          400
        );
      }

      // Extract idempotency key
      const idempotencyKey = extractIdempotencyKey(payload, config.provider);
      if (!idempotencyKey) {
        throw new AppError(
          'WEBHOOK_MISSING_IDEMPOTENCY_KEY',
          `Could not extract idempotency key from ${config.provider} webhook`,
          400
        );
      }

      // Extract event type
      const eventType = extractEventType(payload, config.provider);

      // Verify tenant context (must come from payload, not headers)
      const tenantContext = verifyTenantContext(req);

      // Get database transaction
      const trx = getDbTransaction(req);

      // Check if webhook already processed
      const { processed, response: cachedResponse } =
        await checkWebhookProcessed(
          tenantContext.tenantId,
          config.provider,
          idempotencyKey,
          trx
        );

      // Create webhook context
      req.webhookContext = {
        provider: config.provider,
        idempotencyKey,
        eventType,
        tenantId: tenantContext.tenantId,
        signature,
        payload,
        isRetry: processed,
        cachedResponse,
      };

      // If retry detected, return cached response
      if (processed) {
        logger.info('Webhook retry detected, returning cached response', {
          provider: config.provider,
          idempotencyKey,
          tenantId: tenantContext.tenantId,
        });

        return res.status(200).json(cachedResponse || { status: 'ok' });
      }

      // Attach hook to save response after successful processing
      const originalJson = res.json.bind(res);
      res.json = function (data: any) {
        res.json = originalJson;

        // Schedule background task to mark webhook as processed
        // This happens after successful route handler execution
        setImmediate(async () => {
          try {
            await markWebhookProcessed(
              tenantContext.tenantId,
              config.provider,
              idempotencyKey,
              eventType,
              signature,
              data,
              trx
            );
          } catch (error) {
            logger.error('Failed to mark webhook as processed in background', {
              provider: config.provider,
              idempotencyKey,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });

        return originalJson(data);
      };

      next();
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({
          error: error.code,
          message: error.message,
          timestamp: new Date().toISOString(),
        });
      } else {
        logger.error('Webhook verification middleware error', {
          provider: config.provider,
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({
          error: 'WEBHOOK_VERIFICATION_FAILED',
          message: 'Failed to verify webhook',
          timestamp: new Date().toISOString(),
        });
      }
    }
  };
}

/**
 * Helper function to mark webhook as failed (for error scenarios)
 * Call this if route handler throws after webhook has been validated
 */
export async function markWebhookFailed(
  req: Request,
  error: Error
): Promise<void> {
  try {
    if (!req.webhookContext) {
      logger.warn('Webhook context not available for failure marking');
      return;
    }

    const trx = getDbTransaction(req);
    const { provider, idempotencyKey, tenantId, eventType, signature } =
      req.webhookContext;

    await trx
      .insertInto('webhook_idempotency' as any)
      .values({
        tenant_id: tenantId,
        provider,
        idempotency_key: idempotencyKey,
        event_type: eventType,
        signature,
        error_message: error.message,
        processed_at: new Date(),
        status: 'failed',
      })
      .execute();

    logger.info('Webhook marked as failed', {
      provider,
      idempotencyKey,
      tenantId,
      error: error.message,
    });
  } catch (markError) {
    logger.error('Failed to mark webhook as failed', {
      error: markError instanceof Error ? markError.message : String(markError),
    });
  }
}

/**
 * Retry webhook processing logic for background job
 */
export async function retryFailedWebhook(
  idempotencyKey: string,
  provider: string,
  handler: (payload: any) => Promise<any>
): Promise<void> {
  try {
    const webhookRecord = await db
      .selectFrom('webhook_idempotency' as any)
      .selectAll()
      .where('idempotency_key', '=', idempotencyKey)
      .where('provider', '=', provider)
      .where('status', '=', 'failed')
      .executeTakeFirst();

    if (!webhookRecord) {
      logger.warn('Failed webhook record not found', {
        idempotencyKey,
        provider,
      });
      return;
    }

    const payload = webhookRecord.payload
      ? JSON.parse(webhookRecord.payload)
      : null;
    if (!payload) {
      throw new Error('Webhook payload not stored');
    }

    // Re-execute handler
    const result = await handler(payload);

    // Mark as processed
    await db
      .updateTable('webhook_idempotency' as any)
      .set({
        status: 'processed',
        cached_response: JSON.stringify(result),
        retry_count: (webhookRecord.retry_count || 0) + 1,
      })
      .where('idempotency_key', '=', idempotencyKey)
      .where('provider', '=', provider)
      .execute();

    logger.info('Failed webhook retry succeeded', {
      idempotencyKey,
      provider,
    });
  } catch (error) {
    logger.error('Failed webhook retry failed', {
      idempotencyKey,
      provider,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export default createWebhookVerificationMiddleware;