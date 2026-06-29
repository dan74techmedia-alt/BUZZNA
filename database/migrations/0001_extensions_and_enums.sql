/*
==========================================================
 BUZZNA D74 ENTERPRISE OPERATING SYSTEM
 Migration : 0001_extensions_and_enums.sql
 Version   : 1.0
==========================================================

PURPOSE

1. Enable PostgreSQL extensions
2. Create application schema
3. Create reusable ENUM types
4. Create helper functions
5. Prepare Row-Level Security support

==========================================================
*/

BEGIN;

----------------------------------------------------------
-- REQUIRED POSTGRESQL EXTENSIONS
----------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

----------------------------------------------------------
-- APPLICATION SCHEMA
----------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS buzzna;

SET search_path TO buzzna, public;

----------------------------------------------------------
-- LICENSE STATUS ENUM
----------------------------------------------------------

CREATE TYPE license_status_enum AS ENUM
(
    'TRIAL_ACTIVE',
    'PAYMENT_DUE',
    'GRACE_PERIOD',
    'FULLY_ACTIVATED',
    'SUSPENDED_NON_PAYMENT'
);

----------------------------------------------------------
-- PAYMENT METHOD ENUM
----------------------------------------------------------

CREATE TYPE payment_method_enum AS ENUM
(
    'CASH',
    'MPESA',
    'CARD',
    'BANK',
    'DEBT',
    'MIXED'
);

----------------------------------------------------------
-- PAYMENT STATUS ENUM
----------------------------------------------------------

CREATE TYPE payment_status_enum AS ENUM
(
    'PENDING',
    'COMPLETED_VERIFIED',
    'FAILED',
    'REFUNDED',
    'PARTIAL'
);

----------------------------------------------------------
-- INVENTORY EVENT ENUM
----------------------------------------------------------

CREATE TYPE inventory_event_enum AS ENUM
(
    'OPENING_STOCK',
    'STOCK_ADD',
    'STOCK_TRANSFER',
    'SALE_DISPATCH',
    'RETURN',
    'REFUND_RETURN',
    'ADJUSTMENT',
    'SPOILAGE',
    'DAMAGE',
    'THEFT_LOSS'
);

----------------------------------------------------------
-- BUSINESS TYPE ENUM
----------------------------------------------------------

CREATE TYPE business_type_enum AS ENUM
(
    'RETAIL',
    'WHOLESALE',
    'BUTCHERY',
    'MITUMBA',
    'HARDWARE',
    'AGROVET',
    'CYBER',
    'OTHER'
);

----------------------------------------------------------
-- ACCOUNT ROLE ENUM
----------------------------------------------------------

CREATE TYPE account_role_enum AS ENUM
(
    'OWNER',
    'MANAGER',
    'CASHIER',
    'ACCOUNTANT'
);

----------------------------------------------------------
-- SYNC STATUS ENUM
----------------------------------------------------------

CREATE TYPE sync_status_enum AS ENUM
(
    'PENDING',
    'SYNCED',
    'FAILED',
    'CONFLICT'
);

----------------------------------------------------------
-- UPDATED_AT TRIGGER FUNCTION
----------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS
$$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

----------------------------------------------------------
-- CURRENT TENANT FUNCTION
----------------------------------------------------------

CREATE OR REPLACE FUNCTION current_tenant_uuid()
RETURNS UUID
LANGUAGE sql
STABLE
AS
$$
SELECT NULLIF(
    current_setting(
        'app.current_tenant_id',
        TRUE
    ),
    ''
)::UUID;
$$;

----------------------------------------------------------
-- UUID HELPER
----------------------------------------------------------

CREATE OR REPLACE FUNCTION generate_uuid()
RETURNS UUID
LANGUAGE sql
IMMUTABLE
AS
$$
SELECT gen_random_uuid();
$$;

----------------------------------------------------------
-- SCHEMA COMMENT
----------------------------------------------------------

COMMENT ON SCHEMA buzzna IS
'BuzzNa D74 Enterprise Operating System Schema';

COMMIT;
