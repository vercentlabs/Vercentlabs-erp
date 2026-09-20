BEGIN;

-- F381-F396 workforce: settings, document types and documents, effective-dated employee changes
-- (transfer / promotion / confirmation / probation extension), lifecycle checklists, separation,
-- and employee self-service profile change requests.

ALTER TABLE tenant.hr_payroll_settings
  ADD COLUMN IF NOT EXISTS employee_number_prefix text NOT NULL DEFAULT 'EMP',
  ADD COLUMN IF NOT EXISTS employee_number_padding integer NOT NULL DEFAULT 5 CHECK (employee_number_padding BETWEEN 3 AND 10),
  ADD COLUMN IF NOT EXISTS default_probation_months integer NOT NULL DEFAULT 6 CHECK (default_probation_months BETWEEN 0 AND 24),
  ADD COLUMN IF NOT EXISTS default_notice_days integer NOT NULL DEFAULT 30 CHECK (default_notice_days BETWEEN 0 AND 365),
  ADD COLUMN IF NOT EXISTS require_documents_for_joining boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS onboarding_checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS offboarding_checklist jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE tenant.hr_employees DROP CONSTRAINT IF EXISTS hr_employees_status_check;
ALTER TABLE tenant.hr_employees ADD CONSTRAINT hr_employees_status_check
  CHECK (status IN ('draft','active','on_leave','suspended','on_notice','separated'));
ALTER TABLE tenant.hr_employees
  ADD COLUMN IF NOT EXISTS grade text,
  ADD COLUMN IF NOT EXISTS work_location text,
  ADD COLUMN IF NOT EXISTS notice_period_days integer NOT NULL DEFAULT 30 CHECK (notice_period_days >= 0),
  ADD COLUMN IF NOT EXISTS probation_status text NOT NULL DEFAULT 'not_applicable'
    CHECK (probation_status IN ('not_applicable','on_probation','extended','confirmed')),
  ADD COLUMN IF NOT EXISTS last_working_date date,
  ADD COLUMN IF NOT EXISTS joined_at timestamptz;

CREATE TABLE IF NOT EXISTS tenant.hr_document_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  required_for_joining boolean NOT NULL DEFAULT false,
  expiry_tracked boolean NOT NULL DEFAULT false,
  sensitive boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, company_id, code)
);

CREATE TABLE IF NOT EXISTS tenant.hr_employee_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES tenant.hr_employees(id),
  document_type_id uuid NOT NULL REFERENCES tenant.hr_document_types(id),
  title text NOT NULL,
  file_reference text NOT NULL,
  file_name text,
  mime_type text,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  issued_on date,
  expires_on date,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','verified','rejected','removed')),
  verified_by uuid,
  verified_at timestamptz,
  review_note text,
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_employee_documents_employee_idx ON tenant.hr_employee_documents (organization_id, employee_id, status);

CREATE TABLE IF NOT EXISTS tenant.hr_employee_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES tenant.hr_employees(id),
  change_type text NOT NULL CHECK (change_type IN ('transfer','promotion','confirmation','probation_extension')),
  effective_date date NOT NULL,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  before_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  proposed_annual_ctc numeric(20,6) CHECK (proposed_annual_ctc IS NULL OR proposed_annual_ctc >= 0),
  reason text,
  status text NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval','approved','applied','rejected','cancelled')),
  requested_by uuid NOT NULL,
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_employee_changes_idx ON tenant.hr_employee_changes (organization_id, company_id, status, effective_date);

CREATE TABLE IF NOT EXISTS tenant.hr_lifecycle_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES tenant.hr_employees(id),
  kind text NOT NULL CHECK (kind IN ('onboarding','offboarding')),
  title text NOT NULL,
  owner_label text,
  assignee_user_id uuid,
  mandatory boolean NOT NULL DEFAULT true,
  due_date date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','waived')),
  completed_by uuid,
  completed_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_lifecycle_tasks_idx ON tenant.hr_lifecycle_tasks (organization_id, employee_id, kind, status);

CREATE TABLE IF NOT EXISTS tenant.hr_separations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES tenant.hr_employees(id),
  separation_type text NOT NULL CHECK (separation_type IN ('resignation','termination','retirement','end_of_contract','absconding','death')),
  notice_date date NOT NULL,
  requested_last_day date,
  last_working_day date,
  reason text,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','accepted','completed','rejected','withdrawn')),
  initiated_by uuid NOT NULL,
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  exit_interview jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_by uuid,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS hr_separations_open_uq ON tenant.hr_separations (organization_id, employee_id) WHERE status IN ('submitted','accepted');

CREATE TABLE IF NOT EXISTS tenant.hr_profile_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES tenant.hr_employees(id),
  field_group text NOT NULL CHECK (field_group IN ('bank_details','tax_identifiers','statutory_identifiers')),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requested_by uuid NOT NULL,
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['hr_document_types','hr_employee_documents','hr_employee_changes','hr_lifecycle_tasks','hr_separations','hr_profile_change_requests'] LOOP
  EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.%I', t);
  EXECUTE format('CREATE POLICY tenant_organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', t);
END LOOP; END $$;

COMMIT;
