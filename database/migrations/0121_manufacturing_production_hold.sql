-- Manufacturing: Production Hold. A hold is an episode of a manufacturing order's life during which it may not execute (no new issues,
-- consumption, production batches or output): it remembers the status it interrupted, who owns its resolution, and one or more blocking
-- reasons — material shortage, quality failure, equipment, safety and others — each with its severity, its linked source (a shortage, an
-- inspection, a quality hold, an incident reference), its corrective action and its clearance by the authority it belongs to (production,
-- quality or safety). The order resumes only when every reason is cleared, its readiness is re-checked and — where the company asks — someone
-- approves the resume. A hold moves no stock, releases no reservation and posts nothing to Finance. Additive only: nothing is dropped.

-- ============================================================ 1. hold episodes
CREATE TABLE IF NOT EXISTS tenant.manufacturing_production_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  hold_number text NOT NULL,
  manufacturing_order_id uuid NOT NULL REFERENCES tenant.manufacturing_orders(id),
  previous_mo_status text NOT NULL CHECK (previous_mo_status IN ('RELEASED', 'IN_PROGRESS')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RESUMED', 'CLOSED')),
  -- The highest severity of its reasons (kept as they are added).
  severity text NOT NULL DEFAULT 'NORMAL' CHECK (severity IN ('NORMAL', 'HIGH', 'CRITICAL')),
  hold_owner_id uuid REFERENCES public.users(id),
  affected_location_id uuid REFERENCES tenant.warehouse_locations(id),
  expected_resolution_at timestamptz,
  notes text,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  requested_by uuid REFERENCES public.users(id),
  -- Resume: asked for (where the company wants an approval, bound to the hold's state), approved, done.
  resume_requested_by uuid REFERENCES public.users(id),
  resume_requested_at timestamptz,
  resume_request_note text,
  resume_request_version integer,
  resume_approved_by uuid REFERENCES public.users(id),
  resume_approved_at timestamptz,
  resolution_notes text,
  resumed_to_status text CHECK (resumed_to_status IS NULL OR resumed_to_status IN ('RELEASED', 'IN_PROGRESS')),
  resumed_by uuid REFERENCES public.users(id),
  resolved_at timestamptz,
  closed_reason text,
  overdue_notified_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  idempotency_key text,
  resume_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'ACTIVE' OR resolved_at IS NOT NULL),
  CHECK (status <> 'RESUMED' OR (resumed_to_status IS NOT NULL AND resolution_notes IS NOT NULL)),
  CHECK (resolved_at IS NULL OR resolved_at >= started_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_production_holds_number_uidx ON tenant.manufacturing_production_holds (organization_id, hold_number);
-- One active hold episode per order: a second stop adds a reason to the episode in force.
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_production_holds_active_uidx ON tenant.manufacturing_production_holds (organization_id, manufacturing_order_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_production_holds_key_uidx ON tenant.manufacturing_production_holds (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_production_holds_resume_key_uidx ON tenant.manufacturing_production_holds (organization_id, resume_key) WHERE resume_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS manufacturing_production_holds_order_idx ON tenant.manufacturing_production_holds (organization_id, manufacturing_order_id, started_at);
CREATE INDEX IF NOT EXISTS manufacturing_production_holds_status_idx ON tenant.manufacturing_production_holds (organization_id, status, started_at);

-- ============================================================ 2. blocking reasons
-- clearance_authority: who may clear it — production (a production manager), quality (quality personnel) or safety (the safety authority).
-- A reason linked to a quality hold or an inspection is cleared only once that record itself is released or finalized.
CREATE TABLE IF NOT EXISTS tenant.manufacturing_production_hold_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  production_hold_id uuid NOT NULL REFERENCES tenant.manufacturing_production_holds(id),
  manufacturing_order_id uuid NOT NULL REFERENCES tenant.manufacturing_orders(id),
  reason_code text NOT NULL CHECK (reason_code IN ('MATERIAL_SHORTAGE', 'QUALITY_FAILURE', 'EQUIPMENT_BREAKDOWN', 'SAFETY_CONCERN', 'WORKFORCE_UNAVAILABLE', 'CUSTOMER_CHANGE',
    'PRODUCTION_PRIORITY', 'EXCESS_CONSUMPTION', 'INVENTORY_DISCREPANCY', 'COSTING_EXCEPTION', 'OTHER')),
  severity text NOT NULL DEFAULT 'NORMAL' CHECK (severity IN ('NORMAL', 'HIGH', 'CRITICAL')),
  description text NOT NULL CHECK (length(btrim(description)) >= 3),
  clearance_authority text NOT NULL DEFAULT 'PRODUCTION' CHECK (clearance_authority IN ('PRODUCTION', 'QUALITY', 'SAFETY')),
  source_type text CHECK (source_type IS NULL OR source_type IN ('MATERIAL_SHORTAGE', 'QUALITY_INSPECTION', 'QUALITY_HOLD', 'EQUIPMENT_INCIDENT', 'SAFETY_INCIDENT', 'SALES_DEMAND', 'OTHER')),
  source_id uuid,
  source_reference text,
  affected_material_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RESOLVED')),
  corrective_action text,
  resolution_notes text,
  resolution_evidence text,
  resolved_by uuid REFERENCES public.users(id),
  resolved_at timestamptz,
  added_by uuid REFERENCES public.users(id),
  added_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  idempotency_key text,
  CHECK (status <> 'RESOLVED' OR (resolved_at IS NOT NULL AND resolution_notes IS NOT NULL)),
  CHECK (reason_code <> 'OTHER' OR length(btrim(description)) >= 10)
);
CREATE INDEX IF NOT EXISTS manufacturing_production_hold_reasons_hold_idx ON tenant.manufacturing_production_hold_reasons (organization_id, production_hold_id, status);
CREATE INDEX IF NOT EXISTS manufacturing_production_hold_reasons_order_idx ON tenant.manufacturing_production_hold_reasons (organization_id, manufacturing_order_id);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_production_hold_reasons_key_uidx ON tenant.manufacturing_production_hold_reasons (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS tenant.manufacturing_production_hold_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  production_hold_id uuid NOT NULL REFERENCES tenant.manufacturing_production_holds(id),
  reason_id uuid REFERENCES tenant.manufacturing_production_hold_reasons(id),
  action text NOT NULL,
  summary text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS manufacturing_production_hold_events_idx ON tenant.manufacturing_production_hold_events (organization_id, production_hold_id, occurred_at);

-- ============================================================ 3. guards
-- An episode that ended does not change; an active one never loses its start, its order or the status it will resume to.
CREATE OR REPLACE FUNCTION tenant.manufacturing_production_hold_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A production hold is never deleted.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'A production hold that ended does not change.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.manufacturing_order_id <> OLD.manufacturing_order_id OR NEW.started_at <> OLD.started_at OR NEW.previous_mo_status <> OLD.previous_mo_status
     OR NEW.hold_number <> OLD.hold_number OR NEW.requested_by IS DISTINCT FROM OLD.requested_by THEN
    RAISE EXCEPTION 'A production hold keeps its order, its start and the status it interrupted.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> 'ACTIVE' AND EXISTS (SELECT 1 FROM tenant.manufacturing_production_hold_reasons WHERE production_hold_id = NEW.id AND status = 'ACTIVE') AND NEW.status = 'RESUMED' THEN
    RAISE EXCEPTION 'Every blocking reason is cleared before production resumes.' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
-- A cleared reason stays cleared; an active one changes only by its corrective action or its clearance.
CREATE OR REPLACE FUNCTION tenant.manufacturing_production_hold_reason_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A hold reason is never deleted; clear it.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'RESOLVED' THEN
    RAISE EXCEPTION 'A cleared hold reason does not change.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.production_hold_id <> OLD.production_hold_id OR NEW.reason_code <> OLD.reason_code OR NEW.clearance_authority <> OLD.clearance_authority
     OR NEW.added_at <> OLD.added_at OR NEW.source_id IS DISTINCT FROM OLD.source_id THEN
    RAISE EXCEPTION 'A hold reason keeps what it is and who clears it.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_production_holds_guard') THEN
    CREATE TRIGGER manufacturing_production_holds_guard BEFORE UPDATE OR DELETE ON tenant.manufacturing_production_holds FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_production_hold_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_production_hold_reasons_guard') THEN
    CREATE TRIGGER manufacturing_production_hold_reasons_guard BEFORE UPDATE OR DELETE ON tenant.manufacturing_production_hold_reasons FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_production_hold_reason_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_production_hold_events_append_only') THEN
    CREATE TRIGGER manufacturing_production_hold_events_append_only BEFORE UPDATE OR DELETE ON tenant.manufacturing_production_hold_events FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_bom_append_only();
  END IF;
END $$;

-- ============================================================ 4. policy
-- Resuming asks for an approval by someone other than the person who asks to resume; a hold older than this many hours is overdue.
ALTER TABLE tenant.manufacturing_settings ADD COLUMN IF NOT EXISTS ph_resume_approval_required boolean NOT NULL DEFAULT false;
ALTER TABLE tenant.manufacturing_settings ADD COLUMN IF NOT EXISTS ph_overdue_after_hours integer NOT NULL DEFAULT 24 CHECK (ph_overdue_after_hours BETWEEN 1 AND 8760);

-- ============================================================ 5. orders already on hold become active hold episodes
DO $$
DECLARE
  rec record;
  hold uuid;
BEGIN
  FOR rec IN SELECT mo.* FROM tenant.manufacturing_orders mo
              WHERE mo.status = 'ON_HOLD' AND NOT EXISTS (SELECT 1 FROM tenant.manufacturing_production_holds h WHERE h.manufacturing_order_id = mo.id AND h.status = 'ACTIVE') LOOP
    hold := gen_random_uuid();
    INSERT INTO tenant.manufacturing_production_holds (id, organization_id, hold_number, manufacturing_order_id, previous_mo_status, severity, hold_owner_id, started_at, requested_by)
    VALUES (hold, rec.organization_id, 'MPH-' || upper(substr(replace(hold::text, '-', ''), 1, 8)), rec.id, COALESCE(rec.held_from_status, 'RELEASED'), 'NORMAL', rec.production_owner_id,
      COALESCE((SELECT max(occurred_at) FROM tenant.manufacturing_order_events e WHERE e.manufacturing_order_id = rec.id AND e.action = 'HELD'), rec.updated_at, now()),
      (SELECT actor_user_id FROM tenant.manufacturing_order_events e WHERE e.manufacturing_order_id = rec.id AND e.action = 'HELD' ORDER BY occurred_at DESC LIMIT 1));
    INSERT INTO tenant.manufacturing_production_hold_reasons (organization_id, production_hold_id, manufacturing_order_id, reason_code, description, clearance_authority)
    VALUES (rec.organization_id, hold, rec.id,
      CASE rec.hold_category WHEN 'MATERIAL_SHORTAGE' THEN 'MATERIAL_SHORTAGE' WHEN 'QUALITY_ISSUE' THEN 'QUALITY_FAILURE' WHEN 'EQUIPMENT_DOWNTIME' THEN 'EQUIPMENT_BREAKDOWN'
        WHEN 'PRIORITY_CHANGE' THEN 'PRODUCTION_PRIORITY' WHEN 'COST_VARIANCE' THEN 'COSTING_EXCEPTION' WHEN 'QUANTITY_VARIANCE' THEN 'EXCESS_CONSUMPTION' ELSE 'OTHER' END,
      rpad(COALESCE(NULLIF(btrim(rec.hold_reason), ''), 'Held before production holds were recorded'), 10, '.'),
      CASE rec.hold_category WHEN 'QUALITY_ISSUE' THEN 'QUALITY' ELSE 'PRODUCTION' END);
    INSERT INTO tenant.manufacturing_production_hold_events (organization_id, production_hold_id, action, summary)
    VALUES (rec.organization_id, hold, 'MIGRATED', 'Recorded from the order''s existing hold');
  END LOOP;
END $$;

-- ============================================================ 6. isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['manufacturing_production_holds', 'manufacturing_production_hold_reasons', 'manufacturing_production_hold_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.manufacturing_production_holds, tenant.manufacturing_production_hold_reasons TO vercent_app;
GRANT SELECT, INSERT ON tenant.manufacturing_production_hold_events TO vercent_app;
GRANT SELECT ON tenant.manufacturing_production_holds, tenant.manufacturing_production_hold_reasons, tenant.manufacturing_production_hold_events TO vercent_worker;

-- ============================================================ 7. permissions and roles
-- Placing a hold stays manufacturing.mo.hold. Quality and safety blockers are cleared only by their own authority.
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('manufacturing.hold.view', 'View production holds', 'Manufacturing', 'See production holds, their reasons, readiness and downtime.'),
  ('manufacturing.hold.resolve', 'Clear production hold reasons', 'Manufacturing', 'Record corrective action and clear production blockers (shortages, equipment, priorities).'),
  ('manufacturing.hold.clear_quality', 'Clear quality blockers', 'Manufacturing', 'Clear a quality-related reason that stopped production.'),
  ('manufacturing.hold.clear_safety', 'Clear safety blockers', 'Manufacturing', 'Clear a safety or critical reason that stopped production.'),
  ('manufacturing.hold.resume', 'Resume held production', 'Manufacturing', 'Resume a manufacturing order once every reason is cleared.'),
  ('manufacturing.hold.approve_resume', 'Approve resuming production', 'Manufacturing', 'Approve a request to resume a held order where the company asks for it.'),
  ('manufacturing.hold.export', 'Export production hold reports', 'Manufacturing', 'Export hold and downtime reports.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('manufacturing_manager', 'manufacturing.hold.view'), ('manufacturing_manager', 'manufacturing.hold.resolve'), ('manufacturing_manager', 'manufacturing.hold.resume'),
    ('manufacturing_manager', 'manufacturing.hold.approve_resume'), ('manufacturing_manager', 'manufacturing.hold.export'),
    ('quality_manager', 'manufacturing.hold.view'), ('quality_manager', 'manufacturing.hold.clear_quality'), ('quality_manager', 'manufacturing.hold.export'),
    ('production_planner', 'manufacturing.hold.view'), ('production_planner', 'manufacturing.hold.resolve'), ('production_planner', 'manufacturing.hold.export'),
    ('shop_floor_operator', 'manufacturing.hold.view'), ('inventory_manager', 'manufacturing.hold.view'), ('accountant', 'manufacturing.hold.view'),
    ('purchase_manager', 'manufacturing.hold.view'), ('sales_head', 'manufacturing.hold.view'), ('sales_manager', 'manufacturing.hold.view')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0121_manufacturing_production_hold.sql', 'manufacturing-production-hold') ON CONFLICT DO NOTHING;
