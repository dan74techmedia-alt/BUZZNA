// apps/api/src/common/middleware/idempotency.middleware.ts

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { AppError } from '../errors/AppError';
import { logger } from '../logging/logger';
import { db } from '../../db/client';
import { getDbTransaction, verifyTenantContext } from './tenant-transaction.middleware';

/**
 * Idempotency Middleware
 *
 * PREVENTS DUPLICATE REQUEST PROCESSING
 *
 * Network retries, client timeouts, and browser back-button clicks can cause
 * identical requests to be submitted multiple times. Without idempotency guards,
 * this can cause:
 * - Duplicate inventory adjustments
 * - Double-charged customers
 * - Corrupted financial records
 * - Duplicate sales entries
 *
 * This middleware:
 * 1. Extracts or generates an Idempotency-Key from request headers
 * 2. Stores request hash + response for subsequent identical requests
 * 3. Returns cached response on duplicate detection
 * 4. Scopes idempotency keys by tenant (isolation)
 * 5. Auto-expires old idempotency records (24-hour TTL)
 *
 * Architecture Rules:
 * - Idempotency-Key must be unique per logical operation (client responsibility)
 * - Safe methods (GET) bypass idempotency checks
 * - Idempotency keys are scoped per tenant (no cross-tenant reuse)
 * - Responses are cached for 24 hours
 */

interface IdempotencyContext {
  key: string;
  requestHash: string;
  isRetry: boolean;
  cachedResponse?: any;
  cachedStatusCode?: number;
}

declare global {
  namespace Express {
    interface Request {
      idempotencyContext?: IdempotencyContext;
    }
  }
}

/**
 * Generate SHA256 hash of request body + method + path
 * Used to detect if this is truly the same request (same idempotency key)
 */
function generateRequestHash(
  method: string,
  path: string,
  body: any
): string {
  const normalized = JSON.stringify({
    method,
    path: path.split('?')[0], // Ignore query params
    body,
  });

  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Extract idempotency key from request
 * Generates one if not provided (for backward compatibility)
 */
function extractIdempotencyKey(req: Request): string {
  const headerKey = req.headers['idempotency-key'] as string;

  if (headerKey) {
    // Validate format: UUID or alphanumeric
    if (!/^[a-zA-Z0-9_-]{8,255}$/.test(headerKey)) {
      throw new AppError(
        'INVALID_IDEMPOTENCY_KEY_FORMAT',
        'Idempotency-Key must be alphanumeric, between 8-255 characters',
        400
      );
    }
    return headerKey;
  }

  // Generate one from request signature if not provided
  const requestHash = generateRequestHash(
    req.method,
    req.path,
    req.body || {}
  );

  return `auto-${requestHash.substring(0, 16)}`;
}

/**
 * Check if idempotent request already processed
 */
async function checkIdempotencyRecord(
  tenantId: string,
  idempotencyKey: string,
  requestHash: string,
  trx: any
): Promise<{
  exists: boolean;
  isRetry: boolean;
  cachedResponse?: any;
  cachedStatusCode?: number;
}> {
  try {
    const record = await trx
      .selectFrom('idempotency_cache' as any)
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('idempotency_key', '=', idempotencyKey)
      .executeTakeFirst();

    if (!record) {
      return { exists: false, isRetry: false };
    }

    // Check if request signature matches
    const isRetry = record.request_hash === requestHash;

    if (!isRetry) {
      // Different request, same key = conflict
      throw new AppError(
        'IDEMPOTENCY_KEY_CONFLICT',
        'Different request with same Idempotency-Key. Use a unique key for each request.',
        422
      );
    }

    // Check if cached response expired (24 hour TTL)
    const createdAt = new Date(record.created_at);
    const now = new Date();
    const ageMs = now.getTime() - createdAt.getTime();
    const ttlMs = 24 * 60 * 60 * 1000; // 24 hours

    if (ageMs > ttlMs) {
      logger.info('Idempotency cache expired', {
        tenantId,
        idempotencyKey,
        age: Math.floor(ageMs / 1000 / 60) + 'm',
      });
      return { exists: false, isRetry: false };
    }

    return {
      exists: true,
      isRetry: true,
      cachedResponse: record.cached_response
        ? JSON.parse(record.cached_response)
        : undefined,
      cachedStatusCode: record.cached_status_code || 200,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;

    logger.error('Failed to check idempotency record', {
      tenantId,
      idempotencyKey,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Store idempotency response
 */
async function storeIdempotencyResponse(
  tenantId: string,
  idempotencyKey: string,
  requestHash: string,
  statusCode: number,
  response: any,
  trx: any
): Promise<void> {
  try {
    await trx
      .insertInto('idempotency_cache' as any)
      .values({
        tenant_id: tenantId,
        idempotency_key: idempotencyKey,
        request_hash: requestHash,
        cached_status_code: statusCode,
        cached_response: JSON.stringify(response),
        created_at: new Date(),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })
      .onConflict((oc) =>
        oc.column('tenant_id', 'idempotency_key').doUpdateSet({
          cached_status_code: statusCode,
          cached_response: JSON.stringify(response),
        })
      )
      .execute();

    logger.debug('Idempotency response stored', {
      tenantId,
      idempotencyKey,
      statusCode,
    });
  } catch (error) {
    logger.error('Failed to store idempotency response', {
      tenantId,
      idempotencyKey,
      error: error instanceof Error ? error.message : String(error),
    });
    // Non-fatal: don't fail request if caching fails
  }
}

/**
 * Idempotency Middleware
 *
 * Usage:
 *   app.use(authMiddleware);
 *   app.use(tenantTransactionMiddleware);
 *   app.use(idempotencyMiddleware);
 *   app.use(routes);
 *
 * In requests:
 *   POST /api/v1/sales
 *   Idempotency-Key: checkout-session-abc123
 *   { items: [...], paymentAllocations: [...] }
 *
 * Duplicate request with same key = returns cached response (202 Accepted or original status)
 */
export const idempotencyMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Skip idempotency checks for safe methods
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return next();
    }

    // Skip for health checks
    if (req.path === '/health' || req.path === '/metrics') {
      return next();
    }

    const tenantContext = verifyTenantContext(req);
    const trx = getDbTransaction(req);

    // Extract idempotency key
    const idempotencyKey = extractIdempotencyKey(req);

    // Generate request hash
    const requestHash = generateRequestHash(req.method, req.path, req.body || {});

    // Check if already processed
    const { isRetry, cachedResponse, cachedStatusCode } =
      await checkIdempotencyRecord(
        tenantContext.tenantId,
        idempotencyKey,
        requestHash,
        trx
      );

    // Store context
    req.idempotencyContext = {
      key: idempotencyKey,
      requestHash,
      isRetry,
      cachedResponse,
      cachedStatusCode,
    };

    // If retry, return cached response immediately
    if (isRetry) {
      logger.info('Idempotent request retry detected, returning cached response', {
        tenantId: tenantContext.tenantId,
        idempotencyKey,
        originalStatusCode: cachedStatusCode,
      });

      return res.status(cachedStatusCode || 200).json({
        ...cachedResponse,
        _idempotentRetry: true,
        idempotencyKey,
      });
    }

    // Hook into response to cache it
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    res.json = function (data: any) {
      const statusCode = res.statusCode || 200;

      // Cache successful responses (2xx status codes)
      if (statusCode >= 200 && statusCode < 300) {
        storeIdempotencyResponse(
          tenantContext.tenantId,
          idempotencyKey,
          statusCode,
          data,
          trx
        ).catch((error) => {
          logger.error('Failed to cache idempotency response', {
            error:
              error instanceof Error ? error.message : String(error),
          });
        });
      }

      res.json = originalJson;
      return originalJson.call(this, data);
    };

    res.send = function (data: any) {
      const statusCode = res.statusCode || 200;

      if (statusCode >= 200 && statusCode < 300 && typeof data === 'string') {
        try {
          const parsed = JSON.parse(data);
          storeIdempotencyResponse(
            tenantContext.tenantId,
            idempotencyKey,
            statusCode,
            parsed,
            trx
          ).catch((error) => {
            logger.error('Failed to cache idempotency response', {
              error:
                error instanceof Error ? error.message : String(error),
            });
          });
        } catch {
          // Non-JSON response, skip caching
        }
      }

      res.send = originalSend;
      return originalSend.call(this, data);
    };

    // Add idempotency key to response headers
    res.setHeader('Idempotency-Key', idempotencyKey);

    next();
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        error: error.code,
        message: error.message,
        timestamp: new Date().toISOString(),
      });
    } else {
      logger.error('Idempotency middleware error', {
        path: req.path,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({
        error: 'IDEMPOTENCY_CHECK_FAILED',
        message: 'Failed to process idempotency check',
        timestamp: new Date().toISOString(),
      });
    }
  }
};

/**
 * Helper to clean up expired idempotency records
 * Schedule this as a background worker task
 */
export async function cleanupExpiredIdempotencyRecords(): Promise<void> {
  try {
    const result = await db
      .deleteFrom('idempotency_cache' as any)
      .where('expires_at', '<', new Date())
      .executeTakeFirst();

    logger.info('Cleaned up expired idempotency records', {
      deletedCount: result.numDeletedRows || 0,
    });
  } catch (error) {
    logger.error('Failed to cleanup idempotency records', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export default idempotencyMiddleware;