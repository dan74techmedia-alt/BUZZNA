import { db } from '../../config/database';

export class AnalyticsService {

  /**
   * Concurrently refreshes all reporting views.
   * Triggered by a background cron job runner or sync queue batch completion.
   */
  static async refreshReportingViews(): Promise<void> {
    try {
      // ORDER MATTERS: Refresh primary dependencies prior to the master P&L view
      await db.raw('REFRESH MATERIALIZED VIEW CONCURRENTLY daily_sales_summary_mv;');
      await db.raw('REFRESH MATERIALIZED VIEW CONCURRENTLY daily_inventory_cost_summary_mv;');
      await db.raw('REFRESH MATERIALIZED VIEW CONCURRENTLY daily_profit_loss_mv;');
      console.log('[Analytics Sync Engine]: Materialized views refreshed concurrently successfully.');
    } catch (error) {
      console.error('[Analytics Sync Engine Error]: View refresh operation failed:', error);
      throw error;
    }
  }

  /**
   * Retrieves daily profit and loss historical data with rigid tenant context boundaries
   */
  static async getProfitLossHistory(tenantId: string, startDate: string, endDate: string) {
    return await db('daily_profit_loss_mv')
      .where({ tenant_id: tenantId })
      .whereBetween('summary_date', [startDate, endDate])
      .orderBy('summary_date', 'asc');
  }

  /**
   * Compiles single-layer analytical aggregations for owner metrics dashboard cards
   */
  static async getDashboardSummaryCard(tenantId: string, specificDate: string) {
    const defaultMetrics = {
      gross_revenue: "0.00",
      total_refunds: "0.00",
      net_revenue: "0.00",
      cogs: "0.00",
      spoilage_loss: "0.00",
      total_shrinkage_loss: "0.00",
      operational_expenses: "0.00",
      net_profit: "0.00"
    };

    const metrics = await db('daily_profit_loss_mv')
      .where({ tenant_id: tenantId, summary_date: specificDate })
      .first();

    return metrics || { summary_date: specificDate, ...defaultMetrics };
  }
}