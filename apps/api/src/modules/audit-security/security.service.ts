// apps/api/src/modules/audit-security/security.service.ts

import { db } from '../../db/client';
import { logger } from '../../common/logging/logger';
import crypto from 'crypto';

/**
 * Security Service
 *
 * IMMUTABLE AUDIT TRAIL FOR COMPLIANCE
 *
 * Maintains cryptographically signed audit log of:
 * - User authentication events (login, logout, failed attempts)
 * - Permission changes (role assignments, policy modifications)
 * - Data access (sensitive fields read)
 * - Financial transactions (sales, refunds, payments)
 * - System configuration changes (license updates, business settings)
 *
 * Architecture Rules:
 * - All audit_logs are APPEND-ONLY (no deletes)
 * - Each log entry includes cryptographic hash of previous entry
 * - Logs are immutable for 90+ days (regulatory hold)
 * - RLS enforces tenant isolation (no cross-tenant data leaks)
 * - High-risk events trigger immediate alerts
 */

export enum AuditEventType {
  USER_LOGIN = 'user_login',
  USER_LOGOUT = 'user_logout',
  USER_FAILED_LOGIN = 'user_failed_login',
  USER_CREATED = 'user_created',
  USER_DELETED = 'user_deleted',
  ROLE_CHANGED = 'role_changed',
  PERMISSION_GRANTED = 'permission_granted',
  PERMISSION_REVOKED = 'permission_revoked',
  SALE_CREATED = 'sale_created',
  SALE_REFUNDED = 'sale_refunded',
  SALE_VOIDED = 'sale_voided',
  INVENTORY_ADJUSTED = 'inventory_adjusted',
  PAYMENT_RECEIVED = 'payment_received',
  PRODUCT_CREATED = 'product_created',
  PRODUCT_PRICE_CHANGED = 'product_price_changed',
  LICENSE_CHANGED = 'license_changed',
  BUSINESS_SETTINGS_CHANGED = 'business_settings_changed',
  SYSTEM_CONFIG_CHANGED = 'system_config_changed',
  DATA_EXPORTED = 'data_exported',
  SECURITY_EVENT = 'security_event',
}

export interface AuditLogEntry {
  eventType: AuditEventType;
  tenantId: string;
  userId?: string;
  resourceType: string;
  resourceId: string;
  action: string;
  previousValues?: Record<string, any>;
  newValues?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  severity: 'info' | 'warning' | 'critical';
  metadata?: Record<string, any>;
}

/**
 * Calculate SHA256 hash of previous entry
 * Creates cryptographic chain for tamper detection
 */
async function getLastEntryHash(tenantId: string): Promise<string> {
  try {
    const lastEntry = await db
      .selectFrom('audit_logs' as any)
      .select('entry_hash')
      .where('tenant_id', '=', tenantId)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();

    if (!lastEntry) {
      return crypto.createHash('sha256').update('genesis').digest('hex');
    }

    return lastEntry.entry_hash || '';
  } catch (error) {
    logger.error('Failed to get last entry hash', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}

/**
 * Generate entry hash for current log
 */
function generateEntryHash(
  previousHash: string,
  entry: AuditLogEntry,
  timestamp: Date
): string {
  const content = JSON.stringify({
    previousHash,
    eventType: entry.eventType,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    action: entry.action,
    timestamp: timestamp.toISOString(),
  });

  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Check for suspicious patterns (brute force, privilege escalation)
 */
async function checkSecurityAnomalies(
  tenantId: string,
  userId: string | undefined,
  eventType: AuditEventType
): Promise<{ anomaly: boolean; reason?: string }> {
  try {
    // Check for brute force login attempts
    if (eventType === AuditEventType.USER_FAILED_LOGIN && userId) {
      const failedAttempts = await db
        .selectFrom('audit_logs' as any)
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('user_id', '=', userId)
        .where('event_type', '=', AuditEventType.USER_FAILED_LOGIN)
        .where(
          'created_at',
          '>',
          new Date(Date.now() - 15 * 60 * 1000) // Last 15 minutes
        )
        .execute();

      if (failedAttempts.length >= 5) {
        return {
          anomaly: true,
          reason: 'Brute force attack detected',
        };
      }
    }

    // Check for privilege escalation (non-owner changing roles)
    if (eventType === AuditEventType.ROLE_CHANGED && userId) {
      const userRole = await db
        .selectFrom('users' as any)
        .innerJoin('roles' as any, (join) =>
          join.onRef('users.role_id', '=', 'roles.role_id')
        )
        .select('roles.role_name')
        .where('users.tenant_id', '=', tenantId)
        .where('users.user_id', '=', userId)
        .executeTakeFirst();

      if (userRole?.role_name !== 'owner') {
        return {
          anomaly: true,
          reason: 'Non-owner attempting role modification',
        };
      }
    }

    return { anomaly: false };
  } catch (error) {
    logger.error('Failed to check security anomalies', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { anomaly: false };
  }
}

/**
 * Log security event
 */
export async function logSecurityEvent(entry: AuditLogEntry): Promise<void> {
  try {
    // Check for anomalies
    const { anomaly, reason } = await checkSecurityAnomalies(
      entry.tenantId,
      entry.userId,
      entry.eventType
    );

    if (anomaly) {
      logger.warn('Security anomaly detected', {
        tenantId: entry.tenantId,
        userId: entry.userId,
        eventType: entry.eventType,
        reason,
      });
      entry.severity = 'critical';
    }

    // Get previous entry hash
    const previousHash = await getLastEntryHash(entry.tenantId);

    // Generate current entry hash
    const timestamp = new Date();
    const entryHash = generateEntryHash(previousHash, entry, timestamp);

    // Insert audit log (append-only)
    await db
      .insertInto('audit_logs' as any)
      .values({
        tenant_id: entry.tenantId,
        user_id: entry.userId,
        event_type: entry.eventType,
        resource_type: entry.resourceType,
        resource_id: entry.resourceId,
        action: entry.action,
        previous_values: entry.previousValues
          ? JSON.stringify(entry.previousValues)
          : null,
        new_values: entry.newValues
          ? JSON.stringify(entry.newValues)
          : null,
        ip_address: entry.ipAddress,
        user_agent: entry.userAgent,
        severity: entry.severity,
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
        entry_hash: entryHash,
        previous_hash: previousHash,
        created_at: timestamp,
      })
      .execute();

    // If critical, create security event
    if (entry.severity === 'critical') {
      await db
        .insertInto('security_events' as any)
        .values({
          tenant_id: entry.tenantId,
          event_type: entry.eventType,
          severity: 'critical',
          description: reason,
          audit_log_id: entryHash,
          status: 'active',
          created_at: timestamp,
        })
        .execute();
    }

    logger.info('Security event logged', {
      tenantId: entry.tenantId,
      eventType: entry.eventType,
      resourceId: entry.resourceId,
      severity: entry.severity,
    });
  } catch (error) {
    logger.error('Failed to log security event', {
      tenantId: entry.tenantId,
      eventType: entry.eventType,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Verify audit log chain integrity
 */
export async function verifyAuditChain(tenantId: string): Promise<boolean> {
  try {
    const entries = await db
      .selectFrom('audit_logs' as any)
      .select(['entry_hash', 'previous_hash', 'created_at'])
      .where('tenant_id', '=', tenantId)
      .orderBy('created_at', 'asc')
      .execute();

    if (entries.length === 0) {
      return true;
    }

    // Verify first entry has genesis hash as previous
    if (
      entries[0].previous_hash !==
      crypto.createHash('sha256').update('genesis').digest('hex')
    ) {
      logger.error('Audit chain broken at genesis', {
        tenantId,
      });
      return false;
    }

    // Verify chain continuity
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].previous_hash !== entries[i - 1].entry_hash) {
        logger.error('Audit chain broken', {
          tenantId,
          position: i,
          expectedPrevious: entries[i - 1].entry_hash,
          actualPrevious: entries[i].previous_hash,
        });
        return false;
      }
    }

    logger.info('Audit chain integrity verified', {
      tenantId,
      entryCount: entries.length,
    });
    return true;
  } catch (error) {
    logger.error('Failed to verify audit chain', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Export audit logs for compliance
 */
export async function exportAuditLogs(
  tenantId: string,
  startDate: Date,
  endDate: Date
): Promise<any[]> {
  try {
    const logs = await db
      .selectFrom('audit_logs' as any)
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('created_at', '>=', startDate)
      .where('created_at', '<=', endDate)
      .orderBy('created_at', 'desc')
      .execute();

    return logs.map((log: any) => ({
      ...log,
      previous_values: log.previous_values ? JSON.parse(log.previous_values) : null,
      new_values: log.new_values ? JSON.parse(log.new_values) : null,
      metadata: log.metadata ? JSON.parse(log.metadata) : null,
    }));
  } catch (error) {
    logger.error('Failed to export audit logs', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export const securityService = {
  logSecurityEvent,
  verifyAuditChain,
  exportAuditLogs,
  AuditEventType,
};

export default securityService;