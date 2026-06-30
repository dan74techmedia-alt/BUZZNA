// File: apps/api/src/modules/audit-security/audit.service.ts
// Purpose: Append-only system security ledger. Globally and cryptographically immutable.
// This module provides NO update or delete methods, fulfilling structural business rules.

import { PoolClient } from 'pg';
import { db } from '../../config/database';

export class AuditSecurityService {

    /**
     * Appends an immutable security record to the tenant's audit ledger.
     * Uses JSONB to safely serialize old and new data states.
     */
    static async appendSecurityEvent(
        tenantId: string,
        userId: string | null,
        action: string,
        entityName: string,
        entityId: string | null = null,
        oldValues: Record<string, any> | null = null,
        newValues: Record<string, any> | null = null,
        clientIp: string | null = null
    ): Promise<void> {
        const client: PoolClient = await db.connect();
        
        try {
            // Mandated strict connection encapsulation block
            await client.query('BEGIN');
            await client.query('SET LOCAL app.current_tenant_id = $1', [tenantId]);

            const query = `
                INSERT INTO audit_logs (
                    tenant_id, user_id, action, entity_name, entity_id, 
                    old_values, new_values, client_ip, created_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, now()
                )
            `;

            const params = [
                tenantId,
                userId,
                action,
                entityName,
                entityId,
                oldValues ? JSON.stringify(oldValues) : null,
                newValues ? JSON.stringify(newValues) : null,
                clientIp
            ];

            await client.query(query, params);
            await client.query('COMMIT');
            
        } catch (error) {
            await client.query('ROLLBACK');
            // We intentionally do not suppress security write errors. If audit fails, the upstream transaction must abort.
            throw new Error(`CRITICAL_AUDIT_FAILURE: Unable to append to immutable security log. Details: ${(error as Error).message}`);
        } finally {
            client.release();
        }
    }
}