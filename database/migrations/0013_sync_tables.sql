-- 0013_sync_tables.sql
-- Description: Tracking batch arrays and LWW conflict resolution for Offline-First syncing.

DO $$ BEGIN
    CREATE TYPE sync_status_enum AS ENUM ('SYNC_PENDING', 'PROCESSED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE sync_batches (
    batch_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
    device_id character varying NOT NULL,
    status sync_status_enum DEFAULT 'SYNC_PENDING' NOT NULL,
    processed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE sync_events (
    event_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
    batch_id uuid NOT NULL REFERENCES sync_batches(batch_id) ON DELETE CASCADE,
    client_event_id character varying NOT NULL,
    entity_type character varying NOT NULL,
    event_type character varying NOT NULL,
    payload jsonb NOT NULL,
    occurred_at timestamp with time zone NOT NULL
);

CREATE TABLE sync_rejections (
    rejection_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
    client_event_id character varying NOT NULL,
    rejection_code character varying NOT NULL,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Enable Row-Level Security
ALTER TABLE sync_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_rejections ENABLE ROW LEVEL SECURITY;