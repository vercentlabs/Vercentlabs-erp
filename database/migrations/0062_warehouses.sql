-- 0062 Warehouses: the master of where stock is held. A warehouse never stores a quantity: on hand, reserved, available, incoming,
-- outgoing and value are read from Inventory's ledger and balances. The organization is the owning company (one company per
-- organization), so every warehouse, its stock and its movements belong to it.
--
-- 1. Identity and address: a normalized code unique per organization, description, address, time zone, manager and contact, an optional
--    GST registration, the four operational capabilities (receiving, shipping, transfers, returns) and one company default warehouse.
-- 2. Locations: every warehouse has a default storage location MAIN (created by the database for any new warehouse). Stock with no
--    location in the ledger is stock in MAIN. A location has a purpose (storage, receiving, quality hold, returns, shipping, transit), an
--    optional parent in the same warehouse, may refuse stock (a zone that only groups bins), and the warehouse may name its default
--    receiving, returns and shipping locations.
-- 3. Access: a user may be limited to some warehouses (and operations), and a warehouse to some users. With nobody listed on either
--    side, permissions alone decide. Replaces the per-warehouse receiving list, whose entries carry over.
-- 4. A user's preferred warehouse, and the warehouse history.

-- ============================================================ 1. the warehouse

ALTER TABLE tenant.warehouses
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS address_line1 text,
  ADD COLUMN IF NOT EXISTS address_line2 text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS state_code text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS country_code text,
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS manager_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS tax_registration_id uuid,
  ADD COLUMN IF NOT EXISTS receiving_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS shipping_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS transfer_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS returns_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
-- A warehouse ships when shipping is enabled and its type can fulfil sales (sales_fulfillment: never transit, work in progress, virtual
-- or returns).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouses_code_format_check') THEN
    ALTER TABLE tenant.warehouses ADD CONSTRAINT warehouses_code_format_check CHECK (code ~ '^[A-Z0-9][A-Z0-9._/-]{0,29}$') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouses_tax_registration_fkey') THEN
    ALTER TABLE tenant.warehouses ADD CONSTRAINT warehouses_tax_registration_fkey FOREIGN KEY (tax_registration_id) REFERENCES tenant.tax_registrations(id) ON DELETE SET NULL;
  END IF;
END $$;
-- Codes are compared trimmed and upper-cased; existing codes are normalized first.
UPDATE tenant.warehouses SET code = upper(btrim(code)) WHERE code IS DISTINCT FROM upper(btrim(code));
CREATE UNIQUE INDEX IF NOT EXISTS warehouses_code_normalized_uidx ON tenant.warehouses (organization_id, upper(btrim(code)));
-- One company default; an inactive warehouse is never the default.
CREATE UNIQUE INDEX IF NOT EXISTS warehouses_one_default_uidx ON tenant.warehouses (organization_id) WHERE is_default;
UPDATE tenant.warehouses warehouse SET is_default = true
 WHERE warehouse.status = 'active' AND NOT EXISTS (SELECT 1 FROM tenant.warehouses other WHERE other.organization_id = warehouse.organization_id AND other.is_default)
   AND warehouse.id = (SELECT first.id FROM tenant.warehouses first WHERE first.organization_id = warehouse.organization_id AND first.status = 'active'
                        ORDER BY (first.code = 'MAIN') DESC, first.created_at, first.id LIMIT 1);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouses_default_active_check') THEN
    ALTER TABLE tenant.warehouses ADD CONSTRAINT warehouses_default_active_check CHECK (NOT is_default OR status = 'active');
  END IF;
END $$;

-- ============================================================ 2. locations

ALTER TABLE tenant.warehouse_locations
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'storage',
  ADD COLUMN IF NOT EXISTS allow_stock boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_default_storage boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_default_receiving boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_default_returns boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_default_shipping boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_locations_purpose_check') THEN
    ALTER TABLE tenant.warehouse_locations ADD CONSTRAINT warehouse_locations_purpose_check
      CHECK (purpose IN ('storage', 'receiving', 'quality_hold', 'returns', 'shipping', 'transit'));
  END IF;
END $$;
-- Quality locations already used for holds are quality-hold locations.
UPDATE tenant.warehouse_locations SET purpose = 'quality_hold' WHERE location_type = 'quality' AND purpose = 'storage';
UPDATE tenant.warehouse_locations SET code = upper(btrim(code)) WHERE code IS DISTINCT FROM upper(btrim(code));
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_locations_code_normalized_uidx ON tenant.warehouse_locations (organization_id, warehouse_id, upper(btrim(code)));
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_locations_default_storage_uidx ON tenant.warehouse_locations (organization_id, warehouse_id) WHERE is_default_storage;
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_locations_default_receiving_uidx ON tenant.warehouse_locations (organization_id, warehouse_id) WHERE is_default_receiving;
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_locations_default_returns_uidx ON tenant.warehouse_locations (organization_id, warehouse_id) WHERE is_default_returns;
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_locations_default_shipping_uidx ON tenant.warehouse_locations (organization_id, warehouse_id) WHERE is_default_shipping;

-- MAIN for every warehouse: an existing MAIN location becomes the default storage location, otherwise one is created.
UPDATE tenant.warehouse_locations location SET is_default_storage = true, purpose = 'storage', allow_stock = true
 WHERE location.code = 'MAIN' AND NOT EXISTS (SELECT 1 FROM tenant.warehouse_locations other WHERE other.organization_id = location.organization_id
   AND other.warehouse_id = location.warehouse_id AND other.is_default_storage);
INSERT INTO tenant.warehouse_locations (organization_id, warehouse_id, name, code, location_type, purpose, is_default_storage, status)
SELECT warehouse.organization_id, warehouse.id, 'Main storage', 'MAIN', 'zone', 'storage', true, 'active' FROM tenant.warehouses warehouse
 WHERE NOT EXISTS (SELECT 1 FROM tenant.warehouse_locations location WHERE location.organization_id = warehouse.organization_id AND location.warehouse_id = warehouse.id AND location.is_default_storage);

-- Any new warehouse, whoever creates it, gets its MAIN location.
CREATE OR REPLACE FUNCTION tenant.warehouses_create_main_location() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO tenant.warehouse_locations (organization_id, warehouse_id, name, code, location_type, purpose, is_default_storage, status, created_by, updated_by)
  VALUES (NEW.organization_id, NEW.id, 'Main storage', 'MAIN', 'zone', 'storage', true, 'active', NEW.created_by, NEW.created_by)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER warehouses_create_main_location AFTER INSERT ON tenant.warehouses FOR EACH ROW EXECUTE FUNCTION tenant.warehouses_create_main_location();

-- A location's parent is in the same warehouse, and a location is never its own ancestor.
CREATE OR REPLACE FUNCTION tenant.warehouse_locations_parent_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE cursor_id uuid; depth integer := 0;
BEGIN
  IF NEW.parent_location_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.parent_location_id = NEW.id THEN
    RAISE EXCEPTION 'A location cannot be its own parent.' USING ERRCODE = 'check_violation', CONSTRAINT = 'warehouse_locations_hierarchy';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tenant.warehouse_locations parent WHERE parent.organization_id = NEW.organization_id AND parent.id = NEW.parent_location_id AND parent.warehouse_id = NEW.warehouse_id) THEN
    RAISE EXCEPTION 'A parent location must be in the same warehouse.' USING ERRCODE = 'check_violation', CONSTRAINT = 'warehouse_locations_hierarchy';
  END IF;
  cursor_id := NEW.parent_location_id;
  WHILE cursor_id IS NOT NULL AND depth < 50 LOOP
    IF cursor_id = NEW.id THEN
      RAISE EXCEPTION 'The parent location is inside this location.' USING ERRCODE = 'check_violation', CONSTRAINT = 'warehouse_locations_hierarchy';
    END IF;
    SELECT parent_location_id INTO cursor_id FROM tenant.warehouse_locations WHERE organization_id = NEW.organization_id AND id = cursor_id;
    depth := depth + 1;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER warehouse_locations_parent_guard BEFORE INSERT OR UPDATE OF parent_location_id, warehouse_id ON tenant.warehouse_locations
  FOR EACH ROW EXECUTE FUNCTION tenant.warehouse_locations_parent_guard();

-- ============================================================ 3. access

CREATE TABLE IF NOT EXISTS tenant.warehouse_user_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- receive, ship, transfer, adjust, opening, purchase_return, sales_return
  operations text[] NOT NULL DEFAULT ARRAY['receive', 'ship', 'transfer', 'adjust', 'opening', 'purchase_return', 'sales_return'],
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, warehouse_id, user_id),
  FOREIGN KEY (organization_id, warehouse_id) REFERENCES tenant.warehouses (organization_id, id) ON DELETE CASCADE,
  CHECK (operations <@ ARRAY['receive', 'ship', 'transfer', 'adjust', 'opening', 'purchase_return', 'sales_return'] AND cardinality(operations) > 0)
);
CREATE INDEX IF NOT EXISTS warehouse_user_access_user_idx ON tenant.warehouse_user_access (organization_id, user_id);
-- The receiving lists carry over: whoever was listed keeps receiving into that warehouse.
INSERT INTO tenant.warehouse_user_access (organization_id, warehouse_id, user_id, operations, created_by, created_at)
SELECT access.organization_id, access.warehouse_id, access.user_id, ARRAY['receive'], access.created_by, access.created_at FROM tenant.warehouse_receiving_users access
ON CONFLICT (organization_id, warehouse_id, user_id) DO NOTHING;

-- ============================================================ 4. preferences and history

CREATE TABLE IF NOT EXISTS tenant.user_warehouse_defaults (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id),
  FOREIGN KEY (organization_id, warehouse_id) REFERENCES tenant.warehouses (organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.warehouse_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('created', 'updated', 'code_changed', 'address_changed', 'capabilities_changed', 'default_changed', 'manager_changed',
    'location_added', 'location_changed', 'location_deactivated', 'location_activated', 'access_changed', 'activated', 'deactivated')),
  summary text NOT NULL,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (organization_id, warehouse_id) REFERENCES tenant.warehouses (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS warehouse_history_idx ON tenant.warehouse_history (organization_id, warehouse_id, created_at DESC);

DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['warehouse_user_access', 'user_warehouse_defaults', 'warehouse_history'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    EXECUTE format('GRANT SELECT ON tenant.%I TO vercent_worker', name);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.warehouse_user_access TO vercent_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.user_warehouse_defaults TO vercent_app;
GRANT SELECT, INSERT ON tenant.warehouse_history TO vercent_app;
GRANT DELETE ON tenant.warehouses TO vercent_app;

-- ============================================================ 5. permissions

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('warehouses.view', 'View warehouses', 'Inventory', 'See warehouses, their locations and settings.'),
  ('warehouses.create', 'Create warehouses', 'Inventory', 'Add a warehouse.'),
  ('warehouses.edit', 'Edit warehouses', 'Inventory', 'Change a warehouse''s name, address, contact, manager, capabilities and defaults.'),
  ('warehouses.change_code', 'Change warehouse codes', 'Inventory', 'Correct a warehouse''s code.'),
  ('warehouses.status', 'Activate and deactivate warehouses', 'Inventory', 'Deactivate an empty warehouse or bring one back; delete an unused one.'),
  ('warehouses.manage_locations', 'Manage warehouse locations', 'Inventory', 'Add, change and deactivate locations and bins.'),
  ('warehouses.manage_access', 'Manage warehouse access', 'Inventory', 'Choose which people may work in which warehouses.'),
  ('warehouses.view_stock', 'View warehouse stock', 'Inventory', 'See stock quantities by warehouse and location.'),
  ('warehouses.view_value', 'View warehouse stock value', 'Inventory', 'See the value of stock in a warehouse.'),
  ('stock.opening', 'Post opening stock', 'Inventory', 'Bring in opening balances by warehouse and location.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key IN ('warehouses.view', 'warehouses.view_stock')
 WHERE existing.permission_key = 'stock.view'
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key IN ('warehouses.view', 'warehouses.create', 'warehouses.edit', 'warehouses.change_code', 'warehouses.status',
    'warehouses.manage_locations', 'warehouses.manage_access')
 WHERE existing.permission_key = 'inventory_setup.manage'
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'warehouses.view_value' FROM public.role_permissions existing WHERE existing.permission_key = 'stock.valuation.view'
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'stock.opening' FROM public.role_permissions existing WHERE existing.permission_key = 'stock.adjust'
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0062_warehouses.sql', 'warehouses');
