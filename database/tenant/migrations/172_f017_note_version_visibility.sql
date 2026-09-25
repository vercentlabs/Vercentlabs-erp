BEGIN;

-- F017 Notes: crm_note_versions snapshotted only body and is_pinned, so a
-- change of visibility (notably private -> shared, which exposes the text to
-- everyone who can see the parent record) overwrote the column and left no
-- trace in the append-only ledger. The version row now also records the
-- visibility that was in force for the content it archives. Existing rows
-- stay NULL (unknown at the time).
ALTER TABLE tenant.crm_note_versions
  ADD COLUMN IF NOT EXISTS visibility text;
ALTER TABLE tenant.crm_note_versions
  DROP CONSTRAINT IF EXISTS crm_note_versions_visibility_check;
ALTER TABLE tenant.crm_note_versions
  ADD CONSTRAINT crm_note_versions_visibility_check
  CHECK (visibility IS NULL OR visibility IN ('shared', 'private'));

COMMIT;
