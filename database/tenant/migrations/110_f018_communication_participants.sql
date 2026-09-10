BEGIN;

-- Prompt 6 (CRM-CAP-004, F018 — Email), final closeout pass: the
-- "participant" visibility tier migration 104 deliberately deferred
-- ("participants would require matching To/Cc addresses back to real user
-- accounts (no such mapping exists today)") is built here.
--
-- crm_communication_participants is the missing address-to-identity
-- mapping: one row per address on a communication (sender/recipient/cc/
-- bcc), resolved at write time against public.users (internal) and
-- tenant.contacts (external CRM Contact) by email match. A row with both
-- user_id and contact_id NULL means the address matched neither — still
-- recorded (so the full participant list is always complete for display),
-- just never satisfies the participant-visibility check below.
--
-- Resolving an address to a Contact NEVER grants that Contact's owning
-- login (if any) application access — contact_id is participant metadata
-- only. Only user_id (an internal user) can ever satisfy the
-- participant-visibility predicate.
CREATE TABLE IF NOT EXISTS tenant.crm_communication_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  communication_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('sender', 'recipient', 'cc', 'bcc')),
  email_address text NOT NULL,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES tenant.contacts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, communication_id, role, email_address),
  FOREIGN KEY (organization_id, communication_id)
    REFERENCES tenant.crm_communications(organization_id, id) ON DELETE CASCADE
);

-- crm_communications has no (organization_id, id) unique/PK pair to satisfy
-- the composite FK above yet (its PK is bare id) — add the composite
-- unique index every other tenant table in this cluster already carries
-- (crm_email_threads, crm_email_messages both do this same pattern).
CREATE UNIQUE INDEX IF NOT EXISTS crm_communications_org_id_idx
  ON tenant.crm_communications(organization_id, id);

CREATE INDEX IF NOT EXISTS crm_communication_participants_lookup_idx
  ON tenant.crm_communication_participants(organization_id, communication_id);

-- The participant-visibility EXISTS check's hot path: "is this caller a
-- participant on this communication" by user_id.
CREATE INDEX IF NOT EXISTS crm_communication_participants_user_idx
  ON tenant.crm_communication_participants(organization_id, user_id)
  WHERE user_id IS NOT NULL;

ALTER TABLE tenant.crm_communications
  DROP CONSTRAINT IF EXISTS crm_communications_visibility_check;
ALTER TABLE tenant.crm_communications
  ADD CONSTRAINT crm_communications_visibility_check CHECK (visibility IN ('team', 'private', 'participant'));

-- Same tenant-isolation convention every other tenant table uses (see
-- migration 106's own RLS loop).
ALTER TABLE tenant.crm_communication_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_communication_participants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.crm_communication_participants;
CREATE POLICY tenant_organization_isolation ON tenant.crm_communication_participants
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());

COMMIT;
