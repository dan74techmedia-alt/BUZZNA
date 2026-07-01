import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';

/**
 * Ensures the authenticated user possesses one of the required roles.
 * Expects `req.user` to be populated by the auth.middleware.ts.
 */
export const requireRole = (allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError('Authentication context missing.', 401));
    }

    // Role verification against JWT/Context claims
    if (!allowedRoles.includes(req.user.roleName)) {
      return next(
        new AppError(`Access denied. Requires one of: ${allowedRoles.join(', ')}`, 403)
      );
    }

    next();
  };
};

/**
 * Granular permissions check (for explicit actions like voiding a sale).
 */
export const requirePermission = (requiredPermission: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !req.user.permissions) {
      return next(new AppError('Permission context missing.', 403));
    }

    if (!req.user.permissions.includes(requiredPermission)) {
      return next(
        new AppError(`Forbidden. Missing permission key: ${requiredPermission}`, 403)
      );
    }

    next();
  };
};