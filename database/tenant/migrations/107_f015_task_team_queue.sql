BEGIN;

-- Prompt 6 (CRM-CAP-004, F015 — Tasks), closing the item migration 106's own
-- comment deliberately left open: "team/queue assignment is a separate,
-- still-open item." The dossier requires real team/queue Tasks (individual
-- assignee, sales/team queue, unclaimed queued Task, claim, release/
-- reassign, team membership validation, owner/manager permissions), not an
-- invented CRM-only team system. tenant.crm_sales_teams/crm_sales_team_
-- members (migration 003) is already the platform's real, populated team
-- identity — used today for Lead assignment/eligibility (lead-governance.js)
-- and for F016's escalation-manager lookup (seller-activity-and-follow-up-
-- workspace/shared/notify.js's getManagerForUser). Reusing it here rather
-- than a second team table is exactly "only implement the Task-side
-- semantics needed now" against the existing team identity contract that
-- Prompt 7's deeper Teams/Territories work will build on, not duplicate.
ALTER TABLE tenant.crm_activities
  ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES tenant.crm_sales_teams(id) ON DELETE SET NULL;

-- A queued (unclaimed) Task is exactly assigned_to IS NULL AND team_id IS
-- NOT NULL — this partial index backs both the "my team's queue" list and
-- the atomic claim UPDATE's WHERE clause.
CREATE INDEX IF NOT EXISTS crm_activities_task_queue_idx
  ON tenant.crm_activities(organization_id, team_id, due_at)
  WHERE activity_type = 'task' AND team_id IS NOT NULL AND assigned_to IS NULL;

CREATE INDEX IF NOT EXISTS crm_activities_task_team_idx
  ON tenant.crm_activities(organization_id, team_id)
  WHERE activity_type = 'task' AND team_id IS NOT NULL;

COMMIT;
