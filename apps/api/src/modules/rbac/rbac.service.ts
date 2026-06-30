// File: apps/api/src/modules/rbac/rbac.service.ts
// Purpose: Enforces strict Role-Based Access Control isolation and provides DB lookup utilities.
// Utilizes strict connection encapsulation to prevent pool leakage.

import { PoolClient } from 'pg';
import { db } from '../../config/database';
import { RoleMatrixEnum } from '../../../../../packages/shared-types';

export class RbacService {
    
    /**
     * Retrieves the specific role for a user within a tenant context.
     * Enforces PostgreSQL RLS by setting local transaction variables.
     */
    static async enforceUserRoleAccess(tenantId: string, userId: string): Promise<RoleMatrixEnum> {
        const client: PoolClient = await db.connect();
        try {
            // Strict transaction encapsulation for Connection Pool Leakage Prevention
            await client.query('BEGIN');
            await client.query('SET LOCAL app.current_tenant_id = $1', [tenantId]);
            
            const result = await client.query(`
                SELECT r.role_name 
                FROM users u 
                INNER JOIN roles r ON u.role_id = r.role_id 
                WHERE u.user_id = $2 AND u.is_active = true
            `, [tenantId, userId]);

            await client.query('COMMIT');

            if (result.rowCount === 0) {
                throw new Error('UNAUTHORIZED_ACCESS: User role verification failed within tenant context.');
            }

            return result.rows[0].role_name as RoleMatrixEnum;

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Policy Enforcer - Evaluates if a role is permitted to perform specific destructive actions (like Voiding).
     */
    static canVoidTransaction(role: RoleMatrixEnum): boolean {
        // Only Owners or explicitly configured Managers can void. Cashiers are strictly blocked.
        return [RoleMatrixEnum.OWNER, RoleMatrixEnum.MANAGER].includes(role);
    }
}