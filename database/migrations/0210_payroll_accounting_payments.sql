-- HR & Payroll — posting to Finance, salary and statutory payments, payslip publishing and closing (MVP 39). Additive:
--   1. the run's further states (partially_paid, closed) and the journal it posted; the payslip's payment status (unpaid / partially paid /
--      paid / payment exception), what was paid and when it was published to the employee;
--   2. hr_salary_payments + lines: money actually paid to employees for a run (each payment posts once to Finance: Dr Salaries payable,
--      Cr the bank or cash account); a bank's rejection is a payment exception on the payslip, paid again later;
--   3. hr_statutory_payments: TDS / EPF / ESI / PT deposited (challans), never more than is owed;
--   4. permissions hr_payroll.payment.record and hr_payroll.statutory.pay, with role grants.
-- Re-runnable.

-- ============================================================ 1. runs and payslips
ALTER TABLE tenant.hr_payroll_runs DROP CONSTRAINT IF EXISTS hr_payroll_runs_status_check;
ALTER TABLE tenant.hr_payroll_runs ADD CONSTRAINT hr_payroll_runs_status_check
  CHECK (status IN ('draft', 'calculated', 'pending_approval', 'approved', 'posted', 'partially_paid', 'paid', 'closed', 'cancelled'));
ALTER TABLE tenant.hr_payroll_runs
  ADD COLUMN IF NOT EXISTS journal_entry_id uuid,
  ADD COLUMN IF NOT EXISTS paid_amount numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS closed_by uuid,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS unposted_reason text;
ALTER TABLE tenant.hr_payslips
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'UNPAID',
  ADD COLUMN IF NOT EXISTS paid_amount numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_exception text,
  ADD COLUMN IF NOT EXISTS published_at timestamptz;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hr_payslips_payment_status_check') THEN
    ALTER TABLE tenant.hr_payslips ADD CONSTRAINT hr_payslips_payment_status_check CHECK (payment_status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'PAYMENT_EXCEPTION'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hr_payslips_paid_check') THEN
    ALTER TABLE tenant.hr_payslips ADD CONSTRAINT hr_payslips_paid_check CHECK (paid_amount >= 0 AND paid_amount <= net_pay + 0.005);
  END IF;
END $$;
UPDATE tenant.hr_payslips SET published_at = released_at WHERE published_at IS NULL AND released_at IS NOT NULL;

-- ============================================================ 2. salary payments
CREATE TABLE IF NOT EXISTS tenant.hr_salary_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  payroll_run_id uuid NOT NULL REFERENCES tenant.hr_payroll_runs(id),
  payment_number text NOT NULL,
  payment_date date NOT NULL,
  paid_from_account_id uuid NOT NULL,
  method text NOT NULL DEFAULT 'bank_transfer' CHECK (method IN ('bank_transfer', 'cheque', 'cash')),
  reference text,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  journal_entry_id uuid,
  idempotency_key text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id, payment_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS hr_salary_payments_key_uidx ON tenant.hr_salary_payments (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS tenant.hr_salary_payment_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  payment_id uuid NOT NULL REFERENCES tenant.hr_salary_payments(id),
  payslip_id uuid NOT NULL REFERENCES tenant.hr_payslips(id),
  employee_id uuid NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0)
);
CREATE INDEX IF NOT EXISTS hr_salary_payment_lines_slip_idx ON tenant.hr_salary_payment_lines (payslip_id);

-- ============================================================ 3. statutory payments
CREATE TABLE IF NOT EXISTS tenant.hr_statutory_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('tds', 'epf', 'esi', 'pt')),
  pay_month date NOT NULL,
  challan_number text NOT NULL,
  payment_date date NOT NULL,
  paid_from_account_id uuid NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  journal_entry_id uuid,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id, kind, challan_number)
);

DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['hr_salary_payments', 'hr_salary_payment_lines', 'hr_statutory_payments'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
-- Payments are never edited or deleted: a wrong one is reversed in Finance.
GRANT SELECT, INSERT ON tenant.hr_salary_payment_lines TO vercent_app, vercent_worker;
GRANT SELECT, INSERT, UPDATE (journal_entry_id) ON tenant.hr_salary_payments TO vercent_app, vercent_worker;
GRANT SELECT, INSERT, UPDATE (journal_entry_id) ON tenant.hr_statutory_payments TO vercent_app, vercent_worker;

-- ============================================================ 4. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('hr_payroll.payment.record', 'Record salary payments', 'HR & Payroll', 'Record the salaries actually paid for a payroll, and payment exceptions.'),
  ('hr_payroll.statutory.pay', 'Record statutory payments', 'HR & Payroll', 'Record TDS, EPF, ESI and Professional Tax deposited (challans).')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (
    SELECT slug, key FROM (VALUES ('hr_manager'), ('finance_manager'), ('system_administrator'), ('organization_owner')) AS r(slug)
      CROSS JOIN (VALUES ('hr_payroll.payment.record'), ('hr_payroll.statutory.pay')) AS k(key)
    UNION ALL SELECT 'accountant', 'hr_payroll.payment.record'
    UNION ALL SELECT 'finance_manager', 'hr_payroll.payroll.post'
  ) AS grant_row ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0210_payroll_accounting_payments.sql', 'payroll-accounting-payments') ON CONFLICT DO NOTHING;
