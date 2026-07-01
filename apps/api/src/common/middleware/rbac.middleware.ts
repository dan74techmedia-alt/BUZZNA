// apps/api/src/common/middleware/rbac.middleware.ts

import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';
import { RbacService } from '../../modules/rbac/rbac.service';

/**
 * Factory function that generates RBAC middleware to enforce granular permission requirements.
 * Ensures absolute separation of capabilities across the multi-tenant architecture.
 * * @param requiredPermissions Array of permission keys required to access the route.
 */
export const requirePermissions = (requiredPermissions: string[]) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userContext = req.context?.user;

      if (!userContext || !userContext.userId || !userContext.roleId) {
        throw new AppError('Unauthorized: JWT Context binding missing', 401);
      }

      const rbacService = new RbacService();

      // PostgreSQL RLS ensures the roleId is evaluated securely within the bound tenant_id context
      const hasPermission = await rbacService.checkRolePermissions(
        userContext.roleId,
        requiredPermissions
      );

      if (!hasPermission) {
        throw new AppError('Forbidden: Insufficient RBAC privileges to perform this action', 403);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Explicit guard for Role-Based Overrides (e.g., Only "Owner" or "Manager" can access).
 * Used for high-level system functions where granular permissions are bypassed.
 * * @param allowedRoles Array of role names permitted to execute the route.
 */
export const requireRoles = (allowedRoles: string[]) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userContext = req.context?.user;

      if (!userContext || !userContext.roleName) {
        throw new AppError('Unauthorized: JWT Context binding missing', 401);
      }

      if (!allowedRoles.includes(userContext.roleName)) {
        throw new AppError(
          `Forbidden: Access restricted. Requires one of the following roles: ${allowedRoles.join(', ')}`, 
          403
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};