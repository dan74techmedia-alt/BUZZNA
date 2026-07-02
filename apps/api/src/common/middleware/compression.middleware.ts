// apps/api/src/common/middleware/compression.middleware.ts

import compression from 'compression';
import { Request, Response, NextFunction } from 'express';

/**
 * Compression Middleware
 *
 * Enables gzip and deflate compression for HTTP responses
 * Reduces bandwidth usage by 60-80% for JSON payloads
 *
 * Applied early in middleware chain (Phase 1)
 */
export const compressionMiddleware = compression({
  // Compress responses larger than 1KB
  threshold: 1024,

  // Filter which responses to compress
  filter: (req: Request, res: Response): boolean => {
    // Don't compress if client doesn't support it
    if (req.headers['x-no-compression']) {
      return false;
    }

    // Use compression filter from the compression library
    return compression.filter(req, res);
  },

  // Compression level (1-9, default 6)
  level: 6,
});
