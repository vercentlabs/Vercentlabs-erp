BEGIN;

-- Prompt 6 (CRM-CAP-004, F017 — Notes & Files), final closeout pass:
-- CRM-VNEXT-053's remaining half. Every attachment upload created a fully
-- independent row with no logical-file identity — re-uploading a
-- "replacement" for an existing file silently created an unrelated new
-- attachment with no linkage to the one it was meant to supersede.
--
-- logical_id is the stable identity across versions: for every row
-- uploaded before this migration, logical_id = id (each existing
-- attachment becomes its own one-version logical file — zero data loss,
-- zero behavior change for anything already uploaded). A genuine
-- "replace this file" upload reuses the ORIGINAL logical_id, increments
-- version, and the new row becomes the current one — the old row is never
-- deleted or overwritten, so filename/MIME/size/uploader/timestamp/
-- storage reference/scan-quarantine state for every prior version stays
-- exactly as it was (each version is a full row, not a diff).
ALTER TABLE public.attachments
  ADD COLUMN IF NOT EXISTS logical_id uuid,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT true;

UPDATE public.attachments SET logical_id = id WHERE logical_id IS NULL;

ALTER TABLE public.attachments
  ALTER COLUMN logical_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS attachments_logical_version_idx
  ON public.attachments(organization_id, logical_id, version);

-- At most one current version per logical file, per organization — the
-- row createCrmAttachment's replacement path reads to resolve "the next
-- version number" and the one getCrmAttachmentContent/listCrmAttachments
-- treat as "the" file when no specific version is requested.
CREATE UNIQUE INDEX IF NOT EXISTS attachments_logical_current_idx
  ON public.attachments(organization_id, logical_id) WHERE is_current;

CREATE INDEX IF NOT EXISTS attachments_logical_lookup_idx
  ON public.attachments(organization_id, logical_id, version DESC);

COMMIT;
