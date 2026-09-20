BEGIN;

-- F428-F438: adjustments (bonus, incentives, arrears, recoveries), reimbursements, loans and
-- advances, final settlement, bank transfer files, accounting posting settings.

ALTER TABLE tenant.hr_payroll_settings
  ADD COLUMN IF NOT EXISTS salary_expense_account_id uuid,
  ADD COLUMN IF NOT EXISTS salary_payable_account_id uuid,
  ADD COLUMN IF NOT EXISTS statutory_payable_account_id uuid,
  ADD COLUMN IF NOT EXISTS employer_expense_account_id uuid,
  ADD COLUMN IF NOT EXISTS loan_account_id uuid,
  ADD COLUMN IF NOT EXISTS max_loan_multiple numeric(6,2) NOT NULL DEFAULT 6 CHECK (max_loan_multiple > 0),
  ADD COLUMN IF NOT EXISTS encashment_divisor integer NOT NULL DEFAULT 30 CHECK (encashment_divisor BETWEEN 20 AND 31),
  ADD COLUMN IF NOT EXISTS notice_recovery boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS originator_account text,
  ADD COLUMN IF NOT EXISTS originator_ifsc text;

CREATE TABLE IF NOT EXISTS tenant.hr_payroll_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES tenant.hr_employees(id),
  input_type text NOT NULL CHECK (input_type IN ('bonus','incentive','allowance','deduction','arrear','recovery','settlement_earning','settlement_deduction')),
  category text,
  amount numeric(20,6) NOT NULL CHECK (amount > 0),
  taxable boolean NOT NULL DEFAULT true,
  description text,
  pay_month date NOT NULL,
  status text NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval','approved','rejected','cancelled','paid')),
  requested_by uuid NOT NULL,
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  payroll_run_id uuid,
  source_type text,
  source_id uuid,
  component_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_payroll_inputs_idx ON tenant.hr_payroll_inputs (organization_id, employee_id, status, pay_month);
CREATE UNIQUE INDEX IF NOT EXISTS hr_payroll_inputs_source_uq ON tenant.hr_payroll_inputs (source_type, source_id, component_code) WHERE source_type IS NOT NULL AND status <> 'cancelled';

CREATE TABLE IF NOT EXISTS tenant.hr_expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  monthly_limit numeric(20,6) CHECK (monthly_limit IS NULL OR monthly_limit >= 0),
  receipt_required_above numeric(20,6) CHECK (receipt_required_above IS NULL OR receipt_required_above >= 0),
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, company_id, code)
);
ALTER TABLE tenant.hr_employee_expenses
  ADD COLUMN IF NOT EXISTS category_id uuid,
  ADD COLUMN IF NOT EXISTS payroll_run_id uuid,
  ADD COLUMN IF NOT EXISTS payment_reference text;

CREATE TABLE IF NOT EXISTS tenant.hr_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  loan_number text NOT NULL,
  employee_id uuid NOT NULL REFERENCES tenant.hr_employees(id),
  loan_type text NOT NULL DEFAULT 'loan' CHECK (loan_type IN ('loan','advance')),
  principal numeric(20,6) NOT NULL CHECK (principal > 0),
  interest_rate numeric(7,3) NOT NULL DEFAULT 0 CHECK (interest_rate >= 0),
  installments integer NOT NULL CHECK (installments BETWEEN 1 AND 120),
  emi numeric(20,6) NOT NULL DEFAULT 0,
  first_deduction_month date NOT NULL,
  purpose text,
  status text NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval','active','closed','rejected','cancelled')),
  outstanding_principal numeric(20,6) NOT NULL DEFAULT 0,
  requested_by uuid NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  decision_note text,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, loan_number)
);
CREATE TABLE IF NOT EXISTS tenant.hr_loan_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  loan_id uuid NOT NULL REFERENCES tenant.hr_loans(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  due_month date NOT NULL,
  principal_amount numeric(20,6) NOT NULL,
  interest_amount numeric(20,6) NOT NULL DEFAULT 0,
  amount numeric(20,6) NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','deducted','skipped','waived','prepaid')),
  payroll_run_id uuid,
  note text,
  UNIQUE (loan_id, sequence)
);

CREATE TABLE IF NOT EXISTS tenant.hr_final_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  settlement_number text NOT NULL,
  employee_id uuid NOT NULL REFERENCES tenant.hr_employees(id),
  separation_id uuid REFERENCES tenant.hr_separations(id),
  last_working_day date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','paid','cancelled')),
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_earnings numeric(20,6) NOT NULL DEFAULT 0,
  total_recoveries numeric(20,6) NOT NULL DEFAULT 0,
  net_amount numeric(20,6) NOT NULL DEFAULT 0,
  notes text,
  created_by uuid NOT NULL,
  submitted_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  payroll_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, settlement_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS hr_final_settlements_open_uq ON tenant.hr_final_settlements (employee_id) WHERE status IN ('draft','pending_approval','approved');

CREATE TABLE IF NOT EXISTS tenant.hr_bank_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  payroll_run_id uuid NOT NULL REFERENCES tenant.hr_payroll_runs(id),
  file_number text NOT NULL,
  file_format text NOT NULL DEFAULT 'neft_csv',
  record_count integer NOT NULL,
  total_amount numeric(20,6) NOT NULL,
  checksum text NOT NULL,
  content text NOT NULL,
  skipped jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'generated' CHECK (status IN ('generated','acknowledged','cancelled')),
  utr_reference text,
  generated_by uuid NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  UNIQUE (organization_id, file_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS hr_bank_files_active_uq ON tenant.hr_bank_files (payroll_run_id) WHERE status IN ('generated','acknowledged');

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['hr_payroll_inputs','hr_expense_categories','hr_loans','hr_loan_installments','hr_final_settlements','hr_bank_files'] LOOP
  EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.%I', t);
  EXECUTE format('CREATE POLICY tenant_organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', t);
END LOOP; END $$;

COMMIT;
