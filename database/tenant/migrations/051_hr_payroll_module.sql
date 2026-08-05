BEGIN;

CREATE TABLE IF NOT EXISTS tenant.hr_payroll_settings (
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  payroll_frequency text NOT NULL DEFAULT 'monthly'
    CHECK (payroll_frequency IN ('weekly','biweekly','monthly')),
  require_leave_approval boolean NOT NULL DEFAULT true,
  require_expense_approval boolean NOT NULL DEFAULT true,
  prohibit_self_approval boolean NOT NULL DEFAULT true,
  attendance_grace_minutes integer NOT NULL DEFAULT 0 CHECK (attendance_grace_minutes >= 0),
  default_currency_code text NOT NULL DEFAULT 'INR',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,company_id)
);

CREATE TABLE IF NOT EXISTS tenant.hr_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  parent_department_id uuid REFERENCES tenant.hr_departments(id),
  manager_employee_id uuid,
  cost_center_id uuid,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,company_id,code)
);

CREATE TABLE IF NOT EXISTS tenant.hr_designations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  grade text,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,company_id,code)
);

CREATE TABLE IF NOT EXISTS tenant.hr_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid,
  employee_number text NOT NULL,
  user_id uuid,
  first_name text NOT NULL,
  middle_name text,
  last_name text NOT NULL,
  preferred_name text,
  work_email text,
  personal_email text,
  work_phone text,
  personal_phone text,
  date_of_birth date,
  gender text,
  marital_status text,
  nationality text,
  address jsonb NOT NULL DEFAULT '{}'::jsonb,
  department_id uuid REFERENCES tenant.hr_departments(id),
  designation_id uuid REFERENCES tenant.hr_designations(id),
  manager_employee_id uuid REFERENCES tenant.hr_employees(id),
  employment_type text NOT NULL
    CHECK (employment_type IN ('permanent','contract','intern','consultant','part_time','temporary')),
  joining_date date NOT NULL,
  probation_end_date date,
  confirmation_date date,
  separation_date date,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','on_leave','suspended','separated')),
  bank_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  tax_identifiers jsonb NOT NULL DEFAULT '{}'::jsonb,
  statutory_identifiers jsonb NOT NULL DEFAULT '{}'::jsonb,
  emergency_contacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,employee_number),
  UNIQUE (organization_id,work_email)
);

ALTER TABLE tenant.hr_departments
  ADD CONSTRAINT hr_departments_manager_employee_fk
  FOREIGN KEY (manager_employee_id) REFERENCES tenant.hr_employees(id);

CREATE TABLE IF NOT EXISTS tenant.hr_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  break_minutes integer NOT NULL DEFAULT 0 CHECK (break_minutes >= 0),
  grace_minutes integer NOT NULL DEFAULT 0 CHECK (grace_minutes >= 0),
  working_days jsonb NOT NULL DEFAULT '[1,2,3,4,5]'::jsonb,
  overnight boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,company_id,code)
);

CREATE TABLE IF NOT EXISTS tenant.hr_employee_shift_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES tenant.hr_employees(id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES tenant.hr_shifts(id),
  effective_from date NOT NULL,
  effective_to date,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant.hr_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES tenant.hr_employees(id),
  attendance_date date NOT NULL,
  shift_id uuid REFERENCES tenant.hr_shifts(id),
  check_in_at timestamptz,
  check_out_at timestamptz,
  worked_minutes integer NOT NULL DEFAULT 0 CHECK (worked_minutes >= 0),
  overtime_minutes integer NOT NULL DEFAULT 0 CHECK (overtime_minutes >= 0),
  late_minutes integer NOT NULL DEFAULT 0 CHECK (late_minutes >= 0),
  early_exit_minutes integer NOT NULL DEFAULT 0 CHECK (early_exit_minutes >= 0),
  status text NOT NULL
    CHECK (status IN ('present','absent','half_day','leave','holiday','weekly_off','remote')),
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','biometric','mobile','web','import')),
  notes text,
  approved_by uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id,attendance_date)
);

CREATE TABLE IF NOT EXISTS tenant.hr_leave_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  paid boolean NOT NULL DEFAULT true,
  annual_entitlement numeric(10,4) NOT NULL DEFAULT 0 CHECK (annual_entitlement >= 0),
  carry_forward_allowed boolean NOT NULL DEFAULT false,
  max_carry_forward numeric(10,4) NOT NULL DEFAULT 0 CHECK (max_carry_forward >= 0),
  encashment_allowed boolean NOT NULL DEFAULT false,
  requires_attachment boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,company_id,code)
);

CREATE TABLE IF NOT EXISTS tenant.hr_leave_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES tenant.hr_employees(id),
  leave_type_id uuid NOT NULL REFERENCES tenant.hr_leave_types(id),
  leave_year integer NOT NULL,
  opening_balance numeric(10,4) NOT NULL DEFAULT 0,
  accrued numeric(10,4) NOT NULL DEFAULT 0,
  used numeric(10,4) NOT NULL DEFAULT 0,
  adjusted numeric(10,4) NOT NULL DEFAULT 0,
  closing_balance numeric(10,4) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id,leave_type_id,leave_year)
);

CREATE TABLE IF NOT EXISTS tenant.hr_leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES tenant.hr_employees(id),
  leave_type_id uuid NOT NULL REFERENCES tenant.hr_leave_types(id),
  start_date date NOT NULL,
  end_date date NOT NULL,
  days numeric(10,4) NOT NULL CHECK (days > 0),
  reason text,
  attachment_reference text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','approved','rejected','cancelled')),
  submitted_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  rejection_reason text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS tenant.hr_employee_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES tenant.hr_employees(id),
  expense_number text NOT NULL,
  expense_date date NOT NULL,
  category text NOT NULL,
  description text,
  currency_code text NOT NULL,
  amount numeric(20,6) NOT NULL CHECK (amount > 0),
  base_amount numeric(20,6) NOT NULL CHECK (base_amount > 0),
  receipt_reference text,
  project_id uuid,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','approved','rejected','reimbursed')),
  submitted_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  rejection_reason text,
  accounting_payment_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,expense_number)
);

CREATE TABLE IF NOT EXISTS tenant.hr_salary_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  component_type text NOT NULL
    CHECK (component_type IN ('earning','deduction','employer_contribution')),
  calculation_type text NOT NULL
    CHECK (calculation_type IN ('fixed','percentage','formula','statutory')),
  taxable boolean NOT NULL DEFAULT true,
  affects_gross boolean NOT NULL DEFAULT true,
  affects_net boolean NOT NULL DEFAULT true,
  accounting_account_id uuid,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,company_id,code)
);

CREATE TABLE IF NOT EXISTS tenant.hr_salary_structures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','inactive','obsolete')),
  currency_code text NOT NULL,
  pay_frequency text NOT NULL
    CHECK (pay_frequency IN ('weekly','biweekly','monthly')),
  created_by uuid NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,company_id,code,version)
);

CREATE TABLE IF NOT EXISTS tenant.hr_salary_structure_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  salary_structure_id uuid NOT NULL REFERENCES tenant.hr_salary_structures(id) ON DELETE CASCADE,
  salary_component_id uuid NOT NULL REFERENCES tenant.hr_salary_components(id),
  sequence integer NOT NULL CHECK (sequence > 0),
  amount numeric(20,6),
  percentage numeric(10,6),
  formula text,
  minimum_amount numeric(20,6),
  maximum_amount numeric(20,6),
  UNIQUE (salary_structure_id,sequence)
);

CREATE TABLE IF NOT EXISTS tenant.hr_employee_compensation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES tenant.hr_employees(id),
  salary_structure_id uuid NOT NULL REFERENCES tenant.hr_salary_structures(id),
  effective_from date NOT NULL,
  effective_to date,
  annual_ctc numeric(20,6) NOT NULL DEFAULT 0 CHECK (annual_ctc >= 0),
  monthly_gross numeric(20,6) NOT NULL DEFAULT 0 CHECK (monthly_gross >= 0),
  currency_code text NOT NULL,
  created_by uuid NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant.hr_statutory_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  jurisdiction text NOT NULL DEFAULT 'IN',
  statutory_type text NOT NULL
    CHECK (statutory_type IN ('pf','esi','professional_tax','tds','gratuity','bonus','labor_welfare','other')),
  employee_rate numeric(10,6) NOT NULL DEFAULT 0,
  employer_rate numeric(10,6) NOT NULL DEFAULT 0,
  wage_ceiling numeric(20,6),
  effective_from date NOT NULL,
  effective_to date,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,company_id,code,effective_from)
);

CREATE TABLE IF NOT EXISTS tenant.hr_payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid,
  payroll_number text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  payment_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','calculated','pending_approval','approved','posted','cancelled')),
  employee_count integer NOT NULL DEFAULT 0,
  gross_pay numeric(20,6) NOT NULL DEFAULT 0,
  total_deductions numeric(20,6) NOT NULL DEFAULT 0,
  employer_contributions numeric(20,6) NOT NULL DEFAULT 0,
  net_pay numeric(20,6) NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  calculated_by uuid,
  calculated_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  accounting_batch_id uuid,
  posted_by uuid,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,payroll_number),
  UNIQUE (organization_id,company_id,period_start,period_end)
);

CREATE TABLE IF NOT EXISTS tenant.hr_payslips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  payroll_run_id uuid NOT NULL REFERENCES tenant.hr_payroll_runs(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES tenant.hr_employees(id),
  payslip_number text NOT NULL,
  working_days numeric(10,4) NOT NULL DEFAULT 0,
  paid_days numeric(10,4) NOT NULL DEFAULT 0,
  leave_days numeric(10,4) NOT NULL DEFAULT 0,
  absent_days numeric(10,4) NOT NULL DEFAULT 0,
  overtime_minutes integer NOT NULL DEFAULT 0,
  gross_pay numeric(20,6) NOT NULL DEFAULT 0,
  total_deductions numeric(20,6) NOT NULL DEFAULT 0,
  employer_contributions numeric(20,6) NOT NULL DEFAULT 0,
  net_pay numeric(20,6) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','calculated','approved','posted','cancelled')),
  generated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,payslip_number),
  UNIQUE (payroll_run_id,employee_id)
);

CREATE TABLE IF NOT EXISTS tenant.hr_payslip_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  payslip_id uuid NOT NULL REFERENCES tenant.hr_payslips(id) ON DELETE CASCADE,
  salary_component_id uuid REFERENCES tenant.hr_salary_components(id),
  statutory_component_id uuid REFERENCES tenant.hr_statutory_components(id),
  component_code text NOT NULL,
  component_name text NOT NULL,
  component_type text NOT NULL,
  amount numeric(20,6) NOT NULL DEFAULT 0,
  taxable_amount numeric(20,6) NOT NULL DEFAULT 0,
  employer_amount numeric(20,6) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tenant.hr_payroll_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hr_employees_status_idx
  ON tenant.hr_employees(organization_id,company_id,status,department_id);
CREATE INDEX IF NOT EXISTS hr_attendance_date_idx
  ON tenant.hr_attendance(organization_id,company_id,attendance_date,employee_id);
CREATE INDEX IF NOT EXISTS hr_leave_status_idx
  ON tenant.hr_leave_requests(organization_id,company_id,status,start_date);
CREATE INDEX IF NOT EXISTS hr_payroll_runs_status_idx
  ON tenant.hr_payroll_runs(organization_id,company_id,status,payment_date);
CREATE INDEX IF NOT EXISTS hr_payroll_events_aggregate_idx
  ON tenant.hr_payroll_events(organization_id,aggregate_type,aggregate_id,occurred_at);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'hr_payroll_settings',
    'hr_departments',
    'hr_designations',
    'hr_employees',
    'hr_shifts',
    'hr_employee_shift_assignments',
    'hr_attendance',
    'hr_leave_types',
    'hr_leave_balances',
    'hr_leave_requests',
    'hr_employee_expenses',
    'hr_salary_components',
    'hr_salary_structures',
    'hr_salary_structure_lines',
    'hr_employee_compensation',
    'hr_statutory_components',
    'hr_payroll_runs',
    'hr_payslips',
    'hr_payslip_lines',
    'hr_payroll_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON tenant.%I',
      table_name || '_organization_isolation',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON tenant.%I USING (organization_id=tenant.current_organization_id()) WITH CHECK (organization_id=tenant.current_organization_id())',
      table_name || '_organization_isolation',
      table_name
    );
  END LOOP;
END $$;

COMMIT;
