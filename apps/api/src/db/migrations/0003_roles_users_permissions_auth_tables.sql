-- ============================================================================
-- Migration 0003: RBAC Tables (Roles, Permissions, Users)
-- ============================================================================

CREATE TABLE IF NOT EXISTS roles (
  role_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
  role_name varchar(50) NOT NULL,
  description text,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  
  UNIQUE(tenant_id, role_name)
);

CREATE TABLE IF NOT EXISTS permissions (
  permission_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  permission_key varchar(100) NOT NULL UNIQUE,
  description text,
  
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id uuid NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(permission_id) ON DELETE CASCADE,
  
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS users (
  user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(role_id),
  
  username varchar(100) NOT NULL,
  password_hash varchar(255) NOT NULL,
  phone_number varchar(20),
  email varchar(100),
  
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  UNIQUE(tenant_id, username)
);

-- Enable RLS
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "tenant_isolation" ON roles
  FOR ALL USING (tenant_id = current_tenant_uuid());

CREATE POLICY "tenant_isolation" ON users
  FOR ALL USING (tenant_id = current_tenant_uuid());

CREATE POLICY "tenant_isolation" ON role_permissions
  FOR ALL USING (
    role_id IN (
      SELECT role_id FROM roles WHERE tenant_id = current_tenant_uuid()
    )
  );

-- Indexes
CREATE INDEX idx_roles_tenant ON roles(tenant_id);
CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_users_username ON users(username);
