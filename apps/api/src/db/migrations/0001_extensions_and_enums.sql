// apps/api/src/db/migrations/0001_extensions_and_enums.sql

-- ============================================================================
-- Migration 0001: Enable Extensions and Create Enums
-- ============================================================================
-- PURPOSE:
-- - Enable required PostgreSQL extensions (uuid, pgcrypto)
-- - Define all business domain enums
-- - Set up application-level functions
--
-- ============================================================================

-- Enable UUID extension for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable pgcrypto for cryptographic functions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- License Status Enum
-- ============================================================================
CREATE TYPE license_status_enum AS ENUM (
  'TRIAL_ACTIVE',           -- 14-day trial period
  'PAYMENT_DUE',            -- Payment overdue
  'GRACE_PERIOD',           -- 3-day grace period
  'SUSPENDED_NON_PAYMENT',  -- Subscription suspended (read-only mode)
  'FULLY_ACTIVATED'         -- Perpetual activation (no subscription check)
);

-- ============================================================================
-- Sale Status Enum
-- ============================================================================
CREATE TYPE sale_status_enum AS ENUM (
  'PENDING',           -- Sale being processed
  'COMPLETED',         -- Sale finalized
  'PARTIALLY_REFUNDED', -- Partial refund issued
  'FULLY_REFUNDED'     -- Complete refund issued
);

-- ============================================================================
-- Payment Status Enum
-- ============================================================================
CREATE TYPE payment_status_enum AS ENUM (
  'PENDING',                -- Awaiting payment verification
  'COMPLETED_VERIFIED',     -- Payment confirmed
  'FAILED',                 -- Payment failed
  'REFUNDED'                -- Payment refunded
);

-- ============================================================================
-- Payment Method Enum
-- ============================================================================
CREATE TYPE payment_method_enum AS ENUM (
  'CASH',                   -- Physical cash payment
  'MPESA',                  -- M-Pesa mobile money
  'DEBT'                    -- Customer credit account
);

-- ============================================================================
-- Till Session Status Enum
-- ============================================================================
CREATE TYPE till_session_status_enum AS ENUM (
  'OPEN',              -- Till actively in use
  'CLOSED',            -- Till closed, balanced
  'REVIEW_REQUIRED'    -- Till discrepancy detected
);

-- ============================================================================
-- Application-Level Functions
-- ============================================================================

-- Current tenant UUID from transaction-local context
-- Used by RLS policies for tenant isolation
CREATE OR REPLACE FUNCTION current_tenant_uuid()
RETURNS uuid AS $$
  SELECT nullif(current_setting('app.current_tenant_id', true), '')::uuid;
$$ LANGUAGE SQL STABLE;

-- Current user UUID from transaction-local context
CREATE OR REPLACE FUNCTION current_user_uuid()
RETURNS uuid AS $$
  SELECT nullif(current_setting('app.current_user_id', true), '')::uuid;
$$ LANGUAGE SQL STABLE;

-- ============================================================================
-- RLS Policy Helper Functions
-- ============================================================================

-- Check if current tenant matches record tenant
CREATE OR REPLACE FUNCTION is_tenant_owner(record_tenant_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN record_tenant_id = current_tenant_uuid();
END;
$$ LANGUAGE plpgsql STABLE;
