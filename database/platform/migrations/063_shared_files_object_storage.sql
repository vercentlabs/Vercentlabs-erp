BEGIN;

-- Shared Platform files (Prompt 5). public.attachments becomes the shared file
-- metadata table: PostgreSQL keeps metadata, object storage keeps bytes.
--
--   storage_mode 'database_legacy'  rows written before this migration; their
--                                   bytes stay in attachments.content and remain
--                                   readable through the compatibility path.
--   storage_mode 'object'           bytes live in object storage under
--                                   storage_key; content must be NULL.
-- The column default becomes 'object' and the CHECK below rejects bytes on an
-- object row, so no code path can silently keep writing blobs to PostgreSQL.
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS storage_mode text;
UPDATE attachments SET storage_mode = 'database_legacy' WHERE storage_mode IS NULL;
ALTER TABLE attachments ALTER COLUMN storage_mode SET DEFAULT 'object';
ALTER TABLE attachments ALTER COLUMN storage_mode SET NOT NULL;
ALTER TABLE attachments DROP CONSTRAINT IF EXISTS attachments_storage_mode_check;
ALTER TABLE attachments ADD CONSTRAINT attachments_storage_mode_check CHECK (storage_mode IN ('database_legacy', 'object'));
ALTER TABLE attachments DROP CONSTRAINT IF EXISTS attachments_object_has_no_content;
ALTER TABLE attachments ADD CONSTRAINT attachments_object_has_no_content CHECK (storage_mode <> 'object' OR content IS NULL);

-- Which object store holds the bytes (e.g. 'local', 'memory', later the
-- production provider chosen in Prompt 6).
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS storage_provider text;

-- What the file is for. Export artifacts and generated report outputs are
-- temporary: expires_at is set, downloads after it answer 410, and the worker
-- later removes the bytes (content_removed_at) while the row stays as evidence.
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'attachment';
ALTER TABLE attachments DROP CONSTRAINT IF EXISTS attachments_purpose_check;
ALTER TABLE attachments ADD CONSTRAINT attachments_purpose_check CHECK (purpose IN ('attachment', 'export', 'report_output', 'inbound_mail'));
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS content_removed_at timestamptz;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS attachments_expiry_purge_idx
  ON attachments (expires_at)
  WHERE storage_mode = 'object' AND expires_at IS NOT NULL AND content_removed_at IS NULL;

COMMIT;
