/*
==========================================================
 BUZZNA D74 ENTERPRISE OPERATING SYSTEM
 Migration : 0003_roles_users_permissions_auth_tables.sql
 Version   : 1.0
==========================================================
*/

BEGIN;

SET search_path TO buzzna, public;

----------------------------------------------------------
-- ROLES
----------------------------------------------------------

CREATE TABLE roles
(
    role_id UUID PRIMARY KEY
        DEFAULT generate_uuid(),

    tenant_id UUID NOT NULL,

    role_name VARCHAR(60) NOT NULL,

    description TEXT,

    is_system_role BOOLEAN
        DEFAULT FALSE,

    created_at TIMESTAMPTZ
        DEFAULT NOW(),

    updated_at TIMESTAMPTZ
        DEFAULT NOW(),

    CONSTRAINT fk_roles_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES businesses(tenant_id)
        ON DELETE CASCADE
);

----------------------------------------------------------
-- PERMISSIONS
----------------------------------------------------------

CREATE TABLE permissions
(
    permission_id UUID PRIMARY KEY
        DEFAULT generate_uuid(),

    permission_key VARCHAR(120)
        NOT NULL,

    module_name VARCHAR(80)
        NOT NULL,

    description TEXT,

    created_at TIMESTAMPTZ
        DEFAULT NOW(),

    CONSTRAINT uq_permission_key
        UNIQUE(permission_key)
);

----------------------------------------------------------
-- ROLE PERMISSIONS
----------------------------------------------------------

CREATE TABLE role_permissions
(
    role_permission_id UUID PRIMARY KEY
        DEFAULT generate_uuid(),

    role_id UUID NOT NULL,

    permission_id UUID NOT NULL,

    granted_at TIMESTAMPTZ
        DEFAULT NOW(),

    CONSTRAINT fk_role_permissions_role
        FOREIGN KEY(role_id)
        REFERENCES roles(role_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_role_permissions_permission
        FOREIGN KEY(permission_id)
        REFERENCES permissions(permission_id)
        ON DELETE CASCADE,

    CONSTRAINT uq_role_permission
        UNIQUE(role_id, permission_id)
);

----------------------------------------------------------
-- USERS
----------------------------------------------------------

CREATE TABLE users
(
    user_id UUID PRIMARY KEY
        DEFAULT generate_uuid(),

    tenant_id UUID NOT NULL,

    role_id UUID NOT NULL,

    username VARCHAR(80)
        NOT NULL,

    full_name VARCHAR(150)
        NOT NULL,

    email VARCHAR(150),

    phone_number VARCHAR(30),

    password_hash TEXT
        NOT NULL,

    profile_photo TEXT,

    preferred_language VARCHAR(20)
        DEFAULT 'en',

    last_login_at TIMESTAMPTZ,

    password_changed_at TIMESTAMPTZ
        DEFAULT NOW(),

    failed_login_attempts INTEGER
        DEFAULT 0,

    account_locked BOOLEAN
        DEFAULT FALSE,

    account_locked_until TIMESTAMPTZ,

    is_active BOOLEAN
        DEFAULT TRUE,

    created_at TIMESTAMPTZ
        DEFAULT NOW(),

    updated_at TIMESTAMPTZ
        DEFAULT NOW(),

    CONSTRAINT fk_users_tenant
        FOREIGN KEY(tenant_id)
        REFERENCES businesses(tenant_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_users_role
        FOREIGN KEY(role_id)
        REFERENCES roles(role_id),

    CONSTRAINT uq_username
        UNIQUE(username),

    CONSTRAINT uq_user_email
        UNIQUE(email)
);

----------------------------------------------------------
-- INDEXES
----------------------------------------------------------

CREATE INDEX idx_users_tenant
ON users(tenant_id);

CREATE INDEX idx_users_role
ON users(role_id);

CREATE INDEX idx_users_active
ON users(is_active);

CREATE INDEX idx_roles_tenant
ON roles(tenant_id);

CREATE INDEX idx_permissions_module
ON permissions(module_name);

----------------------------------------------------------
-- UPDATED_AT TRIGGERS
----------------------------------------------------------

CREATE TRIGGER trg_roles_updated_at
BEFORE UPDATE
ON roles
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE
ON users
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

----------------------------------------------------------
-- DEFAULT SYSTEM PERMISSIONS
----------------------------------------------------------

INSERT INTO permissions
(permission_key,module_name,description)

VALUES

('dashboard.view','Dashboard','View dashboard'),

('catalog.manage','Catalog','Create and edit products'),

('inventory.manage','Inventory','Inventory management'),

('sales.create','Sales','Create sales'),

('sales.refund','Sales','Refund completed sales'),

('customers.manage','Customers','Customer management'),

('suppliers.manage','Suppliers','Supplier management'),

('expenses.manage','Expenses','Expense management'),

('reports.view','Reports','View reports'),

('billing.manage','Billing','Manage subscriptions'),

('users.manage','Security','Manage users'),

('roles.manage','Security','Manage roles');

----------------------------------------------------------
-- REFRESH TOKENS
----------------------------------------------------------

CREATE TABLE refresh_tokens
(
    refresh_token_id UUID PRIMARY KEY
        DEFAULT generate_uuid(),

    user_id UUID NOT NULL,

    tenant_id UUID NOT NULL,

    token_hash TEXT NOT NULL,

    expires_at TIMESTAMPTZ NOT NULL,

    revoked BOOLEAN
        DEFAULT FALSE,

    revoked_at TIMESTAMPTZ,

    ip_address INET,

    user_agent TEXT,

    created_at TIMESTAMPTZ
        DEFAULT NOW(),

    CONSTRAINT fk_refresh_user
        FOREIGN KEY(user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_refresh_tenant
        FOREIGN KEY(tenant_id)
        REFERENCES businesses(tenant_id)
        ON DELETE CASCADE
);

----------------------------------------------------------
-- TRUSTED DEVICES
----------------------------------------------------------

CREATE TABLE trusted_devices
(
    device_id UUID PRIMARY KEY
        DEFAULT generate_uuid(),

    tenant_id UUID NOT NULL,

    user_id UUID NOT NULL,

    device_name VARCHAR(150),

    device_identifier VARCHAR(255)
        NOT NULL,

    device_platform VARCHAR(50),

    app_version VARCHAR(30),

    last_seen TIMESTAMPTZ,

    trusted BOOLEAN
        DEFAULT TRUE,

    created_at TIMESTAMPTZ
        DEFAULT NOW(),

    updated_at TIMESTAMPTZ
        DEFAULT NOW(),

    CONSTRAINT fk_device_user
        FOREIGN KEY(user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_device_tenant
        FOREIGN KEY(tenant_id)
        REFERENCES businesses(tenant_id)
        ON DELETE CASCADE
);

----------------------------------------------------------
-- OTP CODES
----------------------------------------------------------

CREATE TABLE otp_codes
(
    otp_id UUID PRIMARY KEY
        DEFAULT generate_uuid(),

    tenant_id UUID NOT NULL,

    user_id UUID NOT NULL,

    otp_code VARCHAR(10)
        NOT NULL,

    otp_type VARCHAR(30)
        DEFAULT 'LOGIN',

    expires_at TIMESTAMPTZ
        NOT NULL,

    verified BOOLEAN
        DEFAULT FALSE,

    created_at TIMESTAMPTZ
        DEFAULT NOW(),

    CONSTRAINT fk_otp_user
        FOREIGN KEY(user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_otp_tenant
        FOREIGN KEY(tenant_id)
        REFERENCES businesses(tenant_id)
        ON DELETE CASCADE
);

----------------------------------------------------------
-- PASSWORD RESET TOKENS
----------------------------------------------------------

CREATE TABLE password_reset_tokens
(
    reset_id UUID PRIMARY KEY
        DEFAULT generate_uuid(),

    tenant_id UUID NOT NULL,

    user_id UUID NOT NULL,

    token_hash TEXT NOT NULL,

    expires_at TIMESTAMPTZ
        NOT NULL,

    used BOOLEAN
        DEFAULT FALSE,

    used_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ
        DEFAULT NOW(),

    CONSTRAINT fk_reset_user
        FOREIGN KEY(user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_reset_tenant
        FOREIGN KEY(tenant_id)
        REFERENCES businesses(tenant_id)
        ON DELETE CASCADE
);

----------------------------------------------------------
-- LOGIN HISTORY
----------------------------------------------------------

CREATE TABLE login_history
(
    login_history_id UUID PRIMARY KEY
        DEFAULT generate_uuid(),

    tenant_id UUID NOT NULL,

    user_id UUID NOT NULL,

    login_time TIMESTAMPTZ
        DEFAULT NOW(),

    logout_time TIMESTAMPTZ,

    ip_address INET,

    user_agent TEXT,

    login_status VARCHAR(30)
        DEFAULT 'SUCCESS',

    failure_reason TEXT,

    CONSTRAINT fk_login_user
        FOREIGN KEY(user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_login_tenant
        FOREIGN KEY(tenant_id)
        REFERENCES businesses(tenant_id)
        ON DELETE CASCADE
);

----------------------------------------------------------
-- INDEXES
----------------------------------------------------------

CREATE INDEX idx_refresh_user
ON refresh_tokens(user_id);

CREATE INDEX idx_refresh_expiry
ON refresh_tokens(expires_at);

CREATE INDEX idx_devices_user
ON trusted_devices(user_id);

CREATE INDEX idx_devices_identifier
ON trusted_devices(device_identifier);

CREATE INDEX idx_otp_user
ON otp_codes(user_id);

CREATE INDEX idx_otp_expiry
ON otp_codes(expires_at);

CREATE INDEX idx_password_reset
ON password_reset_tokens(user_id);

CREATE INDEX idx_login_history_user
ON login_history(user_id);

CREATE INDEX idx_login_history_time
ON login_history(login_time);

----------------------------------------------------------
-- UPDATED_AT TRIGGERS
----------------------------------------------------------

CREATE TRIGGER trg_trusted_devices_updated_at
BEFORE UPDATE
ON trusted_devices
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

----------------------------------------------------------
-- DEFAULT SYSTEM ROLES
----------------------------------------------------------

INSERT INTO roles
(
    tenant_id,
    role_name,
    description,
    is_system_role
)
SELECT
    tenant_id,
    'OWNER',
    'Business Owner',
    TRUE
FROM businesses;

INSERT INTO roles
(
    tenant_id,
    role_name,
    description,
    is_system_role
)
SELECT
    tenant_id,
    'MANAGER',
    'Business Manager',
    TRUE
FROM businesses;

INSERT INTO roles
(
    tenant_id,
    role_name,
    description,
    is_system_role
)
SELECT
    tenant_id,
    'CASHIER',
    'Point Of Sale Cashier',
    TRUE
FROM businesses;

INSERT INTO roles
(
    tenant_id,
    role_name,
    description,
    is_system_role
)
SELECT
    tenant_id,
    'ACCOUNTANT',
    'Business Accountant',
    TRUE
FROM businesses;

----------------------------------------------------------
-- OWNER GETS ALL PERMISSIONS
----------------------------------------------------------

INSERT INTO role_permissions
(
    role_id,
    permission_id
)
SELECT
    r.role_id,
    p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'OWNER';

----------------------------------------------------------
-- AUTHENTICATION HELPER
----------------------------------------------------------

CREATE OR REPLACE FUNCTION user_has_permission
(
    p_user UUID,
    p_permission VARCHAR
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS
$$
BEGIN

RETURN EXISTS
(
    SELECT 1

    FROM users u

    JOIN roles r
    ON u.role_id = r.role_id

    JOIN role_permissions rp
    ON r.role_id = rp.role_id

    JOIN permissions p
    ON rp.permission_id = p.permission_id

    WHERE
        u.user_id = p_user
    AND
        p.permission_key = p_permission
    AND
        u.is_active = TRUE
);

END;
$$;

----------------------------------------------------------
-- LOGIN FAILURE HELPER
----------------------------------------------------------

CREATE OR REPLACE FUNCTION increment_failed_login
(
    p_user UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS
$$
BEGIN

UPDATE users

SET

failed_login_attempts =
failed_login_attempts + 1,

account_locked =

CASE

WHEN failed_login_attempts >= 4

THEN TRUE

ELSE FALSE

END,

account_locked_until =

CASE

WHEN failed_login_attempts >= 4

THEN NOW() + INTERVAL '30 minutes'

ELSE NULL

END

WHERE
user_id = p_user;

END;
$$;

----------------------------------------------------------
-- LOGIN RESET HELPER
----------------------------------------------------------

CREATE OR REPLACE FUNCTION reset_login_attempts
(
    p_user UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS
$$

UPDATE users

SET

failed_login_attempts = 0,

account_locked = FALSE,

account_locked_until = NULL,

last_login_at = NOW()

WHERE user_id = p_user;

$$;

----------------------------------------------------------
-- COMMENTS
----------------------------------------------------------

COMMENT ON TABLE roles IS
'Business roles.';

COMMENT ON TABLE permissions IS
'Application permissions.';

COMMENT ON TABLE role_permissions IS
'Role permission mapping.';

COMMENT ON TABLE users IS
'Application users.';

COMMENT ON TABLE refresh_tokens IS
'JWT Refresh Tokens.';

COMMENT ON TABLE trusted_devices IS
'Known login devices.';

COMMENT ON TABLE otp_codes IS
'One Time Passwords.';

COMMENT ON TABLE password_reset_tokens IS
'Password recovery tokens.';

COMMENT ON TABLE login_history IS
'Complete login audit history.';

----------------------------------------------------------
-- FINAL VALIDATION
----------------------------------------------------------

DO
$$
BEGIN

IF NOT EXISTS
(
SELECT 1
FROM permissions
)
THEN
RAISE EXCEPTION
'Permission seed failed.';
END IF;

END;
$$;

COMMIT;
