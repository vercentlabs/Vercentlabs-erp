BEGIN;

CREATE TABLE IF NOT EXISTS tenant.crm_account_merge_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_party_id uuid NOT NULL,
  survivor_party_id uuid NOT NULL REFERENCES tenant.business_parties(id) ON DELETE RESTRICT,
  source_snapshot jsonb NOT NULL,
  survivor_snapshot jsonb NOT NULL,
  reason text,
  merged_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  merged_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_party_id <> survivor_party_id)
);

CREATE TABLE IF NOT EXISTS tenant.crm_contact_merge_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_contact_id uuid NOT NULL,
  survivor_contact_id uuid NOT NULL REFERENCES tenant.contacts(id) ON DELETE RESTRICT,
  source_snapshot jsonb NOT NULL,
  survivor_snapshot jsonb NOT NULL,
  reason text,
  merged_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  merged_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_contact_id <> survivor_contact_id)
);

CREATE INDEX IF NOT EXISTS crm_account_merge_survivor_idx
  ON tenant.crm_account_merge_history(organization_id, survivor_party_id, merged_at DESC);
CREATE INDEX IF NOT EXISTS crm_contact_merge_survivor_idx
  ON tenant.crm_contact_merge_history(organization_id, survivor_contact_id, merged_at DESC);

ALTER TABLE tenant.crm_account_merge_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_account_merge_history FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.crm_account_merge_history
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());

ALTER TABLE tenant.crm_contact_merge_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_contact_merge_history FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.crm_contact_merge_history
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());

REVOKE UPDATE, DELETE ON tenant.crm_account_merge_history FROM PUBLIC;
REVOKE UPDATE, DELETE ON tenant.crm_contact_merge_history FROM PUBLIC;

COMMIT;
