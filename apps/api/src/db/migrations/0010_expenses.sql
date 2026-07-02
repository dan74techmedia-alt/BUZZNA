-- ============================================================================
-- Migration 0010: Expenses (Capital Outflow Tracking)
-- ============================================================================

CREATE TABLE IF NOT EXISTS expense_categories (
  category_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
  category_name varchar(100) NOT NULL,
  
  UNIQUE(tenant_id, category_name)
);

CREATE TABLE IF NOT EXISTS expenses (
  expense_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
  category_id uuid REFERENCES expense_categories(category_id),
  
  amount numeric(12, 2) NOT NULL,
  description text,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  
  CONSTRAINT expenses_immutable CHECK (expense_id IS NOT NULL)
);

-- Enable RLS
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON expense_categories
  FOR ALL USING (tenant_id = current_tenant_uuid());

CREATE POLICY "tenant_isolation" ON expenses
  FOR ALL USING (tenant_id = current_tenant_uuid());

-- Indexes
CREATE INDEX idx_expenses_tenant ON expenses(tenant_id);
CREATE INDEX idx_expenses_category ON expenses(category_id);
CREATE INDEX idx_expenses_created ON expenses(created_at DESC);

-- Make append-only
REVOKE UPDATE, DELETE ON expenses FROM public;
