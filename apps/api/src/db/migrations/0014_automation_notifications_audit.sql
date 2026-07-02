-- ============================================================================
-- Migration 0014: Notifications and Audit Logging
-- ============================================================================

CREATE TABLE IF NOT EXISTS attention_cards (
  card_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
  
  card_type varchar(50),  -- INVENTORY_ANOMALY, TILL_DISCREPANCY, BILLING_OVERDUE, etc.
  severity varchar(20),   -- INFO, WARNING, CRITICAL
  title varchar(255),
  description text,
  
  is_resolved boolean DEFAULT false,
  resolved_at timestamptz,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(user_id),
  
  action varchar(100),
  resource_type varchar(50),
  resource_id uuid,
  
  changes jsonb,
  ip_address inet,
  user_agent text,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  
  CONSTRAINT audit_logs_immutable CHECK (log_id IS NOT NULL)
);

-- Enable RLS
ALTER TABLE attention_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON attention_cards
  FOR ALL USING (tenant_id = current_tenant_uuid());

CREATE POLICY "tenant_isolation" ON audit_logs
  FOR ALL USING (tenant_id = current_tenant_uuid());

-- Indexes
CREATE INDEX idx_attention_cards_tenant ON attention_cards(tenant_id);
CREATE INDEX idx_attention_cards_type ON attention_cards(card_type);
CREATE INDEX idx_attention_cards_resolved ON attention_cards(is_resolved);
CREATE INDEX idx_audit_logs_tenant ON audit_logs(tenant_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);

-- Make audit logs append-only
REVOKE UPDATE, DELETE ON audit_logs FROM public;
