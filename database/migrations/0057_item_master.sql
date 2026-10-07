-- Item Master.
--
-- The Item Master is the inventory view of the one shared catalogue
-- (tenant.items, the record Sales, Procurement, Inventory, Manufacturing and
-- POS already share). Nothing here creates a second item table. It adds:
--
-- 1. Item fields: lifecycle (Draft / Active / Inactive), brand, manufacturer
--    and part number, shelf life, weight and dimensions, the variant template
--    and variant attributes, and a version for optimistic locking. The item
--    code is the SKU: `sku` now mirrors it, so code and SKU can never differ.
-- 2. Rules on the item, whoever writes it: a service never tracks inventory;
--    a variant template never holds stock nor appears on a transaction; the
--    status every module filters on follows the lifecycle.
-- 3. Identifiers: a primary barcode and any number of alternates (barcode,
--    GTIN, internal), optionally per unit, unique in the organization. The
--    item's `barcode` column mirrors the primary barcode.
-- 4. Categories: default valuation method, tax category and HSN for new
--    items, and a category history.
-- 5. Variants: the old variant rows (item_variants) become items of their own
--    with the parent as template, and the documents and price list entries
--    that named a variant now name that item. Prices no longer live on items.
-- 6. Permissions for categories, units, identifiers, tracking, accounting
--    classification and warehouse stock; the default-price permission goes.

-- ============================================================ 1. item fields

ALTER TABLE tenant.items
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS brand text,
  ADD COLUMN IF NOT EXISTS manufacturer_name text,
  ADD COLUMN IF NOT EXISTS manufacturer_part_number text,
  ADD COLUMN IF NOT EXISTS shelf_life_days integer,
  ADD COLUMN IF NOT EXISTS net_weight numeric(18,6),
  ADD COLUMN IF NOT EXISTS gross_weight numeric(18,6),
  ADD COLUMN IF NOT EXISTS weight_uom_id uuid,
  ADD COLUMN IF NOT EXISTS length numeric(18,6),
  ADD COLUMN IF NOT EXISTS width numeric(18,6),
  ADD COLUMN IF NOT EXISTS height numeric(18,6),
  ADD COLUMN IF NOT EXISTS dimension_uom_id uuid,
  ADD COLUMN IF NOT EXISTS parent_item_id uuid,
  ADD COLUMN IF NOT EXISTS is_variant_template boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS variant_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS activated_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

UPDATE tenant.items SET lifecycle_status = status, activated_at = COALESCE(activated_at, created_at) WHERE lifecycle_status IS DISTINCT FROM status OR activated_at IS NULL;

ALTER TABLE tenant.items
  ADD CONSTRAINT items_lifecycle_status_check CHECK (lifecycle_status IN ('draft', 'active', 'inactive')),
  ADD CONSTRAINT items_shelf_life_check CHECK (shelf_life_days IS NULL OR shelf_life_days BETWEEN 1 AND 36500),
  ADD CONSTRAINT items_physical_check CHECK (
    (net_weight IS NULL OR net_weight >= 0) AND (gross_weight IS NULL OR gross_weight >= 0) AND (net_weight IS NULL OR gross_weight IS NULL OR gross_weight >= net_weight)
    AND (length IS NULL OR length >= 0) AND (width IS NULL OR width >= 0) AND (height IS NULL OR height >= 0)),
  ADD CONSTRAINT items_variant_check CHECK (NOT (is_variant_template AND parent_item_id IS NOT NULL) AND parent_item_id IS DISTINCT FROM id),
  ADD CONSTRAINT items_version_check CHECK (version >= 1),
  ADD CONSTRAINT items_weight_uom_organization_fkey FOREIGN KEY (organization_id, weight_uom_id) REFERENCES tenant.units_of_measure (organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT items_dimension_uom_organization_fkey FOREIGN KEY (organization_id, dimension_uom_id) REFERENCES tenant.units_of_measure (organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT items_parent_item_organization_fkey FOREIGN KEY (organization_id, parent_item_id) REFERENCES tenant.items (organization_id, id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS items_parent_idx ON tenant.items (organization_id, parent_item_id) WHERE parent_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS items_part_number_idx ON tenant.items (organization_id, lower(manufacturer_name), upper(manufacturer_part_number)) WHERE manufacturer_part_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS items_brand_idx ON tenant.items (organization_id, lower(brand)) WHERE brand IS NOT NULL;

-- ============================================================ 2. rules

-- One function for every rule on the item row, whoever writes it:
--   * the code is the SKU: `sku` mirrors it (the code's uniqueness is
--     therefore case-insensitive, through items_sku_uidx);
--   * a service never tracks inventory nor batches / serials / expiry;
--   * a variant template holds no stock and is never bought or sold —
--     its variants are;
--   * `status`, which every module filters on, follows the lifecycle:
--     only an Active item is 'active'. A writer that still sets only
--     `status` moves the lifecycle with it.
CREATE OR REPLACE FUNCTION tenant.items_master_rules() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'inactive' AND NEW.lifecycle_status = 'active' THEN NEW.lifecycle_status := 'inactive'; END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.lifecycle_status IS NOT DISTINCT FROM OLD.lifecycle_status THEN
    NEW.lifecycle_status := NEW.status;
  END IF;
  NEW.status := CASE WHEN NEW.lifecycle_status = 'active' THEN 'active' ELSE 'inactive' END;
  NEW.sku := NEW.code;
  IF NEW.item_type = 'service' THEN
    NEW.track_inventory := false;
    NEW.tracking_type := 'none';
    NEW.requires_expiry_date := false;
    NEW.shelf_life_days := NULL;
  END IF;
  IF NEW.is_variant_template THEN
    NEW.track_inventory := false;
    NEW.tracking_type := 'none';
    NEW.is_sellable := false;
    NEW.is_purchasable := false;
  END IF;
  IF NEW.tracking_type <> 'batch' THEN NEW.requires_expiry_date := false; END IF;
  RETURN NEW;
END;
$$;

-- Replaces the narrower service rule (it fired only on some columns) in place.
CREATE OR REPLACE TRIGGER items_service_never_tracked BEFORE INSERT OR UPDATE ON tenant.items
  FOR EACH ROW EXECUTE FUNCTION tenant.items_master_rules();

UPDATE tenant.items SET sku = code WHERE sku IS DISTINCT FROM code;

-- ============================================================ 3. identifiers

CREATE TABLE IF NOT EXISTS tenant.item_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  item_id uuid NOT NULL,
  identifier_type text NOT NULL DEFAULT 'barcode' CHECK (identifier_type IN ('barcode', 'gtin', 'internal')),
  value text NOT NULL CHECK (value ~ '^[0-9A-Za-z._/-]{3,64}$'),
  uom_id uuid,
  is_primary boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  removed_at timestamptz,
  CHECK ((status = 'removed') = (removed_at IS NOT NULL)),
  CHECK (NOT (is_primary AND status = 'removed')),
  FOREIGN KEY (organization_id, item_id) REFERENCES tenant.items (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, uom_id) REFERENCES tenant.units_of_measure (organization_id, id) ON DELETE RESTRICT
);
-- One live owner per identifier value, whatever its type, and one primary per item.
CREATE UNIQUE INDEX IF NOT EXISTS item_identifiers_value_uidx ON tenant.item_identifiers (organization_id, upper(value)) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS item_identifiers_primary_uidx ON tenant.item_identifiers (organization_id, item_id) WHERE is_primary;
CREATE INDEX IF NOT EXISTS item_identifiers_item_idx ON tenant.item_identifiers (organization_id, item_id, status);

-- The item's barcode column is the primary identifier, kept by the database.
CREATE OR REPLACE FUNCTION tenant.item_identifiers_sync_barcode() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target uuid := COALESCE(NEW.item_id, OLD.item_id);
  org uuid := COALESCE(NEW.organization_id, OLD.organization_id);
BEGIN
  UPDATE tenant.items item
     SET barcode = (SELECT identifier.value FROM tenant.item_identifiers identifier
                     WHERE identifier.organization_id = org AND identifier.item_id = target AND identifier.is_primary AND identifier.status = 'active' LIMIT 1)
   WHERE item.organization_id = org AND item.id = target
     AND item.barcode IS DISTINCT FROM (SELECT identifier.value FROM tenant.item_identifiers identifier
                     WHERE identifier.organization_id = org AND identifier.item_id = target AND identifier.is_primary AND identifier.status = 'active' LIMIT 1);
  RETURN NULL;
END;
$$;
CREATE TRIGGER item_identifiers_sync_barcode AFTER INSERT OR UPDATE OR DELETE ON tenant.item_identifiers
  FOR EACH ROW EXECUTE FUNCTION tenant.item_identifiers_sync_barcode();

-- Today's barcodes become primary identifiers.
INSERT INTO tenant.item_identifiers (organization_id, item_id, identifier_type, value, is_primary, created_by, created_at)
SELECT item.organization_id, item.id, 'barcode', item.barcode, true, item.created_by, item.created_at
  FROM tenant.items item
 WHERE item.barcode IS NOT NULL AND item.barcode <> '' AND item.barcode ~ '^[0-9A-Za-z._/-]{3,64}$'
   AND NOT EXISTS (SELECT 1 FROM tenant.item_identifiers identifier WHERE identifier.organization_id = item.organization_id AND identifier.item_id = item.id);

-- ============================================================ 4. categories

ALTER TABLE tenant.item_groups
  ADD COLUMN IF NOT EXISTS default_valuation_method text,
  ADD COLUMN IF NOT EXISTS default_tax_category_id uuid,
  ADD COLUMN IF NOT EXISTS default_hsn_sac_code text,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

ALTER TABLE tenant.item_groups
  ADD CONSTRAINT item_groups_default_valuation_check CHECK (default_valuation_method IS NULL OR default_valuation_method IN ('moving_average', 'fifo', 'standard')),
  ADD CONSTRAINT item_groups_default_tax_category_organization_fkey FOREIGN KEY (organization_id, default_tax_category_id)
    REFERENCES tenant.tax_categories (organization_id, id) ON DELETE SET NULL (default_tax_category_id),
  ADD CONSTRAINT item_groups_parent_not_self_check CHECK (parent_id IS DISTINCT FROM id);

CREATE UNIQUE INDEX IF NOT EXISTS item_groups_code_ci_uidx ON tenant.item_groups (organization_id, upper(code));

CREATE TABLE IF NOT EXISTS tenant.item_category_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  category_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('created', 'updated', 'activated', 'deactivated')),
  summary text NOT NULL,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, category_id) REFERENCES tenant.item_groups (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS item_category_history_category_idx ON tenant.item_category_history (organization_id, category_id, created_at DESC);

DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['item_identifiers', 'item_category_history'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    EXECUTE format('GRANT SELECT ON tenant.%I TO vercent_worker', name);
  END LOOP;
END $$;
-- DELETE only for an item deleted before it was ever used; a used identifier is marked removed, never deleted.
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.item_identifiers TO vercent_app;
GRANT SELECT, INSERT ON tenant.item_category_history TO vercent_app;

-- ============================================================ 5. variants become items

-- Each variant row becomes an item: its SKU is the item code, its barcode the
-- primary identifier, the parent's other settings are inherited, and the
-- parent becomes the template (unless it already holds stock of its own, in
-- which case it stays an ordinary item and only groups the variants).
CREATE TEMP TABLE item_variant_map ON COMMIT DROP AS
SELECT variant.id AS variant_id, gen_random_uuid() AS item_id, variant.organization_id, variant.item_id AS parent_id
  FROM tenant.item_variants variant;

INSERT INTO tenant.items (id, organization_id, code, name, description, item_type, group_id, uom_id, hsn_sac_code, track_inventory, allow_negative_stock, valuation_method,
                          standard_cost, tax_category_id, status, lifecycle_status, tracking_type, sales_description, purchase_description, sales_uom_id, purchase_uom_id,
                          is_sellable, is_purchasable, requires_expiry_date, brand, manufacturer_name, parent_item_id, variant_attributes, created_by, updated_by, created_at, activated_at)
SELECT map.item_id, parent.organization_id, upper(variant.sku), parent.name || ' — ' || variant.name, parent.description, parent.item_type, parent.group_id, parent.uom_id,
       parent.hsn_sac_code, parent.track_inventory, parent.allow_negative_stock, parent.valuation_method, COALESCE(variant.standard_cost, parent.standard_cost),
       parent.tax_category_id, variant.status, variant.status, parent.tracking_type, parent.sales_description, parent.purchase_description, parent.sales_uom_id,
       parent.purchase_uom_id, parent.is_sellable, parent.is_purchasable, parent.requires_expiry_date, parent.brand, parent.manufacturer_name, parent.id,
       COALESCE(variant.attributes, '{}'::jsonb), variant.created_by, variant.updated_by, variant.created_at, variant.created_at
  FROM item_variant_map map
  JOIN tenant.item_variants variant ON variant.id = map.variant_id
  JOIN tenant.items parent ON parent.organization_id = variant.organization_id AND parent.id = variant.item_id;

INSERT INTO tenant.item_identifiers (organization_id, item_id, identifier_type, value, is_primary, created_by, created_at)
SELECT map.organization_id, map.item_id, 'barcode', variant.barcode, true, variant.created_by, variant.created_at
  FROM item_variant_map map JOIN tenant.item_variants variant ON variant.id = map.variant_id
 WHERE variant.barcode IS NOT NULL AND variant.barcode <> '' AND variant.barcode ~ '^[0-9A-Za-z._/-]{3,64}$';

INSERT INTO tenant.item_uom_conversions (organization_id, item_id, from_uom_id, to_uom_id, conversion_factor, status, created_by, updated_by)
SELECT conversion.organization_id, map.item_id, conversion.from_uom_id, conversion.to_uom_id, conversion.conversion_factor, conversion.status, conversion.created_by, conversion.updated_by
  FROM item_variant_map map JOIN tenant.item_uom_conversions conversion ON conversion.organization_id = map.organization_id AND conversion.item_id = map.parent_id;

-- Documents and price list entries that named a variant now name the variant's item.
UPDATE tenant.sales_quotation_lines line SET item_id = map.item_id FROM item_variant_map map WHERE line.organization_id = map.organization_id AND line.variant_id = map.variant_id;
UPDATE tenant.sales_order_lines line SET item_id = map.item_id FROM item_variant_map map WHERE line.organization_id = map.organization_id AND line.variant_id = map.variant_id;
UPDATE tenant.price_list_items entry SET item_id = map.item_id FROM item_variant_map map WHERE entry.organization_id = map.organization_id AND entry.variant_id = map.variant_id;
UPDATE tenant.pos_cart_lines line SET item_id = map.item_id FROM item_variant_map map WHERE line.organization_id = map.organization_id AND line.variant_id = map.variant_id;
UPDATE tenant.pos_sale_lines line SET item_id = map.item_id FROM item_variant_map map WHERE line.organization_id = map.organization_id AND line.variant_id = map.variant_id;

UPDATE tenant.items parent SET is_variant_template = true
 WHERE EXISTS (SELECT 1 FROM item_variant_map map WHERE map.organization_id = parent.organization_id AND map.parent_id = parent.id)
   AND NOT EXISTS (SELECT 1 FROM tenant.stock_movements movement WHERE movement.organization_id = parent.organization_id AND movement.item_id = parent.id);

-- The old variant rows are kept for the record, retired.
UPDATE tenant.item_variants SET status = 'inactive', updated_at = now() WHERE status <> 'inactive';

-- ============================================================ 6. permissions

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('products.manage_categories', 'Manage item categories', 'Products', 'Create, change, deactivate and delete item categories and their defaults.'),
  ('products.manage_units', 'Manage units and conversions', 'Products', 'Maintain units of measure and an item''s unit conversions.'),
  ('products.manage_identifiers', 'Manage barcodes and identifiers', 'Products', 'Add, remove and choose the primary barcode of an item.'),
  ('products.configure_tracking', 'Configure batch and serial tracking', 'Products', 'Set an item''s batch or serial tracking, expiry and shelf life.'),
  ('products.configure_accounting', 'Configure inventory accounting', 'Products', 'Set an item''s valuation method and standard cost classification.'),
  ('products.view_stock', 'View item stock by warehouse', 'Products', 'See on-hand, reserved, available, incoming and outgoing stock on items.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key
  FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key IN ('products.manage_categories', 'products.manage_units', 'products.manage_identifiers', 'products.configure_tracking',
                                                           'products.configure_accounting')
 WHERE existing.permission_key = 'products.edit_inventory'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'products.view_stock'
  FROM public.role_permissions existing
 WHERE existing.permission_key IN ('stock.view', 'products.edit_inventory', 'sales.view', 'procurement.view')
ON CONFLICT DO NOTHING;

-- Prices live in price lists (sales) and purchase orders (purchasing), not on items.
DELETE FROM public.role_permissions WHERE permission_key = 'products.edit_pricing';
DELETE FROM public.permissions WHERE key = 'products.edit_pricing';

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0057_item_master.sql', 'item-master');
