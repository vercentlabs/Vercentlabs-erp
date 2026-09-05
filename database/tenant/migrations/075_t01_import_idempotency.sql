BEGIN;

-- T01 / SP023: make shared master-data imports retry-safe. The job row and
-- imported business rows are committed in one tenant transaction; a retry with
-- the same idempotency key therefore replays the committed result rather than
-- executing rows again. A reused key with different content fails closed.
ALTER TABLE tenant.master_data_import_jobs
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS request_fingerprint char(64),
  ADD COLUMN IF NOT EXISTS result_payload jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS master_data_import_jobs_idempotency_uidx
  ON tenant.master_data_import_jobs(organization_id, resource, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='tenant.master_data_import_jobs'::regclass
      AND conname='master_data_import_jobs_request_fingerprint_check'
  ) THEN
    ALTER TABLE tenant.master_data_import_jobs
      ADD CONSTRAINT master_data_import_jobs_request_fingerprint_check
      CHECK (request_fingerprint IS NULL OR request_fingerprint ~ '^[0-9a-f]{64}$');
  END IF;
END $$;

COMMIT;
