-- Projects: Milestones — the outcomes a project must achieve (a deliverable, an approval, a phase gate), each with an owner, a deadline, its
-- completion criteria, the tasks and earlier milestones it depends on, and the acceptance it needs. Progress is one lifecycle; acceptance is
-- tracked beside it. Projects owns the milestone, its evidence and its approvals; Tasks owns task execution; Sales and Finance own invoices.
--
--   milestones        NOT_STARTED -> IN_PROGRESS (<-> BLOCKED) -> SUBMITTED -> COMPLETED, or CANCELLED; a completed one may be reopened with a
--                     reason. approval_status (NOT_REQUIRED, NOT_SUBMITTED, PENDING, CHANGES_REQUESTED, APPROVED, REJECTED) is separate.
--                     The first due date is kept; changes to it are recorded with a reason. scope_version moves on each material change,
--                     so an approval of an older scope no longer counts.
--   criteria          the deliverables checklist: required or optional, evidence required or not; completed, or waived with a reason.
--   task links        a project task counted toward one milestone (required or optional); the Tasks feature owns the task.
--   dependencies      finish-to-start, within the project, never circular.
--   blockers          what stops progress, with an owner and a resolution.
--   submissions       the immutable snapshot reviewed: criteria, tasks, evidence and details at that moment.
--   approvals         each decision on a submission: internal approval, or customer acceptance recorded from externally received evidence.
--   billing requests  a non-financial handoff to Sales once a completed milestone's billing stage allows it; one per milestone.
--   events            the milestone's history, append-only.
-- Notes on a milestone are project notes that name it; its files are attachments of the milestone.

-- ============================================================ 1. policy
ALTER TABLE tenant.project_settings
  -- Whoever submitted a milestone may also approve it (off: someone else must).
  ADD COLUMN IF NOT EXISTS milestone_self_approval_allowed boolean NOT NULL DEFAULT false,
  -- A new milestone needs internal approval unless the person creating it says otherwise.
  ADD COLUMN IF NOT EXISTS milestone_internal_approval_default boolean NOT NULL DEFAULT true;

-- ============================================================ 2. milestones
CREATE TABLE IF NOT EXISTS tenant.project_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  milestone_code text NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 200),
  description text,
  milestone_type text NOT NULL DEFAULT 'DELIVERABLE' CHECK (milestone_type IN ('DELIVERABLE', 'APPROVAL', 'PHASE_GATE', 'OTHER')),
  owner_user_id uuid REFERENCES public.users(id),
  status text NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'SUBMITTED', 'COMPLETED', 'CANCELLED')),
  -- The status a blocker interrupted (it resumes there).
  previous_status text CHECK (previous_status IS NULL OR previous_status IN ('NOT_STARTED', 'IN_PROGRESS')),
  approval_status text NOT NULL DEFAULT 'NOT_SUBMITTED' CHECK (approval_status IN ('NOT_REQUIRED', 'NOT_SUBMITTED', 'PENDING', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED')),
  internal_approval_required boolean NOT NULL DEFAULT true,
  customer_acceptance_required boolean NOT NULL DEFAULT false,
  -- The customer's person who accepts (one of the project's active customer contacts).
  customer_contact_id uuid REFERENCES tenant.contacts(id),
  priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  sequence integer NOT NULL DEFAULT 1 CHECK (sequence > 0),
  planned_start_date date,
  original_due_date date NOT NULL,
  current_due_date date NOT NULL,
  started_at timestamptz,
  submitted_at timestamptz,
  completed_at timestamptz,
  completed_by uuid REFERENCES public.users(id),
  -- Must be complete (or waived) before the project completes.
  required_for_completion boolean NOT NULL DEFAULT true,
  waived_at timestamptz,
  waived_by uuid REFERENCES public.users(id),
  waiver_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES public.users(id),
  cancel_reason text,
  -- The Sales commercial stage it bills against: a confirmed sales order linked to the project, and optionally one of its lines.
  sales_order_id uuid REFERENCES tenant.sales_orders(id),
  sales_order_line_id uuid,
  billing_reference text,
  scope_version integer NOT NULL DEFAULT 1,
  current_submission_id uuid,
  approved_submission_id uuid,
  create_key text,
  row_version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_milestones_dates_check CHECK (planned_start_date IS NULL OR current_due_date >= planned_start_date),
  CONSTRAINT project_milestones_completion_check CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL)),
  CONSTRAINT project_milestones_cancel_check CHECK (status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND length(btrim(COALESCE(cancel_reason, ''))) >= 3)),
  CONSTRAINT project_milestones_blocked_check CHECK ((status = 'BLOCKED') = (previous_status IS NOT NULL)),
  CONSTRAINT project_milestones_waiver_check CHECK (waived_at IS NULL OR length(btrim(COALESCE(waiver_reason, ''))) >= 3),
  CONSTRAINT project_milestones_line_check CHECK (sales_order_line_id IS NULL OR sales_order_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS project_milestones_code_uidx ON tenant.project_milestones (organization_id, milestone_code);
CREATE UNIQUE INDEX IF NOT EXISTS project_milestones_create_key_uidx ON tenant.project_milestones (organization_id, create_key) WHERE create_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_milestones_project_idx ON tenant.project_milestones (organization_id, project_id, sequence);
CREATE INDEX IF NOT EXISTS project_milestones_due_idx ON tenant.project_milestones (organization_id, status, current_due_date);
CREATE INDEX IF NOT EXISTS project_milestones_owner_idx ON tenant.project_milestones (organization_id, owner_user_id);

-- ============================================================ 3. criteria, task links, dependencies, blockers
CREATE TABLE IF NOT EXISTS tenant.project_milestone_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  milestone_id uuid NOT NULL REFERENCES tenant.project_milestones(id),
  sequence integer NOT NULL DEFAULT 1 CHECK (sequence > 0),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 2 AND 500),
  is_required boolean NOT NULL DEFAULT true,
  evidence_required boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED', 'WAIVED')),
  -- What shows it is done: a milestone file, a reference (document number, email subject), or both.
  evidence_file_id uuid,
  evidence_note text,
  completed_by uuid REFERENCES public.users(id),
  completed_at timestamptz,
  waived_by uuid REFERENCES public.users(id),
  waived_at timestamptz,
  waiver_reason text,
  removed_at timestamptz,
  removed_by uuid REFERENCES public.users(id),
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT project_milestone_criteria_done_check CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL)),
  CONSTRAINT project_milestone_criteria_waived_check CHECK ((status = 'WAIVED') = (waived_at IS NOT NULL) AND (waived_at IS NULL OR length(btrim(COALESCE(waiver_reason, ''))) >= 3))
);
CREATE INDEX IF NOT EXISTS project_milestone_criteria_idx ON tenant.project_milestone_criteria (organization_id, milestone_id, sequence) WHERE removed_at IS NULL;

CREATE TABLE IF NOT EXISTS tenant.project_milestone_task_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  milestone_id uuid NOT NULL REFERENCES tenant.project_milestones(id),
  -- The project task (owned by the Tasks feature, resolved through its registered source).
  task_id uuid NOT NULL,
  is_required boolean NOT NULL DEFAULT true,
  -- When a required task is cancelled, what happens to the milestone's need for it.
  disposition text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  removed_at timestamptz,
  removed_by uuid REFERENCES public.users(id)
);
-- A task counts once toward one milestone.
CREATE UNIQUE INDEX IF NOT EXISTS project_milestone_task_links_task_uidx ON tenant.project_milestone_task_links (organization_id, task_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS project_milestone_task_links_idx ON tenant.project_milestone_task_links (organization_id, milestone_id) WHERE removed_at IS NULL;

CREATE TABLE IF NOT EXISTS tenant.project_milestone_dependencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  milestone_id uuid NOT NULL REFERENCES tenant.project_milestones(id),
  prerequisite_id uuid NOT NULL REFERENCES tenant.project_milestones(id),
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  removed_at timestamptz,
  removed_by uuid REFERENCES public.users(id),
  CHECK (milestone_id <> prerequisite_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS project_milestone_dependencies_uidx ON tenant.project_milestone_dependencies (milestone_id, prerequisite_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS project_milestone_dependencies_prerequisite_idx ON tenant.project_milestone_dependencies (organization_id, prerequisite_id) WHERE removed_at IS NULL;

CREATE TABLE IF NOT EXISTS tenant.project_milestone_blockers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  milestone_id uuid NOT NULL REFERENCES tenant.project_milestones(id),
  category text NOT NULL DEFAULT 'OTHER' CHECK (category IN ('CUSTOMER_FEEDBACK', 'TASK_DELAYED', 'DOCUMENT_MISSING', 'DEPENDENCY', 'RESOURCE', 'APPROVAL', 'OTHER')),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 3 AND 1000),
  owner_user_id uuid REFERENCES public.users(id),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED')),
  resolution text,
  raised_by uuid REFERENCES public.users(id),
  raised_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_by uuid REFERENCES public.users(id),
  resolved_at timestamptz,
  CONSTRAINT project_milestone_blockers_resolved_check CHECK ((status = 'RESOLVED') = (resolved_at IS NOT NULL) AND (resolved_at IS NULL OR length(btrim(COALESCE(resolution, ''))) >= 3))
);
CREATE INDEX IF NOT EXISTS project_milestone_blockers_idx ON tenant.project_milestone_blockers (organization_id, milestone_id, status);

-- ============================================================ 4. submissions, approvals, billing, history
CREATE TABLE IF NOT EXISTS tenant.project_milestone_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  milestone_id uuid NOT NULL REFERENCES tenant.project_milestones(id),
  submission_number integer NOT NULL CHECK (submission_number > 0),
  scope_version integer NOT NULL,
  -- Criteria, linked tasks with their states, evidence files and the milestone's details, exactly as reviewed.
  snapshot jsonb NOT NULL,
  note text,
  submitted_by uuid REFERENCES public.users(id),
  submitted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS project_milestone_submissions_number_uidx ON tenant.project_milestone_submissions (milestone_id, submission_number);

CREATE TABLE IF NOT EXISTS tenant.project_milestone_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  milestone_id uuid NOT NULL REFERENCES tenant.project_milestones(id),
  submission_id uuid NOT NULL REFERENCES tenant.project_milestone_submissions(id),
  reviewer_type text NOT NULL CHECK (reviewer_type IN ('INTERNAL', 'CUSTOMER')),
  decision text NOT NULL CHECK (decision IN ('APPROVED', 'CHANGES_REQUESTED', 'REJECTED')),
  note text,
  -- Customer acceptance: who at the customer decided, when, and the evidence received (a milestone file and/or a reference).
  customer_contact_id uuid REFERENCES tenant.contacts(id),
  customer_decision_date date,
  evidence_file_id uuid,
  evidence_reference text,
  recorded_by uuid REFERENCES public.users(id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  idempotency_key text,
  CONSTRAINT project_milestone_approvals_customer_check CHECK (reviewer_type = 'INTERNAL'
    OR (customer_contact_id IS NOT NULL AND customer_decision_date IS NOT NULL AND (evidence_file_id IS NOT NULL OR length(btrim(COALESCE(evidence_reference, ''))) >= 3)))
);
CREATE INDEX IF NOT EXISTS project_milestone_approvals_idx ON tenant.project_milestone_approvals (organization_id, milestone_id, recorded_at);
-- One decision of each kind per submission.
CREATE UNIQUE INDEX IF NOT EXISTS project_milestone_approvals_once_uidx ON tenant.project_milestone_approvals (submission_id, reviewer_type);
CREATE UNIQUE INDEX IF NOT EXISTS project_milestone_approvals_key_uidx ON tenant.project_milestone_approvals (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS tenant.project_milestone_billing_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  milestone_id uuid NOT NULL REFERENCES tenant.project_milestones(id),
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  sales_order_id uuid NOT NULL REFERENCES tenant.sales_orders(id),
  sales_order_line_id uuid,
  -- The approved submission it is based on.
  submission_id uuid REFERENCES tenant.project_milestone_submissions(id),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'WITHDRAWN')),
  note text,
  requested_by uuid REFERENCES public.users(id),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  closed_by uuid REFERENCES public.users(id),
  closed_at timestamptz,
  close_note text
);
-- One live billing request per milestone: a repeated approval or request never makes a second.
CREATE UNIQUE INDEX IF NOT EXISTS project_milestone_billing_requests_uidx ON tenant.project_milestone_billing_requests (milestone_id) WHERE status <> 'WITHDRAWN';
CREATE INDEX IF NOT EXISTS project_milestone_billing_requests_order_idx ON tenant.project_milestone_billing_requests (organization_id, sales_order_id);

CREATE TABLE IF NOT EXISTS tenant.project_milestone_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  milestone_id uuid NOT NULL REFERENCES tenant.project_milestones(id),
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  action text NOT NULL,
  summary text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  from_status text,
  to_status text,
  actor_user_id uuid REFERENCES public.users(id),
  idempotency_key text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS project_milestone_events_idx ON tenant.project_milestone_events (organization_id, milestone_id, occurred_at);
CREATE INDEX IF NOT EXISTS project_milestone_events_project_idx ON tenant.project_milestone_events (organization_id, project_id, occurred_at);
CREATE UNIQUE INDEX IF NOT EXISTS project_milestone_events_key_uidx ON tenant.project_milestone_events (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Notes on a milestone are project notes that name it.
ALTER TABLE tenant.project_notes ADD COLUMN IF NOT EXISTS milestone_id uuid REFERENCES tenant.project_milestones(id);
CREATE INDEX IF NOT EXISTS project_notes_milestone_idx ON tenant.project_notes (organization_id, milestone_id) WHERE milestone_id IS NOT NULL;

-- ============================================================ 5. guards
CREATE OR REPLACE FUNCTION tenant.project_milestones_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A milestone is never deleted; cancel it.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.milestone_code <> OLD.milestone_code OR NEW.organization_id <> OLD.organization_id OR NEW.project_id <> OLD.project_id
     OR NEW.original_due_date <> OLD.original_due_date OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'A milestone keeps its code, project and original due date.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'NOT_STARTED' AND NEW.status IN ('IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED'))
    OR (OLD.status = 'IN_PROGRESS' AND NEW.status IN ('BLOCKED', 'SUBMITTED', 'COMPLETED', 'CANCELLED'))
    OR (OLD.status = 'BLOCKED' AND NEW.status IN ('NOT_STARTED', 'IN_PROGRESS', 'CANCELLED'))
    OR (OLD.status = 'SUBMITTED' AND NEW.status IN ('IN_PROGRESS', 'COMPLETED', 'CANCELLED'))
    OR (OLD.status = 'COMPLETED' AND NEW.status = 'IN_PROGRESS')) THEN
    RAISE EXCEPTION 'A milestone cannot move from % to %.', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  -- A completed milestone keeps the moment it was completed until it is reopened.
  IF OLD.status = 'COMPLETED' AND NEW.status = 'COMPLETED' AND NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
    RAISE EXCEPTION 'A completed milestone keeps its completion time.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$
DECLARE
  name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_milestones_guard' AND tgrelid = 'tenant.project_milestones'::regclass) THEN
    CREATE TRIGGER project_milestones_guard BEFORE UPDATE OR DELETE ON tenant.project_milestones FOR EACH ROW EXECUTE FUNCTION tenant.project_milestones_guard();
  END IF;
  FOREACH name IN ARRAY ARRAY['project_milestone_submissions', 'project_milestone_approvals', 'project_milestone_events'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = name || '_append_only' AND tgrelid = ('tenant.' || name)::regclass) THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON tenant.%I FOR EACH ROW EXECUTE FUNCTION tenant.projects_append_only()', name || '_append_only', name);
    END IF;
  END LOOP;
  FOREACH name IN ARRAY ARRAY['project_milestone_criteria', 'project_milestone_task_links', 'project_milestone_dependencies', 'project_milestone_blockers',
                             'project_milestone_billing_requests'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = name || '_no_delete' AND tgrelid = ('tenant.' || name)::regclass) THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON tenant.%I FOR EACH ROW EXECUTE FUNCTION tenant.projects_no_delete()', name || '_no_delete', name);
    END IF;
  END LOOP;
END $$;

-- ============================================================ 6. isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['project_milestones', 'project_milestone_criteria', 'project_milestone_task_links', 'project_milestone_dependencies', 'project_milestone_blockers',
                             'project_milestone_submissions', 'project_milestone_approvals', 'project_milestone_billing_requests', 'project_milestone_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.project_milestones, tenant.project_milestone_criteria, tenant.project_milestone_task_links, tenant.project_milestone_dependencies,
  tenant.project_milestone_blockers, tenant.project_milestone_billing_requests TO vercent_app;
GRANT SELECT, INSERT ON tenant.project_milestone_submissions, tenant.project_milestone_approvals, tenant.project_milestone_events TO vercent_app;
GRANT SELECT ON tenant.project_milestones, tenant.project_milestone_criteria, tenant.project_milestone_task_links, tenant.project_milestone_dependencies, tenant.project_milestone_blockers,
  tenant.project_milestone_submissions, tenant.project_milestone_approvals, tenant.project_milestone_billing_requests, tenant.project_milestone_events TO vercent_worker;

-- ============================================================ 7. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('projects.milestones.view', 'View milestones', 'Projects', 'See the milestones of the projects you can see.'),
  ('projects.milestones.create', 'Create milestones', 'Projects', 'Add milestones to projects you lead.'),
  ('projects.milestones.edit', 'Edit milestones', 'Projects', 'Change a milestone''s details, dates and deliverables.'),
  ('projects.milestones.assign', 'Assign milestone owners', 'Projects', 'Give a milestone to an owner, or move it to another.'),
  ('projects.milestones.links.manage', 'Manage milestone links', 'Projects', 'Link tasks, prerequisite milestones and the Sales billing stage to milestones.'),
  ('projects.milestones.submit', 'Submit milestones', 'Projects', 'Submit a milestone''s completion evidence for review.'),
  ('projects.milestones.approve', 'Approve milestones', 'Projects', 'Approve a submitted milestone, or ask for changes.'),
  ('projects.milestones.customer_acceptance', 'Record customer acceptance', 'Projects', 'Record the customer''s decision on a milestone from the evidence received.'),
  ('projects.milestones.waive', 'Waive milestone requirements', 'Projects', 'Waive a required deliverable or prerequisite, or a milestone at project completion, with a reason.'),
  ('projects.milestones.complete', 'Complete milestones', 'Projects', 'Complete a milestone once its acceptance conditions are met, and hand billing to Sales.'),
  ('projects.milestones.reopen', 'Reopen milestones', 'Projects', 'Reopen a completed milestone, with a reason.'),
  ('projects.milestones.cancel', 'Cancel milestones', 'Projects', 'Cancel a milestone after reviewing what depends on it.'),
  ('projects.milestones.billing.view', 'View milestone billing', 'Projects', 'See the billing stage and billing status of milestones.'),
  ('projects.milestones.export', 'Export milestones', 'Projects', 'Export milestone lists and reports.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('project_manager', 'projects.milestones.view'), ('project_manager', 'projects.milestones.create'), ('project_manager', 'projects.milestones.edit'),
    ('project_manager', 'projects.milestones.assign'), ('project_manager', 'projects.milestones.links.manage'), ('project_manager', 'projects.milestones.submit'),
    ('project_manager', 'projects.milestones.approve'), ('project_manager', 'projects.milestones.customer_acceptance'), ('project_manager', 'projects.milestones.waive'),
    ('project_manager', 'projects.milestones.complete'), ('project_manager', 'projects.milestones.reopen'), ('project_manager', 'projects.milestones.cancel'),
    ('project_manager', 'projects.milestones.billing.view'), ('project_manager', 'projects.milestones.export'),
    ('employee', 'projects.milestones.view'), ('employee', 'projects.milestones.submit'),
    ('sales_head', 'projects.milestones.view'), ('sales_head', 'projects.milestones.billing.view'), ('sales_head', 'projects.milestones.customer_acceptance'),
    ('sales_manager', 'projects.milestones.view'), ('sales_manager', 'projects.milestones.billing.view'), ('sales_manager', 'projects.milestones.customer_acceptance'),
    ('finance_manager', 'projects.milestones.view'), ('finance_manager', 'projects.milestones.billing.view'), ('finance_manager', 'projects.milestones.export'),
    ('accountant', 'projects.milestones.view'), ('accountant', 'projects.milestones.billing.view')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0128_projects_milestones.sql', 'projects-milestones') ON CONFLICT DO NOTHING;
