-- Migration: 0006_till_sessions
-- Purpose: Shift management and cash flow tracking per the BuzzNa D74 Spec.
-- All monetary amounts use exact NUMERIC(12,2) to prevent floating-point rounding errors.

BEGIN;

CREATE TYPE till_status_enum AS ENUM ('OPEN', 'REVIEW_REQUIRED', 'CLOSED');

CREATE TABLE IF NOT EXISTS till_sessions (
    till_session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
    cashier_user_id UUID NOT NULL REFERENCES users(user_id),
    status till_status_enum NOT NULL DEFAULT 'OPEN',
    opening_float NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    expected_cash_balance NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    actual_cash_balance NUMERIC(12,2),
    opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ
);

-- Indexing for rapid tenant isolation and queries
CREATE INDEX idx_till_sessions_tenant ON till_sessions(tenant_id);
CREATE INDEX idx_till_sessions_cashier ON till_sessions(tenant_id, cashier_user_id) WHERE status = 'OPEN';

-- Row-Level Security (RLS)
ALTER TABLE till_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_till_sessions ON till_sessions
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

COMMIT;