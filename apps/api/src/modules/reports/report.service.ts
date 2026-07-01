// apps/api/src/modules/reports/report.service.ts

import { db } from '../../db/client';
import { logger } from '../../common/logging/logger';
import { csvService } from './csv.service';
import { pdfService } from './pdf.service';

/**
 * Report Service
 *
 * High-level report generation orchestration
 * Queries materialized views and formats output
 */

export interface ReportOptions {
  tenantId: string;
  userId: string;
  reportType: string;
  format: 'csv' | 'pdf';
  dateRange?: {
    startDate: Date;
    endDate: Date;
  };
}

/**
 * Generate daily sales summary
 */
export async function generateDailySalesSummary(
  tenantId: string,
  format: 'csv' | 'pdf',
  dateRange?: { startDate: Date; endDate: Date }
): Promise<Buffer> {
  try {
    const query = db.selectFrom('mv_daily_sales_summary' as any).selectAll()
      .where('tenant_id', '=', tenantId);

    if (dateRange) {
      query
        .where('date', '>=', dateRange.startDate)
        .where('date', '<=', dateRange.endDate);
    }

    const rows = await query.execute();

    if (format === 'csv') {
      const csv = csvService.generateCSV({
        headers: [
          'date',
          'shift_id',
          'total_sales',
          'gross_revenue',
          'cash_sales',
          'mpesa_sales',
          'debt_sales',
          'net_profit',
        ],
        data: rows,
        includeBOM: true,
      });
      return csvService.toBuffer(csv);
    } else {
      return await pdfService.generatePdfReport({
        title: 'Daily Sales Summary',
        subtitle: dateRange
          ? `${dateRange.startDate.toLocaleDateString()} - ${dateRange.endDate.toLocaleDateString()}`
          : undefined,
        data: rows,
        columns: [
          { key: 'date', label: 'Date', format: 'date' },
          { key: 'shift_id', label: 'Shift ID' },
          { key: 'total_sales', label: 'Total Sales', format: 'number' },
          { key: 'gross_revenue', label: 'Gross Revenue', format: 'currency' },
          { key: 'cash_sales', label: 'Cash Sales', format: 'currency' },
          { key: 'mpesa_sales', label: 'M-Pesa Sales', format: 'currency' },
          { key: 'debt_sales', label: 'Debt Sales', format: 'currency' },
          { key: 'net_profit', label: 'Net Profit', format: 'currency' },
        ],
        generatedAt: new Date(),
        generatedBy: 'BuzzNa Reports API',
      });
    }
  } catch (error) {
    logger.error('Failed to generate daily sales summary', {
      tenantId,
      format,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Generate customer debt aging
 */
export async function generateCustomerDebtAging(
  tenantId: string,
  format: 'csv' | 'pdf'
): Promise<Buffer> {
  try {
    const rows = await db
      .selectFrom('mv_customer_debt_aging' as any)
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('days_overdue', 'desc')
      .execute();

    if (format === 'csv') {
      const csv = csvService.generateCSV({
        headers: [
          'customer_name',
          'phone_number',
          'total_debt',
          'days_overdue',
          'bucket',
          'last_transaction',
        ],
        data: rows,
        includeBOM: true,
      });
      return csvService.toBuffer(csv);
    } else {
      return await pdfService.generatePdfReport({
        title: 'Customer Debt Aging Report',
        data: rows,
        columns: [
          { key: 'customer_name', label: 'Customer' },
          { key: 'phone_number', label: 'Phone' },
          { key: 'total_debt', label: 'Total Debt', format: 'currency' },
          { key: 'days_overdue', label: 'Days Overdue', format: 'number' },
          { key: 'bucket', label: 'Aging Bucket' },
          { key: 'last_transaction', label: 'Last Transaction', format: 'date' },
        ],
        generatedAt: new Date(),
        generatedBy: 'BuzzNa Reports API',
      });
    }
  } catch (error) {
    logger.error('Failed to generate customer debt aging', {
      tenantId,
      format,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Generate product velocity
 */
export async function generateProductVelocity(
  tenantId: string,
  format: 'csv' | 'pdf'
): Promise<Buffer> {
  try {
    const rows = await db
      .selectFrom('mv_product_velocity' as any)
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('velocity_score', 'desc')
      .execute();

    if (format === 'csv') {
      const csv = csvService.generateCSV({
        headers: [
          'product_name',
          'barcode',
          'category',
          'units_sold_30days',
          'revenue_30days',
          'velocity_score',
          'lru_priority',
        ],
        data: rows,
        includeBOM: true,
      });
      return csvService.toBuffer(csv);
    } else {
      return await pdfService.generatePdfReport({
        title: 'Product Velocity Analysis',
        data: rows,
        columns: [
          { key: 'product_name', label: 'Product' },
          { key: 'barcode', label: 'Barcode' },
          { key: 'category', label: 'Category' },
          { key: 'units_sold_30days', label: 'Units (30d)', format: 'number' },
          { key: 'revenue_30days', label: 'Revenue (30d)', format: 'currency' },
          { key: 'velocity_score', label: 'Velocity Score', format: 'number' },
          { key: 'lru_priority', label: 'LRU Priority' },
        ],
        generatedAt: new Date(),
        generatedBy: 'BuzzNa Reports API',
      });
    }
  } catch (error) {
    logger.error('Failed to generate product velocity', {
      tenantId,
      format,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Generate stale capital audit
 */
export async function generateStaleCapitalAudit(
  tenantId: string,
  format: 'csv' | 'pdf'
): Promise<Buffer> {
  try {
    const rows = await db
      .selectFrom('mv_stale_capital_audit' as any)
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('days_without_transaction', '>=', 45)
      .orderBy('days_without_transaction', 'desc')
      .execute();

    if (format === 'csv') {
      const csv = csvService.generateCSV({
        headers: [
          'product_name',
          'barcode',
          'quantity',
          'unit_cost',
          'total_value',
          'days_without_transaction',
          'recommendation',
        ],
        data: rows,
        includeBOM: true,
      });
      return csvService.toBuffer(csv);
    } else {
      return await pdfService.generatePdfReport({
        title: 'Stale Capital Audit Report',
        subtitle: 'Slow-moving inventory (45+ days without sales)',
        data: rows,
        columns: [
          { key: 'product_name', label: 'Product' },
          { key: 'barcode', label: 'Barcode' },
          { key: 'quantity', label: 'Quantity', format: 'number' },
          { key: 'unit_cost', label: 'Unit Cost', format: 'currency' },
          { key: 'total_value', label: 'Total Value', format: 'currency' },
          { key: 'days_without_transaction', label: 'Days (no sales)', format: 'number' },
          { key: 'recommendation', label: 'Recommendation' },
        ],
        generatedAt: new Date(),
        generatedBy: 'BuzzNa Reports API',
      });
    }
  } catch (error) {
    logger.error('Failed to generate stale capital audit', {
      tenantId,
      format,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export const reportService = {
  generateDailySalesSummary,
  generateCustomerDebtAging,
  generateProductVelocity,
  generateStaleCapitalAudit,
};

export default reportService;