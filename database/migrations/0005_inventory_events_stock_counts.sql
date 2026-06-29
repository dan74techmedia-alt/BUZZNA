/*
==========================================================
 BUZZNA D74 ENTERPRISE OPERATING SYSTEM
 Migration : 0005_inventory_events_stock_counts.sql
 Version   : 1.0
==========================================================
*/

BEGIN;

SET search_path TO buzzna, public;

----------------------------------------------------------
-- INVENTORY EVENTS
----------------------------------------------------------

CREATE TABLE inventory_events
(
    event_id UUID PRIMARY KEY
        DEFAULT generate_uuid(),

    tenant_id UUID NOT NULL,

    product_id UUID NOT NULL,

    event_type inventory_event_enum
        NOT NULL,

    reference_type VARCHAR(50)
        NOT NULL,

    reference_id UUID,

    reason_code VARCHAR(100),

    quantity_delta NUMERIC(15,3)
        NOT NULL,

    unit_cost NUMERIC(15,2),

    running_quantity NUMERIC(15,3),

    remarks TEXT,

    performed_by UUID NOT NULL,

    event_timestamp TIMESTAMPTZ
        DEFAULT NOW(),

    created_at TIMESTAMPTZ
        DEFAULT NOW(),

    CONSTRAINT fk_inventory_product
        FOREIGN KEY(product_id)
        REFERENCES products(product_id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_inventory_tenant
        FOREIGN KEY(tenant_id)
        REFERENCES businesses(tenant_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_inventory_user
        FOREIGN KEY(performed_by)
        REFERENCES users(user_id)
        ON DELETE RESTRICT
);

----------------------------------------------------------
-- VALIDATION
----------------------------------------------------------

ALTER TABLE inventory_events

ADD CONSTRAINT chk_inventory_delta

CHECK
(
    quantity_delta <> 0
);

----------------------------------------------------------
-- INDEXES
----------------------------------------------------------

CREATE INDEX idx_inventory_product

ON inventory_events(product_id);

CREATE INDEX idx_inventory_tenant

ON inventory_events(tenant_id);

CREATE INDEX idx_inventory_timestamp

ON inventory_events(event_timestamp);

CREATE INDEX idx_inventory_reference

ON inventory_events(reference_type,reference_id);

CREATE INDEX idx_inventory_event_type

ON inventory_events(event_type);

CREATE INDEX idx_inventory_user

ON inventory_events(performed_by);

INSERT INTO inventory_events
(
    product_id,
    event_type,
    quantity_delta,
    ...
)
VALUES
(
    ...,
    'SALE_DISPATCH',
    -5,
    ...
);
