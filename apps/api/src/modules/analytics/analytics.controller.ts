import { Router, Request, Response } from 'express';
import { AnalyticsService } from './analytics.service';
import { z } from 'zod';

export const analyticsRouter = Router();

const dateRangeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format must match YYYY-MM-DD"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format must match YYYY-MM-DD")
});

/**
 * GET /api/v1/analytics/profit-loss
 * Purpose: Pull historical data metrics mapped directly to frontend reporting layouts.
 */
analyticsRouter.get('/profit-loss', async (req: Request, res: Response) => {
  try {
    // 1. Strict Tenant Isolation Extraction (Rule #5 - Never trust client headers)
    const tenantId = req.context?.tenantId; 
    if (!tenantId) {
       return res.status(401).json({ error: "Unauthorized tenant identification context." });
    }

    // 2. Query Parameters Input Validation Checks
    const parsedDates = dateRangeSchema.safeParse({
      startDate: req.query.startDate,
      endDate: req.query.endDate
    });

    if (!parsedDates.success) {
      return res.status(400).json({ error: parsedDates.error.errors[0].message });
    }

    const { startDate, endDate } = parsedDates.data;

    // 3. Execution Data Query Retrieval Trace
    const performanceDataset = await AnalyticsService.getProfitLossHistory(tenantId, startDate, endDate);

    res.status(200).json({
      success: true,
      tenant_id: tenantId,
      range: { startDate, endDate },
      data: performanceDataset
    });

  } catch (error: any) {
    console.error('[Analytics Controller Failure]:', error);
    res.status(500).json({ error: "Internal server error reading materialized reports." });
  }
});

/**
 * GET /api/v1/analytics/summary-card
 */
analyticsRouter.get('/summary-card', async (req: Request, res: Response) => {
  try {
    const tenantId = req.context?.tenantId;
    const targetDate = req.query.date as string || new Date().toISOString().split('T')[0];

    if (!tenantId) {
       return res.status(401).json({ error: "Missing validated token lifecycle claims." });
    }

    const summaryCard = await AnalyticsService.getDashboardSummaryCard(tenantId, targetDate);
    res.status(200).json({ success: true, summary: summaryCard });
    
  } catch (error) {
    res.status(500).json({ error: "Failed to assemble dashboard visualization nodes." });
  }
});