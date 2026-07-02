-- ============================================================================
-- Migration 0016: Seed Initial System Data
-- ============================================================================

-- Insert default permissions
INSERT INTO permissions (permission_key, description) VALUES
  ('view.dashboard', 'View main dashboard'),
  ('manage.billing', 'Modify subscription and billing'),
  ('manage.users', 'Create and manage staff accounts'),
  ('manage.catalog', 'Create and edit product catalog'),
  ('manage.inventory', 'Adjust inventory manually'),
  ('create.sale', 'Record sales transactions'),
  ('void.refund.sale', 'Void or refund completed sales'),
  ('manage.expenses', 'Record expense adjustments'),
  ('manage.suppliers', 'Manage supplier accounts'),
  ('export.analytics', 'Export financial reports')
ON CONFLICT (permission_key) DO NOTHING;

-- Insert default subscription plans
INSERT INTO subscription_plans (plan_name, price_monthly, features) VALUES
  ('Starter', 5000.00, '{"users": 2, "support": "email", "storage_gb": 10}'),
  ('Professional', 15000.00, '{"users": 10, "support": "phone", "storage_gb": 100}'),
  ('Enterprise', 50000.00, '{"users": 999, "support": "24/7", "storage_gb": 1000}')
ON CONFLICT DO NOTHING;

-- Note: Specific business setup is done during registration (POST /api/v1/auth/register-business)
-- No pre-seeded businesses to maintain multi-tenancy isolation
