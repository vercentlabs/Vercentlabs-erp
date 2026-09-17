BEGIN;

-- POS Implementation Tracker (docs/03-modules/point-of-sale/
-- POS_IMPLEMENTATION_TRACKER.md), Tranche 1 (F276): pos_sales.customer_id
-- had no foreign key to tenant.business_parties at all — the audit found
-- completePointOfSale accepted any UUID (or none) here with zero
-- validation, alongside an always-trusted, unvalidated free-text
-- customer_name. The domain function now validates customerId against
-- tenant.business_parties (party_type IN ('customer','both'), status=
-- 'active', organization-shared or company-scoped) before completing a
-- sale; this constraint is the database-level backstop for that same
-- invariant, matching the ON DELETE SET NULL pattern every other optional
-- business_parties reference in this codebase already uses (a completed
-- sale must survive if the referenced party record is later archived/
-- deleted, not be silently deleted itself).
ALTER TABLE tenant.pos_sales
  ADD CONSTRAINT pos_sales_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES tenant.business_parties(id) ON DELETE SET NULL
  NOT VALID;
ALTER TABLE tenant.pos_sales VALIDATE CONSTRAINT pos_sales_customer_id_fkey;

COMMIT;
