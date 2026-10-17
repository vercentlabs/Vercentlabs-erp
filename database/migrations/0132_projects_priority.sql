-- Projects — Priority. One four-level priority (URGENT, HIGH, NORMAL, LOW; NORMAL by default) is stored on each record: projects (0125),
-- milestones (0128) and tasks (0129) each already hold the column with that check and default. A parent's priority never flows into its
-- children. Every change is a PRIORITY_CHANGED event in the record's own history (from, to, reason, the versions), so nothing here adds a
-- second store. What this feature adds is the reading it needs to be fast:
--
--   * the work queues filtered and ordered by priority ("Needs attention", Urgent and High queues, counts by level);
--   * the priority reports (open work by priority across projects, milestones and tasks; by person; by project);
--   * the priority change history of projects, milestones and tasks (the "Priority changes" report and the completed-by-priority report).

CREATE INDEX IF NOT EXISTS project_tasks_open_priority_idx ON tenant.project_tasks (organization_id, priority, due_date)
  WHERE status IN ('TO_DO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW') AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS project_milestones_open_priority_idx ON tenant.project_milestones (organization_id, priority)
  WHERE status IN ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'SUBMITTED');
CREATE INDEX IF NOT EXISTS projects_priority_idx ON tenant.projects (organization_id, priority)
  WHERE deleted_at IS NULL AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS project_task_events_priority_idx ON tenant.project_task_events (organization_id, task_id, occurred_at)
  WHERE action = 'PRIORITY_CHANGED';
CREATE INDEX IF NOT EXISTS project_milestone_events_priority_idx ON tenant.project_milestone_events (organization_id, occurred_at)
  WHERE action = 'PRIORITY_CHANGED';
CREATE INDEX IF NOT EXISTS project_events_priority_idx ON tenant.project_events (organization_id, occurred_at)
  WHERE action = 'PRIORITY_CHANGED';

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0132_projects_priority.sql', 'projects-priority') ON CONFLICT DO NOTHING;
