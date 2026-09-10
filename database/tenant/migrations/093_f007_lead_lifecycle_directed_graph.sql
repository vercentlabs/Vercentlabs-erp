BEGIN;

-- F007 Prompt 4: replace the auto-generated bidirectional adjacency graph
-- with a real, admin-configurable directed transition graph, governed
-- transition reasons, dwell/SLA tracking and a safe-deactivation +
-- migration workflow. Existing rows in crm_lead_stage_transitions are left
-- untouched by this migration (backward compatible — every org's current
-- graph keeps working exactly as before); going forward, stage writes no
-- longer regenerate the table wholesale, so an admin's explicit edits stick.

ALTER TABLE tenant.crm_lead_stage_transitions
  ADD COLUMN IF NOT EXISTS reason_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

COMMENT ON TABLE tenant.crm_lead_stage_transitions IS
  'F007 directed transition graph: a row means from_stage_id -> to_stage_id is a legal move. Admin-configured (see transition-graph.js); no longer auto-regenerated on every stage write.';

-- Dwell/SLA thresholds per stage. Both nullable: no threshold configured
-- means no warning/breach is ever raised for that stage.
ALTER TABLE tenant.crm_lead_stages
  ADD COLUMN IF NOT EXISTS dwell_warning_hours integer,
  ADD COLUMN IF NOT EXISTS dwell_breach_hours integer;

ALTER TABLE tenant.crm_lead_stages
  DROP CONSTRAINT IF EXISTS crm_lead_stages_dwell_warning_positive_check,
  ADD CONSTRAINT crm_lead_stages_dwell_warning_positive_check
    CHECK (dwell_warning_hours IS NULL OR dwell_warning_hours > 0);
ALTER TABLE tenant.crm_lead_stages
  DROP CONSTRAINT IF EXISTS crm_lead_stages_dwell_breach_positive_check,
  ADD CONSTRAINT crm_lead_stages_dwell_breach_positive_check
    CHECK (dwell_breach_hours IS NULL OR dwell_breach_hours > 0);
ALTER TABLE tenant.crm_lead_stages
  DROP CONSTRAINT IF EXISTS crm_lead_stages_dwell_order_check,
  ADD CONSTRAINT crm_lead_stages_dwell_order_check
    CHECK (dwell_warning_hours IS NULL OR dwell_breach_hours IS NULL OR dwell_breach_hours >= dwell_warning_hours);

-- Governed transition-reason vocabulary. A row scoped 'transition' applies
-- only to the exact (from,to) pair; 'destination' applies to any transition
-- landing on to_stage_id regardless of source; 'any' applies to every
-- transition in the org. reason_required on crm_lead_stage_transitions
-- means the caller MUST supply one active code from a vocabulary row that
-- matches this transition (transition-scoped first, then destination, then
-- any) — enforced in application code (transition-engine.js), not a DB
-- CHECK, since "which rows apply" is a precedence lookup, not a single-row
-- constraint.
CREATE TABLE IF NOT EXISTS tenant.crm_lead_stage_transition_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  scope_type text NOT NULL CHECK (scope_type IN ('transition','destination','any')),
  from_stage_id uuid,
  to_stage_id uuid,
  code text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{0,63}$'),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 160),
  sequence integer NOT NULL DEFAULT 100 CHECK (sequence BETWEEN 0 AND 100000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, scope_type, from_stage_id, to_stage_id, code),
  FOREIGN KEY (organization_id,from_stage_id)
    REFERENCES tenant.crm_lead_stages(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,to_stage_id)
    REFERENCES tenant.crm_lead_stages(organization_id,id) ON DELETE CASCADE,
  CHECK (
    (scope_type='transition' AND from_stage_id IS NOT NULL AND to_stage_id IS NOT NULL)
    OR (scope_type='destination' AND from_stage_id IS NULL AND to_stage_id IS NOT NULL)
    OR (scope_type='any' AND from_stage_id IS NULL AND to_stage_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS crm_lead_stage_transition_reasons_lookup_idx
  ON tenant.crm_lead_stage_transition_reasons(organization_id,scope_type,to_stage_id,status);

-- Snapshot the reason on the immutable event row so a later edit/retirement
-- of a reason's label (or the whole vocabulary row) can never rewrite
-- history — mirrors from_stage_code/to_stage_code's existing snapshot
-- pattern on this same table.
ALTER TABLE tenant.crm_lead_stage_events
  ADD COLUMN IF NOT EXISTS reason_code text,
  ADD COLUMN IF NOT EXISTS reason_label text;

-- Denormalized "current stage entered at" for O(1) dwell lookups without a
-- per-lead correlated subquery on crm_lead_stage_events (F007-PERF-001 /
-- Prompt 4 §58). This is NOT an independently-mutable field like
-- updated_at: it is written only inside the same transaction/statement
-- that inserts the immutable crm_lead_stage_events row for that exact
-- transition, so it always agrees with (and is fully reconstructible from)
-- the authoritative immutable event log — CALC-001's "derived from
-- immutable entry/exit events, never from mutable updated_at" is satisfied
-- because this column's only writer is the governed transition command,
-- synchronized 1:1 with the event insert.
ALTER TABLE tenant.crm_leads
  ADD COLUMN IF NOT EXISTS stage_entered_at timestamptz;
UPDATE tenant.crm_leads SET stage_entered_at = created_at WHERE stage_entered_at IS NULL;
ALTER TABLE tenant.crm_leads
  ALTER COLUMN stage_entered_at SET NOT NULL,
  ALTER COLUMN stage_entered_at SET DEFAULT now();

-- Dedup marker for the dwell-breach notification tick: reset to NULL
-- whenever stage_entered_at changes (i.e. every governed transition), so a
-- fresh stage entry that also breaches can be notified again. Mirrors the
-- Lead SLA scan's own idempotency approach (status-transition based).
ALTER TABLE tenant.crm_leads
  ADD COLUMN IF NOT EXISTS dwell_breach_notified_at timestamptz;

CREATE INDEX IF NOT EXISTS crm_leads_stage_dwell_idx
  ON tenant.crm_leads(organization_id,status,stage_entered_at)
  WHERE record_status='active';

-- Extend the write guard so a direct UPDATE of stage_entered_at (bypassing
-- the governed transition command) fails closed exactly like a direct
-- status write already does.
CREATE OR REPLACE FUNCTION tenant.crm_lead_stage_write_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.status IS DISTINCT FROM OLD.status OR NEW.stage_entered_at IS DISTINCT FROM OLD.stage_entered_at)
     AND current_setting('app.crm_lead_stage_transition',true)<>'allowed' THEN
    RAISE EXCEPTION 'Use the governed Lead lifecycle transition service'
      USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS crm_leads_stage_write_guard ON tenant.crm_leads;
CREATE TRIGGER crm_leads_stage_write_guard
BEFORE UPDATE OF status, stage_entered_at ON tenant.crm_leads
FOR EACH ROW EXECUTE FUNCTION tenant.crm_lead_stage_write_guard();

-- Safe stage-deactivation + migration workflow. Reuses tenant.background_jobs
-- (job_type='crm.leads.stage_migration') for the job row itself, mirroring
-- crm_lead_bulk_job_items exactly for the per-lead item ledger.
CREATE TABLE IF NOT EXISTS tenant.crm_lead_stage_migration_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES tenant.background_jobs(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES tenant.crm_leads(id) ON DELETE CASCADE,
  from_stage_id uuid NOT NULL,
  to_stage_id uuid NOT NULL,
  expected_updated_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','applied','conflict','skipped','failed')),
  error_code text,
  error_message text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, job_id, lead_id)
);
CREATE INDEX IF NOT EXISTS crm_lead_stage_migration_items_pending_idx
  ON tenant.crm_lead_stage_migration_items(organization_id, job_id, status, lead_id)
  WHERE status='pending';
CREATE INDEX IF NOT EXISTS crm_lead_stage_migration_items_lead_idx
  ON tenant.crm_lead_stage_migration_items(organization_id, lead_id, created_at DESC);

ALTER TABLE tenant.crm_lead_stage_transition_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_stage_transition_reasons FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_stage_migration_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_stage_migration_items FORCE ROW LEVEL SECURITY;
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['crm_lead_stage_transition_reasons','crm_lead_stage_migration_items'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.%I',table_name);
    EXECUTE format('CREATE POLICY tenant_organization_isolation ON tenant.%I USING (organization_id=current_setting(''app.current_organization_id'',true)::uuid) WITH CHECK (organization_id=current_setting(''app.current_organization_id'',true)::uuid)',table_name);
  END LOOP;
END $$;

COMMENT ON COLUMN tenant.crm_leads.stage_entered_at IS 'Timestamp of the lead''s most recent governed stage transition; O(1) dwell projection of the immutable crm_lead_stage_events log, written only by the governed transition command.';
COMMENT ON TABLE tenant.crm_lead_stage_migration_items IS 'F007 safe stage-deactivation migration job items — per-lead ledger for a crm.leads.stage_migration background job.';

COMMIT;
