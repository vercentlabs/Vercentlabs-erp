-- Projects — Project Profitability. A calculated reading above Project Cost (0140) and Project Revenue (0141): actual contribution (Finance's
-- recognized revenue less comparable project cost), the forecast final contribution (forecast revenue less the estimate at completion),
-- budget variance, the cost basis and how complete the data is. Nothing here is a ledger or an editable figure: the estimate to complete
-- stays Project Cost's forecast and the further-revenue estimate Project Revenue's. This adds only:
--
--   1. snapshots    immutable, dated records of what the figures were (on request, and when a project completes), with the calculation
--                   version, the basis, completeness and the sources' watermarks — so history is reported as it was, and restatements show.
--   2. policy       the forecast-margin warning threshold.
--   3. permissions  view summary, details, labor cost, revenue, forecast; edit the forecast; reconcile; export.

-- ============================================================ 1. snapshots
CREATE TABLE IF NOT EXISTS tenant.project_profitability_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  snapshot_number bigint GENERATED ALWAYS AS IDENTITY,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  reason text NOT NULL CHECK (reason IN ('MANUAL', 'COMPLETION', 'SCHEDULED')),
  note text,
  period_start date,
  period_end date NOT NULL,
  calculation_version text NOT NULL,
  cost_basis text NOT NULL CHECK (cost_basis IN ('MANAGERIAL', 'FINANCE_SOURCED', 'NONE')),
  reporting_currency char(3) NOT NULL,
  contract_value numeric(18,2),
  net_invoiced numeric(18,2) NOT NULL,
  collected numeric(18,2),
  recognized_revenue numeric(18,2),
  comparable_actual_cost numeric(18,2) NOT NULL,
  actual_contribution numeric(18,2),
  actual_margin_percent numeric(7,2),
  budget_total numeric(18,2),
  estimate_to_complete numeric(18,2),
  estimate_at_completion numeric(18,2),
  forecast_revenue numeric(18,2),
  forecast_contribution numeric(18,2),
  forecast_margin_percent numeric(7,2),
  status text NOT NULL CHECK (status IN ('PROFITABLE', 'BREAK_EVEN', 'LOSS', 'UNKNOWN', 'INTERNAL')),
  forecast_status text NOT NULL CHECK (forecast_status IN ('FORECAST_PROFIT', 'FORECAST_BREAK_EVEN', 'FORECAST_LOSS', 'FORECAST_UNAVAILABLE', 'INTERNAL')),
  completeness text NOT NULL CHECK (completeness IN ('COMPLETE', 'PARTIAL', 'UNAVAILABLE')),
  cost_forecast_version integer,
  revenue_forecast_version integer,
  contract_versions jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_watermarks jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id),
  snapshot_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  idempotency_key text,
  CONSTRAINT project_profitability_snapshots_period_check CHECK (period_start IS NULL OR period_end >= period_start)
);
CREATE INDEX IF NOT EXISTS project_profitability_snapshots_project_idx ON tenant.project_profitability_snapshots (project_id, snapshot_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS project_profitability_snapshots_key_idx ON tenant.project_profitability_snapshots (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
-- One completion snapshot per completion (a reopened project completes again later).
CREATE UNIQUE INDEX IF NOT EXISTS project_profitability_snapshots_completion_idx ON tenant.project_profitability_snapshots (project_id, period_end) WHERE reason = 'COMPLETION';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_profitability_snapshots_append_only') THEN
    CREATE TRIGGER project_profitability_snapshots_append_only BEFORE UPDATE OR DELETE ON tenant.project_profitability_snapshots FOR EACH ROW EXECUTE FUNCTION tenant.projects_append_only();
  END IF;
END $$;

-- ============================================================ 2. policy
ALTER TABLE tenant.project_settings ADD COLUMN IF NOT EXISTS profitability_margin_alert_percent integer NOT NULL DEFAULT 10 CHECK (profitability_margin_alert_percent BETWEEN -100 AND 100);

-- ============================================================ isolation and grants
DO $$ BEGIN
  ALTER TABLE tenant.project_profitability_snapshots ENABLE ROW LEVEL SECURITY;
  ALTER TABLE tenant.project_profitability_snapshots FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'project_profitability_snapshots' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.project_profitability_snapshots USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT ON tenant.project_profitability_snapshots TO vercent_app;
GRANT SELECT, INSERT ON tenant.project_profitability_snapshots TO vercent_worker;

-- ============================================================ 3. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('projects.profitability.view_summary', 'View project profitability', 'Projects', 'See a project''s actual and forecast contribution and margin.'),
  ('projects.profitability.view_details', 'View profitability breakdown', 'Projects', 'See the cost and revenue drivers, trends and history behind the margin.'),
  ('projects.profitability.view_labor_cost', 'View labor cost by person', 'Projects', 'See the labor cost of each person behind a project''s margin.'),
  ('projects.profitability.view_revenue', 'View profitability revenue', 'Projects', 'See the commercial figures (contract, invoiced, collected) beside the margin.'),
  ('projects.profitability.view_forecast', 'View profitability forecast', 'Projects', 'See the estimate at completion and the forecast final margin.'),
  ('projects.profitability.edit_forecast', 'Update the profitability forecast', 'Projects', 'Revise the estimate to complete and the expected further revenue together.'),
  ('projects.profitability.reconcile', 'Reconcile project profitability', 'Projects', 'Review profitability reconciliation, record snapshots and see every project.'),
  ('projects.profitability.export', 'Export project profitability', 'Projects', 'Export profitability figures and reports.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('project_manager', 'projects.profitability.view_summary'), ('project_manager', 'projects.profitability.view_details'), ('project_manager', 'projects.profitability.view_revenue'),
    ('project_manager', 'projects.profitability.view_forecast'), ('project_manager', 'projects.profitability.edit_forecast'), ('project_manager', 'projects.profitability.export'),
    ('finance_manager', 'projects.profitability.view_summary'), ('finance_manager', 'projects.profitability.view_details'), ('finance_manager', 'projects.profitability.view_labor_cost'),
    ('finance_manager', 'projects.profitability.view_revenue'), ('finance_manager', 'projects.profitability.view_forecast'), ('finance_manager', 'projects.profitability.edit_forecast'),
    ('finance_manager', 'projects.profitability.reconcile'), ('finance_manager', 'projects.profitability.export'),
    ('accountant', 'projects.profitability.view_summary'), ('accountant', 'projects.profitability.view_details'), ('accountant', 'projects.profitability.view_labor_cost'),
    ('accountant', 'projects.profitability.view_revenue'), ('accountant', 'projects.profitability.view_forecast'), ('accountant', 'projects.profitability.reconcile'), ('accountant', 'projects.profitability.export'),
    ('sales_head', 'projects.profitability.view_summary'), ('sales_head', 'projects.profitability.view_revenue'), ('sales_head', 'projects.profitability.view_forecast')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0142_projects_profitability.sql', 'projects-profitability') ON CONFLICT DO NOTHING;
