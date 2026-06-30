// File: apps/api/src/modules/tenancy/tenancy.service.ts
// Purpose: Manages business-specific configurations and license status validation.

import { PoolClient } from 'pg';
import { db } from '../../config/database';
import { LicenseStatusEnum } from '../../../../../packages/shared-types';

export interface IBusinessSettings {
    application_theme: string;
    cash_drawer_variance_limit: string; // Numeric string
    enforce_blind_close: boolean;
}

export class TenancyService {
    
    /**
     * Retrieves business settings for a specific tenant.
     * Enforces strict tenant isolation.
     */
    static async getBusinessSettings(tenantId: string): Promise<IBusinessSettings> {
        const client: PoolClient = await db.connect();
        try {
            await client.query('BEGIN');
            await client.query('SET LOCAL app.current_tenant_id = $1', [tenantId]);

            const query = `
                SELECT application_theme, cash_drawer_variance_limit, enforce_blind_close
                FROM business_settings
                WHERE tenant_id = $1
            `;
            const { rows } = await client.query(query, [tenantId]);
            
            await client.query('COMMIT');

            if (rows.length === 0) {
                throw new Error('TENANCY_ERROR: Business settings not initialized.');
            }

            return rows[0] as IBusinessSettings;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Validates if the current tenant's license is active.
     * Used by middleware to block unauthorized/expired access.
     */
    static async validateLicenseStatus(tenantId: string): Promise<boolean> {
        const client: PoolClient = await db.connect();
        try {
            await client.query('BEGIN');
            await client.query('SET LOCAL app.current_tenant_id = $1', [tenantId]);

            const { rows } = await client.query(`
                SELECT license_status, license_expires_at 
                FROM businesses 
                WHERE tenant_id = $1
            `, [tenantId]);

            await client.query('COMMIT');

            if (rows.length === 0) return false;

            const { license_status, license_expires_at } = rows[0];
            const isExpired = new Date(license_expires_at) < new Date();

            return license_status === LicenseStatusEnum.FULLY_ACTIVATED || 
                   (license_status === LicenseStatusEnum.TRIAL_ACTIVE && !isExpired);
        } catch (error) {
            await client.query('ROLLBACK');
            return false;
        } finally {
            client.release();
        }
    }
}