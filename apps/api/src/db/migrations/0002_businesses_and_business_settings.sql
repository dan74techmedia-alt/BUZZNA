-- ============================================================================
-- Migration 0002: Create Businesses and Tenants Tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS businesses (
  tenant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name varchar(255) NOT NULL,
  trade_name varchar(255),
  business_type varchar(50) NOT NULL,
  
  license_status license_status_enum NOT NULL DEFAULT 'TRIAL_ACTIVE',
  license_expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_settings (
  tenant_id uuid PRIMARY KEY REFERENCES businesses(tenant_id) ON DELETE CASCADE,
  allow_negative_stock boolean NOT NULL DEFAULT false,
  enable_customer_credit boolean NOT NULL DEFAULT true,
  low_stock_threshold integer NOT NULL DEFAULT 10,
  
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on businesses
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only access their own business
CREATE POLICY "tenant_isolation" ON businesses
  FOR ALL USING (tenant_id = current_tenant_uuid());

CREATE POLICY "tenant_isolation" ON business_settings
  FOR ALL USING (tenant_id = current_tenant_uuid());

-- Indexes
CREATE INDEX idx_businesses_license_expires ON businesses(license_expires_at);
CREATE INDEX idx_businesses_status ON businesses(license_status);
