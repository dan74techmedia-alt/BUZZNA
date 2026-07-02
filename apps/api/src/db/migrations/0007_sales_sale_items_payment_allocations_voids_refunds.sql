-- ============================================================================
-- Migration 0007: Sales, Sale Items, Voids, and Refunds
-- ============================================================================

CREATE TABLE IF NOT EXISTS sales_transactions (
  transaction_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES till_sessions(session_id),
  
  sale_status sale_status_enum NOT NULL DEFAULT 'COMPLETED',
  payment_method payment_method_enum NOT NULL,
  payment_status payment_status_enum NOT NULL DEFAULT 'PENDING',
  
  gross_total numeric(12, 2) NOT NULL,
  discount_total numeric(12, 2) DEFAULT 0,
  net_total numeric(12, 2) NOT NULL,
  
  customer_id uuid,  -- Optional: for customer credit sales
  notes text,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  
  CONSTRAINT sales_transactions_immutable CHECK (transaction_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS sale_items (
  item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES sales_transactions(transaction_id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(product_id),
  
  quantity numeric(15, 3) NOT NULL,
  unit_price numeric(12, 2) NOT NULL,
  line_total numeric(12, 2) NOT NULL,
  
  CONSTRAINT sale_items_immutable CHECK (item_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS sale_refunds (
  refund_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES sales_transactions(transaction_id),
  tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
  
  refund_reason varchar(100),
  refund_amount numeric(12, 2) NOT NULL,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  
  CONSTRAINT sale_refunds_immutable CHECK (refund_id IS NOT NULL)
);

-- Enable RLS
ALTER TABLE sales_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_refunds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON sales_transactions
  FOR ALL USING (tenant_id = current_tenant_uuid());

CREATE POLICY "tenant_isolation" ON sale_items
  FOR ALL USING (
    transaction_id IN (
      SELECT transaction_id FROM sales_transactions WHERE tenant_id = current_tenant_uuid()
    )
  );

CREATE POLICY "tenant_isolation" ON sale_refunds
  FOR ALL USING (tenant_id = current_tenant_uuid());

-- Indexes
CREATE INDEX idx_sales_transactions_tenant ON sales_transactions(tenant_id);
CREATE INDEX idx_sales_transactions_session ON sales_transactions(session_id);
CREATE INDEX idx_sales_transactions_created ON sales_transactions(created_at DESC);
CREATE INDEX idx_sale_items_transaction ON sale_items(transaction_id);
CREATE INDEX idx_sale_refunds_transaction ON sale_refunds(transaction_id);

-- Make append-only
REVOKE UPDATE, DELETE ON sales_transactions FROM public;
REVOKE UPDATE, DELETE ON sale_items FROM public;
REVOKE UPDATE, DELETE ON sale_refunds FROM public;
