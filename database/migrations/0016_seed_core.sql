-- FILEPATH: database/migrations/0016_seed_core.sql
-- ============================================================================
-- BUZZNA D74 ENTERPRISE OPERATING SYSTEM
-- Migration: 0016_seed_core.sql
-- Purpose: Populates seed values for system roles, permissions matrices,
--          SaaS subscription plans, and platform-wide defaults.
-- Integrity: Enforces strict idempotency via ON CONFLICT clauses.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. SEED SYSTEM ROLES
-- ----------------------------------------------------------------------------
-- Inserts the standardized user roles defining operational tiers.
-- Primary keys are static deterministic UUIDs to avoid synchronization drift.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS roles (
    role_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

INSERT INTO roles (role_id, name, description) VALUES
('b3fa734c-62de-4f76-88d4-531e21b76df1', 'Owner', 'Root business administrator with full multi-tenant workspace permissions and billing authority.'),
('ca7e82bf-3042-4b2a-ba5c-204128f1b672', 'Manager', 'Operational supervisor authorized to modify catalog, adjust inventory, and review till sessions.'),
('098ad8e2-fcf3-4638-b765-a892b1049b1a', 'Cashier', 'Frontline terminal operator restricted exclusively to sales workflows and blind handover lookups.'),
('d6c29b71-12bf-4631-9721-cfa5d91abf19', 'Accountant', 'Financial auditor with read-only analytics access and management of supplier and expense ledgers.')
ON CONFLICT (name) DO UPDATE SET 
    description = EXCLUDED.description,
    updated_at = now();

-- ----------------------------------------------------------------------------
-- 2. SEED SYSTEM PERMISSIONS
-- ----------------------------------------------------------------------------
-- Defines granular feature flags evaluating authorization bounds.
-- Maps explicitly to the system''s permission matrices.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS permissions (
    permission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

INSERT INTO permissions (permission_id, code, name, description) VALUES
('10010000-0000-0000-0000-000000000001', 'dashboard.view', 'View Live Dashboard', 'Grants visibility into live multi-tenant business operation metrics and attention feeds.'),
('10010000-0000-0000-0000-000000000002', 'billing.modify', 'Modify Platform Billing', 'Allows management of Paystack subscription items, corporate variables, and plans.'),
('10010000-0000-0000-0000-000000000003', 'staff.manage', 'Manage System Staff Accounts', 'Authorizes creation, editing, and access manipulation of subsidiary user accounts.'),
('10010000-0000-0000-0000-000000000004', 'catalog.manage', 'Create/Edit Product Catalog', 'Allows alterations to categories, pricing thresholds, and item definitions.'),
('10010000-0000-0000-0000-000000000005', 'inventory.adjust', 'Manual Stock Inventory Adjust', 'Enforces access to create manual inventory event modifications outside normal sales flow.'),
('10010000-0000-0000-0000-000000000006', 'inventory.verify', 'Approve Shelf Verification Counts', 'Authorizes confirmation of physical inventory shelf balances into the authoritative log.'),
('10010000-0000-0000-0000-000000000007', 'sale.record', 'Record Frontline Sale Entries', 'Enables execution of retail checkout manifests, payment allocations, and local cart pipelines.'),
('10010000-0000-0000-0000-000000000008', 'sale.void_refund', 'Void or Refund a Completed Sale', 'Enables compensation mechanics, creating refunds and reversing append-only events.'),
('10010000-0000-0000-0000-000000000009', 'expense.commit', 'Commit Expense Adjustments', 'Enables tracking and submission of operational cost allocations and outflows.'),
('10010000-0000-0000-0000-000000000010', 'supplier.manage', 'Manage Supplier Accounts', 'Grants rights to edit supplier attributes, terms, and purchase tracking bounds.'),
('10010000-0000-0000-0000-000000000011', 'analytics.export', 'Export Ledger Financial Analytics', 'Allows execution of heavy materialized query reviews and file transformations.')
ON CONFLICT (code) DO UPDATE SET 
    name = EXCLUDED.name,
    description = EXCLUDED.description;

-- ----------------------------------------------------------------------------
-- 3. BUILD ROLE-BASED ACCESS CONTROL (RBAC) RELATIONSHIPS
-- ----------------------------------------------------------------------------
-- Connects permission nodes to target functional profiles.
-- Fully implements the strict permission matrix of section 4.3.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id UUID NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(permission_id) ON DELETE CASCADE,
    is_limited BOOLEAN DEFAULT FALSE NOT NULL,
    is_policy_enforced BOOLEAN DEFAULT FALSE NOT NULL,
    is_optional BOOLEAN DEFAULT FALSE NOT NULL,
    PRIMARY KEY (role_id, permission_id)
);

-- Clear existing entries safely within this transaction block to avoid duplications
TRUNCATE TABLE role_permissions CASCADE;

-- A. OWNER PERMISSIONS (Full Clearance across all modules)
INSERT INTO role_permissions (role_id, permission_id) VALUES
('b3fa734c-62de-4f76-88d4-531e21b76df1', '10010000-0000-0000-0000-000000000001'),
('b3fa734c-62de-4f76-88d4-531e21b76df1', '10010000-0000-0000-0000-000000000002'),
('b3fa734c-62de-4f76-88d4-531e21b76df1', '10010000-0000-0000-0000-000000000003'),
('b3fa734c-62de-4f76-88d4-531e21b76df1', '10010000-0000-0000-0000-000000000004'),
('b3fa734c-62de-4f76-88d4-531e21b76df1', '10010000-0000-0000-0000-000000000005'),
('b3fa734c-62de-4f76-88d4-531e21b76df1', '10010000-0000-0000-0000-000000000006'),
('b3fa734c-62de-4f76-88d4-531e21b76df1', '10010000-0000-0000-0000-000000000007'),
('b3fa734c-62de-4f76-88d4-531e21b76df1', '10010000-0000-0000-0000-000000000008'),
('b3fa734c-62de-4f76-88d4-531e21b76df1', '10010000-0000-0000-0000-000000000009'),
('b3fa734c-62de-4f76-88d4-531e21b76df1', '10010000-0000-0000-0000-000000000010'),
('b3fa734c-62de-4f76-88d4-531e21b76df1', '10010000-0000-0000-0000-000000000011');

-- B. MANAGER PERMISSIONS (Operational, No SaaS billing, limited staff oversight, policy enforced refunds)
INSERT INTO role_permissions (role_id, permission_id, is_limited, is_policy_enforced) VALUES
('ca7e82bf-3042-4b2a-ba5c-204128f1b672', '10010000-0000-0000-0000-000000000001', FALSE, FALSE),
('ca7e82bf-3042-4b2a-ba5c-204128f1b672', '10010000-0000-0000-0000-000000000003', TRUE, FALSE), -- Limited staff oversight
('ca7e82bf-3042-4b2a-ba5c-204128f1b672', '10010000-0000-0000-0000-000000000004', FALSE, FALSE),
('ca7e82bf-3042-4b2a-ba5c-204128f1b672', '10010000-0000-0000-0000-000000000005', FALSE, FALSE),
('ca7e82bf-3042-4b2a-ba5c-204128f1b672', '10010000-0000-0000-0000-000000000006', FALSE, FALSE),
('ca7e82bf-3042-4b2a-ba5c-204128f1b672', '10010000-0000-0000-0000-000000000007', FALSE, FALSE),
('ca7e82bf-3042-4b2a-ba5c-204128f1b672', '10010000-0000-0000-0000-000000000008', FALSE, TRUE),  -- Refund policy enforced
('ca7e82bf-3042-4b2a-ba5c-204128f1b672', '10010000-0000-0000-0000-000000000009', FALSE, FALSE),
('ca7e82bf-3042-4b2a-ba5c-204128f1b672', '10010000-0000-0000-0000-000000000010', FALSE, FALSE),
('ca7e82bf-3042-4b2a-ba5c-204128f1b672', '10010000-0000-0000-0000-000000000011', FALSE, FALSE);

-- C. CASHIER PERMISSIONS (Highly restricted to frontline operation)
INSERT INTO role_permissions (role_id, permission_id, is_limited) VALUES
('098ad8e2-fcf3-4638-b765-a892b1049b1a', '10010000-0000-0000-0000-000000000001', FALSE), -- View Dashboard
('098ad8e2-fcf3-4638-b765-a892b1049b1a', '10010000-0000-0000-0000-000000000007', FALSE), -- Record Sale
('098ad8e2-fcf3-4638-b765-a892b1049b1a', '10010000-0000-0000-0000-000000000009', TRUE);  -- Limited expense entry

-- D. ACCOUNTANT PERMISSIONS (Read-only financials, expense control, and supplier ledgers)
INSERT INTO role_permissions (role_id, permission_id, is_optional) VALUES
('d6c29b71-12bf-4631-9721-cfa5d91abf19', '10010000-0000-0000-0000-000000000001', FALSE),
('d6c29b71-12bf-4631-9721-cfa5d91abf19', '10010000-0000-0000-0000-000000000007', TRUE),  -- Sale record optional
('d6c29b71-12bf-4631-9721-cfa5d91abf19', '10010000-0000-0000-0000-000000000009', FALSE),
('d6c29b71-12bf-4631-9721-cfa5d91abf19', '10010000-0000-0000-0000-000000000010', FALSE),
('d6c29b71-12bf-4631-9721-cfa5d91abf19', '10010000-0000-0000-0000-000000000011', FALSE);

-- ----------------------------------------------------------------------------
-- 4. SEED CORPORATE SUBSCRIPTION PLANS
-- ----------------------------------------------------------------------------
-- Seeds default options for enterprise licensing structures.
-- Implements proper precision parameters for billing.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS subscription_plans (
    plan_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    base_price NUMERIC(12,2) NOT NULL,
    billing_cycle VARCHAR(20) DEFAULT 'MONTHLY' NOT NULL,
    features JSONB NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

INSERT INTO subscription_plans (plan_id, code, name, base_price, features) VALUES
('e1aef912-3004-4df1-bc29-ea2194f1b831', 'TRIAL', '14-Day Micro-Enterprise Evaluation Tier', 0.00, 
 '{"duration_days": 14, "unlimited_sync": true, "max_skus": 500, "max_staff_accounts": 2}'),
('0f9b31ca-711e-45de-9be5-1104eab4dfb1', 'BASIC_RETAIL', 'Standard Retail Operations Plan', 2500.00, 
 '{"unlimited_sync": true, "max_skus": 5000, "max_staff_accounts": 5, "daraja_matching": true}'),
('9cbf511d-a042-4f32-8df2-2c091bc41f92', 'PREMIUM_GROWTH', 'High-Velocity Distributed Enterprise Plan', 5000.00, 
 '{"unlimited_sync": true, "max_skus": 50000, "max_staff_accounts": 25, "daraja_matching": true, "lru_advanced_caching": true}')
ON CONFLICT (code) DO UPDATE SET 
    name = EXCLUDED.name,
    base_price = EXCLUDED.base_price,
    features = EXCLUDED.features;

COMMIT;