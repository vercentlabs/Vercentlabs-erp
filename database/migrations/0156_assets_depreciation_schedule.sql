-- Assets — Depreciation Schedule. Extends Straight-Line Depreciation's schedule versions (no second schedule or engine) with the schedule's
-- own lifecycle and approval trail. `status` keeps its meaning — whether a version is the plan in force (CURRENT) or not (SUPERSEDED), with
-- one plan in force per asset — and `lifecycle_status` says what the version is:
--
--   DRAFT              generated from a proposed basis for review (not in force)
--   VALIDATION_FAILED  its financial inputs changed or were inconsistent (not in force; kept with the reason)
--   CURRENT            the approved plan in force
--   SUPERSEDED         replaced by an approved revision (or a discarded draft)
--   COMPLETED          every month recognized; still the plan in force, nothing left to charge
--   TERMINATED         closed by a disposal or another authorized financial event (no longer in force)
--
-- Each period's status (planned, due, in posting, posted, adjusted, skipped, exception) is derived from run lines and Finance's journals,
-- never stored as an editable figure. Additive:
--
--   1. versions   lifecycle, approval, the version it supersedes, policy, effective month, closing reason, validation errors, row version.
--   2. guard      figures and inputs never change; status and lifecycle move forward only.

-- ============================================================ 1. versions
ALTER TABLE tenant.asset_depreciation_schedule_versions
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'CURRENT'
    CHECK (lifecycle_status IN ('DRAFT', 'VALIDATION_FAILED', 'CURRENT', 'SUPERSEDED', 'COMPLETED', 'TERMINATED')),
  ADD COLUMN IF NOT EXISTS supersedes_schedule_id uuid REFERENCES tenant.asset_depreciation_schedule_versions(id),
  ADD COLUMN IF NOT EXISTS policy_id uuid REFERENCES tenant.asset_depreciation_policies(id),
  ADD COLUMN IF NOT EXISTS effective_from date,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_reason text,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;
-- The plan in force is CURRENT or COMPLETED; every other lifecycle is not in force.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_depreciation_schedule_versions_lifecycle_check') THEN
    ALTER TABLE tenant.asset_depreciation_schedule_versions ADD CONSTRAINT asset_depreciation_schedule_versions_lifecycle_check
      CHECK ((status = 'CURRENT') = (lifecycle_status IN ('CURRENT', 'COMPLETED')));
  END IF;
END $$;
-- At most one draft under review per asset.
CREATE UNIQUE INDEX IF NOT EXISTS asset_depreciation_schedule_draft_idx ON tenant.asset_depreciation_schedule_versions (asset_id) WHERE lifecycle_status = 'DRAFT';

-- ============================================================ 2. guard
-- Figures and inputs never change. The lifecycle moves forward only: a draft is approved (current), fails validation or is discarded
-- (superseded); a current plan is superseded by a revision, completes, or is terminated; a completed plan can still be superseded by an
-- approved basis change or terminated by a disposal. An approval, once recorded, is never rewritten.
CREATE OR REPLACE FUNCTION tenant.asset_depreciation_schedule_versions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  mutable constant text[] := ARRAY['status', 'lifecycle_status', 'superseded_at', 'approved_by', 'approved_at', 'closed_reason', 'closed_at', 'validation_errors', 'row_version'];
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A schedule version is superseded, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF (to_jsonb(NEW) - mutable - ARRAY['effective_from', 'policy_id']) <> (to_jsonb(OLD) - mutable - ARRAY['effective_from', 'policy_id'])
     OR (OLD.effective_from IS NOT NULL AND NEW.effective_from IS DISTINCT FROM OLD.effective_from)
     OR (OLD.policy_id IS NOT NULL AND NEW.policy_id IS DISTINCT FROM OLD.policy_id) THEN
    RAISE EXCEPTION 'A schedule version is never rewritten; generate a new version.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.lifecycle_status <> NEW.lifecycle_status AND NOT (
       (OLD.lifecycle_status = 'DRAFT' AND NEW.lifecycle_status IN ('CURRENT', 'VALIDATION_FAILED', 'SUPERSEDED'))
    OR (OLD.lifecycle_status = 'VALIDATION_FAILED' AND NEW.lifecycle_status = 'SUPERSEDED')
    OR (OLD.lifecycle_status = 'CURRENT' AND NEW.lifecycle_status IN ('SUPERSEDED', 'COMPLETED', 'TERMINATED'))
    OR (OLD.lifecycle_status = 'COMPLETED' AND NEW.lifecycle_status IN ('SUPERSEDED', 'TERMINATED'))) THEN
    RAISE EXCEPTION 'A schedule cannot go from % to %.', OLD.lifecycle_status, NEW.lifecycle_status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.approved_at IS NOT NULL AND NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
    RAISE EXCEPTION 'An approval is never rewritten.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- Versions generated before this lifecycle: superseded ones say so; all were approved with their basis.
UPDATE tenant.asset_depreciation_schedule_versions SET lifecycle_status = 'SUPERSEDED' WHERE status = 'SUPERSEDED' AND lifecycle_status = 'CURRENT';
UPDATE tenant.asset_depreciation_schedule_versions s SET approved_at = b.approved_at, approved_by = b.approved_by, effective_from = b.effective_from, policy_id = b.policy_id
  FROM tenant.asset_depreciation_bases b WHERE b.id = s.basis_id AND s.approved_at IS NULL AND b.approved_at IS NOT NULL;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0156_assets_depreciation_schedule.sql', 'assets-depreciation-schedule') ON CONFLICT DO NOTHING;
