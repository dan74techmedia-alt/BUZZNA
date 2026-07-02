-- ============================================================================
-- Migration 0013: Sync Tables (Offline Synchronization)
-- ============================================================================

CREATE TABLE IF NOT EXISTS sync_batches (
  batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
  
  device_id varchar(100),
  batch_number integer,
  
  status varchar(50),  -- PENDING, PROCESSING, COMPLETED, REJECTED
  
  transaction_count integer,
  successful_count integer,
  failed_count integer,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE TABLE IF NOT EXISTS sync_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES sync_batches(batch_id),
  tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
  
  event_type varchar(50),  -- SALE, INVENTORY, TILL_CLOSE, etc.
  event_data jsonb,
  
  conflict_detected boolean DEFAULT false,
  conflict_resolution varchar(50),  -- LWW, MANUAL, etc.
  
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_rejections (
  rejection_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES sync_batches(batch_id),
  event_index integer,
  
  reason text,
  error_code varchar(50),
  
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE sync_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_rejections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON sync_batches
  FOR ALL USING (tenant_id = current_tenant_uuid());

CREATE POLICY "tenant_isolation" ON sync_events
  FOR ALL USING (tenant_id = current_tenant_uuid());

CREATE POLICY "tenant_isolation" ON sync_rejections
  FOR ALL USING (
    batch_id IN (
      SELECT batch_id FROM sync_batches WHERE tenant_id = current_tenant_uuid()
    )
  );

-- Indexes
CREATE INDEX idx_sync_batches_tenant ON sync_batches(tenant_id);
CREATE INDEX idx_sync_batches_status ON sync_batches(status);
CREATE INDEX idx_sync_events_batch ON sync_events(batch_id);
CREATE INDEX idx_sync_events_created ON sync_events(created_at DESC);
