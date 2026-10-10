-- 0080 Stores & Outlets (POS): the selling location every POS transaction belongs to. One entity (tenant.pos_stores, shown as "Store /
-- Outlet") — never a second Warehouse, Customer, tax system or accounting entity. The organization is the operating company (one company per
-- organization), so every outlet, its warehouse, its GST registration and its accounts belong to it.
--
-- 1. The outlet: a normalized code unique per organization, type, address, time zone, manager and contact; the selling warehouse (stock is
--    read from Inventory, never kept here), optional selling and returns locations of that warehouse, the GST registration it sells under,
--    the default price list, walk-in customer and cash account, a receipt message, business hours and notes. Lifecycle Active / Inactive
--    (`active`); a new outlet is saved inactive and activated once its setup is complete.
-- 2. Payment methods the outlet accepts (cash, card, UPI, wallet, bank transfer), each with an optional clearing / cash account of the
--    company's chart. Existing allowed-method lists carry over.
-- 3. Outlet history: every material change, who made it, when, from what to what.
-- 4. Permissions for viewing, creating, editing, activating, inventory defaults, tax and documents, payment methods, user access,
--    transactions, sessions and cash / finance details.

-- ============================================================ 1. the outlet

ALTER TABLE tenant.pos_stores
  ADD COLUMN IF NOT EXISTS outlet_type text NOT NULL DEFAULT 'retail_store',
  ADD COLUMN IF NOT EXISTS address_line1 text,
  ADD COLUMN IF NOT EXISTS address_line2 text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS state_code text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS country_code text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS manager_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS selling_location_id uuid,
  ADD COLUMN IF NOT EXISTS returns_location_id uuid,
  ADD COLUMN IF NOT EXISTS tax_registration_id uuid,
  ADD COLUMN IF NOT EXISTS default_customer_id uuid,
  ADD COLUMN IF NOT EXISTS cash_account_id uuid,
  ADD COLUMN IF NOT EXISTS receipt_message text,
  ADD COLUMN IF NOT EXISTS business_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_stores_outlet_type_check') THEN
    ALTER TABLE tenant.pos_stores ADD CONSTRAINT pos_stores_outlet_type_check CHECK (outlet_type IN ('retail_store', 'showroom', 'kiosk', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_stores_code_format_check') THEN
    ALTER TABLE tenant.pos_stores ADD CONSTRAINT pos_stores_code_format_check CHECK (code ~ '^[A-Z0-9][A-Z0-9._/-]{0,29}$') NOT VALID;
  END IF;
  -- The selling warehouse, its locations, the GST registration, walk-in customer and cash account are the company's own records.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_stores_warehouse_org_fkey') THEN
    ALTER TABLE tenant.pos_stores ADD CONSTRAINT pos_stores_warehouse_org_fkey FOREIGN KEY (organization_id, warehouse_id) REFERENCES tenant.warehouses (organization_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_stores_selling_location_fkey') THEN
    ALTER TABLE tenant.pos_stores ADD CONSTRAINT pos_stores_selling_location_fkey FOREIGN KEY (selling_location_id) REFERENCES tenant.warehouse_locations (id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_stores_returns_location_fkey') THEN
    ALTER TABLE tenant.pos_stores ADD CONSTRAINT pos_stores_returns_location_fkey FOREIGN KEY (returns_location_id) REFERENCES tenant.warehouse_locations (id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_stores_tax_registration_fkey') THEN
    ALTER TABLE tenant.pos_stores ADD CONSTRAINT pos_stores_tax_registration_fkey FOREIGN KEY (organization_id, tax_registration_id) REFERENCES tenant.tax_registrations (organization_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_stores_default_customer_fkey') THEN
    ALTER TABLE tenant.pos_stores ADD CONSTRAINT pos_stores_default_customer_fkey FOREIGN KEY (default_customer_id) REFERENCES tenant.business_parties (id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_stores_cash_account_fkey') THEN
    ALTER TABLE tenant.pos_stores ADD CONSTRAINT pos_stores_cash_account_fkey FOREIGN KEY (cash_account_id) REFERENCES tenant.accounting_accounts (id) ON DELETE SET NULL;
  END IF;
END $$;

-- Codes are compared trimmed and upper-cased; existing codes are normalized first.
UPDATE tenant.pos_stores SET code = upper(btrim(code)) WHERE code IS DISTINCT FROM upper(btrim(code));
CREATE UNIQUE INDEX IF NOT EXISTS pos_stores_code_normalized_uidx ON tenant.pos_stores (organization_id, upper(btrim(code)));
CREATE INDEX IF NOT EXISTS pos_stores_warehouse_idx ON tenant.pos_stores (organization_id, warehouse_id);
CREATE INDEX IF NOT EXISTS pos_stores_manager_idx ON tenant.pos_stores (organization_id, manager_user_id) WHERE manager_user_id IS NOT NULL;

-- A selling or returns location must be a location of the outlet's selling warehouse.
CREATE OR REPLACE FUNCTION tenant.pos_stores_location_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.selling_location_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenant.warehouse_locations location
      WHERE location.organization_id = NEW.organization_id AND location.id = NEW.selling_location_id AND location.warehouse_id = NEW.warehouse_id) THEN
    RAISE EXCEPTION 'The selling location must be a location of the selling warehouse.' USING ERRCODE = 'check_violation', CONSTRAINT = 'pos_stores_location_in_warehouse';
  END IF;
  IF NEW.returns_location_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenant.warehouse_locations location
      WHERE location.organization_id = NEW.organization_id AND location.id = NEW.returns_location_id AND location.warehouse_id = NEW.warehouse_id) THEN
    RAISE EXCEPTION 'The returns location must be a location of the selling warehouse.' USING ERRCODE = 'check_violation', CONSTRAINT = 'pos_stores_location_in_warehouse';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER pos_stores_location_guard BEFORE INSERT OR UPDATE OF warehouse_id, selling_location_id, returns_location_id ON tenant.pos_stores
  FOR EACH ROW EXECUTE FUNCTION tenant.pos_stores_location_guard();

-- ============================================================ 2. payment methods

CREATE TABLE IF NOT EXISTS tenant.pos_store_payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES tenant.pos_stores(id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('cash', 'card', 'upi', 'wallet', 'bank_transfer')),
  enabled boolean NOT NULL DEFAULT true,
  -- The cash account (cash) or clearing account (card, UPI, wallet, bank transfer) in the company's chart; Finance owns the account.
  account_id uuid REFERENCES tenant.accounting_accounts(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, store_id, method)
);
-- The methods each existing outlet already accepted carry over.
INSERT INTO tenant.pos_store_payment_methods (organization_id, store_id, method, enabled, created_by, created_at)
SELECT store.organization_id, store.id, method, true, store.created_by, store.created_at
  FROM tenant.pos_stores store, unnest(store.allowed_payment_methods) AS method
 WHERE method IN ('cash', 'card', 'upi', 'wallet', 'bank_transfer')
ON CONFLICT (organization_id, store_id, method) DO NOTHING;

-- One assignment per person per outlet and terminal (a store-wide grant has no terminal).
CREATE UNIQUE INDEX IF NOT EXISTS pos_store_access_assignment_uidx
  ON tenant.pos_store_access (organization_id, store_id, user_id, COALESCE(terminal_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ============================================================ 3. history

CREATE TABLE IF NOT EXISTS tenant.pos_store_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  store_id uuid NOT NULL REFERENCES tenant.pos_stores(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('created', 'updated', 'code_changed', 'address_changed', 'manager_changed', 'inventory_changed', 'tax_changed',
    'price_list_changed', 'payment_methods_changed', 'access_changed', 'activated', 'deactivated')),
  summary text NOT NULL,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS pos_store_history_idx ON tenant.pos_store_history (organization_id, store_id, created_at DESC);

DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['pos_store_payment_methods', 'pos_store_history'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
    EXECUTE format('GRANT SELECT ON tenant.%I TO vercent_worker', name);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.pos_store_payment_methods TO vercent_app;
GRANT SELECT, INSERT ON tenant.pos_store_history TO vercent_app;

-- ============================================================ 4. permissions

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('pos.outlets.view', 'View stores and outlets', 'Point of Sale', 'See stores and outlets, their setup and terminals.'),
  ('pos.outlets.create', 'Create stores and outlets', 'Point of Sale', 'Add a store or outlet.'),
  ('pos.outlets.edit', 'Edit stores and outlets', 'Point of Sale', 'Change an outlet''s name, address, contact, manager, price list, walk-in customer and hours.'),
  ('pos.outlets.status', 'Activate and deactivate outlets', 'Point of Sale', 'Activate a fully set-up outlet, deactivate a closed one, delete an unused one.'),
  ('pos.outlets.manage_inventory', 'Manage outlet inventory defaults', 'Point of Sale', 'Choose the selling warehouse and the selling and returns locations.'),
  ('pos.outlets.manage_tax', 'Manage outlet tax and documents', 'Point of Sale', 'Choose the GST registration an outlet sells under and its receipt message.'),
  ('pos.outlets.manage_payments', 'Manage outlet payment methods', 'Point of Sale', 'Choose the payment methods an outlet accepts and their cash and clearing accounts.'),
  ('pos.outlets.manage_access', 'Manage outlet user access', 'Point of Sale', 'Choose which people may work at which outlets and terminals.'),
  ('pos.outlets.view_transactions', 'View outlet transactions', 'Point of Sale', 'See the sales and returns made at an outlet.'),
  ('pos.outlets.view_sessions', 'View outlet sessions', 'Point of Sale', 'See the shifts opened and closed at an outlet.'),
  ('pos.outlets.view_finance', 'View outlet cash and finance details', 'Point of Sale', 'See an outlet''s cash and clearing accounts and cash differences.')
ON CONFLICT (key) DO NOTHING;
-- Whoever sees POS sees outlets; store administrators maintain them, their stock source and who works there; POS settings administrators
-- own tax, payments and accounts; whoever sees POS reports sees an outlet's transactions and sessions.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'pos.outlets.view' FROM public.role_permissions existing WHERE existing.permission_key = 'pos.view'
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key IN ('pos.outlets.view', 'pos.outlets.create', 'pos.outlets.edit', 'pos.outlets.status', 'pos.outlets.manage_inventory',
    'pos.outlets.manage_access', 'pos.outlets.view_transactions', 'pos.outlets.view_sessions')
 WHERE existing.permission_key = 'pos.store.manage'
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key IN ('pos.outlets.view', 'pos.outlets.manage_tax', 'pos.outlets.manage_payments', 'pos.outlets.view_finance')
 WHERE existing.permission_key = 'pos.settings.manage'
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key IN ('pos.outlets.view_transactions', 'pos.outlets.view_sessions')
 WHERE existing.permission_key IN ('pos.reports.view', 'pos.report.view')
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0080_pos_outlets.sql', 'pos-outlets');
