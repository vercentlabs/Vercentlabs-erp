-- CRM Tasks: a piece of work with one owner and a due date, usually about a
-- lead, account, contact or opportunity.
--
--   1. Task fields — number, whether a due time was given, who completed or
--      cancelled it and why, the chosen reminder, the overdue notice
--   2. Task history — append-only: created, assigned, rescheduled, completed,
--      reopened, cancelled…
--   3. Existing tasks — numbered, and "overdue" no longer stored as a status
--   4. Row-level security and grants
--   5. Permissions
--
-- A task stays a row of tenant.crm_activities (activity_type = 'task'), the
-- table every CRM timeline and "next activity" already reads. Overdue, due
-- today and upcoming are calculated from the due date, never stored.
--
-- Run once, after 0014_crm_sales_stages.sql.

SELECT pg_catalog.set_config('search_path', '', false);

-- ============================================================ 1. task fields

ALTER TABLE tenant.crm_activities
  ADD COLUMN task_number text,
  -- false: only a due date was given; due_at is then the end of that day in the organization's time zone
  ADD COLUMN due_time_set boolean DEFAULT true NOT NULL,
  ADD COLUMN completed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN cancelled_at timestamp with time zone,
  ADD COLUMN cancelled_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN cancellation_reason text,
  -- the reminder as chosen: minutes before the due time (0 = at the due time); null = no reminder
  ADD COLUMN reminder_offset_minutes integer,
  -- set once the assignee has been told the task is overdue
  ADD COLUMN overdue_notified_at timestamp with time zone,
  ADD CONSTRAINT crm_activities_cancellation_reason_check CHECK (cancellation_reason IS NULL OR char_length(cancellation_reason) <= 500),
  ADD CONSTRAINT crm_activities_reminder_offset_check CHECK (reminder_offset_minutes IS NULL OR (reminder_offset_minutes >= 0 AND reminder_offset_minutes <= 43200));

CREATE UNIQUE INDEX crm_activities_task_number_uidx ON tenant.crm_activities (organization_id, task_number) WHERE task_number IS NOT NULL;
CREATE INDEX crm_activities_open_tasks_idx ON tenant.crm_activities (organization_id, assigned_to, due_at)
  WHERE activity_type = 'task' AND status = ANY (ARRAY['planned', 'in_progress', 'overdue']);

-- ============================================================ 2. task history

CREATE TABLE tenant.crm_task_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tenant.crm_activities(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  summary text NOT NULL,
  changes jsonb DEFAULT '{}'::jsonb NOT NULL,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT crm_task_history_event_type_check CHECK (event_type = ANY (ARRAY[
    'created', 'updated', 'assigned', 'reassigned', 'rescheduled', 'priority_changed', 'related_changed', 'reminder_changed',
    'started', 'completed', 'reopened', 'cancelled']))
);
CREATE INDEX crm_task_history_idx ON tenant.crm_task_history (organization_id, task_id, created_at DESC);

-- ============================================================ 3. existing tasks

-- Overdue is calculated from the due date; a task is open, in progress, completed or cancelled.
UPDATE tenant.crm_activities SET status = 'planned' WHERE activity_type = 'task' AND status = 'overdue';
-- Low, medium and high: an urgent task is a high one.
UPDATE tenant.crm_activities SET priority = 'high' WHERE activity_type = 'task' AND priority = 'urgent';
UPDATE tenant.crm_activities SET completed_by = COALESCE(updated_by, assigned_to) WHERE activity_type = 'task' AND status = 'completed' AND completed_by IS NULL;
UPDATE tenant.crm_activities SET cancelled_at = updated_at, cancelled_by = updated_by WHERE activity_type = 'task' AND status = 'cancelled' AND cancelled_at IS NULL;

-- A number for every task already there, in the order they were created, and the counter set after them.
UPDATE tenant.crm_activities activity
   SET task_number = 'TSK-' || lpad(numbered.position::text, 5, '0')
  FROM (SELECT id, row_number() OVER (PARTITION BY organization_id ORDER BY created_at, id) AS position
          FROM tenant.crm_activities WHERE activity_type = 'task') numbered
 WHERE activity.id = numbered.id;

INSERT INTO tenant.document_sequences (organization_id, document_type, period_key, prefix, padding, next_value)
SELECT organization_id, 'crm_task', 'global', 'TSK-', 5, count(*) + 1
  FROM tenant.crm_activities WHERE activity_type = 'task'
 GROUP BY organization_id
ON CONFLICT (organization_id, document_type, period_key) DO NOTHING;

-- ============================================================ 4. row-level security and grants

ALTER TABLE tenant.crm_task_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_task_history FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.crm_task_history USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
-- Read and added to, never changed. Rows go only with a task deleted because it was never used.
GRANT SELECT, INSERT ON TABLE tenant.crm_task_history TO vercent_app, vercent_worker;
GRANT DELETE ON TABLE tenant.crm_task_history TO vercent_app;

-- ============================================================ 5. permissions

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('crm.tasks.view', 'View tasks', 'CRM', 'See the tasks assigned to you or created by you.'),
  ('crm.tasks.view_team', 'View team tasks', 'CRM', 'See the tasks of the people in the sales teams you manage.'),
  ('crm.tasks.view_all', 'View all tasks', 'CRM', 'See every task in the organization, on records you can see.'),
  ('crm.tasks.create', 'Create tasks', 'CRM', 'Add a task, for yourself or for someone else.'),
  ('crm.tasks.edit', 'Edit tasks', 'CRM', 'Change a task''s title, description, priority, due date and reminder.'),
  ('crm.tasks.complete', 'Complete tasks', 'CRM', 'Mark a task completed.'),
  ('crm.tasks.reopen', 'Reopen tasks', 'CRM', 'Reopen a completed or cancelled task.'),
  ('crm.tasks.cancel', 'Cancel tasks', 'CRM', 'Cancel a task that is no longer needed.'),
  ('crm.tasks.delete', 'Delete tasks', 'CRM', 'Delete a task created by mistake that was never worked on.'),
  ('crm.tasks.assign', 'Assign tasks', 'CRM', 'Give a task to someone else when creating it.'),
  ('crm.tasks.reassign', 'Reassign tasks', 'CRM', 'Move a task from one person to another.')
ON CONFLICT (key) DO NOTHING;

-- Workspaces that already exist. Whoever could manage CRM activities works tasks day to day.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key
  FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY[
    'crm.tasks.view', 'crm.tasks.create', 'crm.tasks.edit', 'crm.tasks.complete', 'crm.tasks.reopen', 'crm.tasks.cancel', 'crm.tasks.assign'])
 WHERE existing.permission_key = 'crm.activities.manage'
ON CONFLICT DO NOTHING;

-- Whoever can read CRM can read their own tasks.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'crm.tasks.view'
  FROM public.role_permissions existing
 WHERE existing.permission_key = 'crm.view'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, permission.key
  FROM public.roles role
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['crm.tasks.reassign', 'crm.tasks.delete', 'crm.tasks.view_team'])
 WHERE role.is_system AND role.slug = ANY (ARRAY['sales_manager', 'sales_head', 'sales_operations', 'crm_administrator', 'system_administrator'])
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, 'crm.tasks.view_all'
  FROM public.roles role
 WHERE role.is_system AND role.slug = ANY (ARRAY['sales_head', 'sales_operations', 'crm_administrator', 'system_administrator'])
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0015_crm_tasks.sql', 'crm-tasks');
