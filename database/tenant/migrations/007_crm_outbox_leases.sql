BEGIN;

ALTER TABLE tenant.crm_outbox_events
  ADD COLUMN IF NOT EXISTS locked_by text;

DROP INDEX IF EXISTS tenant.crm_outbox_pending_idx;
CREATE INDEX IF NOT EXISTS crm_outbox_claimable_idx
  ON tenant.crm_outbox_events(organization_id, status, next_attempt_at, locked_at)
  WHERE status IN ('pending', 'failed', 'processing');

COMMIT;
