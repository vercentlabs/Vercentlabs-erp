BEGIN;

-- Prompt 6: SECURITY DEFINER functions run with their owner's rights, so
-- nobody may call them by default. EXECUTE is revoked from PUBLIC here and
-- granted per runtime role by `pnpm db:provision:runtime-role` from the
-- registry in packages/database/src/table-classification.js
-- (DEFINER_FUNCTIONS). Trigger functions need no EXECUTE grant; the six
-- functions without any caller are dropped by a contract migration.
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT p.oid::regprocedure AS signature
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'tenant' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', target.signature);
  END LOOP;
END
$$;

COMMIT;
