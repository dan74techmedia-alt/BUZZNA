// apps/api/src/modules/suppliers/suppliers.service.ts

import { db, withTenant } from '../../config/database';
import { logger } from '../../common/logging/logger';
import { AppError } from '../../common/errors/AppError';
import { Decimal } from 'decimal.js';

interface CreateSupplierPayload {
  businessName: string;
  phoneNumber: string;
  email?: string;
  paymentTerms?: string;
  creditLimit?: string;
}

interface RecordPurchasePayload {
  supplierId: string;
  productId: string;
  quantity: string;
  unitCost: string;
  invoiceNumber?: string;
  dueDate?: Date;
}

export class SuppliersService {
  /**
   * Create new supplier
   */
  static async createSupplier(
    tenantId: string,
    payload: CreateSupplierPayload
  ): Promise<{ supplierId: string }> {
    return await withTenant(tenantId, async (trx) => {
      try {
        const result = await trx
          .insertInto('suppliers')
          .values({
            tenant_id: tenantId,
            business_name: payload.businessName,
            phone_number: payload.phoneNumber,
            email: payload.email || null,
            payment_terms: payload.paymentTerms || null,
            credit_limit: payload.creditLimit ? new Decimal(payload.creditLimit).toString() : null,
            is_active: true,
            created_at: new Date(),
          })
          .returning('supplier_id')
          .executeTakeFirst();

        if (!result) {
          throw new Error('Failed to create supplier');
        }

        logger.info('[SuppliersService] Supplier created', {
          tenantId,
          supplierId: result.supplier_id,
        });

        return {
          supplierId: result.supplier_id,
        };
      } catch (error) {
        logger.error('[SuppliersService] Failed to create supplier', {
          tenantId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new AppError('Failed to create supplier', 500);
      }
    });
  }

  /**
   * Record purchase order from supplier (append-only)
   */
  static async recordPurchase(
    tenantId: string,
    userId: string,
    payload: RecordPurchasePayload
  ): Promise<{ transactionId: string; totalCost: string }> {
    return await withTenant(tenantId, async (trx) => {
      try {
        const quantity = new Decimal(payload.quantity);
        const unitCost = new Decimal(payload.unitCost);
        const totalCost = quantity.times(unitCost);

        // Record supplier transaction (append-only)
        const result = await trx
          .insertInto('supplier_transactions')
          .values({
            tenant_id: tenantId,
            supplier_id: payload.supplierId,
            product_id: payload.productId,
            quantity: quantity.toString(),
            unit_cost: unitCost.toString(),
            total_cost: totalCost.toString(),
            invoice_number: payload.invoiceNumber || null,
            due_date: payload.dueDate || null,
            status: 'PENDING',
            recorded_by: userId,
            created_at: new Date(),
          })
          .returning('transaction_id')
          .executeTakeFirst();

        if (!result) {
          throw new Error('Failed to record purchase');
        }

        // Create inventory event for restock
        await trx
          .insertInto('inventory_events')
          .values({
            tenant_id: tenantId,
            product_id: payload.productId,
            event_type: 'STOCK_ADD',
            quantity_delta: quantity.toString(),
            description: `Purchase from supplier: ${result.transaction_id}`,
            created_by: userId,
            created_at: new Date(),
          })
          .execute();

        logger.info('[SuppliersService] Purchase recorded', {
          tenantId,
          supplierId: payload.supplierId,
          quantity: payload.quantity,
          totalCost: totalCost.toString(),
        });

        return {
          transactionId: result.transaction_id,
          totalCost: totalCost.toString(),
        };
      } catch (error) {
        logger.error('[SuppliersService] Failed to record purchase', {
          tenantId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new AppError('Failed to record purchase', 500);
      }
    });
  }

  /**
   * Get all suppliers for tenant
   */
  static async listSuppliers(tenantId: string): Promise<any[]> {
    return await withTenant(tenantId, async (trx) => {
      try {
        const suppliers = await trx
          .selectFrom('suppliers')
          .select([
            'supplier_id',
            'business_name',
            'phone_number',
            'email',
            'credit_limit',
            'is_active',
            'created_at',
          ])
          .where('tenant_id', '=', tenantId)
          .where('is_active', '=', true)
          .execute();

        return suppliers;
      } catch (error) {
        logger.error('[SuppliersService] Failed to list suppliers', {
          tenantId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new AppError('Failed to list suppliers', 500);
      }
    });
  }
}