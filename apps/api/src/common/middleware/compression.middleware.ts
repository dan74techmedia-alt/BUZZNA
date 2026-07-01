// apps/api/src/common/middleware/compression.middleware.ts

import { Request, Response, NextFunction } from 'express';
import compressionLib from 'compression';
import { logger } from '../logging/logger';

/**
 * Compression Middleware
 *
 * PERFORMANCE & BANDWIDTH OPTIMIZATION
 *
 * High-latency networks (common in sub-Saharan Africa) benefit significantly
 * from response compression. This middleware:
 * 1. Detects client support for gzip and brotli compression
 * 2. Compresses response bodies (except small responses)
 * 3. Sets appropriate Content-Encoding headers
 * 4. Skips compression for already-compressed formats (images, PDFs)
 *
 * Benefits:
 * - Large JSON responses (analytics, reports) compressed by 70-80%
 * - Reduced bandwidth usage critical for mobile terminals
 * - Faster network roundtrips on slow connections
 *
 * Configuration:
 * - Minimum response size for compression: 1KB
 * - Level 6 compression (balance between speed and ratio)
 * - Skips video, images, audio files
 */

interface CompressionConfig {
  minSize?: number; // Minimum response size to compress (bytes)
  level?: number; // Compression level (1-11, default 6)
  strategy?: number; // Compression strategy
}

/**
 * Check if content should be compressed
 * Skip already-compressed formats
 */
function shouldCompress(
  req: Request,
  res: Response
): boolean {
  const contentType = res.getHeader('Content-Type') as string;

  if (!contentType) {
    return true;
  }

  // Skip compression for already-compressed formats
  const skipPatterns = [
    'image/',
    'video/',
    'audio/',
    'application/octet-stream',
    'application/pdf',
    'application/zip',
    'application/x-7z-compressed',
    'application/gzip',
  ];

  return !skipPatterns.some((pattern) =>
    contentType.includes(pattern)
  );
}

/**
 * Create compression middleware with optimized settings
 */
export function createCompressionMiddleware(
  config: CompressionConfig = {}
): (req: Request, res: Response, next: NextFunction) => void {
  const {
    minSize = 1024, // 1KB minimum
    level = 6, // Balance between speed and compression
    strategy = 3, // RLE for text
  } = config;

  return compressionLib({
    level,
    strategy,
    threshold: minSize,
    filter: (req: Request, res: Response): boolean => {
      // Don't compress if client doesn't support it
      const acceptEncoding = req.headers['accept-encoding'] || '';
      if (!acceptEncoding.includes('gzip') && !acceptEncoding.includes('br')) {
        return false;
      }

      return shouldCompress(req, res);
    },
    // Custom brotli settings if available
    brotli: {
      lgwin: 22, // Window size
      mode: 1, // Text mode
      quality: 6,
    },
  });
}

/**
 * Apply compression logging for debugging
 */
export function compressionLoggingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const originalJson = res.json.bind(res);

  res.json = function (data: any) {
    const contentLength = JSON.stringify(data).length;
    const contentEncoding = res.getHeader('Content-Encoding') as string;

    if (contentEncoding && contentLength > 1024) {
      logger.debug('Response compression applied', {
        path: req.path,
        encoding: contentEncoding,
        originalSize: contentLength,
        method: req.method,
      });
    }

    res.json = originalJson;
    return originalJson(data);
  };

  next();
}

/**
 * Compression middleware instance (pre-configured)
 *
 * Usage:
 *   app.use(compressionMiddleware);
 */
export const compressionMiddleware = createCompressionMiddleware({
  minSize: 1024,
  level: 6,
});

export default compressionMiddleware;