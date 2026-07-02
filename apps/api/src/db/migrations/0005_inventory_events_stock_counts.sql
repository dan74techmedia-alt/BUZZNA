-- ============================================================================
-- Migration 0005: Inventory Events (Append-Only Ledger)
-- ============================================================================
-- CRITICAL: This is the authoritative source of inventory truth
-- Direct updates to products.current_quantity are FORBIDDEN
-- Stock is calculated by summing inventory_events

CREATE TABLE IF NOT EXISTS inventory_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(product_id),
  
  event_type varchar(50) NOT NULL,  -- STOCK_ADD, SALE_DISPATCH, REFUND_RETURN, SPOILAGE, etc.
  reason_code varchar(50),          -- SPOILAGE, DAMAGE, THEFT_LOSS, MARKDOWN, etc.
  
  quantity_delta numeric(15, 3) NOT NULL,  -- Positive or negative change
  reference_id uuid,                        -- Links to sale_transaction or refund
  
  created_at timestamptz NOT NULL DEFAULT now(),
  
  CONSTRAINT inventory_events_immutable CHECK (event_id IS NOT NULL)
);

-- Enable RLS
ALTER TABLE inventory_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON inventory_events
  FOR ALL USING (tenant_id = current_tenant_uuid());

-- Indexes for performance
CREATE INDEX idx_inventory_events_tenant ON inventory_events(tenant_id);
CREATE INDEX idx_inventory_events_product ON inventory_events(tenant_id, product_id);
CREATE INDEX idx_inventory_events_created ON inventory_events(created_at);
CREATE INDEX idx_inventory_events_reference ON inventory_events(reference_id);

-- CRITICAL: Make table append-only (prevent deletes/updates)
REVOKE UPDATE, DELETE ON inventory_events FROM public;
