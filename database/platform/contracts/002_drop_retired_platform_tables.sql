BEGIN;

-- CONTRACT. Drops platform tables classified RETIRED
-- (packages/database/src/table-classification.js):
--   public.numbering_series        replaced by tenant.document_numbering_policies
--                                  and document_sequences (tenant migration 181)
--   public.mobile_idempotency_keys never used by any runtime path
-- Preconditions: every legacy series was carried into the new numbering
-- policies (so no organisation can re-issue a number), and no idempotency
-- record is still inside its validity window.

DO $$
DECLARE
  unmigrated integer := 0;
  live_keys integer := 0;
BEGIN
  IF to_regclass('public.numbering_series') IS NOT NULL THEN
    SELECT count(*) INTO unmigrated
      FROM public.numbering_series series
     WHERE NOT EXISTS (
       SELECT 1 FROM tenant.document_numbering_policies policy
        WHERE policy.organization_id = series.organization_id AND policy.document_type = series.entity_type
     );
    IF unmigrated > 0 THEN
      RAISE EXCEPTION 'contract precondition failed: % numbering series have no numbering policy (re-run the tenant migration 181 carry-over first)', unmigrated;
    END IF;
  END IF;
  IF to_regclass('public.mobile_idempotency_keys') IS NOT NULL THEN
    SELECT count(*) INTO live_keys FROM public.mobile_idempotency_keys WHERE expires_at > now();
    IF live_keys > 0 THEN
      RAISE EXCEPTION 'contract precondition failed: % unexpired mobile idempotency key(s) exist', live_keys;
    END IF;
  END IF;
END
$$;

DROP TABLE IF EXISTS public.numbering_series;
DROP TABLE IF EXISTS public.mobile_idempotency_keys;

COMMIT;
