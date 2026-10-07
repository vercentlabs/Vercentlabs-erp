-- 0060 Multiple units of measure. Every item has one base unit; stock, valuation, reservations and availability count in it. Any other
-- unit is a transaction unit with a fixed conversion to the base:
--
--   base quantity = quantity × conversion_to_base      (conversion_to_base = base units in one unit of it)
--
-- 1. The unit master gains a symbol, a version and its standard conversions (KG = 1000 G, M = 100 CM …) within one dimension; packaging
--    units (BOX, CARTON, ROLL …) convert only through an item's own conversion.
-- 2. An item's conversions are always to its base unit (older rows written the other way round are turned around), each enabled for
--    purchasing, sales and inventory entry, optionally with a stricter precision, versioned, and with an auditable history.
-- 3. Documents keep the unit and quantity entered and the conversion used: goods receipts and purchase returns may now be entered in another
--    unit than the order's, inventory movements and transfers in another unit than the base.

-- ============================================================ 1. the unit master

ALTER TABLE tenant.units_of_measure
  ADD COLUMN IF NOT EXISTS symbol text,
  ADD COLUMN IF NOT EXISTS fraction_allowed boolean GENERATED ALWAYS AS (decimal_places > 0) STORED,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

-- Deterministic conversions between units of one dimension, by code: factor_to_reference is how many of the dimension's reference unit one
-- unit is (1 KG = 1000 G). Two units of a dimension convert by the ratio of their factors. Shared reference data, the same for every
-- organization; an item's own conversion always comes first.
CREATE TABLE IF NOT EXISTS public.uom_standard_conversions (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z0-9]{1,12}$'),
  dimension text NOT NULL CHECK (dimension IN ('quantity', 'weight', 'volume', 'length', 'area', 'time')),
  factor_to_reference numeric(24, 10) NOT NULL CHECK (factor_to_reference > 0)
);
INSERT INTO public.uom_standard_conversions (code, dimension, factor_to_reference) VALUES
  ('EA', 'quantity', 1), ('PCS', 'quantity', 1), ('NOS', 'quantity', 1), ('PAIR', 'quantity', 2), ('DOZEN', 'quantity', 12),
  ('MG', 'weight', 0.001), ('G', 'weight', 1), ('KG', 'weight', 1000), ('TONNE', 'weight', 1000000),
  ('MM', 'length', 0.001), ('CM', 'length', 0.01), ('M', 'length', 1), ('KM', 'length', 1000),
  ('CM2', 'area', 0.0001), ('M2', 'area', 1), ('SQM', 'area', 1),
  ('ML', 'volume', 0.001), ('L', 'volume', 1), ('M3', 'volume', 1000),
  ('MIN', 'time', 1), ('HOUR', 'time', 60), ('DAY', 'time', 1440)
ON CONFLICT (code) DO NOTHING;
GRANT SELECT ON public.uom_standard_conversions TO vercent_app, vercent_worker;

-- The standard set every organization has (existing units are left as they are).
INSERT INTO tenant.units_of_measure (organization_id, code, name, symbol, category, decimal_places)
SELECT organization.id, unit.code, unit.name, unit.symbol, unit.category, unit.places
  FROM public.organizations organization
 CROSS JOIN (VALUES
   ('PCS', 'Pieces', 'pcs', 'quantity', 0), ('SET', 'Set', NULL, 'quantity', 0), ('PAIR', 'Pair', NULL, 'quantity', 0), ('DOZEN', 'Dozen', 'dz', 'quantity', 0),
   ('MG', 'Milligram', 'mg', 'weight', 3), ('TONNE', 'Tonne', 't', 'weight', 3), ('MM', 'Millimetre', 'mm', 'length', 2), ('KM', 'Kilometre', 'km', 'length', 3),
   ('CM2', 'Square centimetre', 'cm²', 'area', 2), ('M2', 'Square metre', 'm²', 'area', 3), ('M3', 'Cubic metre', 'm³', 'volume', 3),
   ('MIN', 'Minute', 'min', 'time', 0), ('MONTH', 'Month', 'mo', 'time', 2),
   ('PACK', 'Pack', NULL, 'packaging', 0), ('CARTON', 'Carton', 'ctn', 'packaging', 0), ('BAG', 'Bag', NULL, 'packaging', 0), ('ROLL', 'Roll', NULL, 'packaging', 0),
   ('PALLET', 'Pallet', NULL, 'packaging', 0), ('DRUM', 'Drum', NULL, 'packaging', 0)
 ) AS unit (code, name, symbol, category, places)
ON CONFLICT (organization_id, code) DO NOTHING;
UPDATE tenant.units_of_measure SET symbol = CASE code WHEN 'KG' THEN 'kg' WHEN 'G' THEN 'g' WHEN 'L' THEN 'L' WHEN 'ML' THEN 'mL' WHEN 'M' THEN 'm' WHEN 'CM' THEN 'cm'
  WHEN 'SQM' THEN 'm²' WHEN 'HOUR' THEN 'h' WHEN 'DAY' THEN 'd' ELSE symbol END
 WHERE symbol IS NULL AND code IN ('KG', 'G', 'L', 'ML', 'M', 'CM', 'SQM', 'HOUR', 'DAY');

-- ============================================================ 2. an item's units

ALTER TABLE tenant.item_uom_conversions
  ADD COLUMN IF NOT EXISTS purchasing_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sales_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS inventory_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS quantity_precision integer CHECK (quantity_precision IS NULL OR quantity_precision BETWEEN 0 AND 6),
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

-- One direction only: from the alternate unit to the base. A row written the other way round (base -> alternate) is turned around when
-- that pair is not already written the right way; otherwise it is retired. A row to a unit that is no longer the item's base is retired.
UPDATE tenant.item_uom_conversions conversion
   SET from_uom_id = conversion.to_uom_id, to_uom_id = conversion.from_uom_id, conversion_factor = round(1 / conversion.conversion_factor, 10), updated_at = now()
  FROM tenant.items item
 WHERE item.organization_id = conversion.organization_id AND item.id = conversion.item_id AND conversion.from_uom_id = item.uom_id AND conversion.status = 'active'
   AND NOT EXISTS (SELECT 1 FROM tenant.item_uom_conversions other WHERE other.organization_id = conversion.organization_id AND other.item_id = conversion.item_id
                    AND other.from_uom_id = conversion.to_uom_id AND other.to_uom_id = conversion.from_uom_id);
UPDATE tenant.item_uom_conversions conversion SET status = 'inactive', updated_at = now()
  FROM tenant.items item
 WHERE item.organization_id = conversion.organization_id AND item.id = conversion.item_id AND conversion.to_uom_id <> item.uom_id AND conversion.status = 'active';

-- One active conversion per unit of an item.
CREATE UNIQUE INDEX IF NOT EXISTS item_uom_conversions_active_unit_uidx ON tenant.item_uom_conversions (organization_id, item_id, from_uom_id) WHERE status = 'active';

-- Whoever writes a conversion: it is to the item's base unit. When the base unit changes (only possible before the item is used), the
-- conversions to the old base are retired.
CREATE OR REPLACE FUNCTION tenant.item_uom_conversions_to_base() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE base uuid;
BEGIN
  IF NEW.status = 'active' THEN
    SELECT uom_id INTO base FROM tenant.items WHERE organization_id = NEW.organization_id AND id = NEW.item_id;
    IF NEW.to_uom_id IS DISTINCT FROM base THEN
      RAISE EXCEPTION 'An item conversion is always to the item''s base unit.' USING ERRCODE = 'check_violation', CONSTRAINT = 'item_uom_conversions_to_base';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER item_uom_conversions_to_base BEFORE INSERT OR UPDATE ON tenant.item_uom_conversions
  FOR EACH ROW EXECUTE FUNCTION tenant.item_uom_conversions_to_base();

CREATE OR REPLACE FUNCTION tenant.items_retire_conversions_on_base_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.uom_id IS DISTINCT FROM OLD.uom_id THEN
    UPDATE tenant.item_uom_conversions SET status = 'inactive', updated_at = now()
     WHERE organization_id = NEW.organization_id AND item_id = NEW.id AND status = 'active' AND to_uom_id IS DISTINCT FROM NEW.uom_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER items_retire_conversions_on_base_change AFTER UPDATE OF uom_id ON tenant.items
  FOR EACH ROW EXECUTE FUNCTION tenant.items_retire_conversions_on_base_change();

-- What changed on an item's units, with the old and new values.
CREATE TABLE IF NOT EXISTS tenant.item_uom_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  item_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('base_set', 'base_changed', 'unit_added', 'conversion_changed', 'usage_changed', 'precision_changed',
    'purchase_default_changed', 'sales_default_changed', 'unit_deactivated', 'unit_reactivated')),
  uom_id uuid,
  uom_code text,
  old_value jsonb,
  new_value jsonb,
  reason text,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (organization_id, item_id) REFERENCES tenant.items (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS item_uom_history_item_idx ON tenant.item_uom_history (organization_id, item_id, created_at DESC);

-- ============================================================ 3. the unit entered on documents

-- A goods receipt or purchase return line may be entered in another unit than the order's: what was entered, in which unit and at what
-- conversion to the base. The line's own quantities stay in the order's unit (so the order's progress is unchanged), converted exactly.
ALTER TABLE tenant.goods_receipt_lines
  ADD COLUMN IF NOT EXISTS entered_uom_id uuid,
  ADD COLUMN IF NOT EXISTS entered_quantity numeric(24, 6),
  ADD COLUMN IF NOT EXISTS entered_conversion_factor numeric(24, 10);
ALTER TABLE tenant.purchase_return_lines
  ADD COLUMN IF NOT EXISTS entered_uom_id uuid,
  ADD COLUMN IF NOT EXISTS entered_quantity numeric(24, 6),
  ADD COLUMN IF NOT EXISTS entered_conversion_factor numeric(24, 10);
-- An inventory movement or transfer entered in another unit than the base: the ledger keeps the base quantity, these keep what was typed.
ALTER TABLE tenant.stock_movements
  ADD COLUMN IF NOT EXISTS entered_uom_id uuid,
  ADD COLUMN IF NOT EXISTS entered_quantity numeric(24, 6),
  ADD COLUMN IF NOT EXISTS entered_conversion_factor numeric(24, 10),
  ADD COLUMN IF NOT EXISTS entered_unit_cost numeric(24, 6);
ALTER TABLE tenant.stock_transfers
  ADD COLUMN IF NOT EXISTS entered_uom_id uuid,
  ADD COLUMN IF NOT EXISTS entered_quantity numeric(24, 6),
  ADD COLUMN IF NOT EXISTS entered_conversion_factor numeric(24, 10);
DO $$
DECLARE target record;
BEGIN
  FOR target IN SELECT * FROM (VALUES ('goods_receipt_lines'), ('purchase_return_lines'), ('stock_movements'), ('stock_transfers')) AS t(name) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = target.name || '_entered_uom_fkey') THEN
      EXECUTE format('ALTER TABLE tenant.%I ADD CONSTRAINT %I FOREIGN KEY (organization_id, entered_uom_id) REFERENCES tenant.units_of_measure (organization_id, id) ON DELETE RESTRICT',
        target.name, target.name || '_entered_uom_fkey');
    END IF;
  END LOOP;
END $$;

-- ============================================================ 4. security

ALTER TABLE tenant.item_uom_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.item_uom_history FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.item_uom_history USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT ON tenant.item_uom_history TO vercent_app;
GRANT SELECT ON tenant.item_uom_history TO vercent_worker;

-- ============================================================ 5. permissions

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('products.manage_uom_master', 'Manage units of measure', 'Products', 'Create, edit, deactivate and reactivate units in the unit list.'),
  ('products.change_uom_conversions', 'Change unit conversions', 'Products', 'Change how many base units an item''s alternate unit holds, and its usage.'),
  ('products.change_default_uoms', 'Change default units', 'Products', 'Choose an item''s default purchase and sales units.')
ON CONFLICT (key) DO NOTHING;
-- Whoever manages an item's units may do all three.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key
  FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key IN ('products.manage_uom_master', 'products.change_uom_conversions', 'products.change_default_uoms')
 WHERE existing.permission_key = 'products.manage_units'
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0060_multiple_uom.sql', 'multiple-uom');
