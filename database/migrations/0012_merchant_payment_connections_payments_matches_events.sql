-- 0012_merchant_payment_connections_payments_matches_events.sql
-- Description: Safaricom Daraja M-Pesa client revenue reconciliation tracking.

DO $$ BEGIN
    CREATE TYPE merchant_payment_status_enum AS ENUM ('PENDING', 'MATCHED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE merchant_payment_connections (
    connection_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
    daraja_shortcode character varying NOT NULL,
    daraja_consumer_key character varying NOT NULL,
    daraja_consumer_secret_encrypted text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE merchant_payments (
    merchant_payment_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
    mpesa_receipt_number character varying NOT NULL,
    amount numeric(12,2) NOT NULL,
    phone_number character varying NOT NULL,
    payer_name character varying,
    status merchant_payment_status_enum DEFAULT 'PENDING' NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE merchant_payment_matches (
    match_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
    merchant_payment_id uuid NOT NULL REFERENCES merchant_payments(merchant_payment_id) ON DELETE CASCADE,
    sale_id uuid NOT NULL REFERENCES sales(sale_id) ON DELETE RESTRICT,
    matched_by_user_id uuid REFERENCES users(user_id) ON DELETE SET NULL,
    matched_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE merchant_payment_events (
    event_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id uuid REFERENCES businesses(tenant_id) ON DELETE CASCADE,
    raw_payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Enable Row-Level Security
ALTER TABLE merchant_payment_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_payment_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_payment_events ENABLE ROW LEVEL SECURITY;