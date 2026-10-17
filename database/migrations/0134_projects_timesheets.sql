-- Projects — Timesheets. Employees record the time they actually spent on a project (and, optionally, one of its tasks); a weekly
-- submission per project goes to that project's manager, who approves it or returns it for changes. Approved time is locked: it changes
-- only through an authorized, append-only correction. Approved hours carry the internal labor rate effective on their work date (a
-- snapshot, never repriced), and approved billable hours on a time-and-materials project can be handed to Sales — each minute at most once.
-- Timesheets records the work; Sales and Finance own invoices, payroll and the ledger.
--
--   1. policy          the project's billing method (non-billable, fixed price, time and materials) and the company's time policy: the
--                      week start, the daily review and hard limits, the duration increment, the submission deadline, late submissions,
--                      date-only work on a hold or completion day, and whether team members other than the assignee log time on a task.
--   2. time entries    one employee's work on one date: duration in whole minutes (> 0), optional start and end (an interval matches its
--                      duration), the description, billable or not, the entry status, the submission it is in, the review flags, the rate
--                      snapshot once approved, and the correction it replaced.
--   3. submissions     one review version per employee, project and week; the exact entry versions it carried; one pending at a time.
--   4. corrections     an approved entry's correction: the original and proposed values, the reason, who asked and who decided, the
--                      cost and billing adjustments, the replacement entry.
--   5. labor rates     internal hourly cost rates per employee (optionally for one project), effective-dated and versioned.
--   6. billing         the minutes of approved billable time handed to Sales and the invoice line they were billed on; never more
--                      minutes than the entry's approved billable time.
--   7. history         every entry and submission event, append-only.
--   8. permissions     own time, team time, approval, corrections, cost, billing, export and labor rates.

-- ============================================================ 1. policy
ALTER TABLE tenant.projects ADD COLUMN IF NOT EXISTS billing_method text NOT NULL DEFAULT 'NON_BILLABLE';
ALTER TABLE tenant.projects ADD COLUMN IF NOT EXISTS billing_reference text;
ALTER TABLE tenant.projects ADD COLUMN IF NOT EXISTS billing_set_by uuid REFERENCES public.users(id);
ALTER TABLE tenant.projects ADD COLUMN IF NOT EXISTS billing_set_at timestamptz;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_billing_method_check' AND conrelid = 'tenant.projects'::regclass) THEN
    ALTER TABLE tenant.projects ADD CONSTRAINT projects_billing_method_check CHECK (billing_method IN ('NON_BILLABLE', 'FIXED_PRICE', 'TIME_AND_MATERIALS'));
  END IF;
END $$;

ALTER TABLE tenant.project_settings ADD COLUMN IF NOT EXISTS time_week_start smallint NOT NULL DEFAULT 1 CHECK (time_week_start BETWEEN 1 AND 7);
ALTER TABLE tenant.project_settings ADD COLUMN IF NOT EXISTS time_daily_review_minutes integer NOT NULL DEFAULT 600 CHECK (time_daily_review_minutes > 0);
ALTER TABLE tenant.project_settings ADD COLUMN IF NOT EXISTS time_daily_limit_minutes integer NOT NULL DEFAULT 1440 CHECK (time_daily_limit_minutes BETWEEN 60 AND 1440);
ALTER TABLE tenant.project_settings ADD COLUMN IF NOT EXISTS time_increment_minutes integer NOT NULL DEFAULT 1 CHECK (time_increment_minutes IN (1, 5, 6, 10, 15, 30));
ALTER TABLE tenant.project_settings ADD COLUMN IF NOT EXISTS time_submission_deadline_days integer NOT NULL DEFAULT 3 CHECK (time_submission_deadline_days BETWEEN 0 AND 60);
ALTER TABLE tenant.project_settings ADD COLUMN IF NOT EXISTS time_late_submission_allowed boolean NOT NULL DEFAULT true;
ALTER TABLE tenant.project_settings ADD COLUMN IF NOT EXISTS time_boundary_day_policy text NOT NULL DEFAULT 'REVIEW' CHECK (time_boundary_day_policy IN ('REVIEW', 'BLOCK'));
ALTER TABLE tenant.project_settings ADD COLUMN IF NOT EXISTS time_collaborators_allowed boolean NOT NULL DEFAULT true;

-- ============================================================ 2. time entries
CREATE TABLE IF NOT EXISTS tenant.project_time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  entry_number bigint GENERATED ALWAYS AS IDENTITY,
  employee_user_id uuid NOT NULL REFERENCES public.users(id),
  entered_by uuid REFERENCES public.users(id),
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  task_id uuid REFERENCES tenant.project_tasks(id),
  work_date date NOT NULL,
  start_at timestamptz,
  end_at timestamptz,
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0 AND duration_minutes <= 1440),
  description text NOT NULL CHECK (length(btrim(description)) >= 3),
  billable boolean NOT NULL DEFAULT false,
  entry_status text NOT NULL DEFAULT 'DRAFT' CHECK (entry_status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'CHANGES_REQUESTED', 'VOIDED')),
  submission_id uuid,
  review_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- The internal cost basis, fixed when the time is approved (or when a rate is first found for it); never repriced.
  cost_rate_id uuid,
  cost_rate numeric(20,6),
  cost_currency text,
  cost_amount numeric(20,6),
  cost_recorded_at timestamptz,
  corrects_entry_id uuid REFERENCES tenant.project_time_entries(id),
  correction_id uuid,
  approved_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  voided_by uuid REFERENCES public.users(id),
  voided_at timestamptz,
  void_reason text,
  create_key text,
  row_version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((start_at IS NULL) = (end_at IS NULL)),
  CHECK (start_at IS NULL OR (end_at > start_at AND round(extract(epoch FROM end_at - start_at) / 60) = duration_minutes)),
  CHECK (entry_status <> 'VOIDED' OR voided_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS project_time_entries_key_idx ON tenant.project_time_entries (organization_id, create_key) WHERE create_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_time_entries_employee_idx ON tenant.project_time_entries (organization_id, employee_user_id, work_date);
CREATE INDEX IF NOT EXISTS project_time_entries_project_idx ON tenant.project_time_entries (organization_id, project_id, work_date);
CREATE INDEX IF NOT EXISTS project_time_entries_task_idx ON tenant.project_time_entries (organization_id, task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_time_entries_submission_idx ON tenant.project_time_entries (organization_id, submission_id) WHERE submission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_time_entries_approved_idx ON tenant.project_time_entries (organization_id, project_id) WHERE entry_status = 'APPROVED';

-- ============================================================ 3. submissions
CREATE TABLE IF NOT EXISTS tenant.project_timesheet_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  submission_number bigint GENERATED ALWAYS AS IDENTITY,
  employee_user_id uuid NOT NULL REFERENCES public.users(id),
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  submission_version integer NOT NULL DEFAULT 1,
  previous_submission_id uuid REFERENCES tenant.project_timesheet_submissions(id),
  status text NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'APPROVED', 'CHANGES_REQUESTED')),
  -- The designated reviewer (the project manager), or NULL when any authorized approver other than the employee reviews it.
  approver_user_id uuid REFERENCES public.users(id),
  total_minutes integer NOT NULL DEFAULT 0,
  billable_minutes integer NOT NULL DEFAULT 0,
  entry_count integer NOT NULL DEFAULT 0,
  late boolean NOT NULL DEFAULT false,
  late_reason text,
  flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  submitted_by uuid REFERENCES public.users(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES public.users(id),
  decided_at timestamptz,
  decision_comment text,
  returned_entry_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key text,
  decision_key text,
  row_version integer NOT NULL DEFAULT 1,
  CHECK (period_end = period_start + 6),
  CHECK (status <> 'CHANGES_REQUESTED' OR length(btrim(COALESCE(decision_comment, ''))) >= 3)
);
CREATE UNIQUE INDEX IF NOT EXISTS project_timesheet_submissions_key_idx ON tenant.project_timesheet_submissions (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS project_timesheet_submissions_version_idx ON tenant.project_timesheet_submissions (organization_id, employee_user_id, project_id, period_start, submission_version);
-- One review pending per employee, project and week.
CREATE UNIQUE INDEX IF NOT EXISTS project_timesheet_submissions_pending_idx ON tenant.project_timesheet_submissions (organization_id, employee_user_id, project_id, period_start)
  WHERE status = 'SUBMITTED';
CREATE INDEX IF NOT EXISTS project_timesheet_submissions_queue_idx ON tenant.project_timesheet_submissions (organization_id, status, submitted_at);
CREATE INDEX IF NOT EXISTS project_timesheet_submissions_project_idx ON tenant.project_timesheet_submissions (organization_id, project_id, period_start);

-- The exact entry versions a submission carried (the approval checks the entries still match them).
CREATE TABLE IF NOT EXISTS tenant.project_timesheet_submission_entries (
  organization_id uuid NOT NULL,
  submission_id uuid NOT NULL REFERENCES tenant.project_timesheet_submissions(id),
  entry_id uuid NOT NULL REFERENCES tenant.project_time_entries(id),
  entry_version integer NOT NULL,
  snapshot jsonb NOT NULL,
  PRIMARY KEY (submission_id, entry_id)
);
CREATE INDEX IF NOT EXISTS project_timesheet_submission_entries_entry_idx ON tenant.project_timesheet_submission_entries (organization_id, entry_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_time_entries_submission_fk' AND conrelid = 'tenant.project_time_entries'::regclass) THEN
    ALTER TABLE tenant.project_time_entries ADD CONSTRAINT project_time_entries_submission_fk FOREIGN KEY (submission_id) REFERENCES tenant.project_timesheet_submissions(id);
  END IF;
END $$;

-- ============================================================ 4. corrections
CREATE TABLE IF NOT EXISTS tenant.project_time_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  correction_number bigint GENERATED ALWAYS AS IDENTITY,
  entry_id uuid NOT NULL REFERENCES tenant.project_time_entries(id),
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  employee_user_id uuid NOT NULL REFERENCES public.users(id),
  kind text NOT NULL CHECK (kind IN ('ADJUST', 'VOID')),
  original jsonb NOT NULL,
  proposed jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'APPLIED', 'REJECTED')),
  requested_by uuid NOT NULL REFERENCES public.users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES public.users(id),
  decided_at timestamptz,
  decision_note text,
  replacement_entry_id uuid REFERENCES tenant.project_time_entries(id),
  cost_adjustment jsonb,
  billing_adjustment_required boolean NOT NULL DEFAULT false,
  billing_adjustment_reference text,
  idempotency_key text,
  decision_key text,
  row_version integer NOT NULL DEFAULT 1,
  CHECK (status <> 'REJECTED' OR length(btrim(COALESCE(decision_note, ''))) >= 3)
);
CREATE UNIQUE INDEX IF NOT EXISTS project_time_corrections_key_idx ON tenant.project_time_corrections (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
-- One open correction per entry.
CREATE UNIQUE INDEX IF NOT EXISTS project_time_corrections_open_idx ON tenant.project_time_corrections (organization_id, entry_id) WHERE status = 'REQUESTED';
CREATE INDEX IF NOT EXISTS project_time_corrections_project_idx ON tenant.project_time_corrections (organization_id, project_id, requested_at);

-- ============================================================ 5. labor rates
CREATE TABLE IF NOT EXISTS tenant.project_labor_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id),
  project_id uuid REFERENCES tenant.projects(id),
  hourly_rate numeric(20,6) NOT NULL CHECK (hourly_rate >= 0),
  currency text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  rate_version integer NOT NULL,
  reason text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS project_labor_rates_version_idx ON tenant.project_labor_rates (organization_id, user_id, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid), rate_version);
CREATE INDEX IF NOT EXISTS project_labor_rates_lookup_idx ON tenant.project_labor_rates (organization_id, user_id, effective_from);

-- ============================================================ 6. billing allocations
CREATE TABLE IF NOT EXISTS tenant.project_time_billing_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  entry_id uuid NOT NULL REFERENCES tenant.project_time_entries(id),
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  billing_request_id uuid NOT NULL,
  allocated_minutes integer NOT NULL CHECK (allocated_minutes > 0),
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'INVOICED', 'REVERSED')),
  customer_invoice_id uuid REFERENCES tenant.accounting_customer_invoices(id),
  customer_invoice_line_id uuid REFERENCES tenant.accounting_customer_invoice_lines(id),
  requested_by uuid REFERENCES public.users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  invoiced_by uuid REFERENCES public.users(id),
  invoiced_at timestamptz,
  reversed_by uuid REFERENCES public.users(id),
  reversed_at timestamptz,
  reversal_reason text,
  reversal_reference text,
  idempotency_key text,
  CHECK (status <> 'INVOICED' OR customer_invoice_line_id IS NOT NULL),
  CHECK (status <> 'REVERSED' OR (reversed_at IS NOT NULL AND length(btrim(COALESCE(reversal_reason, ''))) >= 3))
);
CREATE INDEX IF NOT EXISTS project_time_billing_allocations_entry_idx ON tenant.project_time_billing_allocations (organization_id, entry_id);
CREATE INDEX IF NOT EXISTS project_time_billing_allocations_request_idx ON tenant.project_time_billing_allocations (organization_id, billing_request_id);
CREATE INDEX IF NOT EXISTS project_time_billing_allocations_project_idx ON tenant.project_time_billing_allocations (organization_id, project_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS project_time_billing_allocations_key_idx ON tenant.project_time_billing_allocations (organization_id, idempotency_key, entry_id) WHERE idempotency_key IS NOT NULL;

-- ============================================================ 7. history
CREATE TABLE IF NOT EXISTS tenant.project_time_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  employee_user_id uuid NOT NULL,
  entry_id uuid,
  submission_id uuid,
  correction_id uuid,
  action text NOT NULL,
  from_status text,
  to_status text,
  summary text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS project_time_events_entry_idx ON tenant.project_time_events (organization_id, entry_id, occurred_at);
CREATE INDEX IF NOT EXISTS project_time_events_submission_idx ON tenant.project_time_events (organization_id, submission_id, occurred_at);
CREATE INDEX IF NOT EXISTS project_time_events_project_idx ON tenant.project_time_events (organization_id, project_id, occurred_at);

-- ============================================================ the guard
-- Approved time keeps its values: only its cost snapshot (once), its billing and its voiding by a correction change. Submitted time
-- changes only by the review. A voided entry stays voided. An entry is never deleted once it has been submitted.
CREATE OR REPLACE FUNCTION tenant.project_time_entries_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.entry_status <> 'DRAFT' OR EXISTS (SELECT 1 FROM tenant.project_timesheet_submission_entries link WHERE link.entry_id = OLD.id) THEN
      RAISE EXCEPTION 'Submitted time is never deleted.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.employee_user_id <> OLD.employee_user_id OR NEW.organization_id <> OLD.organization_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Time stays with the person who worked it.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.entry_status = 'VOIDED' THEN
    RAISE EXCEPTION 'Voided time stays voided.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.entry_status IN ('SUBMITTED', 'APPROVED') AND (NEW.project_id <> OLD.project_id OR NEW.task_id IS DISTINCT FROM OLD.task_id OR NEW.work_date <> OLD.work_date
      OR NEW.duration_minutes <> OLD.duration_minutes OR NEW.billable <> OLD.billable OR NEW.description <> OLD.description
      OR NEW.start_at IS DISTINCT FROM OLD.start_at OR NEW.end_at IS DISTINCT FROM OLD.end_at) THEN
    RAISE EXCEPTION 'Submitted or approved time is changed through its review or a correction.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.entry_status = 'APPROVED' AND NEW.entry_status NOT IN ('APPROVED', 'VOIDED') THEN
    RAISE EXCEPTION 'Approved time is corrected, never reopened.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.entry_status = 'APPROVED' AND OLD.cost_recorded_at IS NOT NULL AND (NEW.cost_rate IS DISTINCT FROM OLD.cost_rate OR NEW.cost_amount IS DISTINCT FROM OLD.cost_amount) THEN
    RAISE EXCEPTION 'Approved time keeps the rate it was costed at.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- A billing allocation never takes more minutes than the entry's approved billable time (counting every allocation not reversed).
CREATE OR REPLACE FUNCTION tenant.project_time_billing_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  entry record;
  used integer;
BEGIN
  SELECT * INTO entry FROM tenant.project_time_entries WHERE id = NEW.entry_id FOR UPDATE;
  IF TG_OP = 'UPDATE' AND OLD.status = 'REVERSED' THEN
    RAISE EXCEPTION 'A reversed billing allocation stays reversed.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.allocated_minutes <> OLD.allocated_minutes OR NEW.entry_id <> OLD.entry_id) THEN
    RAISE EXCEPTION 'A billing allocation keeps its minutes; reverse it instead.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> 'REVERSED' THEN
    IF entry.entry_status <> 'APPROVED' OR NOT entry.billable THEN
      RAISE EXCEPTION 'Only approved billable time is billed.' USING ERRCODE = 'check_violation';
    END IF;
    SELECT COALESCE(sum(allocated_minutes), 0) INTO used FROM tenant.project_time_billing_allocations
     WHERE entry_id = NEW.entry_id AND status <> 'REVERSED' AND id <> NEW.id;
    IF used + NEW.allocated_minutes > entry.duration_minutes THEN
      RAISE EXCEPTION 'These minutes are already allocated to billing.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_time_entries_guard' AND tgrelid = 'tenant.project_time_entries'::regclass) THEN
    CREATE TRIGGER project_time_entries_guard BEFORE UPDATE OR DELETE ON tenant.project_time_entries FOR EACH ROW EXECUTE FUNCTION tenant.project_time_entries_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_time_billing_capacity' AND tgrelid = 'tenant.project_time_billing_allocations'::regclass) THEN
    CREATE TRIGGER project_time_billing_capacity BEFORE INSERT OR UPDATE ON tenant.project_time_billing_allocations FOR EACH ROW EXECUTE FUNCTION tenant.project_time_billing_capacity();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_time_events_append_only' AND tgrelid = 'tenant.project_time_events'::regclass) THEN
    CREATE TRIGGER project_time_events_append_only BEFORE UPDATE OR DELETE ON tenant.project_time_events FOR EACH ROW EXECUTE FUNCTION tenant.projects_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_timesheet_submission_entries_append_only' AND tgrelid = 'tenant.project_timesheet_submission_entries'::regclass) THEN
    CREATE TRIGGER project_timesheet_submission_entries_append_only BEFORE UPDATE OR DELETE ON tenant.project_timesheet_submission_entries FOR EACH ROW EXECUTE FUNCTION tenant.projects_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_timesheet_submissions_no_delete' AND tgrelid = 'tenant.project_timesheet_submissions'::regclass) THEN
    CREATE TRIGGER project_timesheet_submissions_no_delete BEFORE DELETE ON tenant.project_timesheet_submissions FOR EACH ROW EXECUTE FUNCTION tenant.projects_no_delete();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_time_corrections_no_delete' AND tgrelid = 'tenant.project_time_corrections'::regclass) THEN
    CREATE TRIGGER project_time_corrections_no_delete BEFORE DELETE ON tenant.project_time_corrections FOR EACH ROW EXECUTE FUNCTION tenant.projects_no_delete();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_labor_rates_no_delete' AND tgrelid = 'tenant.project_labor_rates'::regclass) THEN
    CREATE TRIGGER project_labor_rates_no_delete BEFORE DELETE ON tenant.project_labor_rates FOR EACH ROW EXECUTE FUNCTION tenant.projects_no_delete();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_time_billing_allocations_no_delete' AND tgrelid = 'tenant.project_time_billing_allocations'::regclass) THEN
    CREATE TRIGGER project_time_billing_allocations_no_delete BEFORE DELETE ON tenant.project_time_billing_allocations FOR EACH ROW EXECUTE FUNCTION tenant.projects_no_delete();
  END IF;
END $$;

-- ============================================================ isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['project_time_entries', 'project_timesheet_submissions', 'project_timesheet_submission_entries', 'project_time_corrections',
      'project_labor_rates', 'project_time_billing_allocations', 'project_time_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.project_time_entries TO vercent_app;
GRANT SELECT, INSERT, UPDATE ON tenant.project_timesheet_submissions, tenant.project_time_corrections, tenant.project_labor_rates, tenant.project_time_billing_allocations TO vercent_app;
GRANT SELECT, INSERT ON tenant.project_timesheet_submission_entries, tenant.project_time_events TO vercent_app;
GRANT SELECT ON tenant.project_time_entries, tenant.project_timesheet_submissions, tenant.project_timesheet_submission_entries, tenant.project_time_corrections,
  tenant.project_labor_rates, tenant.project_time_billing_allocations, tenant.project_time_events TO vercent_worker;
-- The reminder sweep remembers what it sent.
GRANT SELECT, INSERT ON tenant.project_alerts TO vercent_worker;

-- ============================================================ 8. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('projects.time.view_own', 'View own project time', 'Projects', 'See the time you recorded and its review.'),
  ('projects.time.create', 'Record project time', 'Projects', 'Record time on the projects you work on.'),
  ('projects.time.edit_draft', 'Edit unsubmitted time', 'Projects', 'Change or remove your time before it is submitted.'),
  ('projects.time.submit', 'Submit timesheets', 'Projects', 'Submit a week''s time for review.'),
  ('projects.time.view_team', 'View team time', 'Projects', 'See the time recorded on the projects you lead.'),
  ('projects.time.request_changes', 'Return timesheets', 'Projects', 'Return a submitted timesheet for correction, with the reason.'),
  ('projects.time.correct_approved', 'Correct approved time', 'Projects', 'Request or approve a correction of approved time.'),
  ('projects.time.view_cost', 'View labor cost', 'Projects', 'See internal labor rates and the cost of approved time.'),
  ('projects.time.view_billing', 'View time billing', 'Projects', 'See billable, unbilled and invoiced time.'),
  ('projects.time.export', 'Export project time', 'Projects', 'Export time records and timesheet reports.'),
  ('projects.time.rates.manage', 'Manage labor rates', 'Projects', 'Set the effective-dated internal labor cost rates.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('employee', 'projects.time.view_own'), ('employee', 'projects.time.create'), ('employee', 'projects.time.edit_draft'), ('employee', 'projects.time.submit'),
    ('project_manager', 'projects.time.view_own'), ('project_manager', 'projects.time.create'), ('project_manager', 'projects.time.edit_draft'),
    ('project_manager', 'projects.time.submit'), ('project_manager', 'projects.time.view_team'), ('project_manager', 'projects.time.approve'),
    ('project_manager', 'projects.time.request_changes'), ('project_manager', 'projects.time.correct_approved'), ('project_manager', 'projects.time.view_billing'),
    ('project_manager', 'projects.time.export'),
    ('finance_manager', 'projects.time.view_team'), ('finance_manager', 'projects.time.correct_approved'), ('finance_manager', 'projects.time.view_cost'),
    ('finance_manager', 'projects.time.view_billing'), ('finance_manager', 'projects.time.export'), ('finance_manager', 'projects.time.rates.manage'),
    ('accountant', 'projects.time.view_team'), ('accountant', 'projects.time.view_cost'), ('accountant', 'projects.time.view_billing'),
    ('sales_head', 'projects.time.view_billing'), ('sales_manager', 'projects.time.view_billing')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0134_projects_timesheets.sql', 'projects-timesheets') ON CONFLICT DO NOTHING;
