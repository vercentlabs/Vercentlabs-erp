BEGIN;

-- F008 gap-closure (benchmark: "Duplicate detection in top ERPs") — the
-- original crm_duplicate_rules seeding (migration 090) populated defaults
-- only for organizations that already existed at the time it ran, via a
-- one-time CROSS JOIN. Unlike two sibling per-organization configuration
-- tables elsewhere in this system (lead qualification criteria, lead
-- lifecycle stages), this table had no AFTER INSERT ON organizations
-- trigger, so every organization created since that migration shipped
-- silently received zero duplicate-matching rules for Accounts/Contacts —
-- and since the matching functions simply return no results when no rules
-- are enabled, duplicate detection for those two entity types has been
-- completely (and invisibly) inert for any such organization. Lead
-- duplicate detection is unaffected: it never reads this table. Seeds the
-- exact same defaults migration 090 used, so this changes nothing for any
-- organization that already has rules — ON CONFLICT DO NOTHING is
-- redundant here (a fresh org has no rows yet) but kept for symmetry with
-- the one-time backfill's own idempotency guard.
CREATE OR REPLACE FUNCTION tenant.crm_seed_duplicate_rules_defaults()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = tenant, public
AS $$
BEGIN
  INSERT INTO tenant.crm_duplicate_rules
    (organization_id, entity_type, signal, method, weight, enabled, blocking, created_by, updated_by)
  VALUES
    (NEW.id, 'lead', 'email', 'exact', 70, true, true, NEW.created_by, NEW.created_by),
    (NEW.id, 'lead', 'mobile', 'normalized', 55, true, true, NEW.created_by, NEW.created_by),
    (NEW.id, 'lead', 'name_and_company', 'normalized', 30, true, false, NEW.created_by, NEW.created_by),
    (NEW.id, 'contact', 'email', 'exact', 70, true, true, NEW.created_by, NEW.created_by),
    (NEW.id, 'contact', 'mobile', 'normalized', 55, true, true, NEW.created_by, NEW.created_by),
    (NEW.id, 'contact', 'name', 'normalized', 30, true, false, NEW.created_by, NEW.created_by),
    (NEW.id, 'account', 'gstin', 'exact', 70, true, true, NEW.created_by, NEW.created_by),
    (NEW.id, 'account', 'pan', 'exact', 45, true, false, NEW.created_by, NEW.created_by),
    (NEW.id, 'account', 'legal_name', 'normalized', 35, true, false, NEW.created_by, NEW.created_by)
  ON CONFLICT (organization_id, entity_type, signal, method) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crm_seed_duplicate_rules_defaults ON public.organizations;
CREATE TRIGGER crm_seed_duplicate_rules_defaults AFTER INSERT ON public.organizations
FOR EACH ROW EXECUTE FUNCTION tenant.crm_seed_duplicate_rules_defaults();

-- Backfill: any organization created between migration 090 and this one
-- (the exact gap this migration closes) still has zero rules today. Same
-- defaults, same idempotency guard.
INSERT INTO tenant.crm_duplicate_rules
  (organization_id, entity_type, signal, method, weight, enabled, blocking)
SELECT organizations.id, entity_type, signal, method, weight, true, blocking
FROM public.organizations
CROSS JOIN (VALUES
  ('lead', 'email', 'exact', 70, true),
  ('lead', 'mobile', 'normalized', 55, true),
  ('lead', 'name_and_company', 'normalized', 30, false),
  ('contact', 'email', 'exact', 70, true),
  ('contact', 'mobile', 'normalized', 55, true),
  ('contact', 'name', 'normalized', 30, false),
  ('account', 'gstin', 'exact', 70, true),
  ('account', 'pan', 'exact', 45, false),
  ('account', 'legal_name', 'normalized', 35, false)
) AS defaults(entity_type, signal, method, weight, blocking)
ON CONFLICT (organization_id, entity_type, signal, method) DO NOTHING;

-- F008 gap-closure — a genuine full-dataset duplicate scan (background
-- job, not the honestly-scoped 40-most-recent-records workspace check).
-- Reuses tenant.background_jobs for the job row itself (job_type=
-- 'crm.duplicates.full_scan'), mirroring the F007 stage-migration job's
-- shape exactly. This table is a pure append-only discovery log — it never
-- tracks a match's resolution status itself (dismiss/merge already have
-- their own authoritative tables elsewhere), so a pair found here that was
-- since dismissed or merged simply won't reappear the next time someone
-- reviews it live, the same honest-staleness model the rest of F008
-- already uses.
CREATE TABLE IF NOT EXISTS tenant.crm_duplicate_scan_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES tenant.background_jobs(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('lead', 'contact', 'account')),
  record_a_id uuid NOT NULL,
  record_b_id uuid NOT NULL,
  classification text NOT NULL CHECK (classification IN ('exact', 'probable')),
  matched_signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (record_a_id <> record_b_id),
  UNIQUE (organization_id, job_id, record_a_id, record_b_id)
);
CREATE INDEX IF NOT EXISTS crm_duplicate_scan_matches_job_idx
  ON tenant.crm_duplicate_scan_matches(organization_id, job_id, entity_type);

ALTER TABLE tenant.crm_duplicate_scan_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_duplicate_scan_matches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.crm_duplicate_scan_matches;
CREATE POLICY tenant_organization_isolation ON tenant.crm_duplicate_scan_matches
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true)::uuid);

COMMENT ON TABLE tenant.crm_duplicate_scan_matches IS
  'F008 full-dataset duplicate scan results — an append-only discovery log per background job; resolution (dismiss/merge) is tracked by the existing per-entity override/merge-history tables, not here.';

COMMIT;
