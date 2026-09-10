BEGIN;

-- CRM vNext Prompt 3 continuation (CRM-VNEXT-081): F003 dossier gap —
-- Contacts could only ever be linked to a single Account (`contacts.party_id`),
-- and there was no stakeholder-role concept on that relationship at all.
--
-- Design notes (the dossier names "multiple relationship roles" and
-- "stakeholder role" as open enterprise scope in F003-CAP-002 but does not
-- specify a data-model shape or a role vocabulary, fixed or configurable —
-- confirmed by direct re-read this prompt):
--
-- * `relationship_type` and `stakeholder_role` are two distinct attributes.
--   `relationship_type` describes the NATURE of the link ('employment' — the
--   contact works at this Account; 'affiliated' — an external contact who
--   deals with this Account without working there, e.g. an advisor or
--   partner contact; 'other'). `stakeholder_role` describes the person's
--   INFLUENCE/FUNCTION in the relationship, deliberately using the same
--   vocabulary the org already uses for this exact concept elsewhere
--   (`tenant.crm_account_stakeholders.stakeholder_role`, scoped to
--   `account_plan_id` — a different, more advanced feature). Reusing the
--   *table* would be wrong (that table requires an account_plan and treats
--   contact_id as optional — a fundamentally different aggregate); reusing
--   the *vocabulary* is a deliberate consistency choice, not scope creep.
--   Both fields are nullable — a relationship need not have a role, and
--   'employment' is the safe default for the backfilled primary link.
-- * `is_primary` here means "the Contact's primary Account" — this is a NEW
--   concept, orthogonal to the pre-existing `contacts.is_primary` (which
--   means "the Account's primary point-of-contact" — that column's meaning
--   is UNCHANGED by this migration).
-- * No effective-dating columns: the dossier does not mention effective
--   dating for this specific relationship (re-confirmed this prompt); adding
--   it now would be speculative scope, not a traced requirement.
-- * `contacts.party_id`/`contacts.is_primary` are NOT removed or
--   deprecated — they remain the fast, backward-compatible "primary Account"
--   pointer every existing caller already reads, and are kept in sync with
--   this table's primary row by the application layer (contact-operations.js)
--   going forward. This table is additive, not a replacement migration.

CREATE TABLE IF NOT EXISTS tenant.crm_contact_account_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL,
  party_id uuid NOT NULL,
  relationship_type text NOT NULL DEFAULT 'employment'
    CHECK (relationship_type IN ('employment', 'affiliated', 'other')),
  stakeholder_role text
    CHECK (stakeholder_role IS NULL OR stakeholder_role IN (
      'economic_buyer', 'decision_maker', 'champion', 'influencer',
      'user', 'blocker', 'procurement', 'legal', 'technical', 'other'
    )),
  is_primary boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  notes text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, contact_id, party_id),
  FOREIGN KEY (organization_id, contact_id)
    REFERENCES tenant.contacts(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, party_id)
    REFERENCES tenant.business_parties(organization_id, id) ON DELETE CASCADE
);

-- At most one active primary relationship per Contact — mirrors the shape of
-- contacts_primary_party_idx (which enforces the same "at most one" rule in
-- the other direction, per Account).
CREATE UNIQUE INDEX IF NOT EXISTS crm_contact_account_relationships_primary_idx
  ON tenant.crm_contact_account_relationships(organization_id, contact_id)
  WHERE is_primary = true AND status = 'active';

CREATE INDEX IF NOT EXISTS crm_contact_account_relationships_contact_idx
  ON tenant.crm_contact_account_relationships(organization_id, contact_id, status);
CREATE INDEX IF NOT EXISTS crm_contact_account_relationships_party_idx
  ON tenant.crm_contact_account_relationships(organization_id, party_id, status);

ALTER TABLE tenant.crm_contact_account_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_contact_account_relationships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_organization_isolation
  ON tenant.crm_contact_account_relationships;
CREATE POLICY tenant_organization_isolation
  ON tenant.crm_contact_account_relationships
  USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
  )
  WITH CHECK (
    organization_id = current_setting('app.current_organization_id', true)::uuid
  );

CREATE OR REPLACE FUNCTION tenant.crm_contact_account_relationships_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS crm_contact_account_relationships_touch
  ON tenant.crm_contact_account_relationships;
CREATE TRIGGER crm_contact_account_relationships_touch
BEFORE UPDATE ON tenant.crm_contact_account_relationships
FOR EACH ROW EXECUTE FUNCTION tenant.crm_contact_account_relationships_touch();

-- Backfill: every existing Contact with an Account becomes that Contact's
-- primary relationship. Idempotent via ON CONFLICT DO NOTHING against the
-- (organization_id, contact_id, party_id) unique constraint, so re-running
-- this migration (or running it after some relationships already exist from
-- a partial prior run) never duplicates or corrupts data.
INSERT INTO tenant.crm_contact_account_relationships
  (organization_id, contact_id, party_id, relationship_type, is_primary, status, created_by, updated_by, created_at, updated_at)
SELECT
  contact.organization_id,
  contact.id,
  contact.party_id,
  'employment',
  true,
  contact.status,
  contact.created_by,
  contact.updated_by,
  contact.created_at,
  contact.updated_at
FROM tenant.contacts contact
WHERE contact.party_id IS NOT NULL
ON CONFLICT (organization_id, contact_id, party_id) DO NOTHING;

COMMENT ON TABLE tenant.crm_contact_account_relationships
  IS 'F003: governed multi-Account Contact relationships. contacts.party_id/is_primary remain the fast primary-Account pointer, kept in sync with the is_primary=true row here by the application layer. Rollback: DROP TABLE — contacts.party_id/is_primary are untouched by this migration and remain independently correct if this table is ever dropped.';

COMMIT;
