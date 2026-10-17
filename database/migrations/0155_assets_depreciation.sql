-- Assets — Straight-Line Depreciation. One depreciation engine, Finance-controlled: approved policies (versioned, Company-scoped, for the
-- financial-reporting book — never income-tax depreciation), an approved accounting basis per asset (cost, residual, life, commencement,
-- convention, accounts), deterministic schedule versions computed in exact decimal from that basis, monthly runs (prepared, reviewed,
-- approved, posted through Finance's journal, recovered when the outcome is unknown), estimate revisions that keep posted history, and
-- reconciliation with the General Ledger. The schedule is never a second ledger: posted amounts are Finance's. Additive:
--
--   1. policies         approved depreciation policies (method, life, residual rule, convention, commencement rule, accounts), versioned.
--   2. bases            each asset's approved accounting input, versioned; capitalization, opening and revisions create new versions.
--   3. schedules        schedule versions (current / superseded) and their monthly lines, never rewritten.
--   4. runs             a month's depreciation: per-asset lines (included or excluded with the reason), one obligation per asset and month.
--   5. events           an append-only history of policy, basis, schedule, run and posting decisions.
--   6. settings         approval and separate-poster policy.
--   7. migration        assets already capitalized on the older schedule get an approved basis from the next unposted month.
--   8. permissions      view, financials, policy, assign, generate, prepare, review, approve, post, revise, correct, reconcile, export, audit.

-- ============================================================ 1. policies
CREATE TABLE IF NOT EXISTS tenant.asset_depreciation_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  policy_code text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  name text NOT NULL CHECK (length(btrim(name)) >= 2),
  book text NOT NULL DEFAULT 'FINANCIAL' CHECK (book IN ('FINANCIAL')),
  ledger_id uuid,
  method text NOT NULL DEFAULT 'STRAIGHT_LINE' CHECK (method IN ('STRAIGHT_LINE')),
  useful_life_months integer NOT NULL CHECK (useful_life_months > 0 AND useful_life_months <= 1200),
  residual_rule text NOT NULL DEFAULT 'AMOUNT' CHECK (residual_rule IN ('AMOUNT', 'PERCENT')),
  residual_percent numeric(7,4) CHECK (residual_percent IS NULL OR (residual_percent >= 0 AND residual_percent < 100)),
  convention text NOT NULL DEFAULT 'DAILY' CHECK (convention IN ('DAILY', 'FULL_MONTH')),
  commencement_rule text NOT NULL DEFAULT 'AVAILABLE_FOR_USE' CHECK (commencement_rule IN ('AVAILABLE_FOR_USE', 'NEXT_MONTH')),
  expense_account_id uuid,
  accumulated_account_id uuid,
  category_id uuid REFERENCES tenant.asset_categories(id),
  effective_from date NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUPERSEDED', 'INACTIVE')),
  reason text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  approved_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  CONSTRAINT asset_depreciation_policies_version_key UNIQUE (organization_id, policy_code, version),
  CONSTRAINT asset_depreciation_policies_residual_check CHECK (residual_rule <> 'PERCENT' OR residual_percent IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_depreciation_policies_active_idx ON tenant.asset_depreciation_policies (organization_id, policy_code) WHERE status = 'ACTIVE';

-- ============================================================ 2. bases
CREATE TABLE IF NOT EXISTS tenant.asset_depreciation_bases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  basis_version integer NOT NULL,
  policy_id uuid REFERENCES tenant.asset_depreciation_policies(id),
  source text NOT NULL CHECK (source IN ('CAPITALIZATION', 'OPENING', 'REVISION', 'ADJUSTMENT', 'MIGRATED', 'ASSIGNED')),
  capitalization_id uuid,
  opening_position_id uuid,
  cost_basis numeric(18,2) NOT NULL CHECK (cost_basis >= 0),
  accumulated_before numeric(18,2) NOT NULL DEFAULT 0 CHECK (accumulated_before >= 0),
  impairment_before numeric(18,2) NOT NULL DEFAULT 0 CHECK (impairment_before >= 0),
  carrying_at_start numeric(18,2) NOT NULL,
  residual_value numeric(18,2) NOT NULL CHECK (residual_value >= 0),
  useful_life_months integer NOT NULL CHECK (useful_life_months > 0),
  remaining_life_months integer NOT NULL CHECK (remaining_life_months > 0),
  commencement_date date NOT NULL,
  convention text NOT NULL CHECK (convention IN ('DAILY', 'FULL_MONTH')),
  expense_account_id uuid,
  accumulated_account_id uuid,
  effective_from date NOT NULL,
  status text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'APPROVED', 'SUPERSEDED', 'REJECTED')),
  reason text,
  requested_by uuid REFERENCES public.users(id),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  approved_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  decision_note text,
  CONSTRAINT asset_depreciation_bases_version_key UNIQUE (asset_id, basis_version),
  CONSTRAINT asset_depreciation_bases_residual_check CHECK (residual_value <= carrying_at_start OR carrying_at_start <= 0)
);
-- One approved basis per asset at a time; one proposal waiting at a time.
CREATE UNIQUE INDEX IF NOT EXISTS asset_depreciation_bases_approved_idx ON tenant.asset_depreciation_bases (asset_id) WHERE status = 'APPROVED';
CREATE UNIQUE INDEX IF NOT EXISTS asset_depreciation_bases_proposed_idx ON tenant.asset_depreciation_bases (asset_id) WHERE status = 'PROPOSED';
-- A basis keeps its figures; only its status moves forward (proposed → approved or rejected; approved → superseded).
CREATE OR REPLACE FUNCTION tenant.asset_depreciation_bases_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A depreciation basis is superseded, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'approved_by', 'approved_at', 'decision_note']) <> (to_jsonb(OLD) - ARRAY['status', 'approved_by', 'approved_at', 'decision_note']) THEN
    RAISE EXCEPTION 'A depreciation basis keeps its figures; approve a new version instead.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT ((OLD.status = 'PROPOSED' AND NEW.status IN ('APPROVED', 'REJECTED')) OR (OLD.status = 'APPROVED' AND NEW.status = 'SUPERSEDED') OR OLD.status = NEW.status) THEN
    RAISE EXCEPTION 'A depreciation basis cannot go from % to %.', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_depreciation_bases_guard') THEN
    CREATE TRIGGER asset_depreciation_bases_guard BEFORE UPDATE OR DELETE ON tenant.asset_depreciation_bases FOR EACH ROW EXECUTE FUNCTION tenant.asset_depreciation_bases_guard();
  END IF;
END $$;

-- ============================================================ 3. schedules
CREATE TABLE IF NOT EXISTS tenant.asset_depreciation_schedule_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  basis_id uuid NOT NULL REFERENCES tenant.asset_depreciation_bases(id),
  version integer NOT NULL,
  algorithm text NOT NULL DEFAULT 'SLM-1',
  status text NOT NULL DEFAULT 'CURRENT' CHECK (status IN ('CURRENT', 'SUPERSEDED')),
  first_period date,
  last_period date,
  total numeric(18,2) NOT NULL DEFAULT 0,
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_by uuid REFERENCES public.users(id),
  generated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  superseded_at timestamptz,
  CONSTRAINT asset_depreciation_schedule_versions_key UNIQUE (asset_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_depreciation_schedule_current_idx ON tenant.asset_depreciation_schedule_versions (asset_id) WHERE status = 'CURRENT';
CREATE TABLE IF NOT EXISTS tenant.asset_depreciation_schedule_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  schedule_id uuid NOT NULL REFERENCES tenant.asset_depreciation_schedule_versions(id),
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  line_number integer NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  opening_value numeric(18,2) NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount >= 0),
  accumulated numeric(18,2) NOT NULL,
  closing_value numeric(18,2) NOT NULL,
  eligible_from date,
  eligible_to date,
  eligible_days integer,
  period_days integer,
  rounding numeric(18,2) NOT NULL DEFAULT 0,
  CONSTRAINT asset_depreciation_schedule_lines_key UNIQUE (schedule_id, period_start)
);
CREATE INDEX IF NOT EXISTS asset_depreciation_schedule_lines_asset_idx ON tenant.asset_depreciation_schedule_lines (asset_id, period_start);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_depreciation_schedule_lines_append_only') THEN
    CREATE TRIGGER asset_depreciation_schedule_lines_append_only BEFORE UPDATE OR DELETE ON tenant.asset_depreciation_schedule_lines FOR EACH ROW EXECUTE FUNCTION tenant.assets_history_append_only();
  END IF;
END $$;
CREATE OR REPLACE FUNCTION tenant.asset_depreciation_schedule_versions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A schedule version is superseded, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'superseded_at']) <> (to_jsonb(OLD) - ARRAY['status', 'superseded_at']) OR NOT (OLD.status = NEW.status OR (OLD.status = 'CURRENT' AND NEW.status = 'SUPERSEDED')) THEN
    RAISE EXCEPTION 'A schedule version is never rewritten; generate a new version.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_depreciation_schedule_versions_guard') THEN
    CREATE TRIGGER asset_depreciation_schedule_versions_guard BEFORE UPDATE OR DELETE ON tenant.asset_depreciation_schedule_versions FOR EACH ROW EXECUTE FUNCTION tenant.asset_depreciation_schedule_versions_guard();
  END IF;
END $$;

-- ============================================================ 4. runs
CREATE TABLE IF NOT EXISTS tenant.asset_depreciation_period_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  run_number text NOT NULL,
  book text NOT NULL DEFAULT 'FINANCIAL' CHECK (book IN ('FINANCIAL')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  fiscal_period_id uuid,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'CALCULATING', 'READY_FOR_REVIEW', 'NEEDS_CORRECTION', 'APPROVED', 'POSTING', 'POSTED', 'PARTIALLY_POSTED',
    'RECOVERY_REQUIRED', 'CANCELLED')),
  calculation_version text NOT NULL DEFAULT 'SLM-1',
  proposed_total numeric(18,2) NOT NULL DEFAULT 0,
  approved_total numeric(18,2),
  posted_total numeric(18,2) NOT NULL DEFAULT 0,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  journal_entry_id uuid,
  accounting_outcome text,
  idempotency_key text,
  prepared_by uuid REFERENCES public.users(id),
  prepared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  approved_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  posted_by uuid REFERENCES public.users(id),
  posted_at timestamptz,
  cancelled_by uuid REFERENCES public.users(id),
  cancelled_at timestamptz,
  cancel_reason text,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT asset_depreciation_period_runs_number_key UNIQUE (organization_id, run_number),
  CONSTRAINT asset_depreciation_period_runs_dates_check CHECK (period_end >= period_start)
);
-- One live run per month and book.
CREATE UNIQUE INDEX IF NOT EXISTS asset_depreciation_period_runs_live_idx ON tenant.asset_depreciation_period_runs (organization_id, book, period_start) WHERE status <> 'CANCELLED';
CREATE UNIQUE INDEX IF NOT EXISTS asset_depreciation_period_runs_key_idx ON tenant.asset_depreciation_period_runs (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS tenant.asset_depreciation_run_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  run_id uuid NOT NULL REFERENCES tenant.asset_depreciation_period_runs(id),
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  period_start date,
  period_end date,
  schedule_line_id uuid REFERENCES tenant.asset_depreciation_schedule_lines(id),
  schedule_id uuid REFERENCES tenant.asset_depreciation_schedule_versions(id),
  basis_id uuid REFERENCES tenant.asset_depreciation_bases(id),
  category_id uuid,
  department_id uuid,
  expense_account_id uuid,
  accumulated_account_id uuid,
  scheduled_amount numeric(18,2) NOT NULL DEFAULT 0,
  amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  status text NOT NULL CHECK (status IN ('INCLUDED', 'EXCLUDED', 'POSTED', 'CANCELLED')),
  exclusion_code text,
  exclusion_reason text,
  blocking boolean NOT NULL DEFAULT false,
  posting_key text,
  posted_at timestamptz,
  journal_entry_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS asset_depreciation_run_lines_run_idx ON tenant.asset_depreciation_run_lines (run_id);
-- One ordinary depreciation obligation per asset, book and month: an included or posted line is never repeated.
CREATE UNIQUE INDEX IF NOT EXISTS asset_depreciation_run_lines_obligation_idx ON tenant.asset_depreciation_run_lines (asset_id, period_start) WHERE status IN ('INCLUDED', 'POSTED');
CREATE UNIQUE INDEX IF NOT EXISTS asset_depreciation_run_lines_posting_key_idx ON tenant.asset_depreciation_run_lines (organization_id, posting_key) WHERE posting_key IS NOT NULL;
CREATE OR REPLACE FUNCTION tenant.asset_depreciation_run_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A run line is cancelled, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status = 'POSTED' THEN RAISE EXCEPTION 'Posted depreciation is reversed through Finance, never edited.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status = 'CANCELLED' THEN RAISE EXCEPTION 'A cancelled run line stays cancelled.' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.asset_id <> OLD.asset_id OR NEW.run_id <> OLD.run_id OR NEW.period_start IS DISTINCT FROM OLD.period_start OR NEW.amount <> OLD.amount THEN
    RAISE EXCEPTION 'A run line keeps its asset, month and amount; recalculate the run instead.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_depreciation_run_lines_guard') THEN
    CREATE TRIGGER asset_depreciation_run_lines_guard BEFORE UPDATE OR DELETE ON tenant.asset_depreciation_run_lines FOR EACH ROW EXECUTE FUNCTION tenant.asset_depreciation_run_lines_guard();
  END IF;
END $$;

-- ============================================================ 5. events
CREATE TABLE IF NOT EXISTS tenant.asset_depreciation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  asset_id uuid REFERENCES tenant.assets(id),
  run_id uuid REFERENCES tenant.asset_depreciation_period_runs(id),
  policy_id uuid REFERENCES tenant.asset_depreciation_policies(id),
  basis_id uuid REFERENCES tenant.asset_depreciation_bases(id),
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  actor_user_id uuid REFERENCES public.users(id),
  command_id text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS asset_depreciation_events_asset_idx ON tenant.asset_depreciation_events (asset_id, occurred_at);
CREATE INDEX IF NOT EXISTS asset_depreciation_events_run_idx ON tenant.asset_depreciation_events (run_id, occurred_at);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_depreciation_events_append_only') THEN
    CREATE TRIGGER asset_depreciation_events_append_only BEFORE UPDATE OR DELETE ON tenant.asset_depreciation_events FOR EACH ROW EXECUTE FUNCTION tenant.assets_history_append_only();
  END IF;
END $$;

-- ============================================================ 6. settings
ALTER TABLE tenant.asset_settings
  ADD COLUMN IF NOT EXISTS depreciation_approval_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS depreciation_separate_poster boolean NOT NULL DEFAULT false;

-- ============================================================ isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['asset_depreciation_policies', 'asset_depreciation_bases', 'asset_depreciation_schedule_versions', 'asset_depreciation_schedule_lines',
    'asset_depreciation_period_runs', 'asset_depreciation_run_lines', 'asset_depreciation_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.asset_depreciation_policies, tenant.asset_depreciation_bases, tenant.asset_depreciation_schedule_versions, tenant.asset_depreciation_period_runs,
  tenant.asset_depreciation_run_lines TO vercent_app;
GRANT SELECT, INSERT ON tenant.asset_depreciation_schedule_lines, tenant.asset_depreciation_events TO vercent_app;
GRANT SELECT ON tenant.asset_depreciation_policies, tenant.asset_depreciation_bases, tenant.asset_depreciation_schedule_versions, tenant.asset_depreciation_schedule_lines,
  tenant.asset_depreciation_period_runs, tenant.asset_depreciation_run_lines, tenant.asset_depreciation_events TO vercent_worker;

-- ============================================================ 7. assets already on the older schedule
-- A capitalized straight-line asset with no basis gets an approved one (MIGRATED) from the month after its last posted period: its carrying
-- value then, the months still to go, its residual and its category's accounts. Its posted history stays where it is; nothing is posted again.
INSERT INTO tenant.asset_depreciation_bases (organization_id, asset_id, basis_version, source, cost_basis, accumulated_before, impairment_before, carrying_at_start, residual_value,
  useful_life_months, remaining_life_months, commencement_date, convention, expense_account_id, accumulated_account_id, effective_from, status, reason, approved_at)
SELECT a.organization_id, a.id, 1, 'MIGRATED', a.capitalized_cost, COALESCE(a.accumulated_depreciation, 0), COALESCE(a.impairment_accumulated, 0),
  a.capitalized_cost - COALESCE(a.accumulated_depreciation, 0) - COALESCE(a.impairment_accumulated, 0), LEAST(COALESCE(a.residual_value, 0), GREATEST(a.capitalized_cost - COALESCE(a.accumulated_depreciation, 0) - COALESCE(a.impairment_accumulated, 0), 0)),
  a.useful_life_months, GREATEST(a.useful_life_months - COALESCE(posted.months, 0), 1),
  COALESCE((posted.last_end + 1), a.depreciation_start_date), CASE WHEN c.depreciation_convention = 'mid_month' THEN 'DAILY' ELSE 'FULL_MONTH' END,
  c.depreciation_expense_account_id, c.accumulated_depreciation_account_id, COALESCE((posted.last_end + 1), date_trunc('month', a.depreciation_start_date)::date), 'APPROVED',
  'Carried over from the earlier depreciation schedule', clock_timestamp()
FROM tenant.assets a
JOIN tenant.asset_categories c ON c.id = a.category_id
LEFT JOIN LATERAL (SELECT count(*)::int AS months, max(s.period_end) AS last_end FROM tenant.asset_depreciation_schedules s WHERE s.asset_id = a.id AND s.status = 'posted') posted ON true
WHERE a.capitalization_class = 'CAPITALIZED' AND a.depreciation_method = 'straight_line' AND a.depreciation_start_date IS NOT NULL AND COALESCE(a.useful_life_months, 0) > 0
  AND a.capitalized_cost > 0 AND COALESCE(a.status, '') NOT IN ('disposed')
  AND NOT EXISTS (SELECT 1 FROM tenant.asset_depreciation_bases b WHERE b.asset_id = a.id);

-- ============================================================ 8. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('assets.depreciation.view', 'View depreciation schedules', 'Assets', 'See asset depreciation schedules and runs.'),
  ('assets.depreciation.view_financials', 'View depreciation figures', 'Assets', 'See costs, accumulated depreciation and carrying values.'),
  ('assets.depreciation.manage_policy', 'Manage depreciation policies', 'Assets', 'Create and version the Company''s depreciation policies.'),
  ('assets.depreciation.assign_policy', 'Assign depreciation policies', 'Assets', 'Propose an asset''s depreciation policy and basis.'),
  ('assets.depreciation.generate', 'Generate depreciation schedules', 'Assets', 'Generate or regenerate draft schedules from approved bases.'),
  ('assets.depreciation.prepare_run', 'Prepare depreciation runs', 'Assets', 'Calculate a month''s depreciation run.'),
  ('assets.depreciation.review', 'Review depreciation runs', 'Assets', 'Review run exceptions and recalculate.'),
  ('assets.depreciation.approve', 'Approve depreciation', 'Assets', 'Authorize depreciation runs and depreciation bases.'),
  ('assets.depreciation.post', 'Post depreciation', 'Assets', 'Post an approved depreciation run through Finance.'),
  ('assets.depreciation.revise_estimate', 'Revise depreciation estimates', 'Assets', 'Request a change of remaining useful life or residual value.'),
  ('assets.depreciation.correct', 'Correct depreciation', 'Assets', 'Recover uncertain postings and route corrections to Finance.'),
  ('assets.depreciation.reconcile', 'Reconcile depreciation', 'Assets', 'Reconcile schedules and runs with the General Ledger.'),
  ('assets.depreciation.export', 'Export depreciation', 'Assets', 'Download depreciation schedules and reports.'),
  ('assets.depreciation.view_audit', 'View depreciation history', 'Assets', 'See every policy, basis, schedule and posting decision.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('finance_manager', 'assets.depreciation.view'), ('finance_manager', 'assets.depreciation.view_financials'), ('finance_manager', 'assets.depreciation.manage_policy'),
    ('finance_manager', 'assets.depreciation.assign_policy'), ('finance_manager', 'assets.depreciation.generate'), ('finance_manager', 'assets.depreciation.prepare_run'),
    ('finance_manager', 'assets.depreciation.review'), ('finance_manager', 'assets.depreciation.approve'), ('finance_manager', 'assets.depreciation.post'),
    ('finance_manager', 'assets.depreciation.revise_estimate'), ('finance_manager', 'assets.depreciation.correct'), ('finance_manager', 'assets.depreciation.reconcile'),
    ('finance_manager', 'assets.depreciation.export'), ('finance_manager', 'assets.depreciation.view_audit'),
    ('accountant', 'assets.depreciation.view'), ('accountant', 'assets.depreciation.view_financials'), ('accountant', 'assets.depreciation.assign_policy'),
    ('accountant', 'assets.depreciation.generate'), ('accountant', 'assets.depreciation.prepare_run'), ('accountant', 'assets.depreciation.review'),
    ('accountant', 'assets.depreciation.revise_estimate'), ('accountant', 'assets.depreciation.reconcile'), ('accountant', 'assets.depreciation.export'), ('accountant', 'assets.depreciation.view_audit'),
    ('asset_manager', 'assets.depreciation.view'), ('asset_manager', 'assets.depreciation.assign_policy'),
    ('auditor', 'assets.depreciation.view'), ('auditor', 'assets.depreciation.view_financials'), ('auditor', 'assets.depreciation.export'), ('auditor', 'assets.depreciation.view_audit')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0155_assets_depreciation.sql', 'assets-depreciation') ON CONFLICT DO NOTHING;
