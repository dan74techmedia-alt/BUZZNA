import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from './AppError';
import { logger } from '../logging/logger';

/**
 * Global Express error handling middleware.
 * Must be mounted at the absolute end of the application routing chain.
 */
export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const reqMeta = logger.extractRequestMeta(req);

  // 1. Handle strict compile-time TypeScript Zod validation failures
  if (err instanceof ZodError) {
    logger.warn('Schema Validation Failed', { 
      ...reqMeta, 
      issues: err.errors 
    });
    
    res.status(400).json({
      status: 'error',
      code: 'VALIDATION_FAILED',
      message: 'Invalid request payload structures.',
      details: err.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    });
    return;
  }

  // 2. Handle known operational Application Errors (e.g., RBAC denial, RBAC lockout)
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error(`Operational Server Error: ${err.message}`, { ...reqMeta, stack: err.stack });
    } else {
      logger.warn(`Client Error: ${err.message}`, { ...reqMeta, code: err.errorCode });
    }

    res.status(err.statusCode).json({
      status: 'error',
      code: err.errorCode || 'OPERATION_FAILED',
      message: err.message,
    });
    return;
  }

  // 3. Handle unknown fatal/programming exceptions (e.g., PostgreSQL connection failures)
  logger.error('Unhandled System Exception', {
    ...reqMeta,
    message: err.message,
    stack: err.stack,
  });

  const responseMessage = process.env.NODE_ENV === 'production'
    ? 'An unexpected internal server error occurred. This anomaly has been logged.'
    : err.message;

  res.status(500).json({
    status: 'error',
    code: 'INTERNAL_SERVER_ERROR',
    message: responseMessage,
  });
};