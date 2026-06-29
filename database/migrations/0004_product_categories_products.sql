/*
==========================================================
 BUZZNA D74 ENTERPRISE OPERATING SYSTEM
 Migration : 0004_product_categories_products.sql
 Version   : 1.0
==========================================================
*/

BEGIN;

SET search_path TO buzzna, public;

----------------------------------------------------------
-- PRODUCT CATEGORIES
----------------------------------------------------------

CREATE TABLE product_categories
(
    category_id UUID PRIMARY KEY
        DEFAULT generate_uuid(),

    tenant_id UUID NOT NULL,

    category_name VARCHAR(120)
        NOT NULL,

    description TEXT,

    is_active BOOLEAN
        DEFAULT TRUE,

    created_at TIMESTAMPTZ
        DEFAULT NOW(),

    updated_at TIMESTAMPTZ
        DEFAULT NOW(),

    CONSTRAINT fk_category_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES businesses(tenant_id)
        ON DELETE CASCADE,

    CONSTRAINT uq_category_name
        UNIQUE(tenant_id, category_name)
);

----------------------------------------------------------
-- PRODUCTS
----------------------------------------------------------

CREATE TABLE products
(
    product_id UUID PRIMARY KEY
        DEFAULT generate_uuid(),

    tenant_id UUID NOT NULL,

    category_id UUID,

    sku VARCHAR(80)
        NOT NULL,

    barcode VARCHAR(120),

    product_name VARCHAR(200)
        NOT NULL,

    description TEXT,

    unit_of_measure VARCHAR(30)
        DEFAULT 'PCS',

    cost_price NUMERIC(15,2)
        NOT NULL,

    cost_floor NUMERIC(15,2)
        NOT NULL,

    retail_price NUMERIC(15,2)
        NOT NULL,

    wholesale_price NUMERIC(15,2),

    tax_rate NUMERIC(5,2)
        DEFAULT 16.00,

    taxable BOOLEAN
        DEFAULT TRUE,

    current_quantity NUMERIC(15,3)
        DEFAULT 0,

    reorder_level NUMERIC(15,3)
        DEFAULT 10,

    allow_negative_stock BOOLEAN
        DEFAULT TRUE,

    image_url TEXT,

    is_active BOOLEAN
        DEFAULT TRUE,

    created_at TIMESTAMPTZ
        DEFAULT NOW(),

    updated_at TIMESTAMPTZ
        DEFAULT NOW(),

    CONSTRAINT fk_product_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES businesses(tenant_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_product_category
        FOREIGN KEY (category_id)
        REFERENCES product_categories(category_id)
        ON DELETE SET NULL,

    CONSTRAINT uq_product_sku
        UNIQUE(tenant_id, sku),

    CONSTRAINT uq_product_barcode
        UNIQUE(tenant_id, barcode)
);

----------------------------------------------------------
-- INDEXES
----------------------------------------------------------

CREATE INDEX idx_product_name
ON products(product_name);

CREATE INDEX idx_product_barcode
ON products(barcode);

CREATE INDEX idx_product_category
ON products(category_id);

CREATE INDEX idx_product_active
ON products(is_active);

CREATE INDEX idx_product_tenant
ON products(tenant_id);

CREATE INDEX idx_category_tenant
ON product_categories(tenant_id);

----------------------------------------------------------
-- UPDATED_AT TRIGGERS
----------------------------------------------------------

CREATE TRIGGER trg_product_categories_updated_at
BEFORE UPDATE
ON product_categories
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_products_updated_at
BEFORE UPDATE
ON products
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

----------------------------------------------------------
-- PRODUCT VALIDATION
----------------------------------------------------------

ALTER TABLE products

ADD CONSTRAINT chk_cost_price
CHECK
(
    cost_price >= 0
);

ALTER TABLE products

ADD CONSTRAINT chk_cost_floor
CHECK
(
    cost_floor >= 0
);

ALTER TABLE products

ADD CONSTRAINT chk_retail_price
CHECK
(
    retail_price >= cost_floor
);

ALTER TABLE products

ADD CONSTRAINT chk_wholesale_price
CHECK
(
    wholesale_price IS NULL
    OR
    wholesale_price >= cost_floor
);

ALTER TABLE products

ADD CONSTRAINT chk_tax_rate
CHECK
(
    tax_rate >= 0
    AND
    tax_rate <= 100
);

ALTER TABLE products

ADD CONSTRAINT chk_current_quantity
CHECK
(
    current_quantity IS NOT NULL
);

----------------------------------------------------------
-- PRODUCT ARCHIVAL
----------------------------------------------------------

ALTER TABLE products

ADD COLUMN archived_at TIMESTAMPTZ;

ALTER TABLE products

ADD COLUMN archived_by UUID;

ALTER TABLE products

ADD CONSTRAINT fk_product_archived_by

FOREIGN KEY
(
    archived_by
)

REFERENCES users(user_id)

ON DELETE SET NULL;

----------------------------------------------------------
-- SKU GENERATOR
----------------------------------------------------------

CREATE OR REPLACE FUNCTION generate_product_sku
(
    p_category VARCHAR
)
RETURNS VARCHAR
LANGUAGE plpgsql
AS
$$

DECLARE

v_prefix VARCHAR;

BEGIN

v_prefix :=
UPPER
(
LEFT
(
REGEXP_REPLACE
(
COALESCE(p_category,'GEN'),
'[^A-Za-z]',
'',
'g'
),
3
)
);

RETURN

v_prefix

||

'-'

||

UPPER
(
SUBSTRING
(
REPLACE
(
gen_random_uuid()::TEXT,
'-',
''
)

FROM 1 FOR 8
)
);

END;

$$;

----------------------------------------------------------
-- PRODUCT SEARCH INDEXES
----------------------------------------------------------

CREATE INDEX idx_product_sku

ON products(sku);

CREATE INDEX idx_product_price

ON products(retail_price);

CREATE INDEX idx_product_reorder

ON products(reorder_level);

CREATE INDEX idx_product_quantity

ON products(current_quantity);

CREATE INDEX idx_product_taxable

ON products(taxable);

CREATE INDEX idx_product_created

ON products(created_at);

----------------------------------------------------------
-- COMMENTS
----------------------------------------------------------

COMMENT ON TABLE product_categories IS
'Tenant product grouping.';

COMMENT ON TABLE products IS
'Master catalog. Inventory is maintained exclusively by inventory_events.';

COMMENT ON COLUMN products.current_quantity IS
'Cached projection generated from inventory_events only.';

COMMENT ON COLUMN products.cost_floor IS
'Minimum allowed selling price.';

----------------------------------------------------------
-- PRODUCT IMAGE GALLERY
----------------------------------------------------------

CREATE TABLE product_images
(
    image_id UUID PRIMARY KEY
        DEFAULT generate_uuid(),

    tenant_id UUID NOT NULL,

    product_id UUID NOT NULL,

    image_url TEXT NOT NULL,

    display_order INTEGER
        DEFAULT 1,

    is_primary BOOLEAN
        DEFAULT FALSE,

    uploaded_at TIMESTAMPTZ
        DEFAULT NOW(),

    CONSTRAINT fk_product_images_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES businesses(tenant_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_product_images_product
        FOREIGN KEY (product_id)
        REFERENCES products(product_id)
        ON DELETE CASCADE
);

----------------------------------------------------------
-- PRODUCT TAGS
----------------------------------------------------------

CREATE TABLE product_tags
(
    tag_id UUID PRIMARY KEY
        DEFAULT generate_uuid(),

    tenant_id UUID NOT NULL,

    product_id UUID NOT NULL,

    tag_name VARCHAR(60)
        NOT NULL,

    created_at TIMESTAMPTZ
        DEFAULT NOW(),

    CONSTRAINT fk_product_tags_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES businesses(tenant_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_product_tags_product
        FOREIGN KEY (product_id)
        REFERENCES products(product_id)
        ON DELETE CASCADE,

    CONSTRAINT uq_product_tag
        UNIQUE (tenant_id, product_id, tag_name)
);

----------------------------------------------------------
-- INDEXES
----------------------------------------------------------

CREATE INDEX idx_product_images_product
ON product_images(product_id);

CREATE INDEX idx_product_images_primary
ON product_images(is_primary);

CREATE INDEX idx_product_tags_product
ON product_tags(product_id);

CREATE INDEX idx_product_tags_name
ON product_tags(tag_name);

----------------------------------------------------------
-- DEFAULT CATEGORY SEED
----------------------------------------------------------

INSERT INTO product_categories
(
    tenant_id,
    category_name,
    description
)
SELECT
    tenant_id,
    'General',
    'Default system category'
FROM businesses
ON CONFLICT (tenant_id, category_name)
DO NOTHING;

----------------------------------------------------------
-- COMMENTS
----------------------------------------------------------

COMMENT ON TABLE product_images IS
'Stores one or more images for each product.';

COMMENT ON TABLE product_tags IS
'Optional searchable tags for products.';

----------------------------------------------------------
-- FINAL VALIDATION
----------------------------------------------------------

DO
$$
BEGIN

    IF NOT EXISTS
    (
        SELECT 1
        FROM product_categories
    )
    THEN
        RAISE EXCEPTION
        'Default product categories were not created.';
    END IF;

END;
$$;

COMMIT;
