-- 0011_subscription_plans_invoices_payments_license_audit.sql
-- Description: Platform SaaS billing integration via Paystack and Audit tracking.

DO $$ BEGIN
    CREATE TYPE invoice_status_enum AS ENUM ('PENDING', 'PAID', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE subscription_plans (
    plan_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name character varying NOT NULL,
    price numeric(12,2) NOT NULL,
    billing_cycle character varying DEFAULT 'MONTHLY' NOT NULL,
    is_available boolean DEFAULT true NOT NULL
);

CREATE TABLE subscription_invoices (
    invoice_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
    plan_id uuid NOT NULL REFERENCES subscription_plans(plan_id) ON DELETE RESTRICT,
    status invoice_status_enum DEFAULT 'PENDING' NOT NULL,
    amount numeric(12,2) NOT NULL,
    due_date timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE subscription_payments (
    payment_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
    invoice_id uuid NOT NULL REFERENCES subscription_invoices(invoice_id) ON DELETE RESTRICT,
    paystack_reference character varying NOT NULL,
    amount numeric(12,2) NOT NULL,
    status character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE license_audit_logs (
    audit_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
    old_status license_status_enum NOT NULL,
    new_status license_status_enum NOT NULL,
    changed_by character varying NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Enable Row-Level Security (subscription_plans is global, no tenant_id)
ALTER TABLE subscription_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE license_audit_logs ENABLE ROW LEVEL SECURITY;