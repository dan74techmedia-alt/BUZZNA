-- ============================================================================
-- Migration 0015: Materialized Views and Final Indexes
-- ============================================================================

-- Daily Sales Summary View
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_sales_summary AS
SELECT
  tenant_id,
  DATE(created_at) as sale_date,
  payment_method,
  COUNT(*) as transaction_count,
  SUM(gross_total) as total_revenue,
  SUM(discount_total) as total_discounts,
  SUM(net_total) as net_revenue
FROM sales_transactions
GROUP BY tenant_id, DATE(created_at), payment_method;

-- Customer Debt Aging View
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_customer_debt_aging AS
SELECT
  c.tenant_id,
  c.customer_id,
  c.customer_name,
  COALESCE(ccl.running_balance, 0) as outstanding_debt,
  CASE
    WHEN COALESCE(ccl.running_balance, 0) <= 0 THEN '0-7'
    WHEN NOW() - ccl.created_at <= INTERVAL '7 days' THEN '0-7'
    WHEN NOW() - ccl.created_at <= INTERVAL '30 days' THEN '8-30'
    ELSE '30+'
  END as aging_bucket
FROM customers c
LEFT JOIN LATERAL (
  SELECT running_balance, created_at
  FROM customer_credit_ledger
  WHERE customer_id = c.customer_id
  ORDER BY created_at DESC
  LIMIT 1
) ccl ON true
WHERE COALESCE(ccl.running_balance, 0) > 0;

-- Product Velocity View
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_product_velocity AS
SELECT
  p.tenant_id,
  p.product_id,
  p.product_name,
  COUNT(ie.event_id) as transaction_count,
  SUM(ABS(ie.quantity_delta)) as total_units_moved,
  MAX(ie.created_at) as last_transaction_date,
  ROUND(SUM(ABS(ie.quantity_delta))::numeric / NULLIF(DATE_PART('day', NOW() - MIN(ie.created_at)), 0), 2) as velocity_per_day
FROM products p
LEFT JOIN inventory_events ie ON p.product_id = ie.product_id
GROUP BY p.tenant_id, p.product_id, p.product_name;

-- Stale Capital Audit View
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_stale_capital_audit AS
SELECT
  p.tenant_id,
  p.product_id,
  p.product_name,
  p.current_quantity,
  p.retail_price * p.current_quantity as capital_locked,
  MAX(ie.created_at) as last_movement
FROM products p
LEFT JOIN inventory_events ie ON p.product_id = ie.product_id
WHERE p.is_active = true
GROUP BY p.tenant_id, p.product_id, p.product_name, p.current_quantity, p.retail_price
HAVING MAX(ie.created_at) < NOW() - INTERVAL '45 days'
  OR MAX(ie.created_at) IS NULL;

-- Create indexes on materialized views for performance
CREATE INDEX idx_mv_daily_sales_tenant ON mv_daily_sales_summary(tenant_id);
CREATE INDEX idx_mv_daily_sales_date ON mv_daily_sales_summary(sale_date DESC);

CREATE INDEX idx_mv_debt_aging_tenant ON mv_customer_debt_aging(tenant_id);
CREATE INDEX idx_mv_debt_aging_bucket ON mv_customer_debt_aging(aging_bucket);

CREATE INDEX idx_mv_velocity_tenant ON mv_product_velocity(tenant_id);
CREATE INDEX idx_mv_velocity_velocity ON mv_product_velocity(velocity_per_day DESC);

CREATE INDEX idx_mv_stale_capital_tenant ON mv_stale_capital_audit(tenant_id);
CREATE INDEX idx_mv_stale_capital_locked ON mv_stale_capital_audit(capital_locked DESC);
