-- CRM Follow-ups and Reminders: when to contact a customer or revisit a deal
-- again, by whom and how.
--
--   1. Follow-up fields — number, type (call, email, meeting, demo, other),
--      outcome, the lead it came from, the activity its completion logged
--   2. Follow-up history — append-only: scheduled, rescheduled, reassigned,
--      completed, cancelled, snoozed…
--   3. Existing follow-ups — numbered, typed, and "overdue" no longer stored
--   4. Row-level security and grants
--   5. Permissions
--
-- A follow-up stays a row of tenant.crm_activities (activity_type =
-- 'follow_up'), which every CRM timeline and "next follow-up" already reads,
-- and its reminder a row of tenant.crm_activity_reminders, the one reminder
-- mechanism tasks and meetings use too. Overdue, due today and upcoming are
-- calculated from the scheduled time, never stored.
--
-- Run once, after 0015_crm_tasks.sql.

SELECT pg_catalog.set_config('search_path', '', false);

-- ============================================================ 1. follow-up fields

ALTER TABLE tenant.crm_activities
  ADD COLUMN follow_up_number text,
  ADD COLUMN follow_up_type text,
  -- how the follow-up went, chosen when it is completed
  ADD COLUMN outcome_code text,
  -- the lead a follow-up was scheduled on before the lead was converted
  ADD COLUMN origin_lead_id uuid,
  -- the call, email or meeting its completion recorded on the timeline
  ADD COLUMN logged_activity_id uuid,
  ADD CONSTRAINT crm_activities_follow_up_type_check CHECK (follow_up_type IS NULL OR follow_up_type = ANY (ARRAY['call', 'email', 'meeting', 'demo', 'other'])),
  ADD CONSTRAINT crm_activities_outcome_code_check CHECK (outcome_code IS NULL OR outcome_code = ANY (ARRAY[
    'connected', 'no_response', 'interested', 'not_interested', 'meeting_scheduled', 'other']));

CREATE UNIQUE INDEX crm_activities_follow_up_number_uidx ON tenant.crm_activities (organization_id, follow_up_number) WHERE follow_up_number IS NOT NULL;
CREATE INDEX crm_activities_open_follow_ups_idx ON tenant.crm_activities (organization_id, assigned_to, due_at)
  WHERE activity_type = 'follow_up' AND status = ANY (ARRAY['planned', 'in_progress', 'overdue']);

-- ============================================================ 2. follow-up history

CREATE TABLE tenant.crm_follow_up_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  follow_up_id uuid NOT NULL REFERENCES tenant.crm_activities(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  summary text NOT NULL,
  changes jsonb DEFAULT '{}'::jsonb NOT NULL,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT crm_follow_up_history_event_type_check CHECK (event_type = ANY (ARRAY[
    'scheduled', 'updated', 'rescheduled', 'reassigned', 'transferred', 'reminder_changed', 'snoozed', 'related_changed', 'completed', 'cancelled']))
);
CREATE INDEX crm_follow_up_history_idx ON tenant.crm_follow_up_history (organization_id, follow_up_id, created_at DESC);

-- ============================================================ 3. existing follow-ups

UPDATE tenant.crm_activities SET status = 'planned' WHERE activity_type = 'follow_up' AND status = 'overdue';
UPDATE tenant.crm_activities
   SET follow_up_type = CASE follow_up_channel WHEN 'call' THEN 'call' WHEN 'email' THEN 'email' WHEN 'meeting' THEN 'meeting' ELSE 'other' END
 WHERE activity_type = 'follow_up' AND follow_up_type IS NULL;
UPDATE tenant.crm_activities SET completed_by = COALESCE(updated_by, assigned_to) WHERE activity_type = 'follow_up' AND status = 'completed' AND completed_by IS NULL;
UPDATE tenant.crm_activities SET cancelled_at = updated_at, cancelled_by = updated_by WHERE activity_type = 'follow_up' AND status = 'cancelled' AND cancelled_at IS NULL;

UPDATE tenant.crm_activities activity
   SET follow_up_number = 'FUP-' || lpad(numbered.position::text, 5, '0')
  FROM (SELECT id, row_number() OVER (PARTITION BY organization_id ORDER BY created_at, id) AS position
          FROM tenant.crm_activities WHERE activity_type = 'follow_up') numbered
 WHERE activity.id = numbered.id;

INSERT INTO tenant.document_sequences (organization_id, document_type, period_key, prefix, padding, next_value)
SELECT organization_id, 'crm_follow_up', 'global', 'FUP-', 5, count(*) + 1
  FROM tenant.crm_activities WHERE activity_type = 'follow_up'
 GROUP BY organization_id
ON CONFLICT (organization_id, document_type, period_key) DO NOTHING;

-- ============================================================ 4. row-level security and grants

ALTER TABLE tenant.crm_follow_up_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_follow_up_history FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.crm_follow_up_history USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
-- Read and added to, never changed. Rows go only with a follow-up deleted because it was never used.
GRANT SELECT, INSERT ON TABLE tenant.crm_follow_up_history TO vercent_app, vercent_worker;
GRANT DELETE ON TABLE tenant.crm_follow_up_history TO vercent_app;

-- ============================================================ 5. permissions

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('crm.follow_ups.view', 'View follow-ups', 'CRM', 'See the follow-ups assigned to you or created by you.'),
  ('crm.follow_ups.view_team', 'View team follow-ups', 'CRM', 'See the follow-ups of the people in the sales teams you manage.'),
  ('crm.follow_ups.view_all', 'View all follow-ups', 'CRM', 'See every follow-up in the organization, on records you can see.'),
  ('crm.follow_ups.create', 'Create follow-ups', 'CRM', 'Schedule a follow-up, for yourself or for someone else.'),
  ('crm.follow_ups.edit', 'Edit follow-ups', 'CRM', 'Change a follow-up''s subject, type, contact, notes and reminder.'),
  ('crm.follow_ups.complete', 'Complete follow-ups', 'CRM', 'Mark a follow-up completed, with its outcome.'),
  ('crm.follow_ups.reschedule', 'Reschedule follow-ups', 'CRM', 'Move a follow-up to another date or time.'),
  ('crm.follow_ups.cancel', 'Cancel follow-ups', 'CRM', 'Cancel a follow-up that is no longer needed.'),
  ('crm.follow_ups.reassign', 'Reassign follow-ups', 'CRM', 'Give a follow-up to someone else.'),
  ('crm.follow_ups.delete', 'Delete follow-ups', 'CRM', 'Delete a follow-up created by mistake that was never used.')
ON CONFLICT (key) DO NOTHING;

-- Workspaces that already exist. Whoever could manage CRM activities works follow-ups day to day.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key
  FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY[
    'crm.follow_ups.view', 'crm.follow_ups.create', 'crm.follow_ups.edit', 'crm.follow_ups.complete', 'crm.follow_ups.reschedule', 'crm.follow_ups.cancel'])
 WHERE existing.permission_key = 'crm.activities.manage'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'crm.follow_ups.view'
  FROM public.role_permissions existing
 WHERE existing.permission_key = 'crm.view'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, permission.key
  FROM public.roles role
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['crm.follow_ups.reassign', 'crm.follow_ups.delete', 'crm.follow_ups.view_team'])
 WHERE role.is_system AND role.slug = ANY (ARRAY['sales_manager', 'sales_head', 'sales_operations', 'crm_administrator', 'system_administrator'])
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, 'crm.follow_ups.view_all'
  FROM public.roles role
 WHERE role.is_system AND role.slug = ANY (ARRAY['sales_head', 'sales_operations', 'crm_administrator', 'system_administrator'])
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0016_crm_follow_ups.sql', 'crm-follow-ups');
