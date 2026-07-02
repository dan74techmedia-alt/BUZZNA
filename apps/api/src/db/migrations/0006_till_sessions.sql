-- ============================================================================
-- Migration 0006: Till Sessions (Cash Drawer Management)
-- ============================================================================

CREATE TABLE IF NOT EXISTS till_sessions (
  session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
  cashier_user_id uuid NOT NULL REFERENCES users(user_id),
  
  status till_session_status_enum NOT NULL DEFAULT 'OPEN',
  
  opening_float numeric(12, 2) NOT NULL,
  expected_cash_balance numeric(12, 2),     -- System calculated
  actual_cash_balance numeric(12, 2),       -- Cashier entered (blind entry)
  
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  
  UNIQUE(tenant_id, cashier_user_id, opened_at)
);

-- Enable RLS
ALTER TABLE till_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON till_sessions
  FOR ALL USING (tenant_id = current_tenant_uuid());

-- Indexes
CREATE INDEX idx_till_sessions_tenant ON till_sessions(tenant_id);
CREATE INDEX idx_till_sessions_cashier ON till_sessions(cashier_user_id);
CREATE INDEX idx_till_sessions_status ON till_sessions(status);
CREATE INDEX idx_till_sessions_opened ON till_sessions(opened_at DESC);
