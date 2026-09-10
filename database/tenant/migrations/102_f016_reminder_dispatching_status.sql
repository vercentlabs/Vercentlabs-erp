BEGIN;

-- F016: the reminder-dispatch worker claims due reminders with a short,
-- lock-scoped UPDATE (pending -> dispatching) before doing the actual
-- (potentially slow) delivery I/O outside any transaction lock, then marks
-- the real outcome (sent/failed) in a separate follow-up statement. This
-- needs one more transient status value than migration 101 declared.
ALTER TABLE tenant.crm_activity_reminders
  DROP CONSTRAINT IF EXISTS crm_activity_reminders_status_check;
ALTER TABLE tenant.crm_activity_reminders
  ADD CONSTRAINT crm_activity_reminders_status_check
  CHECK (status IN ('pending', 'dispatching', 'sent', 'delivered', 'acknowledged', 'failed', 'cancelled'));

COMMIT;
