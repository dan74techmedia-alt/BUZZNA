import { Request, Response, NextFunction } from 'express';
import { db } from '../../db/client';
import { logger } from '../logging/logger';

/**
 * Middleware for tracking sensitive operations (POST, PUT, DELETE, PATCH).
 * Safely executes after the primary response to prevent blocking client latency.
 */
export const auditLogMiddleware = (entityName: string, actionDesc?: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // We hook into the response 'finish' event to log the audit asynchronously
    res.on('finish', () => {
      // Only log successful mutating actions
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const tenantId = req.tenantId;
        const userId = req.user?.userId || null;
        const action = actionDesc || req.method;
        const clientIp = req.ip || req.headers['x-forwarded-for'] || 'unknown';

        if (!tenantId) {
          logger.warn(`Audit log dropped: Missing tenant context for ${action} on ${entityName}`);
          return;
        }

        // Execute raw query using pg directly or via the configured ORM instance 
        // to write to the `audit_logs` table defined in the schema.
        db.query(
          `INSERT INTO audit_logs (tenant_id, user_id, action, entity_name, client_ip) 
           VALUES ($1, $2, $3, $4, $5)`,
          [tenantId, userId, action, entityName, clientIp]
        ).catch((err) => {
          logger.error(`Failed to write to immutable audit ledger: ${err.message}`, {
            tenantId,
            action,
            entityName,
          });
        });
      }
    });

    next();
  };
};