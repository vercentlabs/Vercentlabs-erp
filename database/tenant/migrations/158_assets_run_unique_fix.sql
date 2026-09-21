BEGIN;

-- Migration 157 named the old unique constraint by its untruncated name, which Postgres had shortened, so
-- it never dropped. Find it by its columns instead.
DO $$
DECLARE conname text;
BEGIN
  FOR conname IN
    SELECT c.conname FROM pg_constraint c
    WHERE c.conrelid='tenant.asset_depreciation_runs'::regclass AND c.contype='u'
      AND (SELECT array_agg(a.attname ORDER BY a.attname) FROM pg_attribute a WHERE a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)) = ARRAY['company_id','organization_id','period_end']::name[]
  LOOP
    EXECUTE format('ALTER TABLE tenant.asset_depreciation_runs DROP CONSTRAINT %I', conname);
  END LOOP;
END $$;

COMMIT;
