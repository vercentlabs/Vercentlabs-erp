-- HR & Payroll — statutory deductions and variable pay (MVP 38). Rebuilt over tenant.hr_statutory_components / hr_statutory_slabs /
-- hr_payroll_inputs (additive):
--   1. statutory rule versions: a rule family (EPF, ESI, PT for one state, TDS for one regime) with numbered versions, effective dates and a
--      verification: a version is DRAFT until someone other than its author verifies it against the current law and activates it; payroll uses
--      only ACTIVE versions in force on the period's last day (an employee they apply to without one is a blocking exception);
--   2. opening year-to-date figures per employee and financial year (cut-over, previous employment) used by TDS;
--   3. variable pay inputs: their reviewer, the run that used them, and the salary component they post as;
--   4. payslip lines: the rule version behind each statutory line;
--   5. permissions hr_payroll.statutory.verify / hr_payroll.inputs.manage / inputs.approve / ytd.manage, with role grants.
-- Earlier statutory rows were never used by the calculation: they become drafts to verify. Re-runnable.

-- ============================================================ 1. rule versions
ALTER TABLE tenant.hr_statutory_components
  ADD COLUMN IF NOT EXISTS rule_family text,
  ADD COLUMN IF NOT EXISTS version_number integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS tax_regime text,
  ADD COLUMN IF NOT EXISTS financial_year text,
  ADD COLUMN IF NOT EXISTS source_reference text,
  ADD COLUMN IF NOT EXISTS verified_by uuid,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_note text,
  ADD COLUMN IF NOT EXISTS retired_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT clock_timestamp();
UPDATE tenant.hr_statutory_components SET rule_family = upper(statutory_type) || CASE WHEN statutory_type = 'professional_tax' THEN '-' || upper(COALESCE(state, jurisdiction, 'XX')) ELSE '' END
 WHERE rule_family IS NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hr_statutory_components_status_check') THEN
    ALTER TABLE tenant.hr_statutory_components ADD CONSTRAINT hr_statutory_components_status_check CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hr_statutory_components_regime_check') THEN
    ALTER TABLE tenant.hr_statutory_components ADD CONSTRAINT hr_statutory_components_regime_check CHECK (tax_regime IS NULL OR tax_regime IN ('new', 'old'));
  END IF;
  -- An active version was verified, by someone.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hr_statutory_components_verified_check') THEN
    ALTER TABLE tenant.hr_statutory_components ADD CONSTRAINT hr_statutory_components_verified_check CHECK (status <> 'ACTIVE' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS hr_statutory_components_version_uidx ON tenant.hr_statutory_components (organization_id, rule_family, version_number) WHERE rule_family IS NOT NULL;
CREATE INDEX IF NOT EXISTS hr_statutory_components_active_idx ON tenant.hr_statutory_components (organization_id, rule_family, status, effective_from);
GRANT SELECT, INSERT, UPDATE ON tenant.hr_statutory_components TO vercent_app, vercent_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.hr_statutory_slabs TO vercent_app, vercent_worker;

-- ============================================================ 2. opening year-to-date figures
CREATE TABLE IF NOT EXISTS tenant.hr_payroll_ytd_openings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES tenant.hr_employees(id),
  financial_year text NOT NULL CHECK (financial_year ~ '^\d{4}-\d{2}$'),
  source text NOT NULL DEFAULT 'CUT_OVER' CHECK (source IN ('CUT_OVER', 'PREVIOUS_EMPLOYER')),
  employer_name text,
  gross_earnings numeric(18,2) NOT NULL DEFAULT 0 CHECK (gross_earnings >= 0),
  taxable_earnings numeric(18,2) NOT NULL DEFAULT 0 CHECK (taxable_earnings >= 0),
  tds_deducted numeric(18,2) NOT NULL DEFAULT 0 CHECK (tds_deducted >= 0),
  epf_employee numeric(18,2) NOT NULL DEFAULT 0 CHECK (epf_employee >= 0),
  professional_tax numeric(18,2) NOT NULL DEFAULT 0 CHECK (professional_tax >= 0),
  note text,
  entered_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id, employee_id, financial_year, source)
);

-- ============================================================ 3. variable pay inputs
ALTER TABLE tenant.hr_payroll_inputs
  ADD COLUMN IF NOT EXISTS reference text,
  ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS hr_payroll_inputs_month_idx ON tenant.hr_payroll_inputs (organization_id, employee_id, pay_month, status);
GRANT SELECT, INSERT, UPDATE ON tenant.hr_payroll_inputs TO vercent_app, vercent_worker;

-- ============================================================ 4. payslip lines
ALTER TABLE tenant.hr_payslip_lines ADD COLUMN IF NOT EXISTS rule_detail jsonb;

DO $$
BEGIN
  ALTER TABLE tenant.hr_payroll_ytd_openings ENABLE ROW LEVEL SECURITY;
  ALTER TABLE tenant.hr_payroll_ytd_openings FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'hr_payroll_ytd_openings' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.hr_payroll_ytd_openings USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.hr_payroll_ytd_openings TO vercent_app, vercent_worker;

-- ============================================================ 5. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('hr_payroll.statutory.verify', 'Verify statutory rules', 'HR & Payroll', 'Verify a statutory rule version against the current law and make it active for payroll.'),
  ('hr_payroll.inputs.manage', 'Enter variable pay', 'HR & Payroll', 'Enter bonuses, incentives, allowances, recoveries and other one-time pay items.'),
  ('hr_payroll.inputs.approve', 'Approve variable pay', 'HR & Payroll', 'Approve or reject variable pay items before they are paid.'),
  ('hr_payroll.ytd.manage', 'Enter opening year-to-date pay', 'HR & Payroll', 'Record earnings and tax already paid this financial year (cut-over or previous employer).')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (
    SELECT slug, key FROM (VALUES ('hr_manager'), ('system_administrator'), ('organization_owner')) AS r(slug)
      CROSS JOIN (VALUES ('hr_payroll.statutory.verify'), ('hr_payroll.inputs.manage'), ('hr_payroll.inputs.approve'), ('hr_payroll.ytd.manage')) AS k(key)
    UNION ALL
    SELECT * FROM (VALUES ('finance_manager', 'hr_payroll.inputs.approve'), ('accountant', 'hr_payroll.inputs.manage')) AS pair(slug, key)
  ) AS grant_row ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0209_payroll_statutory.sql', 'payroll-statutory') ON CONFLICT DO NOTHING;
