-- Assets — Asset Categories. The one Company-scoped category master (tenant.asset_categories), redesigned: a backend-generated code
-- (ACAT-000001), a name unique within the Company, operational registration policies (serial, tag, location, custodian, warranty,
-- maintenance, verification, suggested condition, default department), Finance policy references kept apart and set only by Finance
-- (book and tax depreciation references, GL mappings, the capitalization threshold), versioned so assets keep the policy they were
-- registered under; an append-only change history; controlled reclassification of an existing asset with Finance review where the
-- change touches accounting. A category never posts, capitalizes or depreciates anything. Additive:
--
--   1. category policies    the operational and Finance-reference columns, a row version, a normalized-name uniqueness guard.
--   2. policy versions      an append-only snapshot of each category's rules, with its effective date and reason.
--   3. change history       an append-only log of every category change.
--   4. reclassifications    an asset's category corrections: applied directly, or pending Finance review, with old and new kept.
--   5. assets               the category policy version each asset was registered under.
--   6. permissions          view financial policy, create, edit, deactivate, reclassify, manage financial policy, export, view history.

-- ============================================================ 1. category policies
ALTER TABLE tenant.asset_categories
  ADD COLUMN IF NOT EXISTS serial_number_policy text NOT NULL DEFAULT 'OPTIONAL',
  ADD COLUMN IF NOT EXISTS asset_tag_policy text NOT NULL DEFAULT 'OPTIONAL',
  ADD COLUMN IF NOT EXISTS location_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS custodian_policy text NOT NULL DEFAULT 'ALLOWED',
  ADD COLUMN IF NOT EXISTS warranty_applicable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS verification_applicable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS suggested_condition text,
  ADD COLUMN IF NOT EXISTS default_department_id uuid,
  ADD COLUMN IF NOT EXISTS ownership_applicability text NOT NULL DEFAULT 'ANY',
  ADD COLUMN IF NOT EXISTS accounting_class text,
  ADD COLUMN IF NOT EXISTS tax_depreciation_reference text,
  ADD COLUMN IF NOT EXISTS finance_policy_effective_from date,
  ADD COLUMN IF NOT EXISTS policy_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_by uuid,
  ADD COLUMN IF NOT EXISTS create_key text,
  ADD COLUMN IF NOT EXISTS template_key text,
  -- An unused category removed by an administrator: hidden everywhere, its code never reused, its (append-only) history kept.
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
-- The MVP-9 serial flag becomes the serial policy.
UPDATE tenant.asset_categories SET serial_number_policy = 'REQUIRED' WHERE serial_required AND serial_number_policy = 'OPTIONAL';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_categories_serial_policy_check') THEN
    ALTER TABLE tenant.asset_categories ADD CONSTRAINT asset_categories_serial_policy_check CHECK (serial_number_policy IN ('REQUIRED', 'OPTIONAL', 'NOT_APPLICABLE'));
    ALTER TABLE tenant.asset_categories ADD CONSTRAINT asset_categories_tag_policy_check CHECK (asset_tag_policy IN ('REQUIRED', 'OPTIONAL'));
    ALTER TABLE tenant.asset_categories ADD CONSTRAINT asset_categories_custodian_policy_check CHECK (custodian_policy IN ('ALLOWED', 'REQUIRED', 'NOT_APPLICABLE'));
    ALTER TABLE tenant.asset_categories ADD CONSTRAINT asset_categories_ownership_applicability_check CHECK (ownership_applicability IN ('ANY', 'OWNED_ONLY', 'EXTERNAL_ONLY'));
    ALTER TABLE tenant.asset_categories ADD CONSTRAINT asset_categories_suggested_condition_check CHECK (suggested_condition IS NULL OR suggested_condition IN ('NEW', 'GOOD', 'FAIR', 'DAMAGED', 'UNSERVICEABLE'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS asset_categories_create_key_idx ON tenant.asset_categories (organization_id, create_key) WHERE create_key IS NOT NULL;
-- A category name is unique within the Company (ignoring case and spacing) among categories not deleted; a deleted category's name may be
-- used again, its code never. Where existing data already has a duplicate the guard is not created, and the Company renames one.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'tenant' AND indexname = 'asset_categories_live_name_idx')
     AND NOT EXISTS (SELECT 1 FROM tenant.asset_categories WHERE deleted_at IS NULL GROUP BY organization_id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) HAVING count(*) > 1) THEN
    CREATE UNIQUE INDEX asset_categories_live_name_idx ON tenant.asset_categories (organization_id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) WHERE deleted_at IS NULL;
  END IF;
END $$;
-- A category in use by any asset is never deleted; one never used may be.
CREATE OR REPLACE FUNCTION tenant.asset_categories_no_delete_used() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM tenant.assets WHERE category_id = OLD.id) THEN
    RAISE EXCEPTION 'This category is used by existing assets and cannot be deleted.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_categories_no_delete_used') THEN
    CREATE TRIGGER asset_categories_no_delete_used BEFORE DELETE ON tenant.asset_categories FOR EACH ROW EXECUTE FUNCTION tenant.asset_categories_no_delete_used();
  END IF;
END $$;

-- ============================================================ 2. policy versions
CREATE TABLE IF NOT EXISTS tenant.asset_category_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  category_id uuid NOT NULL REFERENCES tenant.asset_categories(id),
  version integer NOT NULL CHECK (version > 0),
  effective_from date NOT NULL,
  operational jsonb NOT NULL,
  finance jsonb NOT NULL,
  reason text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (category_id, version)
);
-- Every existing category starts its history at version 1.
INSERT INTO tenant.asset_category_policy_versions (organization_id, category_id, version, effective_from, operational, finance, reason, created_by)
SELECT category.organization_id, category.id, 1, COALESCE(category.created_at::date, current_date),
  jsonb_build_object('serialNumberPolicy', category.serial_number_policy, 'assetTagPolicy', category.asset_tag_policy, 'locationRequired', category.location_required, 'custodianPolicy', category.custodian_policy,
    'warrantyApplicable', category.warranty_applicable, 'maintenanceApplicable', category.maintenance_applicable, 'verificationApplicable', category.verification_applicable,
    'capitalizationGuidance', category.capitalization_guidance, 'assetType', category.asset_type),
  jsonb_build_object('depreciationMethod', category.depreciation_method, 'usefulLifeMonths', category.useful_life_months, 'residualValuePercent', category.residual_value_percent,
    'capitalizationThreshold', category.capitalization_threshold, 'assetAccountId', category.asset_account_id, 'accumulatedDepreciationAccountId', category.accumulated_depreciation_account_id,
    'depreciationExpenseAccountId', category.depreciation_expense_account_id, 'gainLossAccountId', category.gain_loss_account_id),
  'Existing category', category.created_by
FROM tenant.asset_categories category
WHERE NOT EXISTS (SELECT 1 FROM tenant.asset_category_policy_versions v WHERE v.category_id = category.id);

-- ============================================================ 3. change history
CREATE TABLE IF NOT EXISTS tenant.asset_category_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  category_id uuid NOT NULL REFERENCES tenant.asset_categories(id),
  action text NOT NULL CHECK (action IN ('CREATED', 'UPDATED', 'FINANCE_POLICY_CHANGED', 'DEACTIVATED', 'REACTIVATED', 'DELETED')),
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  policy_version integer,
  reason text,
  actor_user_id uuid REFERENCES public.users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS asset_category_events_category_idx ON tenant.asset_category_events (category_id, occurred_at DESC);

-- ============================================================ 4. reclassifications
CREATE TABLE IF NOT EXISTS tenant.asset_reclassifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  reclassification_number bigint GENERATED ALWAYS AS IDENTITY,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  from_category_id uuid NOT NULL REFERENCES tenant.asset_categories(id),
  to_category_id uuid NOT NULL REFERENCES tenant.asset_categories(id),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  impact jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('APPLIED', 'PENDING_FINANCE', 'REJECTED', 'WITHDRAWN')),
  requested_by uuid NOT NULL REFERENCES public.users(id),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_by uuid REFERENCES public.users(id),
  decided_at timestamptz,
  decision_note text,
  finance_adjustment_reference text,
  idempotency_key text,
  CONSTRAINT asset_reclassifications_change_check CHECK (from_category_id <> to_category_id),
  CONSTRAINT asset_reclassifications_decision_check CHECK ((status IN ('APPLIED', 'PENDING_FINANCE')) OR decided_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_reclassifications_pending_idx ON tenant.asset_reclassifications (asset_id) WHERE status = 'PENDING_FINANCE';
CREATE UNIQUE INDEX IF NOT EXISTS asset_reclassifications_key_idx ON tenant.asset_reclassifications (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE OR REPLACE FUNCTION tenant.asset_reclassifications_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A reclassification is kept, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.asset_id <> OLD.asset_id OR NEW.from_category_id <> OLD.from_category_id OR NEW.to_category_id <> OLD.to_category_id OR NEW.reason <> OLD.reason THEN
    RAISE EXCEPTION 'A reclassification keeps what it asked for.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'PENDING_FINANCE' AND NEW.status <> OLD.status THEN RAISE EXCEPTION 'A decided reclassification stays decided.' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_reclassifications_guard') THEN
    CREATE TRIGGER asset_reclassifications_guard BEFORE UPDATE OR DELETE ON tenant.asset_reclassifications FOR EACH ROW EXECUTE FUNCTION tenant.asset_reclassifications_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_category_policy_versions_append_only') THEN
    CREATE TRIGGER asset_category_policy_versions_append_only BEFORE UPDATE OR DELETE ON tenant.asset_category_policy_versions FOR EACH ROW EXECUTE FUNCTION tenant.assets_history_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_category_events_append_only') THEN
    CREATE TRIGGER asset_category_events_append_only BEFORE UPDATE OR DELETE ON tenant.asset_category_events FOR EACH ROW EXECUTE FUNCTION tenant.assets_history_append_only();
  END IF;
END $$;

-- ============================================================ 5. assets keep the policy they were registered under
ALTER TABLE tenant.assets ADD COLUMN IF NOT EXISTS category_policy_version integer;
UPDATE tenant.assets SET category_policy_version = 1 WHERE category_policy_version IS NULL;

-- ============================================================ isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['asset_category_policy_versions', 'asset_category_events', 'asset_reclassifications'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT ON tenant.asset_category_policy_versions, tenant.asset_category_events TO vercent_app;
GRANT SELECT, INSERT, UPDATE ON tenant.asset_reclassifications TO vercent_app;
GRANT SELECT ON tenant.asset_category_policy_versions, tenant.asset_category_events, tenant.asset_reclassifications TO vercent_worker;

-- ============================================================ 6. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('assets.category.create', 'Create asset categories', 'Assets', 'Create asset categories, including from the starter templates.'),
  ('assets.category.edit', 'Edit asset categories', 'Assets', 'Change a category''s name and operational registration rules.'),
  ('assets.category.deactivate', 'Deactivate asset categories', 'Assets', 'Deactivate, reactivate or delete an unused asset category.'),
  ('assets.category.reclassify', 'Reclassify assets', 'Assets', 'Move an existing asset to another category.'),
  ('assets.category.manage_financial_policy', 'Manage category financial policy', 'Assets', 'Set a category''s depreciation, tax and GL references, and approve reclassifications that touch accounting.'),
  ('assets.category.view_financial_policy', 'View category financial policy', 'Assets', 'See a category''s depreciation, tax and GL references.'),
  ('assets.category.export', 'Export asset categories', 'Assets', 'Export the category master.'),
  ('assets.category.view_history', 'View category history', 'Assets', 'See every change to a category and its policy versions.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('asset_manager', 'assets.category.create'), ('asset_manager', 'assets.category.edit'), ('asset_manager', 'assets.category.deactivate'), ('asset_manager', 'assets.category.reclassify'),
    ('asset_manager', 'assets.category.export'), ('asset_manager', 'assets.category.view_history'),
    ('finance_manager', 'assets.category.manage_financial_policy'), ('finance_manager', 'assets.category.view_financial_policy'), ('finance_manager', 'assets.category.view_history'),
    ('finance_manager', 'assets.category.export'),
    ('accountant', 'assets.category.view_financial_policy'), ('accountant', 'assets.category.view_history')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0144_assets_categories.sql', 'assets-categories') ON CONFLICT DO NOTHING;
