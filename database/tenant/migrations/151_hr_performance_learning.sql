BEGIN;

-- F448-F452 performance and learning: goals (with cascading/alignment and check-ins), a review-cycle
-- driven appraisal with self, manager and (optional) peer input, a skills registry with employee
-- proficiency, and training (courses, sessions and enrolment/completion).

CREATE TABLE IF NOT EXISTS tenant.hr_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES tenant.hr_employees(id),
  parent_goal_id uuid REFERENCES tenant.hr_goals(id),
  title text NOT NULL,
  description text,
  metric_type text NOT NULL DEFAULT 'percent' CHECK (metric_type IN ('percent','number','boolean')),
  target_value numeric(14,2) NOT NULL DEFAULT 100,
  current_value numeric(14,2) NOT NULL DEFAULT 0,
  weight integer NOT NULL DEFAULT 100 CHECK (weight BETWEEN 1 AND 100),
  start_date date NOT NULL,
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','completed','missed','cancelled')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (due_date >= start_date)
);
CREATE INDEX IF NOT EXISTS hr_goals_employee_idx ON tenant.hr_goals (organization_id, employee_id, status);

CREATE TABLE IF NOT EXISTS tenant.hr_goal_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  goal_id uuid NOT NULL REFERENCES tenant.hr_goals(id) ON DELETE CASCADE,
  checkin_date date NOT NULL DEFAULT current_date,
  value numeric(14,2) NOT NULL,
  note text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant.hr_review_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  self_review boolean NOT NULL DEFAULT true,
  peer_review boolean NOT NULL DEFAULT false,
  rating_scale integer NOT NULL DEFAULT 5 CHECK (rating_scale BETWEEN 3 AND 10),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, company_id, code),
  CHECK (period_end >= period_start)
);

CREATE TABLE IF NOT EXISTS tenant.hr_appraisals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  cycle_id uuid NOT NULL REFERENCES tenant.hr_review_cycles(id),
  employee_id uuid NOT NULL REFERENCES tenant.hr_employees(id),
  reviewer_employee_id uuid NOT NULL REFERENCES tenant.hr_employees(id),
  status text NOT NULL DEFAULT 'pending_self' CHECK (status IN ('pending_self','pending_manager','pending_calibration','completed','cancelled')),
  goal_score numeric(6,2),
  self_rating numeric(4,2),
  self_comments text,
  self_submitted_at timestamptz,
  manager_rating numeric(4,2),
  manager_comments text,
  manager_submitted_at timestamptz,
  final_rating numeric(4,2),
  final_comments text,
  calibrated_by uuid,
  completed_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, employee_id)
);
CREATE INDEX IF NOT EXISTS hr_appraisals_reviewer_idx ON tenant.hr_appraisals (organization_id, reviewer_employee_id, status);

CREATE TABLE IF NOT EXISTS tenant.hr_appraisal_peer_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  appraisal_id uuid NOT NULL REFERENCES tenant.hr_appraisals(id) ON DELETE CASCADE,
  peer_employee_id uuid NOT NULL REFERENCES tenant.hr_employees(id),
  rating numeric(4,2),
  comments text NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (appraisal_id, peer_employee_id)
);

CREATE TABLE IF NOT EXISTS tenant.hr_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  category text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, company_id, code)
);

CREATE TABLE IF NOT EXISTS tenant.hr_employee_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES tenant.hr_employees(id),
  skill_id uuid NOT NULL REFERENCES tenant.hr_skills(id),
  proficiency integer NOT NULL CHECK (proficiency BETWEEN 1 AND 5),
  self_rated boolean NOT NULL DEFAULT true,
  assessed_by uuid,
  assessed_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  UNIQUE (employee_id, skill_id)
);

CREATE TABLE IF NOT EXISTS tenant.hr_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL,
  title text NOT NULL,
  description text,
  category text,
  provider text,
  duration_hours numeric(6,1) CHECK (duration_hours IS NULL OR duration_hours > 0),
  skill_id uuid REFERENCES tenant.hr_skills(id),
  mandatory boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, company_id, code)
);

CREATE TABLE IF NOT EXISTS tenant.hr_training_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  course_id uuid NOT NULL REFERENCES tenant.hr_courses(id),
  session_code text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  location text,
  trainer text,
  capacity integer CHECK (capacity IS NULL OR capacity > 0),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, session_code),
  CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS tenant.hr_training_enrolments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  session_id uuid NOT NULL REFERENCES tenant.hr_training_sessions(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES tenant.hr_employees(id),
  status text NOT NULL DEFAULT 'enrolled' CHECK (status IN ('enrolled','attended','no_show','cancelled')),
  score numeric(6,2),
  feedback text,
  enrolled_by uuid NOT NULL,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (session_id, employee_id)
);
CREATE INDEX IF NOT EXISTS hr_training_enrolments_employee_idx ON tenant.hr_training_enrolments (organization_id, employee_id, status);

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['hr_goals','hr_goal_checkins','hr_review_cycles','hr_appraisals','hr_appraisal_peer_feedback','hr_skills','hr_employee_skills','hr_courses','hr_training_sessions','hr_training_enrolments'] LOOP
  EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.%I', t);
  EXECUTE format('CREATE POLICY tenant_organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', t);
END LOOP; END $$;

COMMIT;
