-- 0082 Cashiers (POS): an operational POS profile over an existing workspace user — never a second login, password or employee master.
-- Authentication stays with the user, employment with HR, authorization with roles and permissions (Cashier Permissions). The organization
-- is the company, so a user has at most one cashier profile.
--
-- 1. The cashier: a normalized code unique in the company, Active / Inactive, an optional short display name for receipts, an optional HR
--    employee, an optional default outlet (always one of their outlets) and notes. Current outlet, terminal, session, sales and cash are
--    read from sessions and transactions, never stored here.
-- 2. Outlet access: where a cashier may work (many outlets per cashier). It replaces the earlier per-user store access list; existing
--    assignments carry over. Terminal-level grants are not kept: an outlet's cashiers may use any of its active terminals.
-- 3. Attribution: every session names its cashier profile; every sale and return records the cashier and snapshots the code and name it
--    was made under, so renaming a user never changes an issued receipt. One open session per cashier.
-- 4. History and permissions.

-- ============================================================ 1. the cashier

CREATE TABLE IF NOT EXISTS tenant.pos_cashiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id),
  employee_id uuid,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9._/-]{0,29}$'),
  display_name text,
  status text NOT NULL DEFAULT 'inactive' CHECK (status IN ('active', 'inactive')),
  default_outlet_id uuid,
  notes text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_cashiers_code_uidx ON tenant.pos_cashiers (organization_id, upper(btrim(code)));
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_cashiers_employee_fkey') THEN
    ALTER TABLE tenant.pos_cashiers ADD CONSTRAINT pos_cashiers_employee_fkey FOREIGN KEY (employee_id) REFERENCES tenant.hr_employees (id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_cashiers_default_outlet_fkey') THEN
    ALTER TABLE tenant.pos_cashiers ADD CONSTRAINT pos_cashiers_default_outlet_fkey FOREIGN KEY (default_outlet_id) REFERENCES tenant.pos_stores (id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================ 2. outlet access

CREATE TABLE IF NOT EXISTS tenant.pos_cashier_outlets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  cashier_id uuid NOT NULL,
  store_id uuid NOT NULL REFERENCES tenant.pos_stores(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, cashier_id, store_id),
  FOREIGN KEY (organization_id, cashier_id) REFERENCES tenant.pos_cashiers (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS pos_cashier_outlets_store_idx ON tenant.pos_cashier_outlets (organization_id, store_id);

-- The default outlet is one of the cashier's outlets.
CREATE OR REPLACE FUNCTION tenant.pos_cashiers_default_outlet_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.default_outlet_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenant.pos_cashier_outlets access
      WHERE access.organization_id = NEW.organization_id AND access.cashier_id = NEW.id AND access.store_id = NEW.default_outlet_id) THEN
    RAISE EXCEPTION 'The default outlet must be one of the cashier''s outlets.' USING ERRCODE = 'check_violation', CONSTRAINT = 'pos_cashiers_default_outlet_allowed';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER pos_cashiers_default_outlet_guard BEFORE UPDATE OF default_outlet_id ON tenant.pos_cashiers
  FOR EACH ROW EXECUTE FUNCTION tenant.pos_cashiers_default_outlet_guard();

-- Earlier per-user store assignments carry over: each assigned user becomes a cashier (code CSH-001, CSH-002, … in order of first
-- assignment), active while their membership is, with access to the outlets they were assigned.
INSERT INTO tenant.pos_cashiers (organization_id, user_id, code, status, created_by, created_at)
SELECT access.organization_id, access.user_id,
       'CSH-' || lpad((row_number() OVER (PARTITION BY access.organization_id ORDER BY min(access.created_at), access.user_id)
         + COALESCE((SELECT count(*) FROM tenant.pos_cashiers existing WHERE existing.organization_id = access.organization_id), 0))::text, 3, '0'),
       CASE WHEN bool_or(membership.status = 'active') THEN 'active' ELSE 'inactive' END, min(access.created_by::text)::uuid, min(access.created_at)
  FROM tenant.pos_store_access access
  LEFT JOIN public.organization_memberships membership ON membership.organization_id = access.organization_id AND membership.user_id = access.user_id
 WHERE NOT EXISTS (SELECT 1 FROM tenant.pos_cashiers cashier WHERE cashier.organization_id = access.organization_id AND cashier.user_id = access.user_id)
 GROUP BY access.organization_id, access.user_id
ON CONFLICT DO NOTHING;
INSERT INTO tenant.pos_cashier_outlets (organization_id, cashier_id, store_id, granted_by, granted_at)
SELECT DISTINCT ON (access.organization_id, cashier.id, access.store_id) access.organization_id, cashier.id, access.store_id, access.created_by, access.created_at
  FROM tenant.pos_store_access access
  JOIN tenant.pos_cashiers cashier ON cashier.organization_id = access.organization_id AND cashier.user_id = access.user_id
 ORDER BY access.organization_id, cashier.id, access.store_id, access.created_at
ON CONFLICT DO NOTHING;

-- ============================================================ 3. attribution

ALTER TABLE tenant.pos_shifts ADD COLUMN IF NOT EXISTS cashier_id uuid;
ALTER TABLE tenant.pos_sales
  ADD COLUMN IF NOT EXISTS cashier_id uuid,
  ADD COLUMN IF NOT EXISTS cashier_code text,
  ADD COLUMN IF NOT EXISTS cashier_name text;
ALTER TABLE tenant.pos_returns
  ADD COLUMN IF NOT EXISTS cashier_id uuid,
  ADD COLUMN IF NOT EXISTS cashier_code text,
  ADD COLUMN IF NOT EXISTS cashier_name text;
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['pos_shifts', 'pos_sales', 'pos_returns'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = name || '_cashier_fkey') THEN
      EXECUTE format('ALTER TABLE tenant.%I ADD CONSTRAINT %I FOREIGN KEY (organization_id, cashier_id) REFERENCES tenant.pos_cashiers (organization_id, id)', name, name || '_cashier_fkey');
    END IF;
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON tenant.%I (organization_id, cashier_id)', name || '_cashier_idx', name);
  END LOOP;
END $$;

-- A session names the cashier profile of the user it is opened for.
CREATE OR REPLACE FUNCTION tenant.pos_shifts_cashier_attribution() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cashier_id IS NULL THEN
    SELECT id INTO NEW.cashier_id FROM tenant.pos_cashiers WHERE organization_id = NEW.organization_id AND user_id = NEW.cashier_user_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER pos_shifts_cashier_attribution BEFORE INSERT ON tenant.pos_shifts FOR EACH ROW EXECUTE FUNCTION tenant.pos_shifts_cashier_attribution();

-- A sale is made by its session's cashier; the code and name are kept as they were.
CREATE OR REPLACE FUNCTION tenant.pos_sales_cashier_attribution() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cashier_id IS NULL THEN
    SELECT shift.cashier_id INTO NEW.cashier_id FROM tenant.pos_shifts shift WHERE shift.organization_id = NEW.organization_id AND shift.id = NEW.shift_id;
  END IF;
  IF NEW.cashier_id IS NOT NULL AND NEW.cashier_code IS NULL THEN
    SELECT cashier.code, COALESCE(cashier.display_name, users.full_name) INTO NEW.cashier_code, NEW.cashier_name
      FROM tenant.pos_cashiers cashier JOIN public.users users ON users.id = cashier.user_id
     WHERE cashier.organization_id = NEW.organization_id AND cashier.id = NEW.cashier_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER pos_sales_cashier_attribution BEFORE INSERT ON tenant.pos_sales FOR EACH ROW EXECUTE FUNCTION tenant.pos_sales_cashier_attribution();

-- A return is made by the cashier who processes it (who may differ from the sale's), with code and name kept as they were.
CREATE OR REPLACE FUNCTION tenant.pos_returns_cashier_attribution() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cashier_id IS NULL THEN
    SELECT id INTO NEW.cashier_id FROM tenant.pos_cashiers WHERE organization_id = NEW.organization_id AND user_id = NEW.requested_by;
  END IF;
  IF NEW.cashier_id IS NOT NULL AND NEW.cashier_code IS NULL THEN
    SELECT cashier.code, COALESCE(cashier.display_name, users.full_name) INTO NEW.cashier_code, NEW.cashier_name
      FROM tenant.pos_cashiers cashier JOIN public.users users ON users.id = cashier.user_id
     WHERE cashier.organization_id = NEW.organization_id AND cashier.id = NEW.cashier_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER pos_returns_cashier_attribution BEFORE INSERT ON tenant.pos_returns FOR EACH ROW EXECUTE FUNCTION tenant.pos_returns_cashier_attribution();

-- Existing records take the cashier of their user, where there is one.
UPDATE tenant.pos_shifts shift SET cashier_id = cashier.id FROM tenant.pos_cashiers cashier
 WHERE shift.cashier_id IS NULL AND cashier.organization_id = shift.organization_id AND cashier.user_id = shift.cashier_user_id;
UPDATE tenant.pos_sales sale SET cashier_id = shift.cashier_id FROM tenant.pos_shifts shift
 WHERE sale.cashier_id IS NULL AND shift.organization_id = sale.organization_id AND shift.id = sale.shift_id AND shift.cashier_id IS NOT NULL;

-- One open session per cashier: a cashier answers for one drawer at a time.
CREATE UNIQUE INDEX IF NOT EXISTS pos_cashier_open_shift_uidx ON tenant.pos_shifts (organization_id, cashier_user_id) WHERE status IN ('open', 'closing');

-- ============================================================ 4. history

CREATE TABLE IF NOT EXISTS tenant.pos_cashier_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  cashier_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('created', 'updated', 'code_changed', 'user_changed', 'outlet_added', 'outlet_removed', 'default_outlet_changed',
    'activated', 'deactivated')),
  summary text NOT NULL,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (organization_id, cashier_id) REFERENCES tenant.pos_cashiers (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS pos_cashier_history_idx ON tenant.pos_cashier_history (organization_id, cashier_id, created_at DESC);

DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['pos_cashiers', 'pos_cashier_outlets', 'pos_cashier_history'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
    EXECUTE format('GRANT SELECT ON tenant.%I TO vercent_worker', name);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.pos_cashiers TO vercent_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.pos_cashier_outlets TO vercent_app;
GRANT SELECT, INSERT ON tenant.pos_cashier_history TO vercent_app;

-- ============================================================ 5. permissions

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('pos.cashiers.view', 'View cashiers', 'Point of Sale', 'See cashiers, where they work and who is on a session now.'),
  ('pos.cashiers.create', 'Create cashiers', 'Point of Sale', 'Give a workspace user a cashier profile.'),
  ('pos.cashiers.edit', 'Edit cashiers', 'Point of Sale', 'Change a cashier''s display name, default outlet and notes; correct the code or user of an unused cashier.'),
  ('pos.cashiers.status', 'Activate and deactivate cashiers', 'Point of Sale', 'Activate a cashier, deactivate one with no open session, delete an unused one.'),
  ('pos.cashiers.assign_outlets', 'Assign cashier outlets', 'Point of Sale', 'Choose the outlets a cashier may work at.'),
  ('pos.cashiers.view_sessions', 'View cashier sessions', 'Point of Sale', 'See the sessions a cashier opened and closed.'),
  ('pos.cashiers.view_transactions', 'View cashier transactions', 'Point of Sale', 'See the sales and returns a cashier made.'),
  ('pos.cashiers.view_cash', 'View cashier cash details', 'Point of Sale', 'See opening, expected and counted cash and differences on a cashier''s sessions.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'pos.cashiers.view' FROM public.role_permissions existing WHERE existing.permission_key = 'pos.view'
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key IN ('pos.cashiers.view', 'pos.cashiers.create', 'pos.cashiers.edit', 'pos.cashiers.status', 'pos.cashiers.assign_outlets',
    'pos.cashiers.view_sessions', 'pos.cashiers.view_transactions')
 WHERE existing.permission_key = 'pos.store.manage'
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key IN ('pos.cashiers.view_sessions', 'pos.cashiers.view_transactions')
 WHERE existing.permission_key IN ('pos.reports.view', 'pos.report.view')
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'pos.cashiers.view_cash' FROM public.role_permissions existing WHERE existing.permission_key IN ('pos.outlets.view_finance', 'pos.settings.manage')
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0082_pos_cashiers.sql', 'pos-cashiers');
