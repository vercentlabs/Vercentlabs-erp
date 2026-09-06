BEGIN;

-- F008 gap: a probable (non-exact) duplicate candidate had no way to be
-- marked "reviewed, not actually a duplicate" — the only recorded outcome
-- was 'create'/'update' (an exact-match override at write time). 'dismiss'
-- reuses the same immutable audit ledger since it is the same underlying
-- event: an explicit, reasoned human disposition of a duplicate-risk
-- signal. It intentionally cannot apply to an 'exact' match — see
-- dismissLeadDuplicateMatch in lead-duplicates.js.
ALTER TABLE tenant.crm_lead_duplicate_overrides
  DROP CONSTRAINT IF EXISTS crm_lead_duplicate_overrides_operation_check;
ALTER TABLE tenant.crm_lead_duplicate_overrides
  ADD CONSTRAINT crm_lead_duplicate_overrides_operation_check
  CHECK (operation IN ('create', 'update', 'dismiss'));

COMMENT ON TABLE tenant.crm_lead_duplicate_overrides
  IS 'Immutable F008 audit ledger for explicitly authorized exact-duplicate Lead overrides and probable-duplicate dismissals.';

COMMIT;
