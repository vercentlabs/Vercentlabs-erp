-- 0083 Cashier Permissions (POS): what a cashier may do at a POS, within which limits, and when a supervisor must approve. Company-scoped
-- permission profiles (the organization is the company) made of grants from a server-defined catalogue; each cashier is assigned one active
-- profile. Shared roles and permissions keep controlling who administers profiles; outlet access keeps controlling where a cashier works.
--
-- 1. Profiles: code unique in the company, name, description, Draft / Active / Inactive, version. Grants: one row per catalogue code, enabled
--    or not, a limit mode (not applicable / limited / unlimited — never an implicit unlimited), a maximum percentage and / or amount (in a
--    stated currency, decimal-safe), and whether a reason is required.
-- 2. Assignment: the cashier's profile, with who assigned it and when.
-- 3. Supervisor approvals: single-use, expiring, bound to the exact action, transaction, version and amount; consumed once.
-- 4. Manual discounts and price overrides remember the approval that allowed them (and an override its reason).
-- 5. History, starter profiles (Draft, sensitive grants off) for every company, and the administration permissions.

-- ============================================================ 1. profiles and grants

CREATE TABLE IF NOT EXISTS tenant.pos_permission_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9._/-]{0,29}$'),
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'inactive')),
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_permission_profiles_code_uidx ON tenant.pos_permission_profiles (organization_id, upper(btrim(code)));

CREATE TABLE IF NOT EXISTS tenant.pos_permission_profile_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  permission_code text NOT NULL CHECK (permission_code ~ '^[A-Z_]{3,60}$'),
  enabled boolean NOT NULL DEFAULT false,
  limit_mode text NOT NULL DEFAULT 'not_applicable' CHECK (limit_mode IN ('not_applicable', 'limited', 'unlimited')),
  max_percentage numeric(9,4) CHECK (max_percentage IS NULL OR (max_percentage >= 0 AND max_percentage <= 100)),
  max_amount numeric(20,6) CHECK (max_amount IS NULL OR max_amount >= 0),
  amount_currency char(3),
  require_reason boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, profile_id, permission_code),
  FOREIGN KEY (organization_id, profile_id) REFERENCES tenant.pos_permission_profiles (organization_id, id) ON DELETE CASCADE,
  -- A limited grant states at least one limit; an amount always names its currency; only a limited grant carries limits.
  CHECK (limit_mode <> 'limited' OR max_percentage IS NOT NULL OR max_amount IS NOT NULL),
  CHECK (max_amount IS NULL OR amount_currency IS NOT NULL),
  CHECK (limit_mode = 'limited' OR (max_percentage IS NULL AND max_amount IS NULL))
);

-- ============================================================ 2. assignment

ALTER TABLE tenant.pos_cashiers
  ADD COLUMN IF NOT EXISTS permission_profile_id uuid,
  ADD COLUMN IF NOT EXISTS profile_assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS profile_assigned_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_cashiers_permission_profile_fkey') THEN
    ALTER TABLE tenant.pos_cashiers ADD CONSTRAINT pos_cashiers_permission_profile_fkey
      FOREIGN KEY (organization_id, permission_profile_id) REFERENCES tenant.pos_permission_profiles (organization_id, id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS pos_cashiers_profile_idx ON tenant.pos_cashiers (organization_id, permission_profile_id);

-- ============================================================ 3. supervisor approvals

CREATE TABLE IF NOT EXISTS tenant.pos_permission_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  outlet_id uuid REFERENCES tenant.pos_stores(id),
  terminal_id uuid REFERENCES tenant.pos_terminals(id),
  session_id uuid REFERENCES tenant.pos_shifts(id),
  cashier_id uuid,
  requested_by uuid NOT NULL REFERENCES public.users(id),
  approver_user_id uuid REFERENCES public.users(id),
  -- The action the cashier asked for (a catalogue code) and the approval permission it needs.
  permission_code text NOT NULL,
  approval_code text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  resource_version integer,
  requested_action jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_amount numeric(20,6),
  requested_percentage numeric(9,4),
  currency_code char(3),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'consumed', 'expired')),
  decision_note text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  consumed_at timestamptz,
  expires_at timestamptz NOT NULL,
  idempotency_key text,
  FOREIGN KEY (organization_id, cashier_id) REFERENCES tenant.pos_cashiers (organization_id, id),
  CHECK (status NOT IN ('approved', 'consumed', 'rejected') OR (approver_user_id IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK (status <> 'consumed' OR consumed_at IS NOT NULL),
  CHECK (approver_user_id IS NULL OR approver_user_id <> requested_by)
);
CREATE INDEX IF NOT EXISTS pos_permission_approvals_resource_idx ON tenant.pos_permission_approvals (organization_id, resource_type, resource_id, status);
CREATE INDEX IF NOT EXISTS pos_permission_approvals_pending_idx ON tenant.pos_permission_approvals (organization_id, status, requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS pos_permission_approvals_idempotency_uidx ON tenant.pos_permission_approvals (organization_id, requested_by, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ============================================================ 4. discounts and overrides remember their approval

ALTER TABLE tenant.pos_cart_lines ADD COLUMN IF NOT EXISTS manual_discount_approval_id uuid REFERENCES tenant.pos_permission_approvals(id);
ALTER TABLE tenant.pos_carts ADD COLUMN IF NOT EXISTS cart_discount_approval_id uuid REFERENCES tenant.pos_permission_approvals(id);
-- A price override keeps its reason and, when it went beyond the cashier's limit, the approval that allowed it.
ALTER TABLE tenant.pos_cart_lines
  ADD COLUMN IF NOT EXISTS price_override_reason text,
  ADD COLUMN IF NOT EXISTS price_override_approval_id uuid REFERENCES tenant.pos_permission_approvals(id);

-- ============================================================ 5. history

CREATE TABLE IF NOT EXISTS tenant.pos_permission_profile_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('created', 'cloned', 'updated', 'grant_changed', 'limit_changed', 'unlimited_configured', 'activated', 'deactivated',
    'assigned', 'unassigned')),
  summary text NOT NULL,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (organization_id, profile_id) REFERENCES tenant.pos_permission_profiles (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS pos_permission_profile_history_idx ON tenant.pos_permission_profile_history (organization_id, profile_id, created_at DESC);

DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['pos_permission_profiles', 'pos_permission_profile_grants', 'pos_permission_approvals', 'pos_permission_profile_history'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
    EXECUTE format('GRANT SELECT ON tenant.%I TO vercent_worker', name);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.pos_permission_profiles TO vercent_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.pos_permission_profile_grants TO vercent_app;
GRANT SELECT, INSERT, UPDATE ON tenant.pos_permission_approvals TO vercent_app;
GRANT SELECT, INSERT ON tenant.pos_permission_profile_history TO vercent_app;

-- Starter profiles for every company, as Draft templates: routine grants on, every sensitive grant (discounts, price overrides, refunds, cash
-- movements, approvals, no-receipt returns, closing other sessions) off until an administrator sets its limits and turns it on. New companies
-- get the same profiles when they register (seedPosPermissionProfiles).
CREATE OR REPLACE FUNCTION tenant.seed_pos_permission_profiles(target_organization_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  profile record;
  profile_id uuid;
  routine text[] := ARRAY['POS_ACCESS', 'SESSION_OPEN_OWN', 'SESSION_CLOSE_OWN', 'SESSION_VIEW_OWN', 'SALE_CREATE', 'SALE_COMPLETE', 'SALE_HOLD', 'SALE_RESUME_OWN',
    'SALE_CANCEL_UNPAID', 'CUSTOMER_SELECT', 'RECEIPT_PRINT', 'TRANSACTION_LOOKUP'];
  catalogue text[] := ARRAY['POS_ACCESS', 'SESSION_OPEN_OWN', 'SESSION_CLOSE_OWN', 'SESSION_VIEW_OWN', 'SESSION_VIEW_EXPECTED_CASH', 'SESSION_CLOSE_OTHER',
    'SALE_CREATE', 'SALE_COMPLETE', 'SALE_HOLD', 'SALE_RESUME_OWN', 'SALE_RESUME_ANY', 'SALE_CANCEL_UNPAID', 'PAYMENT_VOID_PENDING', 'DISCOUNT_LINE_MANUAL',
    'DISCOUNT_ORDER_MANUAL', 'PRICE_OVERRIDE', 'CUSTOMER_SELECT', 'CUSTOMER_QUICK_CREATE', 'RECEIPT_PRINT', 'RECEIPT_REPRINT', 'TRANSACTION_LOOKUP',
    'RETURN_WITH_RECEIPT', 'RETURN_WITHOUT_RECEIPT', 'REFUND_INITIATE', 'RETURN_POLICY_OVERRIDE', 'CASH_DRAWER_OPEN_NO_SALE', 'CASH_MOVEMENT_IN', 'CASH_MOVEMENT_OUT',
    'APPROVE_DISCOUNT_EXCEPTION', 'APPROVE_PRICE_OVERRIDE', 'APPROVE_REFUND_EXCEPTION', 'APPROVE_NO_RECEIPT_RETURN', 'APPROVE_RETURN_POLICY_EXCEPTION',
    'APPROVE_CASH_MOVEMENT_EXCEPTION'];
  -- Codes whose grant asks for a reason whenever it is used.
  with_reason text[] := ARRAY['SESSION_CLOSE_OTHER', 'PRICE_OVERRIDE', 'RETURN_WITHOUT_RECEIPT', 'RETURN_POLICY_OVERRIDE', 'CASH_DRAWER_OPEN_NO_SALE',
    'CASH_MOVEMENT_IN', 'CASH_MOVEMENT_OUT', 'DISCOUNT_LINE_MANUAL', 'DISCOUNT_ORDER_MANUAL'];
  code text;
BEGIN
  FOR profile IN SELECT * FROM (VALUES
      ('STANDARD-CASHIER', 'Standard Cashier', 'Routine checkout: sessions, sales, held sales, receipts and lookups. No discounts, overrides, refunds or approvals until configured.', routine),
      ('SENIOR-CASHIER', 'Senior Cashier', 'Standard Cashier plus reprints and resuming held sales. Set manual-discount, refund and cash-movement limits before enabling them.',
        routine || ARRAY['RECEIPT_REPRINT', 'SALE_RESUME_ANY', 'SESSION_VIEW_EXPECTED_CASH']),
      ('POS-SUPERVISOR', 'POS Supervisor', 'Controlled exceptions: approvals, supervisor session closure and policy exceptions — each enabled only once its limits are set.',
        routine || ARRAY['RECEIPT_REPRINT', 'SALE_RESUME_ANY', 'SESSION_VIEW_EXPECTED_CASH', 'PAYMENT_VOID_PENDING']),
      ('POS-MANAGER', 'POS Manager', 'Store-level operations and approval authority — each sensitive grant enabled only once its limits are set.',
        routine || ARRAY['RECEIPT_REPRINT', 'SALE_RESUME_ANY', 'SESSION_VIEW_EXPECTED_CASH', 'PAYMENT_VOID_PENDING', 'CUSTOMER_QUICK_CREATE'])
    ) AS starter(code, name, description, granted) LOOP
    IF EXISTS (SELECT 1 FROM tenant.pos_permission_profiles existing WHERE existing.organization_id = target_organization_id AND upper(existing.code) = profile.code) THEN
      CONTINUE;
    END IF;
    INSERT INTO tenant.pos_permission_profiles (organization_id, code, name, description, status)
    VALUES (target_organization_id, profile.code, profile.name, profile.description, 'draft') RETURNING id INTO profile_id;
    FOREACH code IN ARRAY catalogue LOOP
      INSERT INTO tenant.pos_permission_profile_grants (organization_id, profile_id, permission_code, enabled, require_reason)
      VALUES (target_organization_id, profile_id, code, code = ANY(profile.granted), code = ANY(with_reason));
    END LOOP;
    INSERT INTO tenant.pos_permission_profile_history (organization_id, profile_id, event_type, summary)
    VALUES (target_organization_id, profile_id, 'created', 'Starter profile ' || profile.name || ' created (Draft)');
  END LOOP;
END;
$$;
DO $$
DECLARE org record;
BEGIN
  FOR org IN SELECT id FROM public.organizations LOOP
    PERFORM set_config('app.current_organization_id', org.id::text, true);
    PERFORM tenant.seed_pos_permission_profiles(org.id);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION tenant.seed_pos_permission_profiles(uuid) TO vercent_app;

-- ============================================================ 6. administration permissions

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('pos.permission_profiles.view', 'View cashier permission profiles', 'Point of Sale', 'See permission profiles, their grants, limits and assigned cashiers.'),
  ('pos.permission_profiles.manage', 'Create and edit cashier permission profiles', 'Point of Sale', 'Create, clone and edit permission profiles and their limits.'),
  ('pos.permission_profiles.status', 'Activate and deactivate permission profiles', 'Point of Sale', 'Activate a valid profile or deactivate one no active cashier uses.'),
  ('pos.permission_profiles.assign', 'Assign permission profiles', 'Point of Sale', 'Give a cashier an active permission profile.'),
  ('pos.permission_profiles.configure_unlimited', 'Configure unlimited cashier limits', 'Point of Sale', 'Grant an unlimited discount, refund or cash-movement limit.'),
  ('pos.permission_profiles.view_history', 'View permission profile history', 'Point of Sale', 'See who changed which grant or limit, and approvals.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key IN ('pos.permission_profiles.view', 'pos.permission_profiles.manage', 'pos.permission_profiles.status',
    'pos.permission_profiles.assign', 'pos.permission_profiles.configure_unlimited', 'pos.permission_profiles.view_history')
 WHERE existing.permission_key = 'pos.settings.manage'
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key IN ('pos.permission_profiles.view', 'pos.permission_profiles.assign')
 WHERE existing.permission_key = 'pos.store.manage'
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0083_pos_cashier_permissions.sql', 'pos-cashier-permissions');
