-- Projects — Assignees. A task has one primary assignee, kept on the task itself (project_tasks.assignee_user_id, from 0129); there is no
-- second assignment table. What this feature adds to the database is the reading it needs to be fast:
--
--   * a task's assignment history (created, reassigned, left the project) and the reassignments report, from the task history;
--   * what a team member still owns before they leave: the tasks they review and the blockers they own (milestone owners: 0128);
--   * the workload of each person across the projects (open tasks by assignee, from 0129's assignee index).
--
-- Reassignment reasons are recorded in each REASSIGNED event's details (reasonCode, reasonText, the versions before and after).

CREATE INDEX IF NOT EXISTS project_task_events_assignment_idx ON tenant.project_task_events (organization_id, task_id, occurred_at)
  WHERE action IN ('CREATED', 'REASSIGNED', 'ASSIGNEE_LEFT');
CREATE INDEX IF NOT EXISTS project_task_events_reassigned_idx ON tenant.project_task_events (organization_id, occurred_at DESC)
  WHERE action = 'REASSIGNED';

CREATE INDEX IF NOT EXISTS project_tasks_reviewer_idx ON tenant.project_tasks (organization_id, project_id, reviewer_user_id)
  WHERE reviewer_user_id IS NOT NULL AND status IN ('TO_DO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW');
CREATE INDEX IF NOT EXISTS project_task_blockers_owner_idx ON tenant.project_task_blockers (organization_id, owner_user_id)
  WHERE status = 'ACTIVE';

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0131_projects_assignees.sql', 'projects-assignees') ON CONFLICT DO NOTHING;
