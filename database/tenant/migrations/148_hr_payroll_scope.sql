BEGIN;

-- A regular payroll can be scoped (by department and/or branch), so a company can run several
-- payroll groups for one period. An employee can be in only one live regular run per period.
ALTER TABLE tenant.hr_payroll_runs
  ADD COLUMN IF NOT EXISTS scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS scope_key text NOT NULL DEFAULT 'all';

DROP INDEX IF EXISTS tenant.hr_payroll_runs_regular_uq;
CREATE UNIQUE INDEX IF NOT EXISTS hr_payroll_runs_regular_scope_uq ON tenant.hr_payroll_runs (organization_id, company_id, period_start, period_end, scope_key) WHERE run_type = 'regular' AND status <> 'cancelled';

COMMIT;
