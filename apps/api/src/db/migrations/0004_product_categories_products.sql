-- ============================================================================
-- Migration 0004: Product Catalog Tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS product_categories (
  category_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
  category_name varchar(100) NOT NULL,
  description text,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  
  UNIQUE(tenant_id, category_name)
);

CREATE TABLE IF NOT EXISTS products (
  product_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
  category_id uuid REFERENCES product_categories(category_id),
  
  barcode varchar(100),
  product_name varchar(255) NOT NULL,
  description text,
  
  cost_floor numeric(12, 2) NOT NULL,
  retail_price numeric(12, 2) NOT NULL,
  
  -- CRITICAL: current_quantity is a CACHE ONLY
  -- True inventory is in immutable inventory_events table
  current_quantity numeric(15, 3) NOT NULL DEFAULT 0,
  
  unit_of_measure varchar(20) DEFAULT 'units',
  is_active boolean NOT NULL DEFAULT true,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  UNIQUE(tenant_id, barcode)
);

-- Enable RLS
ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "tenant_isolation" ON product_categories
  FOR ALL USING (tenant_id = current_tenant_uuid());

CREATE POLICY "tenant_isolation" ON products
  FOR ALL USING (tenant_id = current_tenant_uuid());

-- Indexes
CREATE INDEX idx_products_tenant ON products(tenant_id);
CREATE INDEX idx_products_barcode ON products(tenant_id, barcode);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_active ON products(tenant_id, is_active);
