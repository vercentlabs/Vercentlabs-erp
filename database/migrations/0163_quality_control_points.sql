-- Quality — Quality Control Points. When an inspection must happen, which approved specification it uses, and whether the transaction may
-- proceed before Quality clearance: a Company-scoped, version-controlled rule engine evaluated on authoritative ERP events. A matched point
-- creates one durable inspection obligation per source line and purpose, bound to the exact point and specification versions; a mandatory
-- stock-hold point keeps the received quantity restricted until every blocking obligation is satisfied or formally waived. Additive:
--
--   1. control points   the stable identity: QCP code, name, purpose, retired state.
--   2. versions         stage, trigger event, mandatory / advisory / manual, gate, specification binding, override or additional, dates, approval.
--   3. rules            which items / categories / Company default, supplier and site a version applies to (version-scoped, immutable once approved).
--   4. obligations      the inspection requirement a matched point created for a source line: versions, quantity, inspection, status, allowance.
--   5. evaluations      append-only evidence of every trigger evaluation: candidates, outcome, obligations, conflicts.
--   6. waivers          controlled deviations: requested, approved or rejected by another authorized person (never for a failed critical check).
--   7. events           an append-only history of every change and decision.
--   8. guards           approved content is immutable; one revision in progress and one active version per point; one obligation per source line and point.
--   9. carry-over       the inspection requirement rules become mandatory control points (no gate), so nothing that was required stops being so.
--  10. permissions      quality.qcp.* and the role defaults.

-- ============================================================ 1. control points
CREATE TABLE IF NOT EXISTS tenant.quality_control_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  qcp_code text NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RETIRED')),
  current_version_id uuid,
  copied_from_id uuid REFERENCES tenant.quality_control_points(id),
  retired_at timestamptz,
  retired_by uuid REFERENCES public.users(id),
  retire_reason text,
  legacy_requirement_id uuid,
  idempotency_key text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT quality_control_points_code_key UNIQUE (organization_id, qcp_code)
);
CREATE UNIQUE INDEX IF NOT EXISTS quality_control_points_key_idx ON tenant.quality_control_points (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ============================================================ 2. versions
CREATE TABLE IF NOT EXISTS tenant.quality_control_point_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  control_point_id uuid NOT NULL REFERENCES tenant.quality_control_points(id),
  version_number integer NOT NULL CHECK (version_number > 0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'CHANGES_REQUESTED', 'APPROVED', 'ACTIVE', 'SUPERSEDED', 'RETIRED', 'REJECTED')),
  inspection_stage text NOT NULL CHECK (inspection_stage IN ('INCOMING', 'IN_PROCESS', 'FINAL', 'PRE_DISPATCH', 'RETURN', 'MANUAL')),
  trigger_event text NOT NULL CHECK (trigger_event IN ('INVENTORY_GOODS_RECEIPT_CONFIRMED', 'PRODUCTION_OPERATION_READY_FOR_QC', 'PRODUCTION_OUTPUT_READY_FOR_QC',
    'SALES_DELIVERY_READY_FOR_DISPATCH', 'CUSTOMER_RETURN_RECEIVED', 'QUALITY_MANUAL_INSPECTION_REQUESTED')),
  requirement_type text NOT NULL DEFAULT 'MANDATORY' CHECK (requirement_type IN ('MANDATORY', 'ADVISORY', 'MANUAL')),
  gate_type text NOT NULL DEFAULT 'NONE' CHECK (gate_type IN ('NONE', 'HOLD_STOCK', 'BLOCK_DISPATCH', 'BLOCK_PRODUCTION_PROGRESS')),
  spec_binding text NOT NULL DEFAULT 'FAMILY' CHECK (spec_binding IN ('FAMILY', 'LOCKED', 'RESOLVE')),
  specification_id uuid REFERENCES tenant.quality_inspection_specifications(id),
  spec_version_id uuid REFERENCES tenant.quality_inspection_spec_versions(id),
  match_mode text NOT NULL DEFAULT 'OVERRIDE_DEFAULT' CHECK (match_mode IN ('OVERRIDE_DEFAULT', 'ADDITIONAL_REQUIRED_CHECK')),
  purpose_code text NOT NULL DEFAULT 'GENERAL' CHECK (purpose_code ~ '^[A-Z0-9_]{1,30}$'),
  quantity_scope text NOT NULL DEFAULT 'RECEIVED_QUANTITY' CHECK (quantity_scope IN ('RECEIVED_QUANTITY', 'HELD_QUANTITY')),
  lot_context text NOT NULL DEFAULT 'NONE' CHECK (lot_context IN ('NONE', 'PER_LOT', 'PER_SERIAL')),
  waiver_allowed boolean NOT NULL DEFAULT true,
  effective_from date NOT NULL DEFAULT current_date,
  effective_until date,
  revision_reason text,
  supersedes_version_id uuid REFERENCES tenant.quality_control_point_versions(id),
  superseded_by_version_id uuid REFERENCES tenant.quality_control_point_versions(id),
  submitted_by uuid REFERENCES public.users(id),
  submitted_at timestamptz,
  reviewed_by uuid REFERENCES public.users(id),
  reviewed_at timestamptz,
  review_note text,
  approved_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  approval_note text,
  published_by uuid REFERENCES public.users(id),
  published_at timestamptz,
  activated_at timestamptz,
  superseded_at timestamptz,
  retired_at timestamptz,
  content_hash text,
  idempotency_key text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT quality_control_point_versions_number_key UNIQUE (control_point_id, version_number),
  CONSTRAINT quality_control_point_versions_dates_check CHECK (effective_until IS NULL OR effective_until >= effective_from),
  CONSTRAINT quality_control_point_versions_binding_check CHECK ((spec_binding = 'FAMILY' AND specification_id IS NOT NULL) OR (spec_binding = 'LOCKED' AND spec_version_id IS NOT NULL)
    OR spec_binding = 'RESOLVE' OR status IN ('DRAFT', 'CHANGES_REQUESTED', 'REJECTED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS quality_control_point_versions_open_idx ON tenant.quality_control_point_versions (control_point_id)
  WHERE status IN ('DRAFT', 'PENDING_APPROVAL', 'CHANGES_REQUESTED');
CREATE UNIQUE INDEX IF NOT EXISTS quality_control_point_versions_active_idx ON tenant.quality_control_point_versions (control_point_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS quality_control_point_versions_key_idx ON tenant.quality_control_point_versions (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS quality_control_point_versions_trigger_idx ON tenant.quality_control_point_versions (organization_id, trigger_event, status);

-- ============================================================ 3. rules (version-scoped)
-- Specificity as for specifications: 0 item + supplier + site, 1 item + supplier or site, 2 item, 3-5 category, 6-8 Company default.
CREATE TABLE IF NOT EXISTS tenant.quality_control_point_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  version_id uuid NOT NULL REFERENCES tenant.quality_control_point_versions(id),
  scope_kind text NOT NULL CHECK (scope_kind IN ('ITEM', 'CATEGORY', 'COMPANY_DEFAULT')),
  item_id uuid REFERENCES tenant.items(id),
  item_group_id uuid,
  supplier_id uuid,
  warehouse_id uuid REFERENCES tenant.warehouses(id),
  specificity smallint NOT NULL CHECK (specificity BETWEEN 0 AND 8),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT quality_control_point_rules_scope_check CHECK (
    (scope_kind = 'ITEM' AND item_id IS NOT NULL AND item_group_id IS NULL) OR (scope_kind = 'CATEGORY' AND item_group_id IS NOT NULL AND item_id IS NULL)
    OR (scope_kind = 'COMPANY_DEFAULT' AND item_id IS NULL AND item_group_id IS NULL)),
  CONSTRAINT quality_control_point_rules_group_fk FOREIGN KEY (organization_id, item_group_id) REFERENCES tenant.item_groups(organization_id, id),
  CONSTRAINT quality_control_point_rules_supplier_fk FOREIGN KEY (organization_id, supplier_id) REFERENCES tenant.procurement_suppliers(organization_id, id)
);
CREATE INDEX IF NOT EXISTS quality_control_point_rules_version_idx ON tenant.quality_control_point_rules (version_id);

-- ============================================================ 4. obligations
CREATE TABLE IF NOT EXISTS tenant.quality_inspection_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  control_point_id uuid NOT NULL REFERENCES tenant.quality_control_points(id),
  qcp_version_id uuid NOT NULL REFERENCES tenant.quality_control_point_versions(id),
  spec_version_id uuid REFERENCES tenant.quality_inspection_spec_versions(id),
  source_type text NOT NULL CHECK (source_type IN ('goods_receipt', 'manual')),
  source_document_id uuid,
  source_line_id uuid,
  source_label text,
  source_event_key text NOT NULL,
  purpose_code text NOT NULL,
  quality_scope_key text,
  item_id uuid REFERENCES tenant.items(id),
  supplier_id uuid,
  warehouse_id uuid,
  batch_id uuid,
  controlled_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (controlled_quantity >= 0),
  blocking boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SATISFIED', 'FAILED', 'WAIVED', 'EXCEPTION', 'CANCELLED')),
  exception_code text,
  inspection_id uuid REFERENCES tenant.quality_inspections(id),
  disposition_id uuid,
  allowance_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (allowance_quantity >= 0),
  accepted_quantity numeric(20,6),
  rejected_quantity numeric(20,6),
  outcome_label text,
  source_reversed boolean NOT NULL DEFAULT false,
  resolution jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_by uuid REFERENCES public.users(id),
  resolved_at timestamptz,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS quality_inspection_obligations_scope_idx ON tenant.quality_inspection_obligations (organization_id, source_event_key, control_point_id)
  WHERE status <> 'CANCELLED';
CREATE INDEX IF NOT EXISTS quality_inspection_obligations_line_idx ON tenant.quality_inspection_obligations (organization_id, source_line_id);
CREATE INDEX IF NOT EXISTS quality_inspection_obligations_status_idx ON tenant.quality_inspection_obligations (organization_id, status);
CREATE INDEX IF NOT EXISTS quality_inspection_obligations_inspection_idx ON tenant.quality_inspection_obligations (inspection_id) WHERE inspection_id IS NOT NULL;

-- ============================================================ 5. evaluations
CREATE TABLE IF NOT EXISTS tenant.quality_qcp_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  trigger_event text NOT NULL,
  source_type text NOT NULL,
  source_document_id uuid,
  source_line_id uuid,
  source_label text,
  effective_date date NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('NO_MATCH', 'REQUIREMENTS_CREATED', 'CONFLICT', 'SPEC_MISSING', 'ALREADY_EVALUATED', 'REEVALUATED', 'FAILED')),
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  obligation_ids uuid[] NOT NULL DEFAULT '{}',
  forced_hold boolean NOT NULL DEFAULT false,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS quality_qcp_evaluations_source_idx ON tenant.quality_qcp_evaluations (organization_id, source_line_id);
CREATE INDEX IF NOT EXISTS quality_qcp_evaluations_time_idx ON tenant.quality_qcp_evaluations (organization_id, occurred_at);

-- ============================================================ 6. waivers
CREATE TABLE IF NOT EXISTS tenant.quality_qcp_waivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  obligation_id uuid NOT NULL REFERENCES tenant.quality_inspection_obligations(id),
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  requested_disposition text NOT NULL CHECK (requested_disposition IN ('RELEASE', 'CONDITIONAL_USE')),
  quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  risk_justification text NOT NULL CHECK (length(btrim(risk_justification)) > 0),
  conditions text,
  evidence_reference text,
  requested_by uuid REFERENCES public.users(id),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_by uuid REFERENCES public.users(id),
  decided_at timestamptz,
  decision_note text,
  idempotency_key text
);
CREATE UNIQUE INDEX IF NOT EXISTS quality_qcp_waivers_open_idx ON tenant.quality_qcp_waivers (obligation_id) WHERE status = 'REQUESTED';
CREATE UNIQUE INDEX IF NOT EXISTS quality_qcp_waivers_key_idx ON tenant.quality_qcp_waivers (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ============================================================ 7. events
CREATE TABLE IF NOT EXISTS tenant.quality_qcp_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  control_point_id uuid REFERENCES tenant.quality_control_points(id),
  version_id uuid REFERENCES tenant.quality_control_point_versions(id),
  obligation_id uuid REFERENCES tenant.quality_inspection_obligations(id),
  action text NOT NULL,
  from_status text,
  to_status text,
  note text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS quality_qcp_events_point_idx ON tenant.quality_qcp_events (control_point_id, occurred_at);
CREATE INDEX IF NOT EXISTS quality_qcp_events_obligation_idx ON tenant.quality_qcp_events (obligation_id) WHERE obligation_id IS NOT NULL;

-- Configuration exceptions met by a control point name it and the obligation they block.
ALTER TABLE tenant.quality_spec_exceptions
  ADD COLUMN IF NOT EXISTS control_point_id uuid REFERENCES tenant.quality_control_points(id),
  ADD COLUMN IF NOT EXISTS obligation_id uuid REFERENCES tenant.quality_inspection_obligations(id);

-- ============================================================ 8. guards
CREATE OR REPLACE FUNCTION tenant.quality_qcp_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status NOT IN ('DRAFT', 'CHANGES_REQUESTED') AND (
       (NEW.control_point_id, NEW.version_number, NEW.inspection_stage, NEW.trigger_event, NEW.requirement_type, NEW.gate_type, NEW.spec_binding, NEW.specification_id, NEW.spec_version_id,
        NEW.match_mode, NEW.purpose_code, NEW.quantity_scope, NEW.lot_context, NEW.waiver_allowed, NEW.effective_from, NEW.revision_reason, NEW.supersedes_version_id)
       IS DISTINCT FROM
       (OLD.control_point_id, OLD.version_number, OLD.inspection_stage, OLD.trigger_event, OLD.requirement_type, OLD.gate_type, OLD.spec_binding, OLD.specification_id, OLD.spec_version_id,
        OLD.match_mode, OLD.purpose_code, OLD.quantity_scope, OLD.lot_context, OLD.waiver_allowed, OLD.effective_from, OLD.revision_reason, OLD.supersedes_version_id)
       OR (OLD.content_hash IS NOT NULL AND NEW.content_hash IS DISTINCT FROM OLD.content_hash)) THEN
    RAISE EXCEPTION 'QUALITY_QCP_VERSION_IMMUTABLE: create a new revision to change this approved rule' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'quality_qcp_version_guard') THEN
    CREATE TRIGGER quality_qcp_version_guard BEFORE UPDATE ON tenant.quality_control_point_versions FOR EACH ROW EXECUTE FUNCTION tenant.quality_qcp_version_guard();
  END IF;
END $$;
CREATE OR REPLACE FUNCTION tenant.quality_qcp_rule_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  state text;
BEGIN
  SELECT status INTO state FROM tenant.quality_control_point_versions WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.version_id ELSE NEW.version_id END;
  IF state IS NULL OR state NOT IN ('DRAFT', 'CHANGES_REQUESTED') THEN
    RAISE EXCEPTION 'QUALITY_QCP_VERSION_IMMUTABLE: the applicability of an approved version cannot change' USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'quality_qcp_rule_guard') THEN
    CREATE TRIGGER quality_qcp_rule_guard BEFORE INSERT OR UPDATE OR DELETE ON tenant.quality_control_point_rules FOR EACH ROW EXECUTE FUNCTION tenant.quality_qcp_rule_guard();
  END IF;
END $$;

-- ============================================================ isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['quality_control_points', 'quality_control_point_versions', 'quality_control_point_rules', 'quality_inspection_obligations', 'quality_qcp_evaluations',
    'quality_qcp_waivers', 'quality_qcp_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.quality_control_points, tenant.quality_control_point_versions, tenant.quality_inspection_obligations, tenant.quality_qcp_waivers TO vercent_app, vercent_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.quality_control_point_rules TO vercent_app, vercent_worker;
GRANT SELECT, INSERT ON tenant.quality_qcp_evaluations, tenant.quality_qcp_events TO vercent_app, vercent_worker;

-- ============================================================ 9. carry-over of the inspection requirement rules
-- Each active requirement rule becomes an active mandatory control point with no gate that resolves its specification through the
-- specifications' applicability (what the rule did: a missing specification is a Quality exception). The rule is closed with a pointer.
DO $$
DECLARE
  r record;
  v_point uuid;
  v_version uuid;
  n integer;
BEGIN
  FOR r IN SELECT * FROM tenant.quality_inspection_requirements q WHERE q.status = 'ACTIVE'
      AND NOT EXISTS (SELECT 1 FROM tenant.quality_control_points p WHERE p.legacy_requirement_id = q.id) LOOP
    n := (SELECT count(*) + 1 FROM tenant.quality_control_points WHERE organization_id = r.organization_id);
    INSERT INTO tenant.quality_control_points (organization_id, qcp_code, name, description, legacy_requirement_id, created_by, created_at)
      VALUES (r.organization_id, 'QCP-L' || lpad(n::text, 5, '0'), 'Required inspection (carried over)', COALESCE(r.note, 'Carried over from an inspection requirement rule'), r.id, r.created_by, r.created_at)
      RETURNING id INTO v_point;
    INSERT INTO tenant.quality_control_point_versions (organization_id, control_point_id, version_number, status, inspection_stage, trigger_event, requirement_type, gate_type, spec_binding,
        match_mode, effective_from, created_by, created_at)
      VALUES (r.organization_id, v_point, 1, 'DRAFT', r.inspection_stage,
        CASE r.inspection_stage WHEN 'INCOMING' THEN 'INVENTORY_GOODS_RECEIPT_CONFIRMED' WHEN 'IN_PROCESS' THEN 'PRODUCTION_OPERATION_READY_FOR_QC' WHEN 'FINAL' THEN 'PRODUCTION_OUTPUT_READY_FOR_QC'
          WHEN 'PRE_DISPATCH' THEN 'SALES_DELIVERY_READY_FOR_DISPATCH' WHEN 'RETURN' THEN 'CUSTOMER_RETURN_RECEIVED' ELSE 'QUALITY_MANUAL_INSPECTION_REQUESTED' END,
        'MANDATORY', 'NONE', 'RESOLVE', 'ADDITIONAL_REQUIRED_CHECK', r.created_at::date, r.created_by, r.created_at)
      RETURNING id INTO v_version;
    INSERT INTO tenant.quality_control_point_rules (organization_id, version_id, scope_kind, item_id, item_group_id, supplier_id, specificity)
      VALUES (r.organization_id, v_version, CASE r.scope_kind WHEN 'ALL_ITEMS' THEN 'COMPANY_DEFAULT' ELSE r.scope_kind END, r.item_id, r.item_group_id, r.supplier_id,
        (CASE r.scope_kind WHEN 'ITEM' THEN 0 WHEN 'CATEGORY' THEN 3 ELSE 6 END) + 2 - (CASE WHEN r.supplier_id IS NOT NULL THEN 1 ELSE 0 END));
    UPDATE tenant.quality_control_point_versions SET status = 'ACTIVE', approved_at = now(), published_at = now(), activated_at = now() WHERE id = v_version;
    UPDATE tenant.quality_control_points SET current_version_id = v_version WHERE id = v_point;
    INSERT INTO tenant.quality_qcp_events (organization_id, control_point_id, version_id, action, to_status, details, actor_user_id)
      VALUES (r.organization_id, v_point, v_version, 'CARRIED_OVER', 'ACTIVE', jsonb_build_object('requirementId', r.id), r.created_by);
    UPDATE tenant.quality_inspection_requirements SET status = 'INACTIVE', deactivated_at = now(),
        note = COALESCE(note || ' · ', '') || 'Carried over to control point ' || (SELECT qcp_code FROM tenant.quality_control_points WHERE id = v_point)
      WHERE id = r.id;
  END LOOP;
END $$;

-- ============================================================ 10. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('quality.qcp.view', 'View quality control points', 'Quality', 'See the control points and inspection requirements that apply to your work.'),
  ('quality.qcp.create', 'Create quality control points', 'Quality', 'Start a new control point as a draft.'),
  ('quality.qcp.edit_draft', 'Edit control point drafts', 'Quality', 'Change a draft control point.'),
  ('quality.qcp.copy', 'Copy quality control points', 'Quality', 'Duplicate a control point as a new draft.'),
  ('quality.qcp.submit', 'Submit quality control points', 'Quality', 'Send a draft control point for approval.'),
  ('quality.qcp.review', 'Review quality control points', 'Quality', 'Review a submitted control point and ask for changes or reject it.'),
  ('quality.qcp.approve', 'Approve quality control points', 'Quality', 'Approve a control point configuration.'),
  ('quality.qcp.activate', 'Publish quality control points', 'Quality', 'Make an approved control point effective.'),
  ('quality.qcp.revise', 'Revise quality control points', 'Quality', 'Start a new version of a control point.'),
  ('quality.qcp.retire', 'Retire quality control points', 'Quality', 'Stop a control point applying to new transactions.'),
  ('quality.qcp.manage_gate', 'Configure quality gates', 'Quality', 'Set whether a control point blocks stock or downstream steps.'),
  ('quality.qcp.request_waiver', 'Request quality waivers', 'Quality', 'Ask for an approved deviation from an inspection requirement.'),
  ('quality.qcp.approve_waiver', 'Approve quality waivers', 'Quality', 'Authorize an eligible deviation from an inspection requirement.'),
  ('quality.qcp.reevaluate', 'Re-evaluate quality requirements', 'Quality', 'Retry or reconcile a source transaction''s inspection requirements.'),
  ('quality.qcp.view_history', 'View control point history', 'Quality', 'See trigger history, versions and the audit trail.'),
  ('quality.qcp.export', 'Export quality control points', 'Quality', 'Download control points and their reports.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (
    SELECT slug, key FROM (VALUES ('quality_manager'), ('system_administrator'), ('organization_owner')) AS r(slug)
      CROSS JOIN (VALUES ('quality.qcp.view'), ('quality.qcp.create'), ('quality.qcp.edit_draft'), ('quality.qcp.copy'), ('quality.qcp.submit'), ('quality.qcp.review'), ('quality.qcp.approve'),
        ('quality.qcp.activate'), ('quality.qcp.revise'), ('quality.qcp.retire'), ('quality.qcp.manage_gate'), ('quality.qcp.request_waiver'), ('quality.qcp.approve_waiver'),
        ('quality.qcp.reevaluate'), ('quality.qcp.view_history'), ('quality.qcp.export')) AS k(key)
    UNION ALL
    SELECT * FROM (VALUES
      ('quality_supervisor', 'quality.qcp.view'), ('quality_supervisor', 'quality.qcp.create'), ('quality_supervisor', 'quality.qcp.edit_draft'), ('quality_supervisor', 'quality.qcp.copy'),
      ('quality_supervisor', 'quality.qcp.submit'), ('quality_supervisor', 'quality.qcp.revise'), ('quality_supervisor', 'quality.qcp.request_waiver'), ('quality_supervisor', 'quality.qcp.reevaluate'),
      ('quality_supervisor', 'quality.qcp.view_history'), ('quality_supervisor', 'quality.qcp.export'),
      ('quality_inspector', 'quality.qcp.view'),
      ('buyer', 'quality.qcp.view'), ('purchase_manager', 'quality.qcp.view'), ('inventory_manager', 'quality.qcp.view'), ('goods_receipt_user', 'quality.qcp.view'),
      ('manufacturing_manager', 'quality.qcp.view'),
      ('finance_manager', 'quality.view'), ('finance_manager', 'quality.qcp.view'), ('finance_manager', 'quality.qcp.view_history'),
      ('auditor', 'quality.qcp.view'), ('auditor', 'quality.qcp.view_history'), ('auditor', 'quality.qcp.export')
    ) AS pair(slug, key)
  ) AS grant_row ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0163_quality_control_points.sql', 'quality-control-points') ON CONFLICT DO NOTHING;
