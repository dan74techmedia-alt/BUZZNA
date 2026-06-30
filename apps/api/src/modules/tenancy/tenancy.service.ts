// apps/api/src/modules/tenancy/tenancy.service.ts

import { executeIsolatedTenantQuery, executeIsolatedTenantTransaction } from '../../db/client';
import { AppError } from '../../common/errors/AppError';
import { logger } from '../../common/logging/logger';

export interface BusinessProfile {
  tenant_id: string;
  legal_name: string;
  trade_name: string | null;
  license_status: 'TRIAL_ACTIVE' | 'FULLY_ACTIVATED' | 'PAYMENT_DUE' | 'GRACE_PERIOD' | 'SUSPENDED_NON_PAYMENT';
  license_expires_at: Date;
}

export interface BusinessSettings {
  default_tax_rate: number;
  currency_code: string;
  timezone: string;
  receipt_footer_message: string | null;
}

export class TenancyService {
  /**
   * Retrieves the core SaaS entitlement snapshot for the active business.
   * Required for the UI to enforce feature lockdowns locally via IndexedDB business_snapshot.
   */
  static async getBusinessProfile(tenantId: string): Promise<BusinessProfile> {
    return executeIsolatedTenantQuery(tenantId, async (client) => {
      const query = `
        SELECT tenant_id, legal_name, trade_name, license_status, license_expires_at 
        FROM businesses 
        WHERE tenant_id = $1
        LIMIT 1;
      `;
      
      const result = await client.query<BusinessProfile>(query, [tenantId]);
      
      if (result.rows.length === 0) {
        throw new AppError('Business profile not found or access completely restricted by RLS.', 404);
      }
      
      return result.rows[0];
    });
  }

  /**
   * Fetches operational configuration settings bound to the specific tenant.
   */
  static async getBusinessSettings(tenantId: string): Promise<BusinessSettings> {
    return executeIsolatedTenantQuery(tenantId, async (client) => {
      const query = `
        SELECT default_tax_rate, currency_code, timezone, receipt_footer_message 
        FROM business_settings 
        WHERE tenant_id = $1
        LIMIT 1;
      `;
      
      const result = await client.query<BusinessSettings>(query, [tenantId]);
      
      if (result.rows.length === 0) {
        throw new AppError('Business settings configuration missing for active tenant.', 404);
      }
      
      return result.rows[0];
    });
  }

  /**
   * Updates mutable business settings. Enforces strict write encapsulation.
   */
  static async updateBusinessSettings(
    tenantId: string, 
    updates: Partial<BusinessSettings>
  ): Promise<BusinessSettings> {
    return executeIsolatedTenantTransaction(tenantId, async (client) => {
      const fields: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (updates.default_tax_rate !== undefined) {
        fields.push(`default_tax_rate = $${paramIndex++}`);
        values.push(updates.default_tax_rate);
      }
      if (updates.currency_code !== undefined) {
        fields.push(`currency_code = $${paramIndex++}`);
        values.push(updates.currency_code);
      }
      if (updates.timezone !== undefined) {
        fields.push(`timezone = $${paramIndex++}`);
        values.push(updates.timezone);
      }
      if (updates.receipt_footer_message !== undefined) {
        fields.push(`receipt_footer_message = $${paramIndex++}`);
        values.push(updates.receipt_footer_message);
      }

      if (fields.length === 0) {
        throw new AppError('No valid settings provided for update operation.', 400);
      }

      // Add tenant_id to values array for the WHERE clause isolation validation
      values.push(tenantId);

      const query = `
        UPDATE business_settings 
        SET ${fields.join(', ')}, updated_at = NOW() 
        WHERE tenant_id = $${paramIndex}
        RETURNING default_tax_rate, currency_code, timezone, receipt_footer_message;
      `;

      const result = await client.query<BusinessSettings>(query, values);

      if (result.rows.length === 0) {
        throw new AppError('Failed to apply settings update. RLS constraint failure or missing tenant context.', 500);
      }

      logger.info(`Business settings successfully mutated for Tenant ID: ${tenantId}`);
      return result.rows[0];
    });
  }
}