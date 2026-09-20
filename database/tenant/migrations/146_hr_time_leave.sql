BEGIN;

-- F403-F417 time and leave: shift assignment, punches and attendance rules, regularization,
-- overtime, holiday calendars, leave policies, an append-only leave ledger, accrual, carry forward,
-- leave requests and approval.

ALTER TABLE tenant.hr_payroll_settings
  ADD COLUMN IF NOT EXISTS overtime_threshold_minutes integer NOT NULL DEFAULT 30 CHECK (overtime_threshold_minutes >= 0),
  ADD COLUMN IF NOT EXISTS half_day_percent integer NOT NULL DEFAULT 50 CHECK (half_day_percent BETWEEN 1 AND 99),
  ADD COLUMN IF NOT EXISTS full_day_percent integer NOT NULL DEFAULT 90 CHECK (full_day_percent BETWEEN 1 AND 100),
  ADD COLUMN IF NOT EXISTS late_marks_per_deduction integer NOT NULL DEFAULT 0 CHECK (late_marks_per_deduction >= 0),
  ADD COLUMN IF NOT EXISTS regularization_limit_per_month integer NOT NULL DEFAULT 5 CHECK (regularization_limit_per_month >= 0),
  ADD COLUMN IF NOT EXISTS sandwich_rule boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS leave_year_start_month integer NOT NULL DEFAULT 1 CHECK (leave_year_start_month BETWEEN 1 AND 12),
  ADD COLUMN IF NOT EXISTS overtime_multiplier numeric(6,2) NOT NULL DEFAULT 2 CHECK (overtime_multiplier >= 1);

CREATE TABLE IF NOT EXISTS tenant.hr_holiday_calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, company_id, code)
);
CREATE UNIQUE INDEX IF NOT EXISTS hr_holiday_calendars_default_uq ON tenant.hr_holiday_calendars (organization_id, company_id) WHERE is_default;

CREATE TABLE IF NOT EXISTS tenant.hr_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  calendar_id uuid NOT NULL REFERENCES tenant.hr_holiday_calendars(id) ON DELETE CASCADE,
  holiday_date date NOT NULL,
  name text NOT NULL,
  holiday_type text NOT NULL DEFAULT 'public' CHECK (holiday_type IN ('public','optional','restricted')),
  created_by uuid NOT NULL,
  UNIQUE (calendar_id, holiday_date)
);

CREATE TABLE IF NOT EXISTS tenant.hr_leave_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  employment_types text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, company_id, code)
);

ALTER TABLE tenant.hr_leave_types
  ADD COLUMN IF NOT EXISTS half_day_allowed boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS min_notice_days integer NOT NULL DEFAULT 0 CHECK (min_notice_days >= 0),
  ADD COLUMN IF NOT EXISTS max_consecutive_days numeric(10,4) CHECK (max_consecutive_days IS NULL OR max_consecutive_days > 0),
  ADD COLUMN IF NOT EXISTS allow_negative_balance boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS applicable_gender text NOT NULL DEFAULT 'any' CHECK (applicable_gender IN ('any','female','male')),
  ADD COLUMN IF NOT EXISTS counts_weekends boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS tenant.hr_leave_policy_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  policy_id uuid NOT NULL REFERENCES tenant.hr_leave_policies(id) ON DELETE CASCADE,
  leave_type_id uuid NOT NULL REFERENCES tenant.hr_leave_types(id),
  annual_days numeric(10,4) NOT NULL CHECK (annual_days >= 0),
  accrual_frequency text NOT NULL DEFAULT 'monthly' CHECK (accrual_frequency IN ('upfront','monthly','quarterly','yearly','none')),
  max_balance numeric(10,4) CHECK (max_balance IS NULL OR max_balance >= 0),
  carry_forward_limit numeric(10,4) NOT NULL DEFAULT 0 CHECK (carry_forward_limit >= 0),
  eligible_after_days integer NOT NULL DEFAULT 0 CHECK (eligible_after_days >= 0),
  UNIQUE (policy_id, leave_type_id)
);

ALTER TABLE tenant.hr_employees
  ADD COLUMN IF NOT EXISTS holiday_calendar_id uuid REFERENCES tenant.hr_holiday_calendars(id),
  ADD COLUMN IF NOT EXISTS leave_policy_id uuid REFERENCES tenant.hr_leave_policies(id);

ALTER TABLE tenant.hr_attendance DROP CONSTRAINT IF EXISTS hr_attendance_source_check;
ALTER TABLE tenant.hr_attendance ADD CONSTRAINT hr_attendance_source_check CHECK (source IN ('manual','biometric','mobile','web','import','regularized','system'));
ALTER TABLE tenant.hr_attendance
  ADD COLUMN IF NOT EXISTS leave_request_id uuid,
  ADD COLUMN IF NOT EXISTS half_day_part text CHECK (half_day_part IS NULL OR half_day_part IN ('first','second')),
  ADD COLUMN IF NOT EXISTS override_reason text;

CREATE TABLE IF NOT EXISTS tenant.hr_attendance_punches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES tenant.hr_employees(id),
  punched_at timestamptz NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in','out')),
  source text NOT NULL DEFAULT 'web' CHECK (source IN ('web','mobile','biometric','import','regularized')),
  latitude numeric(9,6),
  longitude numeric(9,6),
  note text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_attendance_punches_idx ON tenant.hr_attendance_punches (organization_id, employee_id, punched_at);

CREATE TABLE IF NOT EXISTS tenant.hr_attendance_regularizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES tenant.hr_employees(id),
  attendance_date date NOT NULL,
  requested_check_in timestamptz,
  requested_check_out timestamptz,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  requested_by uuid NOT NULL,
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (requested_check_in IS NOT NULL OR requested_check_out IS NOT NULL),
  CHECK (requested_check_in IS NULL OR requested_check_out IS NULL OR requested_check_out > requested_check_in)
);
CREATE UNIQUE INDEX IF NOT EXISTS hr_regularizations_open_uq ON tenant.hr_attendance_regularizations (organization_id, employee_id, attendance_date) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS tenant.hr_overtime (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES tenant.hr_employees(id),
  work_date date NOT NULL,
  minutes integer NOT NULL CHECK (minutes > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','paid')),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  payroll_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_date)
);

CREATE TABLE IF NOT EXISTS tenant.hr_leave_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES tenant.hr_employees(id),
  leave_type_id uuid NOT NULL REFERENCES tenant.hr_leave_types(id),
  leave_year integer NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('opening','accrual','usage','reversal','carry_forward','lapse','adjustment','encashment')),
  days numeric(10,4) NOT NULL,
  period_key text,
  reference_id uuid,
  note text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_leave_ledger_idx ON tenant.hr_leave_ledger (organization_id, employee_id, leave_type_id, leave_year);
CREATE UNIQUE INDEX IF NOT EXISTS hr_leave_ledger_period_uq ON tenant.hr_leave_ledger (employee_id, leave_type_id, leave_year, entry_type, period_key) WHERE period_key IS NOT NULL;

ALTER TABLE tenant.hr_leave_requests
  ADD COLUMN IF NOT EXISTS start_half boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS end_half boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS leave_year integer,
  ADD COLUMN IF NOT EXISTS balance_deducted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text;

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['hr_holiday_calendars','hr_holidays','hr_leave_policies','hr_leave_policy_entries','hr_attendance_punches','hr_attendance_regularizations','hr_overtime','hr_leave_ledger'] LOOP
  EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.%I', t);
  EXECUTE format('CREATE POLICY tenant_organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', t);
END LOOP; END $$;

COMMIT;
