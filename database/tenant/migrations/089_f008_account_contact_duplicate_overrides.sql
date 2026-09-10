BEGIN;

-- CRM vNext Prompt 3 continuation (CRM-VNEXT-045): F008 requires "merge or
-- dismiss" generically across the whole feature (F008-CAP-001) and the data
-- model section names crm_account_merge_history/crm_contact_merge_history as
-- structures the feature MUST explicitly govern (F008-DATA-001) — but only
-- crm_lead_duplicate_overrides existed. These two tables give Accounts and
-- Contacts the same immutable, reasoned override/dismissal ledger Leads
-- already have, mirroring crm_lead_duplicate_overrides' exact shape
-- (064_crm_lead_duplicate_detection_f008.sql) rather than inventing a new
-- pattern.
--
-- `signature` and `rules_snapshot_at` exist because the dossier is silent on
-- when a dismissal should go stale (confirmed by direct re-read this
-- prompt) — this is a deliberate, documented design choice, not a dossier
-- requirement: a dismissal is valid only for the exact normalized signal
-- values and rule configuration that produced the match at dismissal time.
-- If either the underlying record's matched fields change, or the relevant
-- duplicate rules are edited afterward, the stored signature/snapshot no
-- longer matches current state and the application layer treats the
-- dismissal as stale (the candidate pair resurfaces on the next scan rather
-- than staying silently suppressed against outdated evidence).

CREATE TABLE IF NOT EXISTS tenant.crm_account_duplicate_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  party_id uuid NOT NULL,
  matched_party_ids uuid[] NOT NULL,
  operation text NOT NULL CHECK (operation IN ('create', 'update', 'dismiss')),
  reason text NOT NULL,
  signature text NOT NULL,
  rules_snapshot_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, party_id)
    REFERENCES tenant.business_parties(organization_id, id) ON DELETE RESTRICT,
  CHECK (cardinality(matched_party_ids) > 0),
  CHECK (length(btrim(reason)) BETWEEN 10 AND 1000)
);

CREATE INDEX IF NOT EXISTS crm_account_duplicate_overrides_party_idx
  ON tenant.crm_account_duplicate_overrides(organization_id, party_id, created_at DESC);

CREATE OR REPLACE FUNCTION tenant.crm_account_duplicate_override_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Account duplicate override history is immutable';
END;
$$;
DROP TRIGGER IF EXISTS crm_account_duplicate_overrides_immutable
  ON tenant.crm_account_duplicate_overrides;
CREATE TRIGGER crm_account_duplicate_overrides_immutable
BEFORE UPDATE OR DELETE ON tenant.crm_account_duplicate_overrides
FOR EACH ROW EXECUTE FUNCTION tenant.crm_account_duplicate_override_immutable();

ALTER TABLE tenant.crm_account_duplicate_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_account_duplicate_overrides FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_organization_isolation
  ON tenant.crm_account_duplicate_overrides;
CREATE POLICY tenant_organization_isolation
  ON tenant.crm_account_duplicate_overrides
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true)::uuid);

CREATE TABLE IF NOT EXISTS tenant.crm_contact_duplicate_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL,
  matched_contact_ids uuid[] NOT NULL,
  operation text NOT NULL CHECK (operation IN ('create', 'update', 'dismiss')),
  reason text NOT NULL,
  signature text NOT NULL,
  rules_snapshot_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, contact_id)
    REFERENCES tenant.contacts(organization_id, id) ON DELETE RESTRICT,
  CHECK (cardinality(matched_contact_ids) > 0),
  CHECK (length(btrim(reason)) BETWEEN 10 AND 1000)
);

CREATE INDEX IF NOT EXISTS crm_contact_duplicate_overrides_contact_idx
  ON tenant.crm_contact_duplicate_overrides(organization_id, contact_id, created_at DESC);

CREATE OR REPLACE FUNCTION tenant.crm_contact_duplicate_override_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Contact duplicate override history is immutable';
END;
$$;
DROP TRIGGER IF EXISTS crm_contact_duplicate_overrides_immutable
  ON tenant.crm_contact_duplicate_overrides;
CREATE TRIGGER crm_contact_duplicate_overrides_immutable
BEFORE UPDATE OR DELETE ON tenant.crm_contact_duplicate_overrides
FOR EACH ROW EXECUTE FUNCTION tenant.crm_contact_duplicate_override_immutable();

ALTER TABLE tenant.crm_contact_duplicate_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_contact_duplicate_overrides FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_organization_isolation
  ON tenant.crm_contact_duplicate_overrides;
CREATE POLICY tenant_organization_isolation
  ON tenant.crm_contact_duplicate_overrides
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true)::uuid);

COMMENT ON TABLE tenant.crm_account_duplicate_overrides
  IS 'Immutable F008 audit ledger for Account exact-duplicate create/update overrides and probable-duplicate dismissals. Mirrors crm_lead_duplicate_overrides.';
COMMENT ON TABLE tenant.crm_contact_duplicate_overrides
  IS 'Immutable F008 audit ledger for Contact exact-duplicate create/update overrides and probable-duplicate dismissals. Mirrors crm_lead_duplicate_overrides.';

COMMIT;
