-- Assets — Asset Movement History. One immutable, chronological read model of how an asset moved and changed hands, built only from
-- the records that own each fact: the opening baseline, location events and observations, custody periods, handovers and their
-- acknowledgments, assignment requests, transfer events and lines, transfer exceptions, missing incidents, maintenance and disposal.
-- Nobody records a movement here: the source workflow commits the fact and the projection reflects it with a stable source identity,
-- so ingesting it again changes nothing and the projection can be rebuilt from the sources at any time. Additive:
--
--   1. events           the projection: one row per source milestone (source type, source id, milestone), grouped per transfer,
--                       assignment or handover, with its certainty, the location and custodian snapshots as recorded, and its times.
--   2. checkpoints      ingestion progress per Company and source stream, so a delayed or failed run resumes safely.
--   3. corrections      a request to correct when a movement happened, with its evidence, decided by someone else; the original stays.
--   4. reconciliation   differences between the projection and the authoritative location and custody records.
--   5. location names   the name a location had at a given moment, from its change history, so renamed places stay intelligible.
--   6. permissions      view, history, evidence, custody details, audit, export, reconcile, request correction.

-- ============================================================ 1. events
CREATE TABLE IF NOT EXISTS tenant.asset_movement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  seq bigserial,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  source_type text NOT NULL CHECK (source_type IN ('LOCATION_EVENT', 'OBSERVATION', 'DISCREPANCY', 'CUSTODY_PERIOD', 'ACKNOWLEDGMENT', 'TRANSFER_EVENT', 'TRANSFER_LINE',
    'TRANSFER_EXCEPTION', 'MISSING_INCIDENT', 'MAINTENANCE_ORDER', 'DISPOSAL', 'CORRECTION')),
  source_id uuid NOT NULL,
  milestone text NOT NULL DEFAULT 'MAIN',
  source_version integer NOT NULL DEFAULT 1,
  group_type text CHECK (group_type IN ('OPENING', 'REGISTRATION', 'TRANSFER', 'ASSIGNMENT', 'HANDOVER', 'OBSERVATION', 'INCIDENT', 'MAINTENANCE', 'DISPOSAL', 'CORRECTION')),
  group_id uuid,
  group_label text,
  event_type text NOT NULL CHECK (event_type IN ('OPENING_BASELINE', 'INITIAL_PLACEMENT', 'INITIAL_CUSTODY', 'ASSIGNMENT_ISSUED', 'ASSIGNMENT_RETURNED', 'CUSTODY_CHANGED',
    'HANDOVER_ACKNOWLEDGED', 'HANDOVER_DISPUTED', 'HANDOVER_CONFIRMED_BY_EXCEPTION', 'LOCATION_CHANGED', 'TRANSFER_REQUESTED', 'TRANSFER_APPROVED', 'TRANSFER_DISPATCHED',
    'TRANSFER_RECEIVED', 'TRANSFER_COMPLETED', 'TRANSFER_CANCELLED', 'MOVEMENT_EXCEPTION', 'TEMPORARY_MOVEMENT', 'RETURN_FROM_TEMPORARY_MOVEMENT', 'LOCATION_OBSERVED',
    'LOCATION_DISCREPANCY', 'MISSING_REPORTED', 'DISPOSED', 'MOVEMENT_CORRECTED')),
  certainty text NOT NULL CHECK (certainty IN ('CONFIRMED', 'PENDING', 'OBSERVED', 'DISPUTED')),
  -- A movement changes the registered location or the accountable custodian; a milestone (approval, acknowledgment, observation) does not.
  changes_location boolean NOT NULL DEFAULT false,
  changes_custody boolean NOT NULL DEFAULT false,
  from_location_id uuid,
  from_location_name text,
  to_location_id uuid,
  to_location_name text,
  -- CONFIRMED: the asset is registered there; PROPOSED: a destination still to be reached; OBSERVED: seen there, not registered.
  to_location_role text CHECK (to_location_role IN ('CONFIRMED', 'PROPOSED', 'OBSERVED')),
  from_custodian_type text,
  from_custodian_id uuid,
  from_custodian_label text,
  to_custodian_type text,
  to_custodian_id uuid,
  to_custodian_label text,
  condition text,
  reason text,
  occurred_at timestamptz NOT NULL,
  effective_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  source_committed_at timestamptz,
  actor_user_id uuid REFERENCES public.users(id),
  approver_user_id uuid REFERENCES public.users(id),
  document_type text,
  document_id uuid,
  document_number text,
  correction_of_event_id uuid REFERENCES tenant.asset_movement_events(id),
  superseded_by_event_id uuid REFERENCES tenant.asset_movement_events(id),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  projection_version integer NOT NULL DEFAULT 1,
  ingested_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- The same source milestone is never ingested twice.
CREATE UNIQUE INDEX IF NOT EXISTS asset_movement_events_source_idx ON tenant.asset_movement_events (organization_id, source_type, source_id, milestone);
CREATE INDEX IF NOT EXISTS asset_movement_events_asset_idx ON tenant.asset_movement_events (organization_id, asset_id, effective_at, seq);
CREATE INDEX IF NOT EXISTS asset_movement_events_group_idx ON tenant.asset_movement_events (organization_id, group_id);
CREATE INDEX IF NOT EXISTS asset_movement_events_from_idx ON tenant.asset_movement_events (organization_id, from_location_id, occurred_at);
CREATE INDEX IF NOT EXISTS asset_movement_events_to_idx ON tenant.asset_movement_events (organization_id, to_location_id, occurred_at);
CREATE INDEX IF NOT EXISTS asset_movement_events_time_idx ON tenant.asset_movement_events (organization_id, occurred_at DESC, seq DESC);

-- The projection is derived: an event is never edited. The one change allowed is pointing an event at the correction that supersedes it;
-- removal happens only inside an explicit rebuild (vercent.movement_rebuild = 'on'), which re-derives the rows from the sources.
CREATE OR REPLACE FUNCTION tenant.asset_movement_events_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('vercent.movement_rebuild', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Movement history is never deleted.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.superseded_by_event_id IS NULL AND NEW.superseded_by_event_id IS NOT NULL
     AND (to_jsonb(NEW) - 'superseded_by_event_id') = (to_jsonb(OLD) - 'superseded_by_event_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Movement history is never edited; correct the source record instead.' USING ERRCODE = 'check_violation';
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_movement_events_guard') THEN
    CREATE TRIGGER asset_movement_events_guard BEFORE UPDATE OR DELETE ON tenant.asset_movement_events FOR EACH ROW EXECUTE FUNCTION tenant.asset_movement_events_guard();
  END IF;
END $$;

-- ============================================================ 2. checkpoints
CREATE TABLE IF NOT EXISTS tenant.asset_movement_checkpoints (
  organization_id uuid NOT NULL,
  stream text NOT NULL,
  last_source_at timestamptz,
  last_run_at timestamptz,
  last_run_status text NOT NULL DEFAULT 'OK' CHECK (last_run_status IN ('OK', 'FAILED', 'REBUILT')),
  last_error text,
  ingested_count bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, stream)
);

-- ============================================================ 3. corrections
CREATE TABLE IF NOT EXISTS tenant.asset_movement_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  correction_number text NOT NULL,
  event_id uuid NOT NULL REFERENCES tenant.asset_movement_events(id),
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  field text NOT NULL CHECK (field IN ('OCCURRED_AT')),
  original_value timestamptz NOT NULL,
  corrected_value timestamptz NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 5),
  evidence text NOT NULL CHECK (length(btrim(evidence)) >= 3),
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'APPLIED', 'REJECTED')),
  requested_by uuid NOT NULL REFERENCES public.users(id),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_by uuid REFERENCES public.users(id),
  decided_at timestamptz,
  decision_note text,
  applied_event_id uuid REFERENCES tenant.asset_movement_events(id),
  CONSTRAINT asset_movement_corrections_number_key UNIQUE (organization_id, correction_number),
  CONSTRAINT asset_movement_corrections_decision_check CHECK ((status = 'REQUESTED') = (decided_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_movement_corrections_open_idx ON tenant.asset_movement_corrections (event_id) WHERE status = 'REQUESTED';
CREATE OR REPLACE FUNCTION tenant.asset_movement_corrections_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A correction request is decided, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  -- Once applied, the one later write is pointing it at the event it produced.
  IF OLD.status = 'APPLIED' AND OLD.applied_event_id IS NULL AND NEW.applied_event_id IS NOT NULL
     AND (to_jsonb(NEW) - 'applied_event_id') = (to_jsonb(OLD) - 'applied_event_id') THEN RETURN NEW; END IF;
  IF OLD.status <> 'REQUESTED' THEN RAISE EXCEPTION 'A decided correction stays decided.' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.event_id <> OLD.event_id OR NEW.original_value <> OLD.original_value OR NEW.corrected_value <> OLD.corrected_value OR NEW.reason <> OLD.reason
     OR NEW.evidence <> OLD.evidence OR NEW.requested_by <> OLD.requested_by THEN
    RAISE EXCEPTION 'A correction request keeps what was asked.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_movement_corrections_guard') THEN
    CREATE TRIGGER asset_movement_corrections_guard BEFORE UPDATE OR DELETE ON tenant.asset_movement_corrections FOR EACH ROW EXECUTE FUNCTION tenant.asset_movement_corrections_guard();
  END IF;
END $$;

-- ============================================================ 4. reconciliation
CREATE TABLE IF NOT EXISTS tenant.asset_movement_reconciliation_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  issue_type text NOT NULL CHECK (issue_type IN ('LOCATION_MISMATCH', 'CUSTODY_MISMATCH', 'MISSING_BASELINE', 'HISTORICAL_CONFLICT')),
  expected jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed jsonb NOT NULL DEFAULT '{}'::jsonb,
  related jsonb NOT NULL DEFAULT '[]'::jsonb,
  first_detected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_detected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reviewer_user_id uuid REFERENCES public.users(id),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED')),
  resolution text,
  resolved_by uuid REFERENCES public.users(id),
  resolved_at timestamptz,
  CONSTRAINT asset_movement_issues_resolution_check CHECK ((status = 'OPEN') = (resolved_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_movement_issues_open_idx ON tenant.asset_movement_reconciliation_issues (asset_id, issue_type) WHERE status = 'OPEN';

-- ============================================================ 5. location names as of a moment
-- Location changes record each renamed field as {from, to}: the name at a moment is the 'from' of the first rename after it.
CREATE OR REPLACE FUNCTION tenant.asset_location_name_at(location uuid, at timestamptz) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT ch.changes -> 'name' ->> 'from' FROM tenant.asset_location_changes ch
      WHERE ch.location_id = location AND ch.action = 'UPDATED' AND ch.changes ? 'name' AND ch.occurred_at > at ORDER BY ch.occurred_at, ch.id LIMIT 1),
    (SELECT l.name FROM tenant.asset_locations l WHERE l.id = location))
$$;
-- The site a location belongs to (its top-level ancestor): a move between sites is interbranch, within one site it is internal.
CREATE OR REPLACE FUNCTION tenant.asset_location_root(location uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
  WITH RECURSIVE up(id, parent_id, depth) AS (
    SELECT l.id, l.parent_id, 0 FROM tenant.asset_locations l WHERE l.id = location
    UNION ALL SELECT p.id, p.parent_id, up.depth + 1 FROM tenant.asset_locations p JOIN up ON p.id = up.parent_id WHERE up.depth < 50)
  SELECT id FROM up WHERE parent_id IS NULL LIMIT 1
$$;

-- ============================================================ isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['asset_movement_events', 'asset_movement_checkpoints', 'asset_movement_corrections', 'asset_movement_reconciliation_issues'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.asset_movement_events TO vercent_app;
GRANT SELECT, INSERT, UPDATE ON tenant.asset_movement_checkpoints, tenant.asset_movement_corrections, tenant.asset_movement_reconciliation_issues TO vercent_app;
GRANT USAGE, SELECT ON SEQUENCE tenant.asset_movement_events_seq_seq TO vercent_app, vercent_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.asset_movement_events TO vercent_worker;
GRANT SELECT, INSERT, UPDATE ON tenant.asset_movement_checkpoints, tenant.asset_movement_reconciliation_issues TO vercent_worker;
GRANT SELECT ON tenant.asset_movement_corrections TO vercent_worker;

-- ============================================================ 6. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('assets.movement.view', 'View asset movement history', 'Assets', 'See the movement history of the assets you are permitted to see.'),
  ('assets.movement.view_history', 'View Company movement history', 'Assets', 'See every asset''s movement history and the Company movement directory.'),
  ('assets.movement.view_evidence', 'Open movement evidence', 'Assets', 'Open the source transactions and documents behind a movement.'),
  ('assets.movement.view_custody', 'View custodians in movement history', 'Assets', 'See which employee or department held an asset.'),
  ('assets.movement.view_audit', 'Audit movement history', 'Assets', 'Inspect corrections, provenance and history as known at a past date.'),
  ('assets.movement.export', 'Export movement history', 'Assets', 'Download movement history and reports.'),
  ('assets.movement.reconcile', 'Reconcile movement history', 'Assets', 'Rebuild and reconcile the movement history, and decide correction requests.'),
  ('assets.movement.request_correction', 'Request movement corrections', 'Assets', 'Ask for a movement''s recorded time to be corrected, with evidence.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('asset_manager', 'assets.movement.view'), ('asset_manager', 'assets.movement.view_history'), ('asset_manager', 'assets.movement.view_evidence'),
    ('asset_manager', 'assets.movement.view_custody'), ('asset_manager', 'assets.movement.view_audit'), ('asset_manager', 'assets.movement.export'),
    ('asset_manager', 'assets.movement.reconcile'), ('asset_manager', 'assets.movement.request_correction'),
    ('employee', 'assets.movement.view'),
    ('inventory_manager', 'assets.movement.view'), ('inventory_manager', 'assets.movement.view_history'), ('inventory_manager', 'assets.movement.view_custody'),
    ('inventory_manager', 'assets.movement.request_correction'),
    ('finance_manager', 'assets.movement.view'), ('finance_manager', 'assets.movement.view_history'), ('finance_manager', 'assets.movement.view_evidence'),
    ('finance_manager', 'assets.movement.view_audit'), ('finance_manager', 'assets.movement.export'),
    ('auditor', 'assets.movement.view'), ('auditor', 'assets.movement.view_history'), ('auditor', 'assets.movement.view_evidence'),
    ('auditor', 'assets.movement.view_custody'), ('auditor', 'assets.movement.view_audit'), ('auditor', 'assets.movement.export')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0154_assets_movement_history.sql', 'assets-movement-history') ON CONFLICT DO NOTHING;
