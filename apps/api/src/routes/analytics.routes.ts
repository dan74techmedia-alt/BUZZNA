import { Router } from 'express';
import * as analyticsController from '../modules/analytics/analytics.controller';

const router = Router();

// Analytics endpoints strictly read from pre-compiled PostgreSQL Materialized Views.
// These remain active even during SUSPENDED_NON_PAYMENT states.
router.get('/daily-sales', analyticsController.getDailySalesSummary);
router.get('/debt-aging', analyticsController.getCustomerDebtAging);
router.get('/product-velocity', analyticsController.getProductVelocity);
router.get('/stale-capital', analyticsController.getStaleCapitalAudit);
router.get('/attention-cards', analyticsController.getAttentionCards);

export default router;