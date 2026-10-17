-- Assets — Opening / Existing Assets. A controlled cutover: assets the Company already owned are brought in as ordinary assets (their own
-- UUID and AST code, the old code kept as an alias) through a migration batch — uploaded or entered by hand, validated row by row,
-- corrected, matched against the register before anything is created, and registered (partially if some rows still need work) with an
-- opening baseline for status, location and custody rather than invented history. Their opening financial position — cost, accumulated
-- depreciation, impairment, carrying value, remaining life — is Finance's: reconciled with Finance's opening balances, approved separately
-- from the physical registration, then locked; later changes are recorded corrections. Nothing here posts a journal. Additive:
--
--   1. batches        a migration batch with its cutover date, workflow state, Finance link and approval.
--   2. rows           each source row: raw values, normalized values, errors, warnings, match candidates, resolution, result.
--   3. positions      each asset's opening financial position, versioned; locked once the batch is closed.
--   4. events         an append-only history of each batch and position change.
--   5. baselines      opening migration custody and lifecycle are labelled as such in their histories.
--   6. permissions    create, upload, edit draft, validate, register, view / approve financials, close, correct, export, audit.

-- ============================================================ 1. batches
CREATE TABLE IF NOT EXISTS tenant.asset_opening_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  batch_number bigint GENERATED ALWAYS AS IDENTITY,
  source text NOT NULL CHECK (source IN ('FILE', 'MANUAL')),
  file_name text,
  file_hash text,
  cutover_date date NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'NEEDS_CORRECTION', 'READY_FOR_CONFIRMATION', 'REGISTERING', 'REGISTERED_PENDING_FINANCE', 'RECONCILED', 'CLOSED', 'CANCELLED', 'RECOVERY_REQUIRED')),
  row_count integer NOT NULL DEFAULT 0,
  registered_count integer NOT NULL DEFAULT 0,
  exception_count integer NOT NULL DEFAULT 0,
  finance_mode text CHECK (finance_mode IS NULL OR finance_mode IN ('LINKED', 'PREPARED')),
  finance_opening_balance_id uuid,
  variance_note text,
  approved_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  closed_by uuid REFERENCES public.users(id),
  closed_at timestamptz,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT asset_opening_batches_approval_check CHECK (approved_by IS NULL OR approved_by <> created_by)
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_opening_batches_file_idx ON tenant.asset_opening_batches (organization_id, file_hash) WHERE file_hash IS NOT NULL AND status <> 'CANCELLED';
CREATE OR REPLACE FUNCTION tenant.asset_opening_batches_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A migration batch is kept, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status IN ('CLOSED', 'CANCELLED') THEN RAISE EXCEPTION 'A closed or cancelled migration batch stays as it is.' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.cutover_date IS DISTINCT FROM OLD.cutover_date AND OLD.registered_count > 0 THEN RAISE EXCEPTION 'The cutover date cannot change once assets are registered.' USING ERRCODE = 'check_violation'; END IF;
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_opening_batches_guard') THEN
    CREATE TRIGGER asset_opening_batches_guard BEFORE UPDATE OR DELETE ON tenant.asset_opening_batches FOR EACH ROW EXECUTE FUNCTION tenant.asset_opening_batches_guard();
  END IF;
END $$;

-- ============================================================ 2. rows
CREATE TABLE IF NOT EXISTS tenant.asset_opening_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  batch_id uuid NOT NULL REFERENCES tenant.asset_opening_batches(id),
  row_number integer NOT NULL,
  raw jsonb NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'INVALID', 'DUPLICATE', 'VALID', 'REGISTERED', 'LINKED', 'SKIPPED')),
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  matches jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolution text CHECK (resolution IS NULL OR resolution IN ('CREATE', 'LINK', 'SKIP')),
  link_asset_id uuid REFERENCES tenant.assets(id),
  asset_id uuid REFERENCES tenant.assets(id),
  updated_by uuid REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (batch_id, row_number)
);
CREATE INDEX IF NOT EXISTS asset_opening_rows_asset_idx ON tenant.asset_opening_rows (asset_id) WHERE asset_id IS NOT NULL;
CREATE OR REPLACE FUNCTION tenant.asset_opening_rows_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A migration row is kept, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status IN ('REGISTERED', 'LINKED') AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.data IS DISTINCT FROM OLD.data OR NEW.asset_id IS DISTINCT FROM OLD.asset_id) THEN
    RAISE EXCEPTION 'A registered row keeps what it registered; correct the asset through its own workflows.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.raw IS DISTINCT FROM OLD.raw THEN RAISE EXCEPTION 'The source values of a row are kept as uploaded.' USING ERRCODE = 'check_violation'; END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_opening_rows_guard') THEN
    CREATE TRIGGER asset_opening_rows_guard BEFORE UPDATE OR DELETE ON tenant.asset_opening_rows FOR EACH ROW EXECUTE FUNCTION tenant.asset_opening_rows_guard();
  END IF;
END $$;

-- ============================================================ 3. positions
CREATE TABLE IF NOT EXISTS tenant.asset_opening_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  asset_id uuid NOT NULL UNIQUE REFERENCES tenant.assets(id),
  batch_id uuid NOT NULL REFERENCES tenant.asset_opening_batches(id),
  row_id uuid REFERENCES tenant.asset_opening_rows(id),
  cutover_date date NOT NULL,
  currency text NOT NULL,
  original_cost numeric(18,2),
  capitalized_cost numeric(18,2) NOT NULL CHECK (capitalized_cost >= 0),
  accumulated_depreciation numeric(18,2) NOT NULL DEFAULT 0 CHECK (accumulated_depreciation >= 0),
  accumulated_impairment numeric(18,2) NOT NULL DEFAULT 0 CHECK (accumulated_impairment >= 0),
  other_adjustments numeric(18,2) NOT NULL DEFAULT 0,
  opening_carrying_amount numeric(18,2) NOT NULL CHECK (opening_carrying_amount >= 0),
  residual_value numeric(18,2) NOT NULL DEFAULT 0 CHECK (residual_value >= 0),
  depreciation_method text,
  original_useful_life_months integer,
  remaining_useful_life_months integer CHECK (remaining_useful_life_months IS NULL OR remaining_useful_life_months >= 0),
  tax_reference text,
  evidence text,
  status text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'NEEDS_REVIEW', 'APPROVED', 'LOCKED')),
  review_note text,
  version integer NOT NULL DEFAULT 1,
  approved_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- A locked opening position changes only through a recorded correction (vercent.opening_correction set by the correction command).
CREATE OR REPLACE FUNCTION tenant.asset_opening_positions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'An opening position is kept, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status = 'LOCKED' AND NULLIF(current_setting('vercent.opening_correction', true), '') IS NULL THEN
    RAISE EXCEPTION 'The opening period is locked; request an authorized adjustment.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'LOCKED' AND NEW.status <> 'LOCKED' THEN RAISE EXCEPTION 'A locked opening position stays locked.' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.asset_id IS DISTINCT FROM OLD.asset_id OR NEW.cutover_date IS DISTINCT FROM OLD.cutover_date THEN RAISE EXCEPTION 'An opening position keeps its asset and cutover date.' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_opening_positions_guard') THEN
    CREATE TRIGGER asset_opening_positions_guard BEFORE UPDATE OR DELETE ON tenant.asset_opening_positions FOR EACH ROW EXECUTE FUNCTION tenant.asset_opening_positions_guard();
  END IF;
END $$;

-- ============================================================ 4. events
CREATE TABLE IF NOT EXISTS tenant.asset_opening_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  batch_id uuid NOT NULL REFERENCES tenant.asset_opening_batches(id),
  asset_id uuid REFERENCES tenant.assets(id),
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  actor_user_id uuid REFERENCES public.users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS asset_opening_events_batch_idx ON tenant.asset_opening_events (batch_id, occurred_at DESC);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_opening_events_append_only') THEN
    CREATE TRIGGER asset_opening_events_append_only BEFORE UPDATE OR DELETE ON tenant.asset_opening_events FOR EACH ROW EXECUTE FUNCTION tenant.assets_history_append_only();
  END IF;
END $$;
ALTER TABLE tenant.asset_settings ADD COLUMN IF NOT EXISTS opening_cutover_date date;

-- ============================================================ 5. baselines
-- Custody created during an opening migration is the opening baseline (no acknowledgment is invented for it).
CREATE OR REPLACE FUNCTION tenant.assets_record_custody_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_type text;
BEGIN
  IF NULLIF(current_setting('vercent.custody_engine', true), '') IS NOT NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND NEW.current_user_id IS NOT DISTINCT FROM OLD.current_user_id AND NEW.current_department_id IS NOT DISTINCT FROM OLD.current_department_id
     AND NEW.current_store_location_id IS NOT DISTINCT FROM OLD.current_store_location_id THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' AND NEW.current_user_id IS NULL AND NEW.current_department_id IS NULL AND NEW.current_store_location_id IS NULL THEN RETURN NULL; END IF;
  UPDATE tenant.asset_custody_assignments SET status = 'ENDED', effective_to = clock_timestamp() WHERE asset_id = NEW.id AND status = 'ACTIVE';
  current_type := CASE WHEN NEW.current_user_id IS NOT NULL THEN 'EMPLOYEE' WHEN NEW.current_department_id IS NOT NULL THEN 'DEPARTMENT' WHEN NEW.current_store_location_id IS NOT NULL THEN 'ASSET_STORE' END;
  IF current_type IS NOT NULL THEN
    INSERT INTO tenant.asset_custody_assignments (organization_id, asset_id, custodian_type, user_id, department_id, store_location_id, accountable_user_id, effective_from, condition_at_issue, source, created_by)
    VALUES (NEW.organization_id, NEW.id, current_type, NEW.current_user_id, CASE WHEN current_type = 'DEPARTMENT' OR current_type = 'EMPLOYEE' THEN NEW.current_department_id END,
      CASE WHEN current_type = 'ASSET_STORE' THEN NEW.current_store_location_id END,
      CASE current_type WHEN 'EMPLOYEE' THEN NEW.current_user_id
        WHEN 'DEPARTMENT' THEN (SELECT accountable_user_id FROM tenant.asset_department_custody d WHERE d.organization_id = NEW.organization_id AND d.department_id = NEW.current_department_id)
        ELSE (SELECT manager_user_id FROM tenant.asset_locations l WHERE l.id = NEW.current_store_location_id) END,
      clock_timestamp(), NEW.condition,
      CASE WHEN NULLIF(current_setting('vercent.asset_action', true), '') = 'opening' THEN 'OPENING'
        WHEN TG_OP = 'INSERT' OR NEW.lifecycle_status IN ('DRAFT', 'REGISTERED') THEN 'REGISTRATION' WHEN NULLIF(current_setting('vercent.location_event', true), '') = 'TRANSFER' THEN 'TRANSFER' ELSE 'WORKFLOW' END,
      COALESCE(NULLIF(current_setting('vercent.asset_actor', true), '')::uuid, NEW.created_by));
  END IF;
  RETURN NULL;
END $$;

-- ============================================================ isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['asset_opening_batches', 'asset_opening_rows', 'asset_opening_positions', 'asset_opening_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.asset_opening_batches, tenant.asset_opening_rows, tenant.asset_opening_positions TO vercent_app;
GRANT SELECT, INSERT ON tenant.asset_opening_events TO vercent_app;
GRANT SELECT ON tenant.asset_opening_batches, tenant.asset_opening_rows, tenant.asset_opening_positions, tenant.asset_opening_events TO vercent_worker;

-- ============================================================ 6. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('assets.opening.create', 'Start an opening asset migration', 'Assets', 'Start a migration batch or add one existing asset.'),
  ('assets.opening.upload', 'Upload existing assets', 'Assets', 'Upload a CSV or Excel register of existing assets.'),
  ('assets.opening.edit_draft', 'Correct migration rows', 'Assets', 'Correct rows and resolve matches before registration.'),
  ('assets.opening.validate', 'Validate migration batches', 'Assets', 'Run the validation of a migration batch.'),
  ('assets.opening.register', 'Register existing assets', 'Assets', 'Register the validated rows of a migration batch as assets.'),
  ('assets.opening.view_financials', 'View opening asset values', 'Assets', 'See historical cost, accumulated depreciation and opening carrying values.'),
  ('assets.opening.approve_financials', 'Approve opening asset values', 'Assets', 'Reconcile and approve the opening financial position (Finance).'),
  ('assets.opening.close', 'Close opening migrations', 'Assets', 'Close a reconciled migration and lock its opening values.'),
  ('assets.opening.correct', 'Correct locked opening values', 'Assets', 'Record an authorized correction to a locked opening position.'),
  ('assets.opening.export', 'Export migration results', 'Assets', 'Download migration batches and opening reports.'),
  ('assets.opening.view_audit', 'View migration history', 'Assets', 'See every migration event, approval and correction.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('asset_manager', 'assets.opening.create'), ('asset_manager', 'assets.opening.upload'), ('asset_manager', 'assets.opening.edit_draft'), ('asset_manager', 'assets.opening.validate'),
    ('asset_manager', 'assets.opening.register'), ('asset_manager', 'assets.opening.export'), ('asset_manager', 'assets.opening.view_audit'),
    ('finance_manager', 'assets.opening.view_financials'), ('finance_manager', 'assets.opening.approve_financials'), ('finance_manager', 'assets.opening.close'), ('finance_manager', 'assets.opening.correct'),
    ('finance_manager', 'assets.opening.export'), ('finance_manager', 'assets.opening.view_audit'),
    ('accountant', 'assets.opening.view_financials'), ('accountant', 'assets.opening.view_audit')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0149_assets_opening.sql', 'assets-opening') ON CONFLICT DO NOTHING;
