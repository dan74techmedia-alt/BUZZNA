-- ============================================================================
-- Migration 0012: Merchant Payments (M-Pesa Integration)
-- ============================================================================

CREATE TABLE IF NOT EXISTS merchant_payment_connections (
  connection_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
  
  consumer_key varchar(255),
  consumer_secret varchar(255),  -- ENCRYPTED
  business_shortcode varchar(50),
  
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS merchant_payments (
  payment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
  
  mpesa_receipt_number varchar(50) UNIQUE,
  phone_number varchar(20),
  amount numeric(12, 2) NOT NULL,
  
  status varchar(50),  -- PENDING, UNMATCHED, MATCHED, FAILED
  
  created_at timestamptz NOT NULL DEFAULT now(),
  
  CONSTRAINT merchant_payments_immutable CHECK (payment_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS merchant_payment_matches (
  match_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES merchant_payments(payment_id),
  transaction_id uuid REFERENCES sales_transactions(transaction_id),
  
  matched_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE merchant_payment_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_payment_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON merchant_payment_connections
  FOR ALL USING (tenant_id = current_tenant_uuid());

CREATE POLICY "tenant_isolation" ON merchant_payments
  FOR ALL USING (tenant_id = current_tenant_uuid());

CREATE POLICY "tenant_isolation" ON merchant_payment_matches
  FOR ALL USING (
    payment_id IN (
      SELECT payment_id FROM merchant_payments WHERE tenant_id = current_tenant_uuid()
    )
  );

-- Indexes
CREATE INDEX idx_merchant_payments_tenant ON merchant_payments(tenant_id);
CREATE INDEX idx_merchant_payments_status ON merchant_payments(status);
CREATE INDEX idx_merchant_payments_created ON merchant_payments(created_at DESC);
CREATE INDEX idx_merchant_payment_matches_payment ON merchant_payment_matches(payment_id);

-- Make append-only
REVOKE UPDATE, DELETE ON merchant_payments FROM public;
