-- 0010_suppliers_supplier_transactions.sql
-- Description: B2B supply lines and procurement transaction logs.

CREATE TABLE suppliers (
    supplier_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
    company_name character varying NOT NULL,
    contact_name character varying,
    phone_number character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE supplier_transactions (
    transaction_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
    supplier_id uuid NOT NULL REFERENCES suppliers(supplier_id) ON DELETE CASCADE,
    transaction_type character varying NOT NULL,
    amount numeric(15,2) NOT NULL,
    reference_number character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Enable Row-Level Security
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_transactions ENABLE ROW LEVEL SECURITY;