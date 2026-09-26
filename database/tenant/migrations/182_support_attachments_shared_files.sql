BEGIN;

-- Support attachments reference a Shared Platform file (public.attachments)
-- instead of a free-text storage key the caller typed. Legacy rows keep their
-- old storage_key text for history; they never had stored bytes.
ALTER TABLE tenant.support_attachments ADD COLUMN IF NOT EXISTS file_id uuid REFERENCES public.attachments(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS support_attachments_file_uidx ON tenant.support_attachments (organization_id, file_id) WHERE file_id IS NOT NULL;

COMMIT;
