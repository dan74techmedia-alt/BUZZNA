// apps/api/src/common/middleware/request-id.middleware.ts

import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

/**
 * Request ID Middleware
 *
 * Generates a unique request ID for tracing requests through the system
 * Useful for debugging, log aggregation, and distributed tracing
 *
 * Applied early in middleware chain (Phase 2)
 */

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  // Check if client provided a request ID (X-Request-ID header)
  const clientRequestId = req.headers['x-request-id'] as string;

  // Use client ID if provided and valid, otherwise generate new one
  const requestId = clientRequestId && /^[a-f0-9-]{36}$/.test(clientRequestId)
    ? clientRequestId
    : uuidv4();

  // Attach to request object for use in handlers and logging
  req.requestId = requestId;

  // Add to response headers for client reference
  res.setHeader('X-Request-ID', requestId);

  next();
};
