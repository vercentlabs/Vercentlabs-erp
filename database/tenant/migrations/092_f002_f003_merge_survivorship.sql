BEGIN;

-- CRM vNext Prompt 3 second continuation (CRM-VNEXT-086): field-level merge
-- survivorship. `source_snapshot`/`survivor_snapshot` already capture each
-- record's PRE-merge state; `field_selections` records which record's value
-- won for each field the user was shown a choice for, so "old survivor
-- value + selection = new value" is fully reconstructable without a third,
-- redundant post-merge snapshot.
ALTER TABLE tenant.crm_account_merge_history
  ADD COLUMN IF NOT EXISTS field_selections jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tenant.crm_contact_merge_history
  ADD COLUMN IF NOT EXISTS field_selections jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN tenant.crm_account_merge_history.field_selections
  IS 'Map of field -> "source"|"survivor" recording which candidate''s value was kept for each field the merge UI showed a conflict for.';
COMMENT ON COLUMN tenant.crm_contact_merge_history.field_selections
  IS 'Map of field -> "source"|"survivor" recording which candidate''s value was kept for each field the merge UI showed a conflict for.';

COMMIT;
