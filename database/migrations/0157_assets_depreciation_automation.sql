-- Assets — Automatic Depreciation Accounting. An orchestration layer over the existing depreciation runs (no second calculator, schedule or
-- ledger): a Company- and book-scoped automation policy (manual, prepare and approve, or automatic posting — opted into by an authorized
-- Finance user), durable executions of each month's automation (claimed with a lease, idempotent per book and month, with their attempts,
-- outcome and reconciliation), and the links from runs to the execution that prepared them and to the Finance acknowledgment of any
-- catch-up of earlier months. Posting stays Finance's: a run is posted only when Finance's journal confirms it. Additive:
--
--   1. policies     versioned automation settings; one active per Company and book; who enabled automatic posting and when.
--   2. executions   each scheduled or manual execution: book, month, trigger, run, state, attempts, lease, error, reconciliation outcome.
--   3. runs         the execution that prepared a run, and the catch-up acknowledgment.
--   4. permissions  automation view, configure, enable; retry.

-- ============================================================ 1. policies
CREATE TABLE IF NOT EXISTS tenant.asset_depreciation_automation_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  book text NOT NULL DEFAULT 'FINANCIAL' CHECK (book IN ('FINANCIAL')),
  version integer NOT NULL,
  mode text NOT NULL CHECK (mode IN ('MANUAL', 'PREPARE_APPROVE', 'AUTO_POST')),
  frequency text NOT NULL DEFAULT 'MONTHLY' CHECK (frequency IN ('MONTHLY')),
  -- A month becomes eligible this many days after its last day (the close window), never on a fixed calendar day.
  trigger_days_after_period_end integer NOT NULL DEFAULT 0 CHECK (trigger_days_after_period_end BETWEEN 0 AND 60),
  -- Unposted months older than this many days past their end are reported as overdue.
  close_deadline_days integer NOT NULL DEFAULT 10 CHECK (close_deadline_days BETWEEN 0 AND 120),
  journal_date_rule text NOT NULL DEFAULT 'PERIOD_END' CHECK (journal_date_rule IN ('PERIOD_END')),
  first_period date NOT NULL CHECK (extract(day FROM first_period) = 1),
  -- Automatic posting acts as this Finance user, with their current rights: revoking them stops automatic posting.
  posting_user_id uuid REFERENCES public.users(id),
  notify_finance boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUPERSEDED')),
  reason text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  enabled_by uuid REFERENCES public.users(id),
  enabled_at timestamptz,
  superseded_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT asset_depreciation_automation_policies_version_key UNIQUE (organization_id, book, version),
  CONSTRAINT asset_depreciation_automation_policies_auto_check CHECK (mode <> 'AUTO_POST' OR (posting_user_id IS NOT NULL AND enabled_by IS NOT NULL AND enabled_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_depreciation_automation_policies_active_idx ON tenant.asset_depreciation_automation_policies (organization_id, book) WHERE status = 'ACTIVE';
-- A version keeps its settings; the only change is being superseded by the next version.
CREATE OR REPLACE FUNCTION tenant.asset_depreciation_automation_policies_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'An automation policy version is superseded, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status <> 'ACTIVE' OR NEW.status <> 'SUPERSEDED'
     OR (to_jsonb(NEW) - ARRAY['status', 'superseded_at', 'row_version']) <> (to_jsonb(OLD) - ARRAY['status', 'superseded_at', 'row_version']) THEN
    RAISE EXCEPTION 'An automation policy is changed by saving a new version.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_depreciation_automation_policies_guard') THEN
    CREATE TRIGGER asset_depreciation_automation_policies_guard BEFORE UPDATE OR DELETE ON tenant.asset_depreciation_automation_policies FOR EACH ROW EXECUTE FUNCTION tenant.asset_depreciation_automation_policies_guard();
  END IF;
END $$;

-- ============================================================ 2. executions
CREATE TABLE IF NOT EXISTS tenant.asset_depreciation_automation_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  policy_id uuid REFERENCES tenant.asset_depreciation_automation_policies(id),
  policy_version integer,
  mode text NOT NULL CHECK (mode IN ('MANUAL', 'PREPARE_APPROVE', 'AUTO_POST')),
  book text NOT NULL DEFAULT 'FINANCIAL',
  period_start date NOT NULL,
  trigger text NOT NULL CHECK (trigger IN ('SCHEDULED', 'MANUAL')),
  -- One execution per book and month: a re-run, a retried job or a second worker finds this row instead of starting another.
  execution_key text NOT NULL,
  run_id uuid REFERENCES tenant.asset_depreciation_period_runs(id),
  status text NOT NULL DEFAULT 'CLAIMED' CHECK (status IN ('CLAIMED', 'WAITING', 'AWAITING_APPROVAL', 'POSTING', 'POSTED', 'EXCEPTION', 'FAILED', 'SKIPPED')),
  reconciliation text CHECK (reconciliation IN ('RECONCILED', 'PENDING_POSTING', 'PARTIAL_POSTING', 'MISMATCH', 'RECOVERY_REQUIRED')),
  attempts integer NOT NULL DEFAULT 0,
  lease_expires_at timestamptz,
  error_code text,
  error_summary text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  triggered_by uuid REFERENCES public.users(id),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  CONSTRAINT asset_depreciation_automation_executions_key UNIQUE (organization_id, execution_key)
);
CREATE INDEX IF NOT EXISTS asset_depreciation_automation_executions_period_idx ON tenant.asset_depreciation_automation_executions (organization_id, period_start DESC);
-- The attempt history of every execution (claims, outcomes, recoveries) is append-only.
CREATE TABLE IF NOT EXISTS tenant.asset_depreciation_automation_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  execution_id uuid NOT NULL REFERENCES tenant.asset_depreciation_automation_executions(id),
  attempt integer NOT NULL,
  outcome text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS asset_depreciation_automation_attempts_execution_idx ON tenant.asset_depreciation_automation_attempts (execution_id, occurred_at);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_depreciation_automation_attempts_append_only') THEN
    CREATE TRIGGER asset_depreciation_automation_attempts_append_only BEFORE UPDATE OR DELETE ON tenant.asset_depreciation_automation_attempts FOR EACH ROW EXECUTE FUNCTION tenant.assets_history_append_only();
  END IF;
END $$;

-- ============================================================ 3. runs
ALTER TABLE tenant.asset_depreciation_period_runs
  ADD COLUMN IF NOT EXISTS automation_execution_id uuid REFERENCES tenant.asset_depreciation_automation_executions(id),
  ADD COLUMN IF NOT EXISTS prepared_by_automation boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS catch_up_acknowledged_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS catch_up_acknowledged_at timestamptz;

-- ============================================================ isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['asset_depreciation_automation_policies', 'asset_depreciation_automation_executions', 'asset_depreciation_automation_attempts'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.asset_depreciation_automation_policies, tenant.asset_depreciation_automation_executions TO vercent_app, vercent_worker;
GRANT SELECT, INSERT ON tenant.asset_depreciation_automation_attempts TO vercent_app, vercent_worker;
-- The scheduled worker prepares and posts through the same depreciation tables as a person does.
GRANT SELECT, INSERT, UPDATE ON tenant.asset_depreciation_period_runs, tenant.asset_depreciation_run_lines, tenant.asset_depreciation_schedule_versions TO vercent_worker;
GRANT SELECT, INSERT ON tenant.asset_depreciation_events TO vercent_worker;
-- Posting the run's journal through Finance's posting service records the posting and its attempts.
GRANT SELECT, INSERT, UPDATE ON tenant.accounting_postings TO vercent_worker;
GRANT SELECT, INSERT ON tenant.accounting_posting_attempts TO vercent_worker;

-- ============================================================ 4. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('assets.depreciation.automation_view', 'View depreciation automation', 'Assets', 'See the depreciation automation settings, executions and health.'),
  ('assets.depreciation.automation_configure', 'Configure depreciation automation', 'Assets', 'Choose manual or automatic preparation, the close window and the first period.'),
  ('assets.depreciation.automation_enable', 'Enable automatic depreciation posting', 'Assets', 'Turn automatic posting on or off (Finance authorization).'),
  ('assets.depreciation.retry', 'Retry depreciation automation', 'Assets', 'Re-run or recover a depreciation automation execution.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('finance_manager', 'assets.depreciation.automation_view'), ('finance_manager', 'assets.depreciation.automation_configure'),
    ('finance_manager', 'assets.depreciation.automation_enable'), ('finance_manager', 'assets.depreciation.retry'),
    ('accountant', 'assets.depreciation.automation_view'), ('accountant', 'assets.depreciation.retry'),
    ('auditor', 'assets.depreciation.automation_view')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0157_assets_depreciation_automation.sql', 'assets-depreciation-automation') ON CONFLICT DO NOTHING;
