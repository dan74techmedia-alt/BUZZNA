// apps/api/src/modules/customers/customers.service.ts

import { db, withTenant } from '../../config/database';
import { logger } from '../../common/logging/logger';
import { AppError } from '../../common/errors/AppError';
import { Decimal } from 'decimal.js';

interface CreateCustomerPayload {
  phoneNumber: string;
  fullName: string;
  email?: string;
  creditLimit?: string;
}

interface RecordRepaymentPayload {
  customerId: string;
  amount: string;
  paymentMethod: 'CASH' | 'MPESA' | 'CHECK';
  reference?: string;
}

export class CustomersService {
  /**
   * Create new customer with optional credit limit
   */
  static async createCustomer(
    tenantId: string,
    payload: CreateCustomerPayload
  ): Promise<{ customerId: string }> {
    return await withTenant(tenantId, async (trx) => {
      try {
        // Normalize phone number
        const normalizedPhone = this.normalizePhone(payload.phoneNumber);

        const result = await trx
          .insertInto('customers')
          .values({
            tenant_id: tenantId,
            phone_number: normalizedPhone,
            full_name: payload.fullName,
            email: payload.email || null,
            credit_limit: payload.creditLimit ? new Decimal(payload.creditLimit).toString() : null,
            is_active: true,
            created_at: new Date(),
          })
          .returning('customer_id')
          .executeTakeFirst();

        if (!result) {
          throw new Error('Failed to create customer');
        }

        logger.info('[CustomersService] Customer created', {
          tenantId,
          customerId: result.customer_id,
          phone: normalizedPhone,
        });

        return {
          customerId: result.customer_id,
        };
      } catch (error) {
        logger.error('[CustomersService] Failed to create customer', {
          tenantId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new AppError('Failed to create customer', 500);
      }
    });
  }

  /**
   * Get customer debt summary
   */
  static async getCustomerDebt(
    tenantId: string,
    customerId: string
  ): Promise<{ totalDebt: string; daysBuckets: Record<string, string> }> {
    return await withTenant(tenantId, async (trx) => {
      try {
        // Get all credit ledger entries
        const ledger = await trx
          .selectFrom('customer_credit_ledger')
          .select(['amount_delta', 'created_at'])
          .where('tenant_id', '=', tenantId)
          .where('customer_id', '=', customerId)
          .orderBy('created_at', 'asc')
          .execute();

        // Calculate total debt
        let totalDebt = new Decimal('0');
        for (const entry of ledger) {
          totalDebt = totalDebt.plus(new Decimal(entry.amount_delta));
        }

        // Categorize by aging buckets
        const now = new Date();
        const buckets = {
          '0_7_days': new Decimal('0'),
          '8_30_days': new Decimal('0'),
          '30_plus_days': new Decimal('0'),
        };

        for (const entry of ledger) {
          const ageMs = now.getTime() - new Date(entry.created_at).getTime();
          const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
          const amount = new Decimal(entry.amount_delta);

          if (ageDays <= 7) {
            buckets['0_7_days'] = buckets['0_7_days'].plus(amount);
          } else if (ageDays <= 30) {
            buckets['8_30_days'] = buckets['8_30_days'].plus(amount);
          } else {
            buckets['30_plus_days'] = buckets['30_plus_days'].plus(amount);
          }
        }

        return {
          totalDebt: totalDebt.toString(),
          daysBuckets: {
            '0_7_days': buckets['0_7_days'].toString(),
            '8_30_days': buckets['8_30_days'].toString(),
            '30_plus_days': buckets['30_plus_days'].toString(),
          },
        };
      } catch (error) {
        logger.error('[CustomersService] Failed to get debt', {
          tenantId,
          customerId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new AppError('Failed to calculate customer debt', 500);
      }
    });
  }

  /**
   * Record customer repayment (append-only ledger)
   */
  static async recordRepayment(
    tenantId: string,
    userId: string,
    payload: RecordRepaymentPayload
  ): Promise<{ repaymentId: string; newDebt: string }> {
    return await withTenant(tenantId, async (trx) => {
      try {
        const amount = new Decimal(payload.amount);

        // Record repayment as negative delta in ledger
        const result = await trx
          .insertInto('customer_credit_ledger')
          .values({
            tenant_id: tenantId,
            customer_id: payload.customerId,
            amount_delta: amount.negated().toString(),
            payment_method: payload.paymentMethod,
            reference: payload.reference || null,
            processed_by: userId,
            created_at: new Date(),
          })
          .returning('ledger_id')
          .executeTakeFirst();

        if (!result) {
          throw new Error('Failed to record repayment');
        }

        // Recalculate debt
        const debt = await this.getCustomerDebt(tenantId, payload.customerId);

        logger.info('[CustomersService] Repayment recorded', {
          tenantId,
          customerId: payload.customerId,
          amount: payload.amount,
          method: payload.paymentMethod,
          newDebt: debt.totalDebt,
        });

        return {
          repaymentId: result.ledger_id,
          newDebt: debt.totalDebt,
        };
      } catch (error) {
        logger.error('[CustomersService] Failed to record repayment', {
          tenantId,
          customerId: payload.customerId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new AppError('Failed to record repayment', 500);
      }
    });
  }

  /**
   * Get all customers for tenant
   */
  static async listCustomers(tenantId: string): Promise<any[]> {
    return await withTenant(tenantId, async (trx) => {
      try {
        const customers = await trx
          .selectFrom('customers')
          .select([
            'customer_id',
            'phone_number',
            'full_name',
            'email',
            'credit_limit',
            'is_active',
            'created_at',
          ])
          .where('tenant_id', '=', tenantId)
          .where('is_active', '=', true)
          .orderBy('created_at', 'desc')
          .execute();

        return customers;
      } catch (error) {
        logger.error('[CustomersService] Failed to list customers', {
          tenantId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new AppError('Failed to list customers', 500);
      }
    });
  }

  /**
   * Normalize phone to MSISDN format
   */
  private static normalizePhone(phone: string): string {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 9) {
      return `254${cleaned}`;
    } else if (cleaned.length === 12 && cleaned.startsWith('254')) {
      return cleaned;
    }
    return phone;
  }
}