import { z } from 'zod';

/**
 * Validates request parameters for querying pre-compiled materialized views.
 * Ensures strict date formatting and limits metric requests to approved analytical models.
 */
export const getAnalyticsQuerySchema = z.object({
  query: z.object({
    startDate: z.string().datetime({ 
      message: 'startDate must be a valid ISO 8601 datetime string' 
    }).optional(),
    
    endDate: z.string().datetime({ 
      message: 'endDate must be a valid ISO 8601 datetime string' 
    }).optional(),
    
    view: z.enum([
      'mv_daily_sales_summary',
      'mv_customer_debt_aging',
      'mv_product_velocity',
      'mv_stale_capital_audit'
    ], {
      errorMap: () => ({ message: 'Requested metric view does not exist or is unauthorized' })
    })
  })
});

export type GetAnalyticsQueryInput = z.infer<typeof getAnalyticsQuerySchema>; 