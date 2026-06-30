-- Migration: 0007_sales_sale_items_payment_allocations_voids_refunds
-- Purpose: Checkout execution logic, multi-payment allocations, and append-only correction logs.

BEGIN;

CREATE TYPE sale_status_enum AS ENUM ('DRAFT', 'COMPLETED_VERIFIED', 'REFUNDED', 'VOIDED');

-- Sales Header Table
CREATE TABLE IF NOT EXISTS sales (
    sale_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
    till_session_id UUID NOT NULL REFERENCES till_sessions(till_session_id),
    customer_id UUID, -- Nullable for walk-in retail
    status sale_status_enum NOT NULL DEFAULT 'DRAFT',
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sale Items Table
CREATE TABLE IF NOT EXISTS sale_items (
    sale_item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
    sale_id UUID NOT NULL REFERENCES sales(sale_id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(product_id),
    quantity NUMERIC(15,3) NOT NULL,
    unit_price NUMERIC(12,2) NOT NULL,
    line_discount NUMERIC(12,2) NOT NULL DEFAULT 0.00
);

-- Payment Allocations Table
CREATE TABLE IF NOT EXISTS sale_payment_allocations (
    allocation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
    sale_id UUID NOT NULL REFERENCES sales(sale_id) ON DELETE CASCADE,
    payment_method VARCHAR NOT NULL, -- e.g., 'CASH', 'MPESA', 'DEBT'
    amount NUMERIC(12,2) NOT NULL,
    merchant_payment_id UUID -- Nullable, mapped to Daraja M-Pesa records later
);

-- Sale Refunds (Append-Only History Preservation)
CREATE TABLE IF NOT EXISTS sale_refunds (
    sale_refund_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
    sale_id UUID NOT NULL REFERENCES sales(sale_id),
    refunded_by UUID NOT NULL REFERENCES users(user_id),
    refund_type VARCHAR NOT NULL,
    refund_amount NUMERIC(12,2) NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sale Voids (Append-Only History Preservation)
CREATE TABLE IF NOT EXISTS sale_voids (
    sale_void_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
    sale_id UUID NOT NULL REFERENCES sales(sale_id),
    voided_by UUID NOT NULL REFERENCES users(user_id),
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- High-Performance Composite Indexing
CREATE INDEX idx_sales_tenant_session ON sales(tenant_id, till_session_id);
CREATE INDEX idx_sale_items_tx ON sale_items(sale_id);
CREATE INDEX idx_sales_sync ON sales(tenant_id, created_at DESC);

-- Row-Level Security (RLS)
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_voids ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_sales ON sales FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
CREATE POLICY tenant_isolation_sale_items ON sale_items FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
CREATE POLICY tenant_isolation_allocations ON sale_payment_allocations FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
CREATE POLICY tenant_isolation_refunds ON sale_refunds FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
CREATE POLICY tenant_isolation_voids ON sale_voids FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

COMMIT;