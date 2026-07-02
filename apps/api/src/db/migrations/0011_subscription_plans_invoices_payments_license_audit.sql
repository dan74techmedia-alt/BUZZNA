-- ============================================================================
-- Migration 0011: Billing (Subscriptions, Invoices, Payments)
-- ============================================================================

CREATE TABLE IF NOT EXISTS subscription_plans (
  plan_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_name varchar(100) NOT NULL,
  price_monthly numeric(12, 2) NOT NULL,
  features jsonb,
  
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoices (
  invoice_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
  plan_id uuid REFERENCES subscription_plans(plan_id),
  
  invoice_number varchar(50) NOT NULL UNIQUE,
  amount_due numeric(12, 2) NOT NULL,
  amount_paid numeric(12, 2) DEFAULT 0,
  
  status varchar(50),  -- DRAFT, SENT, PAID, OVERDUE
  due_date date,
  paid_at timestamptz,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS paystack_payments (
  payment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES invoices(invoice_id),
  
  paystack_reference varchar(100) UNIQUE,
  amount numeric(12, 2) NOT NULL,
  status varchar(50),  -- success, failed, pending
  
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE paystack_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON invoices
  FOR ALL USING (tenant_id = current_tenant_uuid());

CREATE POLICY "tenant_isolation" ON paystack_payments
  FOR ALL USING (tenant_id = current_tenant_uuid());

-- Indexes
CREATE INDEX idx_invoices_tenant ON invoices(tenant_id);
CREATE INDEX idx_invoices_due_date ON invoices(due_date);
CREATE INDEX idx_paystack_payments_tenant ON paystack_payments(tenant_id);
CREATE INDEX idx_paystack_payments_reference ON paystack_payments(paystack_reference);
