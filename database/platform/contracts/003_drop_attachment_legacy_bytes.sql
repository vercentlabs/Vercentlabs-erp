BEGIN;

-- CONTRACT. File bytes live only in object storage. Run only after:
--   pnpm files:migrate-legacy   (until "remaining" is 0)
--   pnpm files:reconcile        (healthy: no missing or drifted object)
-- Reconciliation needs object storage and cannot run inside SQL; the
-- precondition here refuses to drop anything while a single legacy row still
-- holds bytes.

DO $$
DECLARE
  legacy integer;
BEGIN
  SELECT count(*) INTO legacy FROM public.attachments WHERE storage_mode = 'database_legacy';
  IF legacy > 0 THEN
    RAISE EXCEPTION 'contract precondition failed: % attachment(s) still stored in PostgreSQL (run pnpm files:migrate-legacy, then pnpm files:reconcile)', legacy;
  END IF;
END
$$;

ALTER TABLE public.attachments DROP CONSTRAINT IF EXISTS attachments_object_has_no_content;
ALTER TABLE public.attachments DROP COLUMN IF EXISTS content;
ALTER TABLE public.attachments DROP CONSTRAINT IF EXISTS attachments_storage_mode_check;
ALTER TABLE public.attachments ADD CONSTRAINT attachments_storage_mode_check CHECK (storage_mode = 'object');

COMMIT;
