BEGIN;

-- Prompt 6 (CRM-CAP-004, F017 — Notes & Files). Re-audit confirmed Notes had
-- no dedicated domain module (a single Lead-only POST route with raw SQL),
-- no versioning of any kind (an edit would have silently overwritten prior
-- content — except no edit path even existed yet), and no optimistic-
-- concurrency check. This closes those three gaps.
--
-- version is the CURRENT row's version number; crm_note_versions is the
-- append-only ledger of every PRIOR version's content — an edit inserts the
-- about-to-be-replaced content into crm_note_versions before overwriting
-- crm_notes, so historical content is never silently lost, and the current
-- Note row always references its own latest version via its own `version`
-- column (no separate "current" pointer needed).
ALTER TABLE tenant.crm_notes
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS tenant.crm_note_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  note_id uuid NOT NULL REFERENCES tenant.crm_notes(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  body text NOT NULL,
  is_pinned boolean NOT NULL,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, note_id, version)
);
CREATE INDEX IF NOT EXISTS crm_note_versions_note_idx
  ON tenant.crm_note_versions(organization_id, note_id, version DESC);

-- Governed attachments beyond Lead reuse the SAME public.attachments table
-- (already generic: entity_type/entity_id, lifecycle_status already covers
-- pending/uploaded/quarantined/clean/rejected/archived per platform
-- migration 035) — no schema change needed there, just a shared domain
-- service (see attachments.js) instead of duplicating the Lead route's SQL
-- three more times.

DO $$
BEGIN
  EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', 'crm_note_versions');
  EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', 'crm_note_versions');
  EXECUTE format('DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.%I', 'crm_note_versions');
  EXECUTE format(
    'CREATE POLICY tenant_organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())',
    'crm_note_versions'
  );
END $$;

COMMIT;
