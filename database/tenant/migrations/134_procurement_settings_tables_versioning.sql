BEGIN;

-- procurement_policies, procurement_source_rules and procurement_portal_users are
-- written through the same generic child-record engine as every other Procurement
-- child table (sites, catalog items, bids, ...), which stores a version, a content
-- hash, the acting user and an optional idempotency key on each row. These three
-- tables were created without those columns, so creating or updating any record in
-- them failed with "column content_hash does not exist" -- in particular the
-- invoice-matching tolerance policy could never be set.
ALTER TABLE tenant.procurement_policies
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS updated_by uuid,
  ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE tenant.procurement_source_rules
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS updated_by uuid,
  ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE tenant.procurement_portal_users
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS updated_by uuid,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS procurement_policies_idempotency_uidx ON tenant.procurement_policies(organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS procurement_source_rules_idempotency_uidx ON tenant.procurement_source_rules(organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS procurement_portal_users_idempotency_uidx ON tenant.procurement_portal_users(organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

COMMIT;
