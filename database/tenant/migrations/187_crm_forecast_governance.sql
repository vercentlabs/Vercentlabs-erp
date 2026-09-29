BEGIN;

-- F025 Sales forecast governance.
--   * Periods: OPEN -> FROZEN (locked) -> CLOSED, with who/when. A closed
--     period is final: it cannot be reopened or re-dated.
--   * Submissions: versioned (optimistic concurrency), the system baseline at
--     submission time kept with them, manager review/adjustment with a reason,
--     and an append-only event history. No submission changes once the period
--     is frozen or closed (enforced here, not only in code).
--   * Snapshots: immutable captures (scheduled, submission, freeze, close,
--     manual) holding organisation, team and owner rows plus the deals behind
--     each owner row, so a past forecast is reproduced from what was captured,
--     never recalculated from today's opportunities.

ALTER TABLE tenant.crm_forecast_periods
  ADD COLUMN IF NOT EXISTS frozen_at timestamptz,
  ADD COLUMN IF NOT EXISTS frozen_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE tenant.crm_forecast_submissions
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS baseline jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS adjustment_reason text,
  ADD COLUMN IF NOT EXISTS review_notes text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

-- One live owner-level submission per period (team/territory submissions are
-- not used by the governed flow). Older duplicates written through the former
-- generic path are superseded first so the index can be built.
UPDATE tenant.crm_forecast_submissions older
   SET status = 'superseded'
 WHERE older.status <> 'superseded' AND older.team_id IS NULL AND older.territory_id IS NULL
   AND EXISTS (
     SELECT 1 FROM tenant.crm_forecast_submissions newer
      WHERE newer.organization_id = older.organization_id AND newer.period_id = older.period_id
        AND newer.owner_user_id IS NOT DISTINCT FROM older.owner_user_id
        AND newer.team_id IS NULL AND newer.territory_id IS NULL AND newer.status <> 'superseded'
        AND (newer.updated_at, newer.id) > (older.updated_at, older.id));
CREATE UNIQUE INDEX IF NOT EXISTS crm_forecast_submissions_owner_live_uidx
  ON tenant.crm_forecast_submissions(organization_id, period_id, owner_user_id)
  WHERE team_id IS NULL AND territory_id IS NULL AND status <> 'superseded';

CREATE TABLE IF NOT EXISTS tenant.crm_forecast_submission_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  submission_id uuid NOT NULL,
  period_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('submitted', 'resubmitted', 'adjusted', 'approved', 'rejected')),
  previous_status text,
  next_status text NOT NULL,
  commit_amount numeric(18,2),
  best_case_amount numeric(18,2),
  manager_adjustment numeric(18,2),
  reason text,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, submission_id) REFERENCES tenant.crm_forecast_submissions(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, period_id) REFERENCES tenant.crm_forecast_periods(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS crm_forecast_submission_events_submission_idx
  ON tenant.crm_forecast_submission_events(organization_id, submission_id, created_at);

CREATE TABLE IF NOT EXISTS tenant.crm_forecast_snapshot_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period_id uuid NOT NULL,
  capture_key text NOT NULL CHECK (length(capture_key) BETWEEN 1 AND 120),
  source text NOT NULL CHECK (source IN ('scheduled', 'submission', 'freeze', 'close', 'manual')),
  as_of date NOT NULL,
  reporting_currency char(3),
  metric_version text NOT NULL,
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  content_hash text NOT NULL,
  captured_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, period_id, capture_key),
  FOREIGN KEY (organization_id, period_id) REFERENCES tenant.crm_forecast_periods(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS crm_forecast_snapshot_captures_period_idx
  ON tenant.crm_forecast_snapshot_captures(organization_id, period_id, captured_at DESC);

ALTER TABLE tenant.crm_forecast_snapshots
  ADD COLUMN IF NOT EXISTS capture_id uuid,
  ADD COLUMN IF NOT EXISTS scope_type text CHECK (scope_type IN ('organization', 'team', 'owner')),
  ADD COLUMN IF NOT EXISTS scope_id uuid,
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS team_id uuid,
  ADD COLUMN IF NOT EXISTS parent_team_id uuid,
  ADD COLUMN IF NOT EXISTS currency_code char(3),
  ADD COLUMN IF NOT EXISTS pipeline_amount numeric(18,2),
  ADD COLUMN IF NOT EXISTS best_case_amount numeric(18,2),
  ADD COLUMN IF NOT EXISTS commit_amount numeric(18,2),
  ADD COLUMN IF NOT EXISTS weighted_amount numeric(18,2),
  ADD COLUMN IF NOT EXISTS won_amount numeric(18,2),
  ADD COLUMN IF NOT EXISTS submitted_commit numeric(18,2),
  ADD COLUMN IF NOT EXISTS manager_adjustment numeric(18,2),
  ADD COLUMN IF NOT EXISTS deal_count integer;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_forecast_snapshots_capture_fkey') THEN
    ALTER TABLE tenant.crm_forecast_snapshots
      ADD CONSTRAINT crm_forecast_snapshots_capture_fkey FOREIGN KEY (organization_id, capture_id)
      REFERENCES tenant.crm_forecast_snapshot_captures(organization_id, id) ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE tenant.crm_forecast_snapshots DROP CONSTRAINT IF EXISTS crm_forecast_snapshots_snapshot_type_check;
ALTER TABLE tenant.crm_forecast_snapshots
  ADD CONSTRAINT crm_forecast_snapshots_snapshot_type_check
  CHECK (snapshot_type IN ('scheduled', 'submission', 'approval', 'freeze', 'close', 'manual'));
CREATE UNIQUE INDEX IF NOT EXISTS crm_forecast_snapshots_capture_scope_uidx
  ON tenant.crm_forecast_snapshots(organization_id, capture_id, scope_type, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE capture_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_forecast_snapshots_period_scope_idx
  ON tenant.crm_forecast_snapshots(organization_id, period_id, scope_type, scope_id, snapshot_at DESC);

-- Row-level security for the new tables.
ALTER TABLE tenant.crm_forecast_submission_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_forecast_submission_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.crm_forecast_submission_events;
CREATE POLICY tenant_organization_isolation ON tenant.crm_forecast_submission_events
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true)::uuid);
ALTER TABLE tenant.crm_forecast_snapshot_captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_forecast_snapshot_captures FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.crm_forecast_snapshot_captures;
CREATE POLICY tenant_organization_isolation ON tenant.crm_forecast_snapshot_captures
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true)::uuid);

-- Append-only evidence: snapshots, captures and submission events never
-- change. Deletes cascaded from a parent (period or organisation removal) run
-- inside the foreign-key trigger (pg_trigger_depth() > 1) and remain allowed.
CREATE OR REPLACE FUNCTION tenant.crm_forecast_history_immutable_f025()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Forecast history is immutable' USING ERRCODE = 'check_violation';
END;
$$;
DROP TRIGGER IF EXISTS crm_forecast_snapshots_immutable_f025 ON tenant.crm_forecast_snapshots;
CREATE TRIGGER crm_forecast_snapshots_immutable_f025
BEFORE UPDATE OR DELETE ON tenant.crm_forecast_snapshots
FOR EACH ROW EXECUTE FUNCTION tenant.crm_forecast_history_immutable_f025();
DROP TRIGGER IF EXISTS crm_forecast_snapshot_captures_immutable_f025 ON tenant.crm_forecast_snapshot_captures;
CREATE TRIGGER crm_forecast_snapshot_captures_immutable_f025
BEFORE UPDATE OR DELETE ON tenant.crm_forecast_snapshot_captures
FOR EACH ROW EXECUTE FUNCTION tenant.crm_forecast_history_immutable_f025();
DROP TRIGGER IF EXISTS crm_forecast_submission_events_immutable_f025 ON tenant.crm_forecast_submission_events;
CREATE TRIGGER crm_forecast_submission_events_immutable_f025
BEFORE UPDATE OR DELETE ON tenant.crm_forecast_submission_events
FOR EACH ROW EXECUTE FUNCTION tenant.crm_forecast_history_immutable_f025();

-- Submissions cannot change in a frozen or closed period.
CREATE OR REPLACE FUNCTION tenant.crm_forecast_submission_period_open_f025()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  period_status text;
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  SELECT status INTO period_status FROM tenant.crm_forecast_periods
   WHERE organization_id = COALESCE(NEW.organization_id, OLD.organization_id) AND id = COALESCE(NEW.period_id, OLD.period_id);
  IF period_status IN ('frozen', 'closed') THEN
    RAISE EXCEPTION 'Forecast period is % and its submissions can no longer change', period_status USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS crm_forecast_submissions_period_open_f025 ON tenant.crm_forecast_submissions;
CREATE TRIGGER crm_forecast_submissions_period_open_f025
BEFORE INSERT OR UPDATE OR DELETE ON tenant.crm_forecast_submissions
FOR EACH ROW EXECUTE FUNCTION tenant.crm_forecast_submission_period_open_f025();

-- A closed period is final.
CREATE OR REPLACE FUNCTION tenant.crm_forecast_period_closed_final_f025()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'closed' AND (NEW.status <> 'closed' OR NEW.period_start <> OLD.period_start OR NEW.period_end <> OLD.period_end OR NEW.currency_code IS DISTINCT FROM OLD.currency_code) THEN
    RAISE EXCEPTION 'A closed forecast period cannot be reopened or changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS crm_forecast_periods_closed_final_f025 ON tenant.crm_forecast_periods;
CREATE TRIGGER crm_forecast_periods_closed_final_f025
BEFORE UPDATE ON tenant.crm_forecast_periods
FOR EACH ROW EXECUTE FUNCTION tenant.crm_forecast_period_closed_final_f025();

COMMIT;
