-- 0008_expenses.sql
-- Description: Capital outflow tracking and categorization.

CREATE TABLE expense_categories (
    category_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
    name character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE expenses (
    expense_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
    category_id uuid NOT NULL REFERENCES expense_categories(category_id) ON DELETE RESTRICT,
    till_session_id uuid REFERENCES till_sessions(till_session_id) ON DELETE SET NULL,
    amount numeric(12,2) NOT NULL,
    description text NOT NULL,
    recorded_by uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Enable Row-Level Security
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;