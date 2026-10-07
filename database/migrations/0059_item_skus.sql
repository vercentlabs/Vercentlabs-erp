-- 0059 SKUs: the SKU is the company's code for an item of the shared Item
-- Master (tenant.items.code; `sku` mirrors it). It is not a separate entity:
-- stock, batches, serials, barcodes and prices stay where they are.
--
-- 1. Normalized SKU: upper-case and trimmed, unique per organization; the
--    format is enforced for every writer.
-- 2. Generation: an organization chooses Manual, Automatic or either; an
--    automatic SKU is a prefix (the item's category's, else the default),
--    an optional year and a padded number from an atomic per-prefix counter.
--    Numbers may have gaps; they are never issued twice.
-- 3. Changes: an SKU change keeps the item (its id, stock, documents); the
--    old value is kept in the item's SKU history and stays searchable.
-- 4. Reservation: once a SKU has identified an item it is never given to
--    another item, even after the item is deactivated or its SKU changed.
--    Enforced by the database (item_sku_reservations).

-- ============================================================ 1. the SKU on the item

ALTER TABLE tenant.items
  ADD COLUMN IF NOT EXISTS normalized_sku text GENERATED ALWAYS AS (upper(btrim(code))) STORED,
  ADD COLUMN IF NOT EXISTS sku_generation_mode text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS sku_sequence_reference text,
  ADD COLUMN IF NOT EXISTS sku_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS sku_changed_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_sku_generation_mode_check') THEN
    ALTER TABLE tenant.items ADD CONSTRAINT items_sku_generation_mode_check CHECK (sku_generation_mode IN ('manual', 'automatic'));
  END IF;
  -- Letters, digits, dot, dash, underscore and slash; up to 40 characters; no spaces or invisible characters.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_sku_format_check') THEN
    ALTER TABLE tenant.items ADD CONSTRAINT items_sku_format_check CHECK (code ~ '^[A-Z0-9][A-Z0-9._/-]{0,39}$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS items_normalized_sku_uidx ON tenant.items (organization_id, normalized_sku);
-- SKU prefix search.
CREATE INDEX IF NOT EXISTS items_normalized_sku_prefix_idx ON tenant.items (organization_id, normalized_sku text_pattern_ops);

-- A category may give its items' generated SKUs their prefix (Pumps -> PUMP-000001).
ALTER TABLE tenant.item_groups ADD COLUMN IF NOT EXISTS sku_prefix text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'item_groups_sku_prefix_check') THEN
    ALTER TABLE tenant.item_groups ADD CONSTRAINT item_groups_sku_prefix_check CHECK (sku_prefix IS NULL OR sku_prefix ~ '^[A-Z0-9]{1,12}$');
  END IF;
END $$;

-- ============================================================ 2. numbering

CREATE TABLE IF NOT EXISTS tenant.item_sku_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- manual: every SKU is typed; automatic: every SKU is generated; either: generated when left empty.
  sku_mode text NOT NULL DEFAULT 'either' CHECK (sku_mode IN ('manual', 'automatic', 'either')),
  default_prefix text NOT NULL DEFAULT 'ITEM' CHECK (default_prefix ~ '^[A-Z0-9]{1,12}$'),
  separator text NOT NULL DEFAULT '-' CHECK (separator IN ('-', '_', '.', '/', '')),
  padding integer NOT NULL DEFAULT 6 CHECK (padding BETWEEN 3 AND 10),
  include_year boolean NOT NULL DEFAULT false,
  use_category_prefix boolean NOT NULL DEFAULT true,
  allow_sku_changes boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One counter per prefix (and year, when the year is part of the SKU). Only moves forward.
CREATE TABLE IF NOT EXISTS tenant.item_sku_sequences (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sequence_key text NOT NULL,
  next_value bigint NOT NULL DEFAULT 1 CHECK (next_value > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, sequence_key)
);

-- ============================================================ 3. history and reservation

CREATE TABLE IF NOT EXISTS tenant.item_sku_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  item_id uuid NOT NULL,
  old_sku text NOT NULL,
  normalized_old_sku text NOT NULL,
  new_sku text NOT NULL,
  reason text,
  changed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (organization_id, item_id) REFERENCES tenant.items (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS item_sku_history_item_idx ON tenant.item_sku_history (organization_id, item_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS item_sku_history_old_idx ON tenant.item_sku_history (organization_id, normalized_old_sku text_pattern_ops);

-- Every SKU an item has ever had. An unused item that is deleted frees its SKUs (it was on no document).
CREATE TABLE IF NOT EXISTS tenant.item_sku_reservations (
  organization_id uuid NOT NULL,
  normalized_sku text NOT NULL,
  item_id uuid NOT NULL,
  reserved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, normalized_sku),
  FOREIGN KEY (organization_id, item_id) REFERENCES tenant.items (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS item_sku_reservations_item_idx ON tenant.item_sku_reservations (organization_id, item_id);

-- Whoever writes the item: its SKU is reserved for it, and a SKU reserved for another item is refused.
CREATE OR REPLACE FUNCTION tenant.items_sku_reserve() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE holder uuid;
BEGIN
  INSERT INTO tenant.item_sku_reservations (organization_id, normalized_sku, item_id)
  VALUES (NEW.organization_id, upper(btrim(NEW.code)), NEW.id)
  ON CONFLICT (organization_id, normalized_sku) DO NOTHING;
  SELECT item_id INTO holder FROM tenant.item_sku_reservations
   WHERE organization_id = NEW.organization_id AND normalized_sku = upper(btrim(NEW.code));
  IF holder IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'SKU % has already identified another item and is never reused.', NEW.code
      USING ERRCODE = 'unique_violation', CONSTRAINT = 'item_sku_reserved';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER items_sku_reserve AFTER INSERT OR UPDATE OF code ON tenant.items
  FOR EACH ROW EXECUTE FUNCTION tenant.items_sku_reserve();

-- Today's SKUs are reserved for their items.
INSERT INTO tenant.item_sku_reservations (organization_id, normalized_sku, item_id)
SELECT item.organization_id, item.normalized_sku, item.id FROM tenant.items item
ON CONFLICT (organization_id, normalized_sku) DO NOTHING;

-- ============================================================ 4. security

DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['item_sku_settings', 'item_sku_sequences', 'item_sku_history', 'item_sku_reservations'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    EXECUTE format('GRANT SELECT ON tenant.%I TO vercent_worker', name);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.item_sku_settings TO vercent_app;
GRANT SELECT, INSERT, UPDATE ON tenant.item_sku_sequences TO vercent_app;
GRANT SELECT, INSERT ON tenant.item_sku_history TO vercent_app;
GRANT SELECT, INSERT ON tenant.item_sku_reservations TO vercent_app;

-- ============================================================ 5. permissions

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('products.generate_sku', 'Generate SKUs', 'Products', 'Create items with an automatically generated SKU.'),
  ('products.enter_sku', 'Enter SKUs manually', 'Products', 'Type an item''s SKU instead of generating it.'),
  ('products.change_sku', 'Change SKUs', 'Products', 'Correct or replace an existing item''s SKU. The old SKU stays reserved and searchable.'),
  ('products.view_sku_history', 'View SKU history', 'Products', 'See the SKUs an item had before.'),
  ('products.configure_sku_numbering', 'Configure SKU numbering', 'Products', 'Choose manual or automatic SKUs, the prefix, separator and number length.')
ON CONFLICT (key) DO NOTHING;

-- Whoever creates items may generate or type their SKUs.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key
  FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key IN ('products.generate_sku', 'products.enter_sku')
 WHERE existing.permission_key = 'products.create'
ON CONFLICT DO NOTHING;
-- Changing SKUs and their numbering is for item administrators: whoever configures item tracking.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key
  FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key IN ('products.change_sku', 'products.configure_sku_numbering')
 WHERE existing.permission_key = 'products.configure_tracking'
ON CONFLICT DO NOTHING;
-- Whoever sees items sees their SKU history.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'products.view_sku_history'
  FROM public.role_permissions existing WHERE existing.permission_key = 'products.view'
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0059_item_skus.sql', 'item-skus');
