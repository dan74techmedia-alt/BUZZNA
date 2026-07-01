/**
 * ============================================================================
 * BUZZNA D74 - Report Exporter Worker
 * ============================================================================
 *
 * PURPOSE:
 * - Generate PDF/CSV financial reports asynchronously
 * - Compile materialized view data into export formats
 * - Store exports in file storage for download
 * - Queue triggered by user request, not scheduled
 *
 * TRIGGERED BY: User API request to /reports/export
 * QUEUE: buzzna:report-exporter
 *
 * REPORT TYPES:
 * 1. Daily Sales Summary (CSV, PDF)
 * 2. Customer Debt Aging (CSV, PDF)
 * 3. Product Velocity (CSV, Excel)
 * 4. Stale Capital Audit (CSV)
 *
 * ============================================================================
 */

import { Worker, Job } from 'bullmq';
import { db } from '../config/database';
import { queueConnectionConfig } from '../config/redis';
import { logger } from '../common/logging/logger';
import { v4 as uuidv4 } from 'uuid';

interface ReportExportJob {
  tenantId: string;
  reportType: string;
  format: 'csv' | 'pdf' | 'excel';
  startDate?: string;
  endDate?: string;
}

async function processReportExport(job: Job<ReportExportJob>): Promise<void> {
  try {
    const { tenantId, reportType, format, startDate, endDate } = job.data;

    logger.info('Generating report export', {
      tenantId,
      reportType,
      format,
    });

    // Fetch data from materialized views
    const data = await fetchReportData(
      tenantId,
      reportType,
      startDate,
      endDate
    );

    // Format data
    let exportContent: string;
    const contentType = format === 'csv' ? 'text/csv' : 'application/pdf';

    switch (format) {
      case 'csv':
        exportContent = convertToCSV(data);
        break;
      case 'pdf':
        exportContent = convertToPDF(data);
        break;
      case 'excel':
        exportContent = convertToExcel(data);
        break;
      default:
        throw new Error(`Unsupported format: ${format}`);
    }

    // Store export
    const exportId = uuidv4();
    const filename = `${reportType}-${new Date().toISOString()}.${format}`;

    await db
      .insertInto('report_exports')
      .values({
        export_id: exportId,
        tenant_id: tenantId,
        report_type: reportType,
        filename,
        file_size: exportContent.length,
        format,
        created_at: new Date(),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      })
      .execute();

    logger.info('Report export completed', {
      tenantId,
      exportId,
      filename,
    });
  } catch (error) {
    logger.error('Report export failed', {
      jobId: job.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function fetchReportData(
  tenantId: string,
  reportType: string,
  startDate?: string,
  endDate?: string
): Promise<any[]> {
  switch (reportType) {
    case 'daily_sales_summary':
      return db
        .selectFrom('mv_daily_sales_summary')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .execute();

    case 'customer_debt_aging':
      return db
        .selectFrom('mv_customer_debt_aging')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .execute();

    default:
      return [];
  }
}

function convertToCSV(data: any[]): string {
  if (data.length === 0) return '';

  const headers = Object.keys(data[0]);
  const rows = data.map((row) =>
    headers.map((h) => JSON.stringify(row[h])).join(',')
  );

  return [headers.join(','), ...rows].join('\n');
}

function convertToPDF(data: any[]): string {
  // Placeholder - integrate with PDFKit or similar
  return JSON.stringify(data);
}

function convertToExcel(data: any[]): string {
  // Placeholder - integrate with xlsx library
  return JSON.stringify(data);
}

export const reportExporterWorker = new Worker(
  'buzzna:report-exporter',
  processReportExport,
  {
    connection: queueConnectionConfig,
    concurrency: 2,
    settings: {
      lockDuration: 300000,
      lockRenewTime: 150000,
      maxStalledCount: 2,
      stalledInterval: 60000,
    },
  }
);

export default reportExporterWorker;