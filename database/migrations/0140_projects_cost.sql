-- Projects — Project Cost. One project-level view of what delivering a project cost, consolidated from the authoritative records that
-- already hold each cost: approved time costed at its effective labor rate (0134), recognized expense, supplier bill and material
-- allocations (0138). Nothing here is a second ledger: labor cost and overhead are managerial cost allocations, never new GL expense.
-- This adds only what those sources do not hold:
--
--   1. budgets      the approved cost plan, versioned: a total and its amounts per cost category, approved by someone other than its author.
--   2. forecasts    the estimate to complete, versioned and dated, stating whether it already includes the open purchase commitments.
--   3. overhead     the company's overhead policy (per approved labor hour, a percentage of labor cost, or a fixed amount for a period),
--                   effective-dated, and its allocations to projects per period — managerial cost, reversible, never twice per period.
--   4. policy       the overrun alert threshold.
--   5. permissions  view summary, view detail, view labor rates, allocate, approve allocations, edit the forecast, reconcile, view
--                   profitability, export.

-- ============================================================ 1. budgets
CREATE TABLE IF NOT EXISTS tenant.project_cost_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'APPROVED', 'REJECTED', 'SUPERSEDED')),
  total_amount numeric(18,2) NOT NULL CHECK (total_amount >= 0),
  currency char(3) NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  proposed_by uuid REFERENCES public.users(id),
  proposed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_by uuid REFERENCES public.users(id),
  decided_at timestamptz,
  decision_note text,
  idempotency_key text,
  UNIQUE (project_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS project_cost_budgets_approved_idx ON tenant.project_cost_budgets (project_id) WHERE status = 'APPROVED';
CREATE UNIQUE INDEX IF NOT EXISTS project_cost_budgets_proposed_idx ON tenant.project_cost_budgets (project_id) WHERE status = 'PROPOSED';
CREATE UNIQUE INDEX IF NOT EXISTS project_cost_budgets_key_idx ON tenant.project_cost_budgets (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS tenant.project_cost_budget_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  budget_id uuid NOT NULL REFERENCES tenant.project_cost_budgets(id),
  category text NOT NULL CHECK (category IN ('LABOR', 'TRAVEL', 'SUBCONTRACTORS', 'MATERIALS', 'EQUIPMENT', 'SOFTWARE', 'OTHER_DIRECT', 'OVERHEAD')),
  amount numeric(18,2) NOT NULL CHECK (amount >= 0),
  UNIQUE (budget_id, category)
);
-- A budget's amounts are fixed once proposed; only its decision is recorded.
CREATE OR REPLACE FUNCTION tenant.project_cost_budgets_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A budget version is kept, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.total_amount <> OLD.total_amount OR NEW.version <> OLD.version OR NEW.project_id <> OLD.project_id OR NEW.reason <> OLD.reason THEN
    RAISE EXCEPTION 'A budget version keeps its amounts; propose a new version instead.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('REJECTED', 'SUPERSEDED') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'A rejected or superseded budget stays so.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_cost_budgets_guard') THEN
    CREATE TRIGGER project_cost_budgets_guard BEFORE UPDATE OR DELETE ON tenant.project_cost_budgets FOR EACH ROW EXECUTE FUNCTION tenant.project_cost_budgets_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_cost_budget_lines_append_only') THEN
    CREATE TRIGGER project_cost_budget_lines_append_only BEFORE UPDATE OR DELETE ON tenant.project_cost_budget_lines FOR EACH ROW EXECUTE FUNCTION tenant.projects_append_only();
  END IF;
END $$;

-- ============================================================ 2. forecasts
CREATE TABLE IF NOT EXISTS tenant.project_cost_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  version integer NOT NULL CHECK (version > 0),
  estimate_to_complete numeric(18,2) NOT NULL CHECK (estimate_to_complete >= 0),
  currency char(3) NOT NULL,
  as_of_date date NOT NULL,
  commitment_treatment text NOT NULL CHECK (commitment_treatment IN ('INCLUDED', 'EXCLUDED')),
  notes text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  idempotency_key text,
  UNIQUE (project_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS project_cost_forecasts_key_idx ON tenant.project_cost_forecasts (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ============================================================ 3. overhead
CREATE TABLE IF NOT EXISTS tenant.project_overhead_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  policy_number bigint GENERATED ALWAYS AS IDENTITY,
  method text NOT NULL CHECK (method IN ('PER_LABOR_HOUR', 'PERCENT_OF_LABOR', 'FIXED_AMOUNT')),
  rate numeric(18,4) NOT NULL CHECK (rate > 0),
  currency char(3) NOT NULL,
  -- Every project, or one project (a fixed amount is always for one project).
  project_id uuid REFERENCES tenant.projects(id),
  effective_from date NOT NULL,
  effective_to date,
  description text NOT NULL CHECK (length(btrim(description)) >= 3),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ENDED')),
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ended_by uuid REFERENCES public.users(id),
  ended_at timestamptz,
  CONSTRAINT project_overhead_policies_dates_check CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT project_overhead_policies_fixed_check CHECK (method <> 'FIXED_AMOUNT' OR project_id IS NOT NULL),
  CONSTRAINT project_overhead_policies_percent_check CHECK (method <> 'PERCENT_OF_LABOR' OR rate <= 500)
);
CREATE TABLE IF NOT EXISTS tenant.project_overhead_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  policy_id uuid NOT NULL REFERENCES tenant.project_overhead_policies(id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  basis_minutes integer,
  basis_amount numeric(18,2),
  amount numeric(18,2) NOT NULL CHECK (amount >= 0),
  currency char(3) NOT NULL,
  status text NOT NULL DEFAULT 'RECOGNIZED' CHECK (status IN ('RECOGNIZED', 'REVERSED')),
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reversed_by uuid REFERENCES public.users(id),
  reversed_at timestamptz,
  reversal_reason text,
  CONSTRAINT project_overhead_allocations_period_check CHECK (period_end >= period_start),
  CONSTRAINT project_overhead_allocations_reversal_check CHECK ((status = 'REVERSED') = (reversed_at IS NOT NULL))
);
-- One live allocation per project, policy and period.
CREATE UNIQUE INDEX IF NOT EXISTS project_overhead_allocations_live_idx ON tenant.project_overhead_allocations (project_id, policy_id, period_start) WHERE status = 'RECOGNIZED';
CREATE OR REPLACE FUNCTION tenant.project_overhead_allocations_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'An overhead allocation is reversed, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.amount <> OLD.amount OR NEW.project_id <> OLD.project_id OR NEW.policy_id <> OLD.policy_id OR NEW.period_start <> OLD.period_start THEN
    RAISE EXCEPTION 'An overhead allocation keeps its amount; reverse it and allocate again.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'REVERSED' AND NEW.status <> 'REVERSED' THEN RAISE EXCEPTION 'A reversed allocation stays reversed.' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_overhead_allocations_guard') THEN
    CREATE TRIGGER project_overhead_allocations_guard BEFORE UPDATE OR DELETE ON tenant.project_overhead_allocations FOR EACH ROW EXECUTE FUNCTION tenant.project_overhead_allocations_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_cost_forecasts_append_only') THEN
    CREATE TRIGGER project_cost_forecasts_append_only BEFORE UPDATE OR DELETE ON tenant.project_cost_forecasts FOR EACH ROW EXECUTE FUNCTION tenant.projects_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_overhead_policies_no_delete') THEN
    CREATE TRIGGER project_overhead_policies_no_delete BEFORE DELETE ON tenant.project_overhead_policies FOR EACH ROW EXECUTE FUNCTION tenant.projects_no_delete();
  END IF;
END $$;

-- ============================================================ 4. policy
ALTER TABLE tenant.project_settings ADD COLUMN IF NOT EXISTS cost_overrun_alert_percent integer NOT NULL DEFAULT 90 CHECK (cost_overrun_alert_percent BETWEEN 50 AND 200);

-- ============================================================ isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['project_cost_budgets', 'project_cost_budget_lines', 'project_cost_forecasts', 'project_overhead_policies', 'project_overhead_allocations'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.project_cost_budgets, tenant.project_overhead_policies, tenant.project_overhead_allocations TO vercent_app;
GRANT SELECT, INSERT ON tenant.project_cost_budget_lines, tenant.project_cost_forecasts TO vercent_app;
GRANT SELECT ON tenant.project_cost_budgets, tenant.project_cost_budget_lines, tenant.project_cost_forecasts, tenant.project_overhead_policies, tenant.project_overhead_allocations TO vercent_worker;

-- ============================================================ 5. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('projects.cost.view_summary', 'View project cost totals', 'Projects', 'See a project''s total cost, budget, commitments and forecast.'),
  ('projects.cost.view_detail', 'View project cost lines', 'Projects', 'See the source-linked cost lines behind the totals.'),
  ('projects.cost.view_labor_rate', 'View internal labor rates', 'Projects', 'See the confidential cost rate of each person''s time.'),
  ('projects.cost.allocate', 'Allocate project cost', 'Projects', 'Propose budgets and allocate overhead to projects.'),
  ('projects.cost.approve_allocation', 'Approve cost allocations', 'Projects', 'Approve budgets and set the overhead policy.'),
  ('projects.cost.forecast_edit', 'Maintain the cost forecast', 'Projects', 'Record the estimate to complete of the projects you lead.'),
  ('projects.cost.reconcile', 'Reconcile project cost', 'Projects', 'Review cost reconciliation and its exceptions.'),
  ('projects.cost.view_profitability', 'View project profitability', 'Projects', 'See invoiced value against project cost.'),
  ('projects.cost.export', 'Export project cost', 'Projects', 'Export project cost lines and reports.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('project_manager', 'projects.cost.view_summary'), ('project_manager', 'projects.cost.view_detail'), ('project_manager', 'projects.cost.allocate'),
    ('project_manager', 'projects.cost.forecast_edit'), ('project_manager', 'projects.cost.view_profitability'), ('project_manager', 'projects.cost.export'),
    ('finance_manager', 'projects.cost.view_summary'), ('finance_manager', 'projects.cost.view_detail'), ('finance_manager', 'projects.cost.view_labor_rate'),
    ('finance_manager', 'projects.cost.allocate'), ('finance_manager', 'projects.cost.approve_allocation'), ('finance_manager', 'projects.cost.reconcile'),
    ('finance_manager', 'projects.cost.view_profitability'), ('finance_manager', 'projects.cost.export'),
    ('accountant', 'projects.cost.view_summary'), ('accountant', 'projects.cost.view_detail'), ('accountant', 'projects.cost.view_labor_rate'),
    ('accountant', 'projects.cost.allocate'), ('accountant', 'projects.cost.reconcile'), ('accountant', 'projects.cost.view_profitability'), ('accountant', 'projects.cost.export'),
    ('sales_head', 'projects.cost.view_summary'), ('sales_head', 'projects.cost.view_profitability')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0140_projects_cost.sql', 'projects-cost') ON CONFLICT DO NOTHING;
