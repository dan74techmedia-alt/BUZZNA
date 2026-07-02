// apps/api/src/common/middleware/audit.middleware.ts

import { Request, Response, NextFunction } from 'express';
import { logger } from '../logging/logger';

/**
 * Audit Logging Middleware
 *
 * PURPOSE:
 * - Log all HTTP requests and responses for compliance and debugging
 * - Track user actions for security audit trail
 * - Record request/response timings for performance analysis
 * - Applied early (Phase 4) to capture full request lifecycle
 *
 * AUDIT TRAIL CAPTURES:
 * - Request timestamp, method, path
 * - Authenticated user (if available)
 * - Request body size
 * - Response status code
 * - Response time
 * - Tenant context
 *
 * NON-SENSITIVE OPERATIONS:
 * - GET requests to /health
 * - OPTIONS requests (CORS preflight)
 *
 * ============================================================================
 */

interface AuditContext {
  timestamp: number;
  requestId?: string;
  tenantId?: string;
  userId?: string;
}

declare global {
  namespace Express {
    interface Request {
      auditContext?: AuditContext;
    }
  }
}

export const auditMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  // Skip audit logging for health checks and preflight requests
  if (req.path === '/health' || req.method === 'OPTIONS') {
    return next();
  }

  // Record audit context
  const auditContext: AuditContext = {
    timestamp: Date.now(),
    requestId: req.requestId,
    tenantId: req.tenantId,
    userId: req.user?.userId,
  };

  req.auditContext = auditContext;

  // Capture original response.json to intercept response data
  const originalJson = res.json.bind(res);
  res.json = function (body: any) {
    // Log response after it's being sent
    const duration = Date.now() - auditContext.timestamp;
    logger.info('HTTP Request', {
      requestId: auditContext.requestId,
      tenantId: auditContext.tenantId,
      userId: auditContext.userId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: duration,
    });

    return originalJson(body);
  };

  next();
};
