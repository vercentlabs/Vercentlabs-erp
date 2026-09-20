BEGIN;

-- F397-F402 recruitment: job openings, candidates, the application pipeline, interviews with
-- structured feedback, offers with approval, and conversion of an accepted offer to an employee.

CREATE TABLE IF NOT EXISTS tenant.hr_job_openings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  opening_number text NOT NULL,
  title text NOT NULL,
  department_id uuid REFERENCES tenant.hr_departments(id),
  designation_id uuid REFERENCES tenant.hr_designations(id),
  hiring_manager_employee_id uuid REFERENCES tenant.hr_employees(id),
  employment_type text NOT NULL DEFAULT 'permanent' CHECK (employment_type IN ('permanent','contract','intern','consultant','part_time','temporary')),
  location text,
  positions integer NOT NULL DEFAULT 1 CHECK (positions > 0),
  filled integer NOT NULL DEFAULT 0 CHECK (filled >= 0),
  description text,
  requirements text,
  salary_min numeric(20,6) CHECK (salary_min IS NULL OR salary_min >= 0),
  salary_max numeric(20,6) CHECK (salary_max IS NULL OR salary_max >= 0),
  target_close_date date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','open','on_hold','closed','cancelled')),
  requested_by uuid NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  opened_at timestamptz,
  closed_at timestamptz,
  close_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, opening_number),
  CHECK (salary_max IS NULL OR salary_min IS NULL OR salary_max >= salary_min),
  CHECK (filled <= positions)
);

CREATE TABLE IF NOT EXISTS tenant.hr_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  candidate_number text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL,
  phone text,
  source text NOT NULL DEFAULT 'other' CHECK (source IN ('referral','portal','agency','campus','social','walk_in','other')),
  referred_by_employee_id uuid REFERENCES tenant.hr_employees(id),
  current_employer text,
  current_title text,
  experience_years numeric(5,2) CHECK (experience_years IS NULL OR experience_years >= 0),
  current_ctc numeric(20,6) CHECK (current_ctc IS NULL OR current_ctc >= 0),
  expected_ctc numeric(20,6) CHECK (expected_ctc IS NULL OR expected_ctc >= 0),
  notice_period_days integer CHECK (notice_period_days IS NULL OR notice_period_days >= 0),
  resume_reference text,
  skills text[] NOT NULL DEFAULT '{}',
  notes text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','hired','rejected','withdrawn')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, candidate_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS hr_candidates_email_uq ON tenant.hr_candidates (organization_id, lower(email));

CREATE TABLE IF NOT EXISTS tenant.hr_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  opening_id uuid NOT NULL REFERENCES tenant.hr_job_openings(id),
  candidate_id uuid NOT NULL REFERENCES tenant.hr_candidates(id),
  stage text NOT NULL DEFAULT 'applied' CHECK (stage IN ('applied','screening','interview','offer','hired','rejected','withdrawn')),
  stage_changed_at timestamptz NOT NULL DEFAULT now(),
  reason text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (opening_id, candidate_id)
);
CREATE INDEX IF NOT EXISTS hr_applications_stage_idx ON tenant.hr_applications (organization_id, opening_id, stage);

CREATE TABLE IF NOT EXISTS tenant.hr_interviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  application_id uuid NOT NULL REFERENCES tenant.hr_applications(id),
  round_number integer NOT NULL CHECK (round_number > 0),
  interview_type text NOT NULL DEFAULT 'technical' CHECK (interview_type IN ('phone','technical','managerial','hr','panel')),
  interviewer_employee_id uuid NOT NULL REFERENCES tenant.hr_employees(id),
  scheduled_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 45 CHECK (duration_minutes BETWEEN 10 AND 480),
  mode text NOT NULL DEFAULT 'video' CHECK (mode IN ('video','onsite','phone')),
  location text,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled','no_show')),
  rating integer CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  recommendation text CHECK (recommendation IS NULL OR recommendation IN ('strong_yes','yes','no','strong_no')),
  feedback text,
  feedback_by uuid,
  feedback_at timestamptz,
  cancel_reason text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_interviews_slot_idx ON tenant.hr_interviews (organization_id, interviewer_employee_id, scheduled_at);

CREATE TABLE IF NOT EXISTS tenant.hr_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  offer_number text NOT NULL,
  application_id uuid NOT NULL REFERENCES tenant.hr_applications(id),
  designation_id uuid REFERENCES tenant.hr_designations(id),
  department_id uuid REFERENCES tenant.hr_departments(id),
  employment_type text NOT NULL DEFAULT 'permanent' CHECK (employment_type IN ('permanent','contract','intern','consultant','part_time','temporary')),
  annual_ctc numeric(20,6) NOT NULL CHECK (annual_ctc > 0),
  joining_date date NOT NULL,
  valid_until date NOT NULL,
  terms text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','sent','accepted','declined','expired','withdrawn')),
  created_by uuid NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  sent_at timestamptz,
  decided_at timestamptz,
  decision_note text,
  employee_id uuid REFERENCES tenant.hr_employees(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, offer_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS hr_offers_open_uq ON tenant.hr_offers (application_id) WHERE status IN ('draft','pending_approval','approved','sent','accepted');

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['hr_job_openings','hr_candidates','hr_applications','hr_interviews','hr_offers'] LOOP
  EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.%I', t);
  EXECUTE format('CREATE POLICY tenant_organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', t);
END LOOP; END $$;

COMMIT;
