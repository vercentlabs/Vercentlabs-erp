BEGIN;

-- F418-F427 compensation and the payroll engine: component metadata, structure lines with a basis
-- and a formula, approved compensation assignments with a frozen breakup, payroll periods, runs
-- with a frozen source snapshot per payslip, and payroll exceptions.

ALTER TABLE tenant.hr_payroll_settings
  ADD COLUMN IF NOT EXISTS payroll_days_basis text NOT NULL DEFAULT 'calendar' CHECK (payroll_days_basis IN ('calendar','fixed_30')),
  ADD COLUMN IF NOT EXISTS overtime_basis_days integer NOT NULL DEFAULT 26 CHECK (overtime_basis_days BETWEEN 20 AND 31),
  ADD COLUMN IF NOT EXISTS overtime_hours_per_day numeric(4,1) NOT NULL DEFAULT 8 CHECK (overtime_hours_per_day BETWEEN 1 AND 24),
  ADD COLUMN IF NOT EXISTS max_deduction_percent numeric(5,2) NOT NULL DEFAULT 100 CHECK (max_deduction_percent BETWEEN 1 AND 100),
  ADD COLUMN IF NOT EXISTS payslip_release text NOT NULL DEFAULT 'approval' CHECK (payslip_release IN ('approval','payment'));

ALTER TABLE tenant.hr_salary_components
  ADD COLUMN IF NOT EXISTS component_kind text NOT NULL DEFAULT 'allowance' CHECK (component_kind IN ('basic','allowance','bonus','incentive','reimbursement','arrear','overtime','loan','advance','statutory','other')),
  ADD COLUMN IF NOT EXISTS prorated boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pf_wage boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS esic_wage boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS description text;

ALTER TABLE tenant.hr_salary_structures DROP CONSTRAINT IF EXISTS hr_salary_structures_status_check;
ALTER TABLE tenant.hr_salary_structures ADD CONSTRAINT hr_salary_structures_status_check CHECK (status IN ('draft','pending_approval','active','inactive','obsolete'));
ALTER TABLE tenant.hr_salary_structures
  ADD COLUMN IF NOT EXISTS submitted_by uuid,
  ADD COLUMN IF NOT EXISTS supersedes_id uuid,
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE tenant.hr_salary_structure_lines
  ADD COLUMN IF NOT EXISTS percent_of text,
  ADD COLUMN IF NOT EXISTS is_balance boolean NOT NULL DEFAULT false;

ALTER TABLE tenant.hr_employee_compensation
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval','active','rejected','ended')),
  ADD COLUMN IF NOT EXISTS breakup jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS structure_version integer,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS requested_by uuid,
  ADD COLUMN IF NOT EXISTS decision_note text,
  ADD COLUMN IF NOT EXISTS source_change_id uuid,
  ADD COLUMN IF NOT EXISTS source_offer_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS hr_compensation_start_uq ON tenant.hr_employee_compensation (employee_id, effective_from) WHERE status IN ('pending_approval','active');

CREATE TABLE IF NOT EXISTS tenant.hr_payroll_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  period_code text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  payment_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','locked','closed')),
  locked_by uuid,
  locked_at timestamptz,
  closed_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, company_id, period_code),
  CHECK (period_end >= period_start),
  CHECK (payment_date >= period_end)
);

DO $$
DECLARE name text;
BEGIN
  FOR name IN SELECT conname FROM pg_constraint WHERE conrelid='tenant.hr_payroll_runs'::regclass AND contype='u' AND pg_get_constraintdef(oid) LIKE '%period_start%period_end%' LOOP
    EXECUTE format('ALTER TABLE tenant.hr_payroll_runs DROP CONSTRAINT %I', name);
  END LOOP;
END $$;
ALTER TABLE tenant.hr_payroll_runs DROP CONSTRAINT IF EXISTS hr_payroll_runs_status_check;
ALTER TABLE tenant.hr_payroll_runs ADD CONSTRAINT hr_payroll_runs_status_check CHECK (status IN ('draft','calculated','pending_approval','approved','posted','paid','cancelled'));
ALTER TABLE tenant.hr_payroll_runs
  ADD COLUMN IF NOT EXISTS period_id uuid REFERENCES tenant.hr_payroll_periods(id),
  ADD COLUMN IF NOT EXISTS run_type text NOT NULL DEFAULT 'regular' CHECK (run_type IN ('regular','off_cycle','final_settlement')),
  ADD COLUMN IF NOT EXISTS calc_hash text,
  ADD COLUMN IF NOT EXISTS submitted_by uuid,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS returned_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS notes text;
CREATE UNIQUE INDEX IF NOT EXISTS hr_payroll_runs_regular_uq ON tenant.hr_payroll_runs (organization_id, company_id, period_start, period_end) WHERE run_type = 'regular' AND status <> 'cancelled';

ALTER TABLE tenant.hr_payslips DROP CONSTRAINT IF EXISTS hr_payslips_status_check;
ALTER TABLE tenant.hr_payslips ADD CONSTRAINT hr_payslips_status_check CHECK (status IN ('draft','calculated','approved','posted','paid','held','cancelled'));
ALTER TABLE tenant.hr_payslips
  ADD COLUMN IF NOT EXISTS source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS calc_hash text,
  ADD COLUMN IF NOT EXISTS lop_days numeric(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS released_at timestamptz,
  ADD COLUMN IF NOT EXISTS hold_reason text;
ALTER TABLE tenant.hr_payslip_lines
  ADD COLUMN IF NOT EXISTS line_sequence integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS component_kind text;

CREATE TABLE IF NOT EXISTS tenant.hr_payroll_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  payroll_run_id uuid NOT NULL REFERENCES tenant.hr_payroll_runs(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES tenant.hr_employees(id),
  code text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('error','warning')),
  message text NOT NULL,
  resolved boolean NOT NULL DEFAULT false,
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_payroll_exceptions_run_idx ON tenant.hr_payroll_exceptions (organization_id, payroll_run_id, resolved);

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['hr_payroll_periods','hr_payroll_exceptions'] LOOP
  EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.%I', t);
  EXECUTE format('CREATE POLICY tenant_organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', t);
END LOOP; END $$;

COMMIT;
