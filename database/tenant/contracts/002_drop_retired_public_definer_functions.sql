BEGIN;

-- CONTRACT. Six SECURITY DEFINER lookups with no caller anywhere
-- (DEFINER_FUNCTIONS "retired" in packages/database/src/table-classification.js).
-- EXECUTE was already revoked from everyone (tenant migration 185).
-- Precondition: nothing in the database depends on them.

DO $$
DECLARE
  dependents integer;
BEGIN
  SELECT count(*) INTO dependents
    FROM pg_depend dependency
    JOIN pg_proc fn ON fn.oid = dependency.refobjid
    JOIN pg_namespace n ON n.oid = fn.pronamespace
   WHERE n.nspname = 'tenant'
     AND fn.proname IN ('crm_public_acquisition_connection', 'crm_public_capture_form_v2', 'crm_public_chat_session',
                        'crm_public_marketing_event', 'crm_public_marketing_survey', 'crm_public_sync_account')
     AND dependency.deptype = 'n';
  IF dependents > 0 THEN
    RAISE EXCEPTION 'contract precondition failed: % database object(s) still depend on the retired public lookup functions', dependents;
  END IF;
END
$$;

DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT p.oid::regprocedure AS signature
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'tenant'
       AND p.proname IN ('crm_public_acquisition_connection', 'crm_public_capture_form_v2', 'crm_public_chat_session',
                         'crm_public_marketing_event', 'crm_public_marketing_survey', 'crm_public_sync_account')
  LOOP
    EXECUTE format('DROP FUNCTION %s', target.signature);
  END LOOP;
END
$$;

COMMIT;
