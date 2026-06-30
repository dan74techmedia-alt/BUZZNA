// apps/api/src/workers/report-exporter.worker.ts

import { Worker, Job } from 'bullmq';
import { queueConnectionConfig } from '../config/redis';
import { executeIsolatedTenantQuery } from '../db/client';
import { logger } from '../common/logging/logger';

interface ReportExportJobData {
  tenant_id: string;
  report_type: 'DAILY_SALES' | 'CUSTOMER_DEBT_AGING' | 'PRODUCT_VELOCITY';
  format: 'CSV' | 'PDF';
  requester_user_id: string;
}

/**
 * BullMQ Worker: Compiles dense asynchronous financial statement exports
 * explicitly routing queries to pre-compiled materialized views.
 */
export const reportExporterWorker = new Worker<ReportExportJobData>(
  'report-exporter-queue',
  async (job: Job) => {
    const { tenant_id, report_type, format, requester_user_id } = job.data;
    
    logger.info(`[Job ID: ${job.id}] Compiling ${format} ${report_type} report for Tenant ID: ${tenant_id}`);

    try {
      const reportData = await executeIsolatedTenantQuery(tenant_id, async (client) => {
        let query = '';

        switch (report_type) {
          case 'DAILY_SALES':
            query = `SELECT * FROM mv_daily_sales_summary WHERE tenant_id = $1 ORDER BY report_date DESC LIMIT 30;`;
            break;
          case 'CUSTOMER_DEBT_AGING':
            query = `SELECT * FROM mv_customer_debt_aging WHERE tenant_id = $1 ORDER BY total_overdue DESC;`;
            break;
          case 'PRODUCT_VELOCITY':
            query = `SELECT * FROM mv_product_velocity WHERE tenant_id = $1 ORDER BY transaction_count DESC;`;
            break;
          default:
            throw new Error(`Unsupported report type requested: ${report_type}`);
        }

        const result = await client.query(query, [tenant_id]);
        return result.rows;
      });

      // Simulation of heavy formatting computation (e.g., PDF generation or CSV mapping)
      logger.info(`Extracted ${reportData.length} records from materialized view. Generating ${format} artifact...`);
      
      // Note: Implementation of specific PDF/CSV write streams and AWS S3/Cloud Storage upload logic goes here.
      const mockArtifactUrl = `https://storage.buzzna.local/exports/${tenant_id}_${report_type}_${Date.now()}.${format.toLowerCase()}`;

      logger.info(`Report export successful. Artifact localized at: ${mockArtifactUrl}`);
      
      // Dispatch internal system notification to requester_user_id indicating download readiness.
      
      return { status: 'COMPLETED', artifact_url: mockArtifactUrl };

    } catch (error) {
      logger.error(`Report generation failed for Job ${job.id}:`, error);
      throw error;
    }
  },
  {
    connection: queueConnectionConfig,
    concurrency: 5, // Concurrent processing allowed for read-only view extraction
  }
);

reportExporterWorker.on('failed', (job, err) => {
  logger.error(`Report Exporter Worker Failed for Job ${job?.id}: ${err.message}`);
});