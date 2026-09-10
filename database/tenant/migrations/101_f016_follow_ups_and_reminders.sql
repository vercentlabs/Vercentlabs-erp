BEGIN;

-- Prompt 6 (CRM-CAP-004): F016 Follow-ups and reminders. Re-audit confirmed
-- this feature had no dedicated schema at all — only the shared
-- `crm_activities.reminder_at` column existed, with no reminder dispatch,
-- no multiple-reminder support, no escalation, no dedup. This migration:
--   1. Adds 'follow_up' as a valid crm_activities.activity_type, specializing
--      the canonical Activity row exactly like Calls (069) and Meetings (070)
--      did, rather than creating a second/parallel entity ledger.
--   2. Adds an immutable crm_follow_up_events history ledger, matching the
--      crm_call_events/crm_meeting_events/crm_task_events precedent.
--   3. Adds crm_activity_reminders — a first-class, activity-agnostic
--      multi-reminder table (works for any crm_activities row, not just
--      follow-ups), since "multiple reminders" is a real, first-class
--      requirement (DEC-CRM-P1-F016) that a single timestamp column cannot
--      represent.

ALTER TABLE tenant.crm_activities
  DROP CONSTRAINT IF EXISTS crm_activities_activity_type_check;
ALTER TABLE tenant.crm_activities
  ADD CONSTRAINT crm_activities_activity_type_check
  CHECK (activity_type IN ('task', 'call', 'meeting', 'email', 'whatsapp', 'sms', 'note', 'follow_up'));

-- Follow-up-specific columns, gated to activity_type='follow_up' exactly
-- like call_*/meeting_* columns are gated to their own activity_type.
ALTER TABLE tenant.crm_activities
  ADD COLUMN IF NOT EXISTS follow_up_reason text,
  ADD COLUMN IF NOT EXISTS follow_up_channel text,
  ADD COLUMN IF NOT EXISTS follow_up_snooze_count integer NOT NULL DEFAULT 0,
  -- Per-follow-up escalation policy (proportionate substitute for a full
  -- policy table — no existing "escalation policy" concept applies cleanly
  -- to ad hoc seller follow-ups the way crm_lead_sla_policies does to
  -- inbound-response SLAs). NULL = escalation disabled for this follow-up.
  ADD COLUMN IF NOT EXISTS follow_up_escalate_after_minutes integer,
  ADD COLUMN IF NOT EXISTS follow_up_escalated_at timestamptz,
  ADD COLUMN IF NOT EXISTS follow_up_escalated_to uuid REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE tenant.crm_activities
  DROP CONSTRAINT IF EXISTS crm_activities_follow_up_channel_check;
ALTER TABLE tenant.crm_activities
  ADD CONSTRAINT crm_activities_follow_up_channel_check
  CHECK (follow_up_channel IS NULL OR follow_up_channel IN ('call', 'email', 'meeting', 'whatsapp', 'sms', 'other'));

ALTER TABLE tenant.crm_activities
  DROP CONSTRAINT IF EXISTS crm_activities_follow_up_scope_check;
ALTER TABLE tenant.crm_activities
  ADD CONSTRAINT crm_activities_follow_up_scope_check
  CHECK (
    (activity_type = 'follow_up') OR
    (follow_up_reason IS NULL AND follow_up_channel IS NULL AND follow_up_snooze_count = 0
      AND follow_up_escalate_after_minutes IS NULL AND follow_up_escalated_at IS NULL AND follow_up_escalated_to IS NULL)
  );

ALTER TABLE tenant.crm_activities
  DROP CONSTRAINT IF EXISTS crm_activities_follow_up_escalate_minutes_check;
ALTER TABLE tenant.crm_activities
  ADD CONSTRAINT crm_activities_follow_up_escalate_minutes_check
  CHECK (follow_up_escalate_after_minutes IS NULL OR (follow_up_escalate_after_minutes > 0 AND follow_up_escalate_after_minutes <= 43200));

CREATE TABLE IF NOT EXISTS tenant.crm_follow_up_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  activity_id uuid NOT NULL REFERENCES tenant.crm_activities(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('created', 'updated', 'snoozed', 'completed', 'cancelled', 'escalated')),
  from_status text,
  to_status text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_follow_up_events_activity_idx
  ON tenant.crm_follow_up_events(organization_id, activity_id, occurred_at DESC, id DESC);

-- Activity-agnostic multi-reminder table: one crm_activities row (a
-- Follow-up, but also usable later for Tasks/Meetings/Calls without a
-- schema change) can own several reminder rows. `fire_at` is the resolved,
-- working-hours-adjusted absolute instant this specific reminder should
-- fire — computed and stored at creation/reschedule time so the dispatch
-- worker can do a simple indexed range scan rather than recomputing
-- business-hours math on every tick.
CREATE TABLE IF NOT EXISTS tenant.crm_activity_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  activity_id uuid NOT NULL REFERENCES tenant.crm_activities(id) ON DELETE CASCADE,
  -- Minutes before the activity's due_at this reminder should fire; 0 = at
  -- due time. The pair (activity_id, offset_minutes) is the natural
  -- dedup/idempotency key for "one reminder configuration per offset."
  offset_minutes integer NOT NULL CHECK (offset_minutes >= 0 AND offset_minutes <= 43200),
  channel text NOT NULL CHECK (channel IN ('in_app', 'email')),
  fire_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'acknowledged', 'failed', 'cancelled')),
  sent_at timestamptz,
  delivered_at timestamptz,
  acknowledged_at timestamptz,
  failure_reason text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, activity_id, offset_minutes, channel)
);
CREATE INDEX IF NOT EXISTS crm_activity_reminders_due_idx
  ON tenant.crm_activity_reminders(organization_id, status, fire_at)
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION tenant.crm_follow_up_events_immutable_f016()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CRM Follow-up event history is immutable';
END;
$$;
DROP TRIGGER IF EXISTS crm_follow_up_events_immutable_f016 ON tenant.crm_follow_up_events;
CREATE TRIGGER crm_follow_up_events_immutable_f016
BEFORE UPDATE OR DELETE ON tenant.crm_follow_up_events
FOR EACH ROW EXECUTE FUNCTION tenant.crm_follow_up_events_immutable_f016();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['crm_follow_up_events', 'crm_activity_reminders'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())',
      t
    );
  END LOOP;
END $$;

COMMIT;
