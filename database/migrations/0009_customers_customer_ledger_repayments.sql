-- 0009_customers_customer_ledger_repayments.sql
-- Description: Neighborhood debt ledger, profiles, and repayment streams.

CREATE TABLE customers (
    customer_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
    full_name character varying NOT NULL,
    phone_number character varying,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE customer_credit_ledger (
    ledger_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
    customer_id uuid NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
    sale_id uuid REFERENCES sales(sale_id) ON DELETE RESTRICT,
    amount_delta numeric(15,2) NOT NULL, -- Positive adds to debt, Negative reduces debt
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE customer_repayments (
    repayment_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
    customer_id uuid NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
    amount numeric(15,2) NOT NULL,
    payment_method character varying NOT NULL,
    recorded_by uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Enable Row-Level Security
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_repayments ENABLE ROW LEVEL SECURITY;