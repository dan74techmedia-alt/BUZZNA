-- ============================================================================
-- Migration 0009: Suppliers and Supplier Transactions
-- ============================================================================

CREATE TABLE IF NOT EXISTS suppliers (
  supplier_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
  
  supplier_name varchar(255) NOT NULL,
  phone_number varchar(20),
  email varchar(100),
  
  payment_terms varchar(50),  -- e.g., NET_30, NET_60, PREPAID
  is_active boolean NOT NULL DEFAULT true,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supplier_transactions (
  transaction_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(supplier_id),
  
  transaction_type varchar(20),  -- PURCHASE, RETURN, PAYMENT
  amount numeric(12, 2) NOT NULL,
  
  reference_number varchar(100),
  notes text,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  
  CONSTRAINT supplier_transactions_immutable CHECK (transaction_id IS NOT NULL)
);

-- Enable RLS
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON suppliers
  FOR ALL USING (tenant_id = current_tenant_uuid());

CREATE POLICY "tenant_isolation" ON supplier_transactions
  FOR ALL USING (tenant_id = current_tenant_uuid());

-- Indexes
CREATE INDEX idx_suppliers_tenant ON suppliers(tenant_id);
CREATE INDEX idx_suppliers_active ON suppliers(tenant_id, is_active);
CREATE INDEX idx_supplier_transactions_tenant ON supplier_transactions(tenant_id);
CREATE INDEX idx_supplier_transactions_supplier ON supplier_transactions(supplier_id);
CREATE INDEX idx_supplier_transactions_created ON supplier_transactions(created_at DESC);

-- Make append-only
REVOKE UPDATE, DELETE ON supplier_transactions FROM public;
