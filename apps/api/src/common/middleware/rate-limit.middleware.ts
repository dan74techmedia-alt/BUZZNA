import rateLimit from 'express-rate-limit';

/**
 * Protects Authentication endpoints (e.g., login, register)
 * Limit: 5 requests per 1 minute per IP.
 */
export const authRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, 
  max: 5,
  message: {
    status: 'error',
    message: 'Too many authentication attempts. Please try again in 1 minute.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Protects Offline-First Synchronization endpoints.
 * Limit: 10 requests per 5 minutes per IP to prevent clients stuck in sync loops from overwhelming the DB.
 */
export const syncRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  message: {
    status: 'error',
    message: 'Synchronization rate limit exceeded. Batch uploads temporarily paused.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});