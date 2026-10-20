-- Quality — In-Process Inspection (MVP 32). The shared inspection engine (0203) with a production source: a Manufacturing Order's production
-- run (batch) and its reported output (production entry) are the population an in-process inspection controls. Manufacturing has no
-- operation-level execution yet, so the "operation" is the control point's operation label on the run; the routing is not snapshotted
-- (none is used), the BOM revision is.
--
--   1. control points: the in-process checkpoint (first piece / operation completion / every N units) and the operation it covers;
--      the production trigger is connected, its gate blocks production progress.
--   2. requirements and inspections accept production sources; dispositions gain REWORK (a restricted quantity reinspected after rework).
--   3. quality_inprocess_contexts: the frozen production context of each in-process inspection (order, run, entry, operation, location,
--      operator, quantities, the rework a reinspection waits for).
--   4. quality_inprocess_checkpoints: one row per periodic / first-piece occurrence, so a checkpoint creates one requirement only.
--   5. permissions quality.inprocess.* and role grants.
-- Re-runnable.

-- ============================================================ 1. control points
ALTER TABLE tenant.quality_control_point_versions
  ADD COLUMN IF NOT EXISTS checkpoint_type text,
  ADD COLUMN IF NOT EXISTS checkpoint_interval numeric(20,6),
  ADD COLUMN IF NOT EXISTS operation_label text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quality_control_point_versions_checkpoint_check') THEN
    ALTER TABLE tenant.quality_control_point_versions ADD CONSTRAINT quality_control_point_versions_checkpoint_check
      CHECK ((checkpoint_type IS NULL OR checkpoint_type IN ('FIRST_PIECE', 'OPERATION_COMPLETION', 'PERIODIC'))
        AND (checkpoint_type IS DISTINCT FROM 'PERIODIC' OR checkpoint_interval > 0)
        AND (checkpoint_interval IS NULL OR checkpoint_interval > 0));
  END IF;
END $$;

-- Approved content is immutable (0163 guards its own columns): the checkpoint settings join it.
CREATE OR REPLACE FUNCTION tenant.quality_qcp_checkpoint_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status NOT IN ('DRAFT', 'CHANGES_REQUESTED') AND (NEW.checkpoint_type, NEW.checkpoint_interval, NEW.operation_label)
      IS DISTINCT FROM (OLD.checkpoint_type, OLD.checkpoint_interval, OLD.operation_label) THEN
    RAISE EXCEPTION 'QUALITY_QCP_VERSION_IMMUTABLE: approved control point content cannot change';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS quality_qcp_checkpoint_immutable ON tenant.quality_control_point_versions;
CREATE TRIGGER quality_qcp_checkpoint_immutable BEFORE UPDATE ON tenant.quality_control_point_versions FOR EACH ROW EXECUTE FUNCTION tenant.quality_qcp_checkpoint_immutable();

-- ============================================================ 2. production sources and the rework decision
ALTER TABLE tenant.quality_inspection_obligations DROP CONSTRAINT IF EXISTS quality_inspection_obligations_source_type_check;
ALTER TABLE tenant.quality_inspection_obligations ADD CONSTRAINT quality_inspection_obligations_source_type_check
  CHECK (source_type IN ('goods_receipt', 'manual', 'production_entry', 'production_run'));
ALTER TABLE tenant.quality_inspections DROP CONSTRAINT IF EXISTS quality_inspections_source_type_check;
ALTER TABLE tenant.quality_inspections ADD CONSTRAINT quality_inspections_source_type_check
  CHECK (source_type IN ('procurement_receipt', 'stock_batch', 'stock_serial', 'manufacturing_work_order', 'manufacturing_posting', 'sales_return', 'pos_return', 'manual', 'production_entry'));
CREATE INDEX IF NOT EXISTS quality_inspection_obligations_source_doc_idx ON tenant.quality_inspection_obligations (organization_id, source_type, source_document_id);

ALTER TABLE tenant.quality_dispositions ADD COLUMN IF NOT EXISTS rework_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (rework_quantity >= 0);
ALTER TABLE tenant.quality_dispositions ADD COLUMN IF NOT EXISTS rework_instruction text;
ALTER TABLE tenant.quality_dispositions ADD COLUMN IF NOT EXISTS manufacturing_decision_id uuid;
ALTER TABLE tenant.quality_dispositions DROP CONSTRAINT IF EXISTS quality_dispositions_decision_check;
ALTER TABLE tenant.quality_dispositions ADD CONSTRAINT quality_dispositions_decision_check
  CHECK (decision IN ('ACCEPT', 'PARTIAL_ACCEPT', 'REJECT', 'REINSPECT', 'CONDITIONAL_ACCEPT', 'RETURN_TO_SUPPLIER', 'SCRAP', 'HOLD_FOR_REVIEW', 'REWORK'));
-- Only Manufacturing's scrap decision for an in-process disposition is linked afterwards (like Procurement's rejection case).
GRANT UPDATE (manufacturing_decision_id) ON tenant.quality_dispositions TO vercent_app, vercent_worker;

-- ============================================================ 3. the production context of an in-process inspection
CREATE TABLE IF NOT EXISTS tenant.quality_inprocess_contexts (
  inspection_id uuid PRIMARY KEY REFERENCES tenant.quality_inspections(id),
  organization_id uuid NOT NULL,
  manufacturing_order_id uuid NOT NULL,
  production_entry_id uuid,
  production_batch_id uuid,
  mo_number text NOT NULL,
  entry_number text,
  batch_reference text,
  bom_revision_id uuid,
  operation_label text,
  checkpoint_type text NOT NULL CHECK (checkpoint_type IN ('FIRST_PIECE', 'OPERATION_COMPLETION', 'PERIODIC', 'MANUAL', 'REWORK')),
  checkpoint_sequence integer,
  production_location_id uuid,
  location_label text,
  produced_quantity numeric(20,6) NOT NULL DEFAULT 0,
  cumulative_quantity numeric(20,6),
  operator_user_id uuid,
  shift_label text,
  source_event_key text,
  rework_required boolean NOT NULL DEFAULT false,
  rework_instruction text,
  rework_reference text,
  rework_completed_at timestamptz,
  rework_completed_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS quality_inprocess_contexts_order_idx ON tenant.quality_inprocess_contexts (organization_id, manufacturing_order_id);
CREATE INDEX IF NOT EXISTS quality_inprocess_contexts_entry_idx ON tenant.quality_inprocess_contexts (organization_id, production_entry_id);
CREATE UNIQUE INDEX IF NOT EXISTS quality_inprocess_contexts_event_uidx ON tenant.quality_inprocess_contexts (organization_id, source_event_key) WHERE source_event_key IS NOT NULL;

-- ============================================================ 4. checkpoint occurrences
CREATE TABLE IF NOT EXISTS tenant.quality_inprocess_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  manufacturing_order_id uuid NOT NULL,
  production_batch_id uuid,
  control_point_id uuid NOT NULL,
  qcp_version_id uuid NOT NULL,
  checkpoint_type text NOT NULL CHECK (checkpoint_type IN ('FIRST_PIECE', 'PERIODIC')),
  checkpoint_sequence integer NOT NULL CHECK (checkpoint_sequence > 0),
  threshold_quantity numeric(20,6),
  production_entry_id uuid NOT NULL,
  obligation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS quality_inprocess_checkpoints_uidx ON tenant.quality_inprocess_checkpoints
  (organization_id, manufacturing_order_id, COALESCE(production_batch_id, '00000000-0000-0000-0000-000000000000'::uuid), control_point_id, checkpoint_type, checkpoint_sequence);

DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['quality_inprocess_contexts', 'quality_inprocess_checkpoints'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT ON tenant.quality_inprocess_checkpoints TO vercent_app, vercent_worker;
-- A checkpoint is claimed first, then linked to the requirement it created.
GRANT UPDATE (obligation_id) ON tenant.quality_inprocess_checkpoints TO vercent_app, vercent_worker;
GRANT SELECT, INSERT ON tenant.quality_inprocess_contexts TO vercent_app, vercent_worker;
-- The context is frozen; only the rework a reinspection waits for is confirmed later.
GRANT UPDATE (rework_reference, rework_completed_at, rework_completed_by) ON tenant.quality_inprocess_contexts TO vercent_app, vercent_worker;

-- ============================================================ 5. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('quality.inprocess.view', 'View in-process inspections', 'Quality', 'See production inspections, their results and the work they hold.'),
  ('quality.inprocess.create', 'Request in-process inspections', 'Quality', 'Request an inspection of reported production output.'),
  ('quality.inprocess.assign', 'Assign in-process inspections', 'Quality', 'Assign or reassign the inspector.'),
  ('quality.inprocess.start', 'Start in-process inspections', 'Quality', 'Begin an inspection and select its samples.'),
  ('quality.inprocess.record_result', 'Record in-process results', 'Quality', 'Save measurements and observations.'),
  ('quality.inprocess.submit', 'Submit in-process inspections', 'Quality', 'Submit the results for evaluation and review.'),
  ('quality.inprocess.review', 'Review in-process inspections', 'Quality', 'Review submitted results.'),
  ('quality.inprocess.request_changes', 'Return in-process inspections', 'Quality', 'Send results back to the inspector.'),
  ('quality.inprocess.complete', 'Complete in-process inspections', 'Quality', 'Finalize the inspection evidence.'),
  ('quality.inprocess.reinspect', 'Request in-process reinspection', 'Quality', 'Request a retest of a defined quantity, or rework and reinspection.'),
  ('quality.inprocess.correct', 'Correct in-process results', 'Quality', 'Amend a recorded result with a reason (history kept).'),
  ('quality.inprocess.cancel', 'Cancel in-process inspections', 'Quality', 'Cancel an eligible inspection.'),
  ('quality.inprocess.export', 'Export in-process inspections', 'Quality', 'Download inspections and their reports.'),
  ('quality.inprocess.view_audit', 'View in-process history', 'Quality', 'See every result, amendment, review and decision.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (
    SELECT slug, key FROM (VALUES ('quality_manager'), ('system_administrator'), ('organization_owner')) AS r(slug)
      CROSS JOIN (VALUES ('quality.inprocess.view'), ('quality.inprocess.create'), ('quality.inprocess.assign'), ('quality.inprocess.start'), ('quality.inprocess.record_result'),
        ('quality.inprocess.submit'), ('quality.inprocess.review'), ('quality.inprocess.request_changes'), ('quality.inprocess.complete'), ('quality.inprocess.reinspect'),
        ('quality.inprocess.correct'), ('quality.inprocess.cancel'), ('quality.inprocess.export'), ('quality.inprocess.view_audit')) AS k(key)
    UNION ALL
    SELECT * FROM (VALUES
      ('quality_supervisor', 'quality.inprocess.view'), ('quality_supervisor', 'quality.inprocess.create'), ('quality_supervisor', 'quality.inprocess.assign'),
      ('quality_supervisor', 'quality.inprocess.start'), ('quality_supervisor', 'quality.inprocess.record_result'), ('quality_supervisor', 'quality.inprocess.submit'),
      ('quality_supervisor', 'quality.inprocess.review'), ('quality_supervisor', 'quality.inprocess.request_changes'), ('quality_supervisor', 'quality.inprocess.complete'),
      ('quality_supervisor', 'quality.inprocess.reinspect'), ('quality_supervisor', 'quality.inprocess.correct'), ('quality_supervisor', 'quality.inprocess.export'),
      ('quality_supervisor', 'quality.inprocess.view_audit'),
      ('quality_inspector', 'quality.inprocess.view'), ('quality_inspector', 'quality.inprocess.start'), ('quality_inspector', 'quality.inprocess.record_result'),
      ('quality_inspector', 'quality.inprocess.submit'),
      ('manufacturing_manager', 'quality.inprocess.view'), ('manufacturing_manager', 'quality.inprocess.create'), ('manufacturing_manager', 'quality.inprocess.export'),
      ('production_supervisor', 'quality.inprocess.view'), ('production_supervisor', 'quality.inprocess.create'),
      ('production_planner', 'quality.inprocess.view'), ('manufacturing_engineer', 'quality.inprocess.view'),
      ('shop_floor_operator', 'quality.inprocess.view'), ('shop_floor_operator', 'quality.inprocess.create'),
      ('inventory_manager', 'quality.inprocess.view'),
      ('auditor', 'quality.inprocess.view'), ('auditor', 'quality.inprocess.export'), ('auditor', 'quality.inprocess.view_audit')
    ) AS pair(slug, key)
  ) AS grant_row ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0204_quality_in_process_inspection.sql', 'quality-in-process-inspection') ON CONFLICT DO NOTHING;
