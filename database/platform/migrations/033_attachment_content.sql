BEGIN;

ALTER TABLE public.attachments
  ADD COLUMN IF NOT EXISTS content bytea,
  ADD COLUMN IF NOT EXISTS content_sha256 char(64);

CREATE INDEX IF NOT EXISTS attachments_entity_lookup_idx
  ON public.attachments(organization_id, entity_type, entity_id, created_at DESC);

COMMIT;
