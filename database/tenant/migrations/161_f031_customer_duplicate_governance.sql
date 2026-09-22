BEGIN;

-- F031 Customer Master: Sales customer creation now reuses the same governed
-- duplicate-detection/override policy CRM already applies to Accounts
-- (findAccountDuplicates/recordAccountDuplicateOverride,
-- 089_f008_account_contact_duplicate_overrides.sql) instead of relying only
-- on the DB-level unique constraints on code/gstin, which never catch a
-- differently-coded duplicate of the same legal entity. Both modules write
-- to the same immutable ledger table -- this column exists purely so an
-- override row can be attributed to the module that created it; it changes
-- nothing about the table's existing immutability trigger or RLS policy.
ALTER TABLE tenant.crm_account_duplicate_overrides
  ADD COLUMN IF NOT EXISTS source_module text NOT NULL DEFAULT 'crm'
    CHECK (source_module IN ('crm', 'sales'));

COMMIT;
