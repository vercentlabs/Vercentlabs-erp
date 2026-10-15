-- Projects: Tasks — the accountable units of work that deliver a project: what someone must do, by when, where it stands, what it waits for
-- and what it needs before it is done. Projects owns the task, its checklist, reviews and history; Milestones counts tasks toward its
-- deliverables; Time Tracking, Expenses, Sales and Finance keep their own records and only reference a task.
--
--   tasks         TO_DO -> IN_PROGRESS (<-> BLOCKED) -> [IN_REVIEW ->] DONE, or CANCELLED; a done task may be reopened with a reason.
--                 approval_status (NOT_REQUIRED, NOT_SUBMITTED, PENDING, APPROVED, CHANGES_REQUESTED, REJECTED) is separate. One primary
--                 assignee; the first due date is kept. scope_version moves on each material change, so an older review no longer counts.
--                 A done task is read-only until reopened. Recurrence is not part of a task (a future recurring definition is its own record).
--   checklist     lightweight steps (required or optional) — done, or waived with a reference; never counted as project tasks.
--   dependencies  finish-to-start, within the project, never circular.
--   blockers      the reason, its owner and its resolution.
--   reviews       the immutable snapshot submitted; decisions on it are recorded once.
--   comments      the discussion, with mentions of project people.
--   views         each person's saved task views.
--   events        the task's history, append-only (status changes carry to_status, so past progress can be rebuilt).
-- A task's files are attachments of the task.

-- ============================================================ 1. policy
ALTER TABLE tenant.project_settings
  -- Whoever submitted a task for review may also approve it (off: someone else must).
  ADD COLUMN IF NOT EXISTS task_self_review_allowed boolean NOT NULL DEFAULT false,
  -- A new task needs review unless the person creating it says otherwise.
  ADD COLUMN IF NOT EXISTS task_review_default boolean NOT NULL DEFAULT false,
  -- The one due-soon reminder: this many days before the due date (0: on the day).
  ADD COLUMN IF NOT EXISTS task_reminder_days integer NOT NULL DEFAULT 1 CHECK (task_reminder_days BETWEEN 0 AND 30);

-- ============================================================ 2. tasks
CREATE TABLE IF NOT EXISTS tenant.project_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  task_code text NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 200),
  description text,
  -- One primary milestone of the same project (kept in step with the milestone's task link).
  milestone_id uuid REFERENCES tenant.project_milestones(id),
  assignee_user_id uuid NOT NULL REFERENCES public.users(id),
  reporter_user_id uuid REFERENCES public.users(id),
  -- Who reviews it, when someone in particular should (otherwise anyone who may approve on the project).
  reviewer_user_id uuid REFERENCES public.users(id),
  status text NOT NULL DEFAULT 'TO_DO' CHECK (status IN ('TO_DO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE', 'CANCELLED')),
  -- The status a blocker interrupted (it resumes there).
  previous_status text CHECK (previous_status IS NULL OR previous_status IN ('TO_DO', 'IN_PROGRESS')),
  approval_status text NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (approval_status IN ('NOT_REQUIRED', 'NOT_SUBMITTED', 'PENDING', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED')),
  review_required boolean NOT NULL DEFAULT false,
  -- Completion needs evidence: a note, a file, or a linked document reference.
  evidence_required boolean NOT NULL DEFAULT false,
  priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  task_type text NOT NULL DEFAULT 'GENERAL' CHECK (task_type IN ('GENERAL', 'DESIGN', 'BUILD', 'CONFIGURATION', 'DATA', 'TESTING', 'DOCUMENTATION', 'MEETING', 'OTHER')),
  tags text[] NOT NULL DEFAULT '{}',
  planned_start_date date,
  original_due_date date NOT NULL,
  due_date date NOT NULL,
  estimate_minutes integer CHECK (estimate_minutes IS NULL OR estimate_minutes BETWEEN 1 AND 1000000),
  actual_started_at timestamptz,
  completed_at timestamptz,
  completed_by uuid REFERENCES public.users(id),
  completion_note text,
  evidence_reference text,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES public.users(id),
  cancel_reason text,
  archived_at timestamptz,
  archived_by uuid REFERENCES public.users(id),
  -- The template a task was created from (a snapshot reference; the task never changes with the template).
  template_ref text,
  scope_version integer NOT NULL DEFAULT 1,
  current_review_id uuid,
  create_key text,
  row_version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_tasks_dates_check CHECK (planned_start_date IS NULL OR due_date >= planned_start_date),
  CONSTRAINT project_tasks_done_check CHECK ((status = 'DONE') = (completed_at IS NOT NULL)),
  CONSTRAINT project_tasks_cancel_check CHECK (status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND length(btrim(COALESCE(cancel_reason, ''))) >= 3)),
  CONSTRAINT project_tasks_blocked_check CHECK ((status = 'BLOCKED') = (previous_status IS NOT NULL)),
  CONSTRAINT project_tasks_archive_check CHECK (archived_at IS NULL OR status IN ('DONE', 'CANCELLED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS project_tasks_code_uidx ON tenant.project_tasks (organization_id, task_code);
CREATE UNIQUE INDEX IF NOT EXISTS project_tasks_create_key_uidx ON tenant.project_tasks (organization_id, create_key) WHERE create_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_tasks_project_idx ON tenant.project_tasks (organization_id, project_id, status);
CREATE INDEX IF NOT EXISTS project_tasks_assignee_idx ON tenant.project_tasks (organization_id, assignee_user_id, status);
CREATE INDEX IF NOT EXISTS project_tasks_due_idx ON tenant.project_tasks (organization_id, status, due_date);
CREATE INDEX IF NOT EXISTS project_tasks_milestone_idx ON tenant.project_tasks (organization_id, milestone_id) WHERE milestone_id IS NOT NULL;

-- ============================================================ 3. checklist, dependencies, blockers
CREATE TABLE IF NOT EXISTS tenant.project_task_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  task_id uuid NOT NULL REFERENCES tenant.project_tasks(id),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 300),
  is_required boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DONE', 'WAIVED')),
  position integer NOT NULL DEFAULT 1 CHECK (position > 0),
  note text,
  completed_by uuid REFERENCES public.users(id),
  completed_at timestamptz,
  waived_by uuid REFERENCES public.users(id),
  waived_at timestamptz,
  waiver_reference text,
  removed_at timestamptz,
  removed_by uuid REFERENCES public.users(id),
  row_version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT project_task_checklist_done_check CHECK ((status = 'DONE') = (completed_at IS NOT NULL)),
  CONSTRAINT project_task_checklist_waived_check CHECK ((status = 'WAIVED') = (waived_at IS NOT NULL) AND (waived_at IS NULL OR length(btrim(COALESCE(waiver_reference, ''))) >= 3))
);
CREATE INDEX IF NOT EXISTS project_task_checklist_idx ON tenant.project_task_checklist_items (organization_id, task_id, position) WHERE removed_at IS NULL;

CREATE TABLE IF NOT EXISTS tenant.project_task_dependencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  task_id uuid NOT NULL REFERENCES tenant.project_tasks(id),
  prerequisite_task_id uuid NOT NULL REFERENCES tenant.project_tasks(id),
  dependency_type text NOT NULL DEFAULT 'FINISH_TO_START' CHECK (dependency_type = 'FINISH_TO_START'),
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  removed_at timestamptz,
  removed_by uuid REFERENCES public.users(id),
  CHECK (task_id <> prerequisite_task_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS project_task_dependencies_uidx ON tenant.project_task_dependencies (task_id, prerequisite_task_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS project_task_dependencies_prerequisite_idx ON tenant.project_task_dependencies (organization_id, prerequisite_task_id) WHERE removed_at IS NULL;

CREATE TABLE IF NOT EXISTS tenant.project_task_blockers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  task_id uuid NOT NULL REFERENCES tenant.project_tasks(id),
  reason_code text NOT NULL DEFAULT 'OTHER' CHECK (reason_code IN ('CUSTOMER_RESPONSE', 'MISSING_REQUIREMENTS', 'WAITING_ON_TASK', 'RESOURCE', 'APPROVAL', 'TECHNICAL', 'OTHER')),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 3 AND 1000),
  owner_user_id uuid NOT NULL REFERENCES public.users(id),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RESOLVED')),
  resolution text,
  raised_by uuid REFERENCES public.users(id),
  raised_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_by uuid REFERENCES public.users(id),
  resolved_at timestamptz,
  CONSTRAINT project_task_blockers_resolved_check CHECK ((status = 'RESOLVED') = (resolved_at IS NOT NULL) AND (resolved_at IS NULL OR length(btrim(COALESCE(resolution, ''))) >= 3))
);
CREATE INDEX IF NOT EXISTS project_task_blockers_idx ON tenant.project_task_blockers (organization_id, task_id, status);

-- ============================================================ 4. reviews, comments, views, history
CREATE TABLE IF NOT EXISTS tenant.project_task_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  task_id uuid NOT NULL REFERENCES tenant.project_tasks(id),
  review_number integer NOT NULL CHECK (review_number > 0),
  scope_version integer NOT NULL,
  -- The task, its checklist, evidence and files exactly as submitted.
  snapshot jsonb NOT NULL,
  note text,
  submitted_by uuid REFERENCES public.users(id),
  submitted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS project_task_reviews_number_uidx ON tenant.project_task_reviews (task_id, review_number);

CREATE TABLE IF NOT EXISTS tenant.project_task_review_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  task_id uuid NOT NULL REFERENCES tenant.project_tasks(id),
  review_id uuid NOT NULL REFERENCES tenant.project_task_reviews(id),
  decision text NOT NULL CHECK (decision IN ('APPROVED', 'CHANGES_REQUESTED', 'REJECTED')),
  reason text,
  decided_by uuid REFERENCES public.users(id),
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  idempotency_key text,
  CONSTRAINT project_task_review_decisions_reason_check CHECK (decision = 'APPROVED' OR length(btrim(COALESCE(reason, ''))) >= 3)
);
-- One decision per submission.
CREATE UNIQUE INDEX IF NOT EXISTS project_task_review_decisions_once_uidx ON tenant.project_task_review_decisions (review_id);
CREATE UNIQUE INDEX IF NOT EXISTS project_task_review_decisions_key_uidx ON tenant.project_task_review_decisions (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS tenant.project_task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  task_id uuid NOT NULL REFERENCES tenant.project_tasks(id),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 5000),
  -- Project people mentioned (each told once).
  mentions uuid[] NOT NULL DEFAULT '{}',
  author_user_id uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  removed_at timestamptz,
  removed_by uuid REFERENCES public.users(id),
  idempotency_key text
);
CREATE INDEX IF NOT EXISTS project_task_comments_idx ON tenant.project_task_comments (organization_id, task_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS project_task_comments_key_uidx ON tenant.project_task_comments (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS tenant.project_task_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS project_task_views_name_uidx ON tenant.project_task_views (organization_id, user_id, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS project_task_views_default_uidx ON tenant.project_task_views (organization_id, user_id) WHERE is_default;

CREATE TABLE IF NOT EXISTS tenant.project_task_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  task_id uuid NOT NULL REFERENCES tenant.project_tasks(id),
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
CREATE INDEX IF NOT EXISTS project_task_events_idx ON tenant.project_task_events (organization_id, task_id, occurred_at);
CREATE INDEX IF NOT EXISTS project_task_events_project_idx ON tenant.project_task_events (organization_id, project_id, occurred_at);
CREATE UNIQUE INDEX IF NOT EXISTS project_task_events_key_uidx ON tenant.project_task_events (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ============================================================ 5. guards
CREATE OR REPLACE FUNCTION tenant.project_tasks_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A task is never deleted; cancel it.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.task_code <> OLD.task_code OR NEW.organization_id <> OLD.organization_id OR NEW.project_id <> OLD.project_id
     OR NEW.original_due_date <> OLD.original_due_date OR NEW.created_at <> OLD.created_at OR NEW.reporter_user_id IS DISTINCT FROM OLD.reporter_user_id THEN
    RAISE EXCEPTION 'A task keeps its code, project, reporter and original due date.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'TO_DO' AND NEW.status IN ('IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED'))
    OR (OLD.status = 'IN_PROGRESS' AND NEW.status IN ('BLOCKED', 'IN_REVIEW', 'DONE', 'CANCELLED'))
    OR (OLD.status = 'BLOCKED' AND NEW.status IN ('TO_DO', 'IN_PROGRESS', 'CANCELLED'))
    OR (OLD.status = 'IN_REVIEW' AND NEW.status IN ('IN_PROGRESS', 'DONE', 'CANCELLED'))
    OR (OLD.status = 'DONE' AND NEW.status = 'IN_PROGRESS')) THEN
    RAISE EXCEPTION 'A task cannot move from % to %.', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  -- A done task is read-only (its completion time included) until it is reopened; only its milestone association may move.
  IF OLD.status = 'DONE' AND NEW.status = 'DONE' AND (NEW.completed_at IS DISTINCT FROM OLD.completed_at OR NEW.title <> OLD.title
     OR NEW.description IS DISTINCT FROM OLD.description OR NEW.assignee_user_id <> OLD.assignee_user_id OR NEW.due_date <> OLD.due_date
     OR NEW.review_required <> OLD.review_required OR NEW.priority <> OLD.priority) THEN
    RAISE EXCEPTION 'A done task is changed only after it is reopened.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$
DECLARE
  name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_tasks_guard' AND tgrelid = 'tenant.project_tasks'::regclass) THEN
    CREATE TRIGGER project_tasks_guard BEFORE UPDATE OR DELETE ON tenant.project_tasks FOR EACH ROW EXECUTE FUNCTION tenant.project_tasks_guard();
  END IF;
  FOREACH name IN ARRAY ARRAY['project_task_reviews', 'project_task_review_decisions', 'project_task_events'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = name || '_append_only' AND tgrelid = ('tenant.' || name)::regclass) THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON tenant.%I FOR EACH ROW EXECUTE FUNCTION tenant.projects_append_only()', name || '_append_only', name);
    END IF;
  END LOOP;
  FOREACH name IN ARRAY ARRAY['project_task_checklist_items', 'project_task_dependencies', 'project_task_blockers', 'project_task_comments'] LOOP
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
  FOREACH name IN ARRAY ARRAY['project_tasks', 'project_task_checklist_items', 'project_task_dependencies', 'project_task_blockers', 'project_task_reviews',
                             'project_task_review_decisions', 'project_task_comments', 'project_task_views', 'project_task_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.project_tasks, tenant.project_task_checklist_items, tenant.project_task_dependencies, tenant.project_task_blockers,
  tenant.project_task_comments TO vercent_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.project_task_views TO vercent_app;
GRANT SELECT, INSERT ON tenant.project_task_reviews, tenant.project_task_review_decisions, tenant.project_task_events TO vercent_app;
GRANT SELECT ON tenant.project_tasks, tenant.project_task_checklist_items, tenant.project_task_dependencies, tenant.project_task_blockers, tenant.project_task_reviews,
  tenant.project_task_review_decisions, tenant.project_task_comments, tenant.project_task_views, tenant.project_task_events TO vercent_worker;

-- ============================================================ 7. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('projects.tasks.view', 'View project tasks', 'Projects', 'See the tasks of the projects you can see.'),
  ('projects.tasks.create', 'Create project tasks', 'Projects', 'Add tasks to projects you lead.'),
  ('projects.tasks.edit', 'Edit project tasks', 'Projects', 'Change a task''s details, dates, checklist, dependencies and milestone.'),
  ('projects.tasks.assign', 'Assign project tasks', 'Projects', 'Give a task to a project member, or move it to another.'),
  ('projects.tasks.start', 'Start project tasks', 'Projects', 'Start work on a task and keep its checklist up to date.'),
  ('projects.tasks.block', 'Block project tasks', 'Projects', 'Mark a task blocked with its reason and owner, and resolve the blocker.'),
  ('projects.tasks.complete', 'Complete project tasks', 'Projects', 'Complete a task once its completion requirements are met.'),
  ('projects.tasks.submit_review', 'Submit tasks for review', 'Projects', 'Submit a task''s work for the required review.'),
  ('projects.tasks.approve', 'Approve project tasks', 'Projects', 'Approve a task submitted for review.'),
  ('projects.tasks.request_changes', 'Request task changes', 'Projects', 'Return a task submitted for review, with the reason.'),
  ('projects.tasks.reopen', 'Reopen project tasks', 'Projects', 'Reopen a done task, with a reason.'),
  ('projects.tasks.cancel', 'Cancel project tasks', 'Projects', 'Cancel a task that is no longer needed, after reviewing what depends on it.'),
  ('projects.tasks.bulk_manage', 'Bulk-manage project tasks', 'Projects', 'Reassign, reprioritise, reschedule, move or cancel several tasks at once.'),
  ('projects.tasks.export', 'Export project tasks', 'Projects', 'Export task lists and reports.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('project_manager', 'projects.tasks.view'), ('project_manager', 'projects.tasks.create'), ('project_manager', 'projects.tasks.edit'),
    ('project_manager', 'projects.tasks.assign'), ('project_manager', 'projects.tasks.start'), ('project_manager', 'projects.tasks.block'),
    ('project_manager', 'projects.tasks.complete'), ('project_manager', 'projects.tasks.submit_review'), ('project_manager', 'projects.tasks.approve'),
    ('project_manager', 'projects.tasks.request_changes'), ('project_manager', 'projects.tasks.reopen'), ('project_manager', 'projects.tasks.cancel'),
    ('project_manager', 'projects.tasks.bulk_manage'), ('project_manager', 'projects.tasks.export'),
    ('employee', 'projects.tasks.view'), ('employee', 'projects.tasks.start'), ('employee', 'projects.tasks.block'), ('employee', 'projects.tasks.complete'),
    ('employee', 'projects.tasks.submit_review'),
    ('sales_head', 'projects.tasks.view'), ('sales_manager', 'projects.tasks.view'),
    ('finance_manager', 'projects.tasks.view'), ('finance_manager', 'projects.tasks.export'),
    ('accountant', 'projects.tasks.view')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0129_projects_tasks.sql', 'projects-tasks') ON CONFLICT DO NOTHING;
