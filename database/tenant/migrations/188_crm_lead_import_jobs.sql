BEGIN;

-- F021 Lead import at enterprise volume. Large imports run as a durable,
-- resumable background job in chunks (each chunk its own short transaction),
-- instead of one request processing every row inside one transaction.
--   * Batch: queued/processing states, the job that runs it, progress
--     counters, the dry-run report and timings.
--   * Row: the planned action from the dry run (create/update/skip/error), an
--     error code, and the earlier row an in-file duplicate repeats.

ALTER TABLE tenant.crm_lead_import_batches DROP CONSTRAINT IF EXISTS crm_lead_import_batches_status_check;
ALTER TABLE tenant.crm_lead_import_batches
  ADD CONSTRAINT crm_lead_import_batches_status_check
  CHECK (status IN ('previewed', 'queued', 'processing', 'committing', 'completed', 'completed_with_errors', 'failed', 'rolled_back'));

ALTER TABLE tenant.crm_lead_import_batches
  ADD COLUMN IF NOT EXISTS job_id uuid,
  ADD COLUMN IF NOT EXISTS processed_rows integer NOT NULL DEFAULT 0 CHECK (processed_rows >= 0),
  ADD COLUMN IF NOT EXISTS failed_rows integer NOT NULL DEFAULT 0 CHECK (failed_rows >= 0),
  ADD COLUMN IF NOT EXISTS dry_run_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS failure_reason text;

ALTER TABLE tenant.crm_lead_import_rows
  ADD COLUMN IF NOT EXISTS planned_action text CHECK (planned_action IN ('create', 'update', 'skip', 'error')),
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS duplicate_of_row integer;

-- The worker claims the next pending rows of a batch in row order.
CREATE INDEX IF NOT EXISTS crm_lead_import_rows_pending_idx
  ON tenant.crm_lead_import_rows(organization_id, batch_id, row_number)
  WHERE action = 'pending';
CREATE INDEX IF NOT EXISTS crm_lead_import_rows_error_idx
  ON tenant.crm_lead_import_rows(organization_id, batch_id, row_number)
  WHERE action = 'error';

COMMIT;
