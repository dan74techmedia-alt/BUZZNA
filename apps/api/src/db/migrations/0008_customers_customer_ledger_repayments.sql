-- ============================================================================
-- Migration 0008: Customers and Customer Credit Ledger
-- ============================================================================

CREATE TABLE IF NOT EXISTS customers (
  customer_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
  
  phone_number varchar(20),
  customer_name varchar(100),
  email varchar(100),
  
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_credit_ledger (
  ledger_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(customer_id),
  
  transaction_id uuid,  -- Reference to sale or repayment
  transaction_type varchar(20),  -- DEBIT, CREDIT
  
  amount numeric(12, 2) NOT NULL,
  running_balance numeric(12, 2) NOT NULL,
  
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_credit_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON customers
  FOR ALL USING (tenant_id = current_tenant_uuid());

CREATE POLICY "tenant_isolation" ON customer_credit_ledger
  FOR ALL USING (tenant_id = current_tenant_uuid());

-- Indexes
CREATE INDEX idx_customers_tenant ON customers(tenant_id);
CREATE INDEX idx_customers_phone ON customers(tenant_id, phone_number);
CREATE INDEX idx_credit_ledger_tenant ON customer_credit_ledger(tenant_id);
CREATE INDEX idx_credit_ledger_customer ON customer_credit_ledger(customer_id);
CREATE INDEX idx_credit_ledger_created ON customer_credit_ledger(created_at DESC);
