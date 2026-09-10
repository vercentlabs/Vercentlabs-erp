BEGIN;

-- Prompt 6 (CRM-CAP-004, F016 — Follow-ups and reminders), closing
-- CRM-VNEXT-052's remaining half: "No push/email delivery worker exists for
-- the nurture queue" (the Scheduled Follow-ups half of this same issue was
-- already closed by migration 101/102's crm_activity_reminders worker).
-- tenant.crm_lead_nurture_queue (migration 035) is a real, populated,
-- system-computed queue with due_at/status/owner_user_id, but nothing ever
-- claims a due item and notifies its owner — refreshLeadNurtureQueue() only
-- recomputes membership/priority on manual API call, confirmed by grep
-- showing zero worker/scheduler references to "nurture" anywhere.
--
-- notified_at tracks whether a due item has already triggered its one
-- in-app/email notification, so a worker tick is idempotent against itself
-- (claim query below only matches notified_at IS NULL) without needing a
-- separate delivery-log table — the nurture queue item IS the delivery
-- record, mirroring how crm_activity_reminders' own status column serves
-- the same purpose for Scheduled Follow-ups.
ALTER TABLE tenant.crm_lead_nurture_queue
  ADD COLUMN IF NOT EXISTS notified_at timestamptz;

CREATE INDEX IF NOT EXISTS crm_lead_nurture_queue_due_unnotified_idx
  ON tenant.crm_lead_nurture_queue(organization_id, due_at)
  WHERE status = 'active' AND notified_at IS NULL;

COMMIT;
