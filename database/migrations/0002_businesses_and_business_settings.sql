/*
==========================================================
 BUZZNA D74 ENTERPRISE OPERATING SYSTEM
 Migration : 0002_businesses_and_business_settings.sql
 Version   : 1.0
==========================================================
*/

BEGIN;

SET search_path TO buzzna, public;

----------------------------------------------------------
-- BUSINESSES (TENANTS)
----------------------------------------------------------

CREATE TABLE businesses
(
    tenant_id UUID PRIMARY KEY DEFAULT generate_uuid(),

    legal_name VARCHAR(200) NOT NULL,

    trade_name VARCHAR(200),

    business_type business_type_enum
        NOT NULL
        DEFAULT 'RETAIL',

    owner_name VARCHAR(150) NOT NULL,

    email VARCHAR(150),

    phone VARCHAR(30) NOT NULL,

    kra_pin VARCHAR(30),

    physical_address TEXT,

    county VARCHAR(100),

    town VARCHAR(100),

    country VARCHAR(100)
        DEFAULT 'Kenya',

    currency_code VARCHAR(10)
        DEFAULT 'KES',

    timezone VARCHAR(100)
        DEFAULT 'Africa/Nairobi',

    logo_url TEXT,

    license_status license_status_enum
        NOT NULL
        DEFAULT 'TRIAL_ACTIVE',

    trial_started_at TIMESTAMPTZ
        DEFAULT NOW(),

    license_expires_at TIMESTAMPTZ
        DEFAULT NOW() + INTERVAL '14 days',

    is_active BOOLEAN
        DEFAULT TRUE,

    created_at TIMESTAMPTZ
        DEFAULT NOW(),

    updated_at TIMESTAMPTZ
        DEFAULT NOW()
);

----------------------------------------------------------
-- BUSINESS SETTINGS
----------------------------------------------------------

CREATE TABLE business_settings
(
    settings_id UUID PRIMARY KEY
        DEFAULT generate_uuid(),

    tenant_id UUID NOT NULL,

    allow_negative_stock BOOLEAN
        DEFAULT TRUE,

    enable_customer_credit BOOLEAN
        DEFAULT TRUE,

    enable_supplier_credit BOOLEAN
        DEFAULT TRUE,

    enable_barcodes BOOLEAN
        DEFAULT TRUE,

    enable_notifications BOOLEAN
        DEFAULT TRUE,

    enable_sms_receipts BOOLEAN
        DEFAULT FALSE,

    enable_email_receipts BOOLEAN
        DEFAULT FALSE,

    tax_enabled BOOLEAN
        DEFAULT TRUE,

    tax_name VARCHAR(100)
        DEFAULT 'VAT',

    tax_rate NUMERIC(5,2)
        DEFAULT 16.00,

    low_stock_threshold INTEGER
        DEFAULT 10,

    receipt_footer TEXT,

    backup_frequency VARCHAR(30)
        DEFAULT 'DAILY',

    created_at TIMESTAMPTZ
        DEFAULT NOW(),

    updated_at TIMESTAMPTZ
        DEFAULT NOW(),

    CONSTRAINT fk_business_settings_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES businesses(tenant_id)
        ON DELETE CASCADE
);

----------------------------------------------------------
-- UNIQUE CONSTRAINTS
----------------------------------------------------------

ALTER TABLE businesses
ADD CONSTRAINT uq_business_email
UNIQUE(email);

ALTER TABLE businesses
ADD CONSTRAINT uq_business_phone
UNIQUE(phone);

ALTER TABLE business_settings
ADD CONSTRAINT uq_business_settings
UNIQUE(tenant_id);

----------------------------------------------------------
-- INDEXES
----------------------------------------------------------

CREATE INDEX idx_business_license
ON businesses(license_status);

CREATE INDEX idx_business_active
ON businesses(is_active);

CREATE INDEX idx_business_type
ON businesses(business_type);

CREATE INDEX idx_business_settings_tenant
ON business_settings(tenant_id);

----------------------------------------------------------
-- UPDATED_AT TRIGGERS
----------------------------------------------------------

CREATE TRIGGER trg_business_updated_at
BEFORE UPDATE
ON businesses
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_business_settings_updated_at
BEFORE UPDATE
ON business_settings
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

----------------------------------------------------------
-- COMMENTS
----------------------------------------------------------

COMMENT ON TABLE businesses IS
'Stores all registered tenant businesses.';

COMMENT ON TABLE business_settings IS
'Stores configurable settings for each tenant.';

COMMIT;
