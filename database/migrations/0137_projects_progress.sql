-- Projects — Progress Tracking. Progress is derived from the tasks and milestones themselves, never typed in. This migration adds only
-- what a derived read model cannot recover later: the history of how progress moved and why, the scope a project started from, and the
-- dates it committed to.
--
--   1. original target   the target date a project had when it started; the current target can move, this one never does.
--   2. target revisions  each change of a started project's target date: from, to, why and who (append-only).
--   3. baselines         the scope a project committed to — its active tasks and required milestones, and its target — captured when it
--                        starts and again on an authorized re-baseline; versioned, append-only.
--   4. snapshots         the progress figures as they stood after each change of scope or state (task added, done, reopened, cancelled;
--                        milestone completed or reopened; project held, resumed, completed, cancelled, reopened), with the calculation
--                        version, the latest source event and the cause; plus daily and lifecycle snapshots with health. Append-only.
--   5. policy            whether project managers receive a weekly progress summary.
--   6. permissions       capture a baseline; export progress.

-- ============================================================ 1. the original target date
ALTER TABLE tenant.projects ADD COLUMN IF NOT EXISTS original_target_end_date date;
-- Started projects take their current target as the original (the earliest commitment still on record).
UPDATE tenant.projects SET original_target_end_date = target_end_date
 WHERE original_target_end_date IS NULL AND target_end_date IS NOT NULL AND actual_start_date IS NOT NULL;

CREATE OR REPLACE FUNCTION tenant.projects_original_target() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.original_target_end_date IS NOT NULL AND NEW.original_target_end_date IS DISTINCT FROM OLD.original_target_end_date THEN
    RAISE EXCEPTION 'A project''s original target date is kept as it was committed.' USING ERRCODE = 'check_violation';
  END IF;
  -- Captured when the project starts.
  IF NEW.original_target_end_date IS NULL AND NEW.status = 'IN_PROGRESS' AND OLD.status IN ('DRAFT', 'PLANNED') THEN
    NEW.original_target_end_date := NEW.target_end_date;
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'projects_original_target') THEN
    CREATE TRIGGER projects_original_target BEFORE UPDATE ON tenant.projects FOR EACH ROW EXECUTE FUNCTION tenant.projects_original_target();
  END IF;
END $$;

-- ============================================================ 2. target revisions
CREATE TABLE IF NOT EXISTS tenant.project_target_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  from_date date,
  to_date date,
  reason text,
  project_status text NOT NULL,
  changed_by uuid REFERENCES public.users(id),
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS project_target_revisions_project_idx ON tenant.project_target_revisions (organization_id, project_id, changed_at);

-- ============================================================ 3. baselines
CREATE TABLE IF NOT EXISTS tenant.project_progress_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  version integer NOT NULL CHECK (version > 0),
  source text NOT NULL CHECK (source IN ('PROJECT_START', 'REBASELINE')),
  task_ids uuid[] NOT NULL DEFAULT '{}',
  milestone_ids uuid[] NOT NULL DEFAULT '{}',
  task_count integer NOT NULL CHECK (task_count >= 0),
  milestone_count integer NOT NULL CHECK (milestone_count >= 0),
  target_end_date date,
  reason text,
  captured_by uuid REFERENCES public.users(id),
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  idempotency_key text,
  UNIQUE (project_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS project_progress_baselines_key_idx ON tenant.project_progress_baselines (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- A project's first baseline is the scope it had when it started: its tasks but the cancelled, its required milestones not cancelled or waived.
CREATE OR REPLACE FUNCTION tenant.projects_capture_baseline() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  tasks uuid[];
  milestones uuid[];
BEGIN
  IF NEW.status = 'IN_PROGRESS' AND OLD.status IN ('DRAFT', 'PLANNED')
     AND NOT EXISTS (SELECT 1 FROM tenant.project_progress_baselines baseline WHERE baseline.project_id = NEW.id) THEN
    SELECT COALESCE(array_agg(id ORDER BY created_at), '{}') INTO tasks FROM tenant.project_tasks WHERE project_id = NEW.id AND status <> 'CANCELLED';
    SELECT COALESCE(array_agg(id ORDER BY sequence), '{}') INTO milestones FROM tenant.project_milestones
     WHERE project_id = NEW.id AND status <> 'CANCELLED' AND required_for_completion AND waived_at IS NULL;
    INSERT INTO tenant.project_progress_baselines (organization_id, project_id, version, source, task_ids, milestone_ids, task_count, milestone_count, target_end_date, reason, captured_by)
    VALUES (NEW.organization_id, NEW.id, 1, 'PROJECT_START', tasks, milestones, cardinality(tasks), cardinality(milestones), NEW.target_end_date, 'Scope when the project started', NEW.updated_by);
  END IF;
  RETURN NULL;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'projects_capture_baseline') THEN
    CREATE TRIGGER projects_capture_baseline AFTER UPDATE OF status ON tenant.projects FOR EACH ROW EXECUTE FUNCTION tenant.projects_capture_baseline();
  END IF;
END $$;

-- ============================================================ 4. snapshots
CREATE TABLE IF NOT EXISTS tenant.project_progress_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  sequence bigint GENERATED ALWAYS AS IDENTITY,
  kind text NOT NULL CHECK (kind IN ('CHANGE', 'DAILY', 'LIFECYCLE', 'REBUILD')),
  snapshot_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  snapshot_day date NOT NULL,
  calculation_version integer NOT NULL,
  source_event_at timestamptz,
  -- What caused it: a task, milestone or project event (CHANGE and LIFECYCLE).
  cause_type text CHECK (cause_type IN ('TASK', 'MILESTONE', 'PROJECT')),
  cause_id uuid,
  cause_action text,
  task_total integer NOT NULL CHECK (task_total >= 0),
  task_done integer NOT NULL CHECK (task_done >= 0 AND task_done <= task_total),
  task_to_do integer NOT NULL DEFAULT 0,
  task_in_progress integer NOT NULL DEFAULT 0,
  task_blocked integer NOT NULL DEFAULT 0,
  task_in_review integer NOT NULL DEFAULT 0,
  task_overdue integer NOT NULL DEFAULT 0,
  task_cancelled integer NOT NULL DEFAULT 0,
  milestone_required_total integer NOT NULL DEFAULT 0,
  milestone_required_completed integer NOT NULL DEFAULT 0,
  milestone_waived integer NOT NULL DEFAULT 0,
  project_status text NOT NULL,
  health text,
  health_reason_codes text[] NOT NULL DEFAULT '{}',
  baseline_version integer,
  created_by uuid REFERENCES public.users(id),
  CONSTRAINT project_progress_snapshots_counts_check CHECK (task_to_do + task_in_progress + task_blocked + task_in_review + task_done = task_total)
);
CREATE INDEX IF NOT EXISTS project_progress_snapshots_project_idx ON tenant.project_progress_snapshots (organization_id, project_id, sequence);
CREATE INDEX IF NOT EXISTS project_progress_snapshots_day_idx ON tenant.project_progress_snapshots (organization_id, snapshot_day, project_id);
-- One daily snapshot per project and day.
CREATE UNIQUE INDEX IF NOT EXISTS project_progress_snapshots_daily_idx ON tenant.project_progress_snapshots (project_id, snapshot_day) WHERE kind = 'DAILY';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_target_revisions_append_only') THEN
    CREATE TRIGGER project_target_revisions_append_only BEFORE UPDATE OR DELETE ON tenant.project_target_revisions FOR EACH ROW EXECUTE FUNCTION tenant.projects_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_progress_baselines_append_only') THEN
    CREATE TRIGGER project_progress_baselines_append_only BEFORE UPDATE OR DELETE ON tenant.project_progress_baselines FOR EACH ROW EXECUTE FUNCTION tenant.projects_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_progress_snapshots_append_only') THEN
    CREATE TRIGGER project_progress_snapshots_append_only BEFORE UPDATE OR DELETE ON tenant.project_progress_snapshots FOR EACH ROW EXECUTE FUNCTION tenant.projects_append_only();
  END IF;
END $$;

-- ============================================================ 5. policy
ALTER TABLE tenant.project_settings ADD COLUMN IF NOT EXISTS progress_weekly_summary boolean NOT NULL DEFAULT false;

-- ============================================================ isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['project_target_revisions', 'project_progress_baselines', 'project_progress_snapshots'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT ON tenant.project_target_revisions, tenant.project_progress_baselines, tenant.project_progress_snapshots TO vercent_app;
GRANT SELECT ON tenant.project_target_revisions, tenant.project_progress_baselines, tenant.project_progress_snapshots TO vercent_worker;

-- ============================================================ 6. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('projects.progress.baseline', 'Re-baseline project scope', 'Projects', 'Record a new approved scope baseline for the projects you lead.'),
  ('projects.progress.export', 'Export project progress', 'Projects', 'Export the progress reports of the projects you can see.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('project_manager', 'projects.progress.baseline'), ('project_manager', 'projects.progress.export'),
    ('finance_manager', 'projects.progress.export'), ('sales_head', 'projects.progress.export')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0137_projects_progress.sql', 'projects-progress') ON CONFLICT DO NOTHING;
