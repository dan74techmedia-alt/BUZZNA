-- 0015_views_indexes_rls.sql
-- Description: Analytics Materialized Views, Composite Indexes, and Global RLS Policies

-- 1. High-Performance Composite Indexes (Tenant-First Routing)
CREATE INDEX idx_products_tenant_barcode ON products (tenant_id, barcode);
CREATE INDEX idx_inventory_events_sync ON inventory_events (tenant_id, timestamp DESC);
CREATE INDEX idx_sales_sync ON sales (tenant_id, created_at DESC);
CREATE INDEX idx_sale_items_sale ON sale_items (sale_id);
CREATE INDEX idx_customer_ledger_sync ON customer_credit_ledger (tenant_id, customer_id, created_at DESC);

-- 2. Materialized Views for Analytics
-- mv_daily_sales_summary
CREATE MATERIALIZED VIEW mv_daily_sales_summary AS
SELECT
    s.tenant_id,
    DATE(s.created_at) as sale_date,
    COUNT(s.sale_id) as total_transactions,
    SUM(s.total_amount) as gross_sales,
    SUM(s.discount_amount) as total_discounts,
    SUM(CASE WHEN spa.payment_method = 'CASH' THEN spa.amount ELSE 0 END) as cash_revenue,
    SUM(CASE WHEN spa.payment_method = 'MPESA' THEN spa.amount ELSE 0 END) as mpesa_revenue,
    SUM(CASE WHEN spa.payment_method = 'DEBT' THEN spa.amount ELSE 0 END) as debt_issued
FROM sales s
LEFT JOIN sale_payment_allocations spa ON s.sale_id = spa.sale_id
WHERE s.status = 'COMPLETED_VERIFIED'
GROUP BY s.tenant_id, DATE(s.created_at);

CREATE UNIQUE INDEX idx_mv_daily_sales_summary ON mv_daily_sales_summary (tenant_id, sale_date);

-- mv_customer_debt_aging
CREATE MATERIALIZED VIEW mv_customer_debt_aging AS
SELECT
    c.tenant_id,
    c.customer_id,
    c.full_name,
    SUM(ccl.amount_delta) as total_outstanding,
    SUM(CASE WHEN ccl.created_at >= NOW() - INTERVAL '7 days' THEN ccl.amount_delta ELSE 0 END) as debt_0_7_days,
    SUM(CASE WHEN ccl.created_at >= NOW() - INTERVAL '30 days' AND ccl.created_at < NOW() - INTERVAL '7 days' THEN ccl.amount_delta ELSE 0 END) as debt_8_30_days,
    SUM(CASE WHEN ccl.created_at < NOW() - INTERVAL '30 days' THEN ccl.amount_delta ELSE 0 END) as debt_30_plus_days
FROM customers c
JOIN customer_credit_ledger ccl ON c.customer_id = ccl.customer_id
GROUP BY c.tenant_id, c.customer_id, c.full_name
HAVING SUM(ccl.amount_delta) > 0;

CREATE UNIQUE INDEX idx_mv_customer_debt_aging ON mv_customer_debt_aging (tenant_id, customer_id);

-- mv_product_velocity
CREATE MATERIALIZED VIEW mv_product_velocity AS
SELECT
    p.tenant_id,
    p.product_id,
    p.name,
    COUNT(ie.event_id) as transaction_count,
    ABS(SUM(ie.quantity_delta)) as total_units_moved
FROM products p
JOIN inventory_events ie ON p.product_id = ie.product_id
WHERE ie.event_type = 'SALE_DISPATCH'
  AND ie.timestamp >= NOW() - INTERVAL '30 days'
GROUP BY p.tenant_id, p.product_id, p.name;

CREATE UNIQUE INDEX idx_mv_product_velocity ON mv_product_velocity (tenant_id, product_id);

-- mv_stale_capital_audit
CREATE MATERIALIZED VIEW mv_stale_capital_audit AS
SELECT
    p.tenant_id,
    p.product_id,
    p.name,
    p.current_quantity,
    p.cost_floor,
    (p.current_quantity * p.cost_floor) as locked_capital_value,
    MAX(ie.timestamp) as last_movement_date
FROM products p
LEFT JOIN inventory_events ie ON p.product_id = ie.product_id
GROUP BY p.tenant_id, p.product_id, p.name, p.current_quantity, p.cost_floor
HAVING (MAX(ie.timestamp) IS NULL OR MAX(ie.timestamp) < NOW() - INTERVAL '45 days')
   AND p.current_quantity > 0;

CREATE UNIQUE INDEX idx_mv_stale_capital_audit ON mv_stale_capital_audit (tenant_id, product_id);


-- 3. Row Level Security Policies (Strict Tenant Isolation)
-- Create a high-performance STABLE function to read the transaction context variable
CREATE OR REPLACE FUNCTION get_current_tenant_id() RETURNS uuid AS $$
BEGIN
  -- Returns NULL if setting is missing, preventing cross-tenant leakage
  RETURN current_setting('app.current_tenant_id', true)::uuid;
END;
$$ LANGUAGE plpgsql STABLE;

-- Dynamically apply the strict isolation policy to every table containing a tenant_id
DO $$
DECLARE
    target_table text;
BEGIN
    FOR target_table IN
        SELECT table_name
        FROM information_schema.columns
        WHERE column_name = 'tenant_id'
          AND table_schema = 'public'
    LOOP
        EXECUTE format('
            DROP POLICY IF EXISTS tenant_isolation_policy ON %I;
            CREATE POLICY tenant_isolation_policy ON %I
            AS PERMISSIVE FOR ALL
            TO PUBLIC
            USING (tenant_id = get_current_tenant_id())
            WITH CHECK (tenant_id = get_current_tenant_id());
        ', target_table, target_table);
    END LOOP;
END $$;