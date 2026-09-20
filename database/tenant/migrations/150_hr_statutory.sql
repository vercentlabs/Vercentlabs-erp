BEGIN;

-- F439-F447 statutory compliance: PF, ESIC, professional tax, TDS, labour welfare fund, gratuity,
-- statutory reports, state-specific configuration and compliance reports.

ALTER TABLE tenant.hr_statutory_components
  ADD COLUMN IF NOT EXISTS calculation_basis text NOT NULL DEFAULT 'percentage_of_wage' CHECK (calculation_basis IN ('percentage_of_wage','flat_amount','slab')),
  ADD COLUMN IF NOT EXISTS wage_basis text NOT NULL DEFAULT 'gross' CHECK (wage_basis IN ('pf_wage','esic_wage','gross','net')),
  ADD COLUMN IF NOT EXISTS frequency text NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly','half_yearly','yearly')),
  ADD COLUMN IF NOT EXISTS employee_flat_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (employee_flat_amount >= 0),
  ADD COLUMN IF NOT EXISTS employer_flat_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (employer_flat_amount >= 0),
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS due_day integer CHECK (due_day IS NULL OR due_day BETWEEN 1 AND 28),
  ADD COLUMN IF NOT EXISTS statutory_account_id uuid;

-- Slab-based components (professional tax, TDS): each row is one income bracket.
CREATE TABLE IF NOT EXISTS tenant.hr_statutory_slabs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  statutory_component_id uuid NOT NULL REFERENCES tenant.hr_statutory_components(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  from_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (from_amount >= 0),
  to_amount numeric(20,6) CHECK (to_amount IS NULL OR to_amount >= from_amount),
  flat_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (flat_amount >= 0),
  rate_percent numeric(7,4) NOT NULL DEFAULT 0 CHECK (rate_percent >= 0),
  UNIQUE (statutory_component_id, sequence)
);

-- Gratuity (F444): a computed estimate/payment record per employee, populated on final settlement
-- or on request (an accrual estimate while still employed).
CREATE TABLE IF NOT EXISTS tenant.hr_gratuity_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES tenant.hr_employees(id),
  as_of_date date NOT NULL,
  years_of_service numeric(6,2) NOT NULL,
  last_drawn_basic numeric(20,6) NOT NULL,
  eligible boolean NOT NULL DEFAULT false,
  amount numeric(20,6) NOT NULL DEFAULT 0,
  capped boolean NOT NULL DEFAULT false,
  record_type text NOT NULL DEFAULT 'estimate' CHECK (record_type IN ('estimate','settlement')),
  settlement_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_gratuity_records_idx ON tenant.hr_gratuity_records (organization_id, employee_id, created_at);

ALTER TABLE tenant.hr_payroll_settings
  ADD COLUMN IF NOT EXISTS gratuity_ceiling numeric(20,6) NOT NULL DEFAULT 2000000,
  ADD COLUMN IF NOT EXISTS gratuity_min_years numeric(4,1) NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS gratuity_days_per_year integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS gratuity_month_days integer NOT NULL DEFAULT 26;

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['hr_statutory_slabs','hr_gratuity_records'] LOOP
  EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.%I', t);
  EXECUTE format('CREATE POLICY tenant_organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', t);
END LOOP; END $$;

COMMIT;
