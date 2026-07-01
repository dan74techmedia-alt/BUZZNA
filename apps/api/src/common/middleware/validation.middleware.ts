import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError } from 'zod';
import { AppError } from '../errors/AppError';

/**
 * Parses and validates the HTTP Request against Zod schemas.
 * Discards unknown keys and normalizes data types.
 */
export const validateRequest = (schema: AnyZodObject) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsedData = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });

      // Override request payload with strictly typed and stripped data
      req.body = parsedData.body;
      req.query = parsedData.query;
      req.params = parsedData.params;

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const issues = error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        }));
        
        // Use 400 Bad Request for validation failures
        res.status(400).json({
          status: 'error',
          message: 'Payload validation failed',
          issues,
        });
        return;
      }
      next(new AppError('Internal validation error', 500));
    }
  };
};