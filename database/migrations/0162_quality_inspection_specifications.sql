-- Quality — Inspection Specifications. One Company-scoped, version-controlled definition of what must be checked, how, what result is
-- acceptable and when: ordered characteristics with decimal-safe limits, a deterministic sampling plan and decision rule, approval, effective
-- dating and applicability rules resolved deterministically for each inspection. Inspections bind to the exact version they used. Additive:
--
--   1. specifications   the stable identity: QSP code, name, purpose, inspection stage, product or category, template flag, retired state.
--   2. versions         the controlled content: method, sampling, decision rule, effective dates, review / approval / publication, content hash.
--   3. characteristics  the ordered checks of one version (numeric range or target ± tolerance, pass/fail, choice, visual, observation).
--   4. applicability    which specification applies to which item / category / company default, supplier and site, over which dates.
--   5. requirements     where the Company requires an inspection (a missing specification there is an exception, never an acceptance).
--   6. events           an append-only history of every change, review, approval, publication and retirement.
--   7. exceptions       configuration exceptions met while resolving a source (missing specification, conflicting rules).
--   8. guards           approved content is immutable (versions and characteristics), one open revision and one active version per specification.
--   9. legacy link      an inspection plan mirrors each published version (the inspection screens keep working); inspections remember their version.
--  10. carry-over      existing quality plans continue as specifications with their history.
--  11. permissions     quality.spec.* and the Quality Inspector and Quality Supervisor roles.

-- ============================================================ 1. specifications
CREATE TABLE IF NOT EXISTS tenant.quality_inspection_specifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  specification_code text NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text NOT NULL DEFAULT '',
  inspection_stage text NOT NULL CHECK (inspection_stage IN ('INCOMING', 'IN_PROCESS', 'FINAL', 'PRE_DISPATCH', 'RETURN', 'MANUAL')),
  item_id uuid REFERENCES tenant.items(id),
  item_group_id uuid,
  is_template boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RETIRED')),
  current_version_id uuid,
  copied_from_id uuid REFERENCES tenant.quality_inspection_specifications(id),
  retired_at timestamptz,
  retired_by uuid REFERENCES public.users(id),
  retire_reason text,
  legacy_plan_code text,
  idempotency_key text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT quality_inspection_specifications_code_key UNIQUE (organization_id, specification_code),
  CONSTRAINT quality_inspection_specifications_group_fk FOREIGN KEY (organization_id, item_group_id) REFERENCES tenant.item_groups(organization_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS quality_inspection_specifications_key_idx ON tenant.quality_inspection_specifications (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS quality_inspection_specifications_item_idx ON tenant.quality_inspection_specifications (organization_id, item_id);

-- ============================================================ 2. versions
CREATE TABLE IF NOT EXISTS tenant.quality_inspection_spec_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  specification_id uuid NOT NULL REFERENCES tenant.quality_inspection_specifications(id),
  version_number integer NOT NULL CHECK (version_number > 0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'ACTIVE', 'SUPERSEDED', 'RETIRED', 'REJECTED')),
  inspection_stage text NOT NULL CHECK (inspection_stage IN ('INCOMING', 'IN_PROCESS', 'FINAL', 'PRE_DISPATCH', 'RETURN', 'MANUAL')),
  inspection_method text NOT NULL DEFAULT 'FULL' CHECK (inspection_method IN ('SAMPLING', 'FULL', 'DOCUMENT_REVIEW')),
  sampling_method text NOT NULL DEFAULT 'ALL_UNITS' CHECK (sampling_method IN ('ALL_UNITS', 'FIXED_COUNT', 'PERCENTAGE', 'DOCUMENT_ONLY', 'MANUAL_APPROVED_COUNT')),
  sampling_basis text NOT NULL DEFAULT 'RECEIVED_QUANTITY' CHECK (sampling_basis IN ('RECEIVED_QUANTITY', 'LOT', 'SOURCE_LINE')),
  sample_value numeric(24,6) CHECK (sample_value IS NULL OR sample_value > 0),
  sample_minimum integer CHECK (sample_minimum IS NULL OR sample_minimum >= 0),
  sample_maximum integer CHECK (sample_maximum IS NULL OR sample_maximum > 0),
  rounding_rule text NOT NULL DEFAULT 'UP' CHECK (rounding_rule IN ('UP', 'DOWN', 'NEAREST')),
  sampling_instructions text,
  decision_rule text NOT NULL DEFAULT 'ALL_REQUIRED_PASS' CHECK (decision_rule IN ('ALL_REQUIRED_PASS', 'COUNT_BASED', 'MANUAL_REVIEW')),
  allowed_major_defects integer CHECK (allowed_major_defects IS NULL OR allowed_major_defects >= 0),
  allowed_minor_defects integer CHECK (allowed_minor_defects IS NULL OR allowed_minor_defects >= 0),
  lot_context text NOT NULL DEFAULT 'NONE' CHECK (lot_context IN ('NONE', 'PER_LOT', 'PER_SERIAL')),
  effective_from date NOT NULL DEFAULT current_date,
  effective_until date,
  revision_reason text,
  supersedes_version_id uuid REFERENCES tenant.quality_inspection_spec_versions(id),
  superseded_by_version_id uuid REFERENCES tenant.quality_inspection_spec_versions(id),
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
  legacy_plan_id uuid,
  idempotency_key text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT quality_inspection_spec_versions_number_key UNIQUE (specification_id, version_number),
  CONSTRAINT quality_inspection_spec_versions_dates_check CHECK (effective_until IS NULL OR effective_until >= effective_from)
);
-- One revision in progress and one effective version per specification at a time.
CREATE UNIQUE INDEX IF NOT EXISTS quality_inspection_spec_versions_open_idx ON tenant.quality_inspection_spec_versions (specification_id)
  WHERE status IN ('DRAFT', 'PENDING_REVIEW', 'CHANGES_REQUESTED');
CREATE UNIQUE INDEX IF NOT EXISTS quality_inspection_spec_versions_active_idx ON tenant.quality_inspection_spec_versions (specification_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS quality_inspection_spec_versions_key_idx ON tenant.quality_inspection_spec_versions (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS quality_inspection_spec_versions_status_idx ON tenant.quality_inspection_spec_versions (organization_id, status);

-- ============================================================ 3. characteristics
CREATE TABLE IF NOT EXISTS tenant.quality_inspection_characteristics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  version_id uuid NOT NULL REFERENCES tenant.quality_inspection_spec_versions(id),
  characteristic_code text NOT NULL CHECK (characteristic_code ~ '^[A-Z0-9][A-Z0-9_-]{0,29}$'),
  sequence integer NOT NULL CHECK (sequence > 0),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  check_type text NOT NULL CHECK (check_type IN ('NUMERIC_RANGE', 'NUMERIC_TARGET_TOLERANCE', 'BOOLEAN', 'ENUM', 'VISUAL', 'TEXT_OBSERVATION')),
  instructions text NOT NULL DEFAULT '',
  acceptance_text text,
  evidence_note text,
  uom_id uuid REFERENCES tenant.units_of_measure(id),
  unit_code text,
  target_value numeric(24,10),
  lower_tolerance numeric(24,10) CHECK (lower_tolerance IS NULL OR lower_tolerance >= 0),
  upper_tolerance numeric(24,10) CHECK (upper_tolerance IS NULL OR upper_tolerance >= 0),
  lower_limit numeric(24,10),
  upper_limit numeric(24,10),
  lower_inclusive boolean NOT NULL DEFAULT true,
  upper_inclusive boolean NOT NULL DEFAULT true,
  decimal_places integer NOT NULL DEFAULT 2 CHECK (decimal_places BETWEEN 0 AND 10),
  measurement_rounding text NOT NULL DEFAULT 'NONE' CHECK (measurement_rounding IN ('NONE', 'HALF_UP')),
  expected_boolean boolean,
  allowed_values jsonb NOT NULL DEFAULT '[]'::jsonb,
  judgement text CHECK (judgement IS NULL OR judgement IN ('INFORMATIONAL', 'INSPECTOR_JUDGEMENT')),
  criticality text NOT NULL DEFAULT 'MAJOR' CHECK (criticality IN ('CRITICAL', 'MAJOR', 'MINOR', 'INFORMATIONAL')),
  is_required boolean NOT NULL DEFAULT true,
  allow_na boolean NOT NULL DEFAULT false,
  evidence_required boolean NOT NULL DEFAULT false,
  instrument_note text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT quality_inspection_characteristics_code_key UNIQUE (version_id, characteristic_code),
  CONSTRAINT quality_inspection_characteristics_sequence_key UNIQUE (version_id, sequence) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT quality_inspection_characteristics_limits_check CHECK (lower_limit IS NULL OR upper_limit IS NULL OR lower_limit <= upper_limit)
);

-- ============================================================ 4. applicability
-- The specificity tier: 0 item + supplier + site, 1 item + supplier or site, 2 item, 3-5 the same over a category, 6-8 over the company.
CREATE TABLE IF NOT EXISTS tenant.quality_spec_applicability_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  specification_id uuid NOT NULL REFERENCES tenant.quality_inspection_specifications(id),
  inspection_stage text NOT NULL CHECK (inspection_stage IN ('INCOMING', 'IN_PROCESS', 'FINAL', 'PRE_DISPATCH', 'RETURN', 'MANUAL')),
  scope_kind text NOT NULL CHECK (scope_kind IN ('ITEM', 'CATEGORY', 'COMPANY_DEFAULT')),
  item_id uuid REFERENCES tenant.items(id),
  item_group_id uuid,
  supplier_id uuid,
  warehouse_id uuid REFERENCES tenant.warehouses(id),
  effective_from date NOT NULL DEFAULT current_date,
  effective_until date,
  specificity smallint NOT NULL CHECK (specificity BETWEEN 0 AND 8),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  reason text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deactivated_by uuid REFERENCES public.users(id),
  deactivated_at timestamptz,
  deactivation_reason text,
  CONSTRAINT quality_spec_applicability_rules_scope_check CHECK (
    (scope_kind = 'ITEM' AND item_id IS NOT NULL AND item_group_id IS NULL) OR (scope_kind = 'CATEGORY' AND item_group_id IS NOT NULL AND item_id IS NULL)
    OR (scope_kind = 'COMPANY_DEFAULT' AND item_id IS NULL AND item_group_id IS NULL)),
  CONSTRAINT quality_spec_applicability_rules_dates_check CHECK (effective_until IS NULL OR effective_until >= effective_from),
  CONSTRAINT quality_spec_applicability_rules_group_fk FOREIGN KEY (organization_id, item_group_id) REFERENCES tenant.item_groups(organization_id, id),
  CONSTRAINT quality_spec_applicability_rules_supplier_fk FOREIGN KEY (organization_id, supplier_id) REFERENCES tenant.procurement_suppliers(organization_id, id)
);
CREATE INDEX IF NOT EXISTS quality_spec_applicability_rules_stage_idx ON tenant.quality_spec_applicability_rules (organization_id, inspection_stage, status);
CREATE INDEX IF NOT EXISTS quality_spec_applicability_rules_spec_idx ON tenant.quality_spec_applicability_rules (specification_id);

-- ============================================================ 5. inspection requirements and the approval policy
CREATE TABLE IF NOT EXISTS tenant.quality_inspection_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  inspection_stage text NOT NULL CHECK (inspection_stage IN ('INCOMING', 'IN_PROCESS', 'FINAL', 'PRE_DISPATCH', 'RETURN', 'MANUAL')),
  scope_kind text NOT NULL CHECK (scope_kind IN ('ITEM', 'CATEGORY', 'ALL_ITEMS')),
  item_id uuid REFERENCES tenant.items(id),
  item_group_id uuid,
  supplier_id uuid,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  note text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deactivated_by uuid REFERENCES public.users(id),
  deactivated_at timestamptz,
  CONSTRAINT quality_inspection_requirements_scope_check CHECK (
    (scope_kind = 'ITEM' AND item_id IS NOT NULL AND item_group_id IS NULL) OR (scope_kind = 'CATEGORY' AND item_group_id IS NOT NULL AND item_id IS NULL)
    OR (scope_kind = 'ALL_ITEMS' AND item_id IS NULL AND item_group_id IS NULL)),
  CONSTRAINT quality_inspection_requirements_group_fk FOREIGN KEY (organization_id, item_group_id) REFERENCES tenant.item_groups(organization_id, id),
  CONSTRAINT quality_inspection_requirements_supplier_fk FOREIGN KEY (organization_id, supplier_id) REFERENCES tenant.procurement_suppliers(organization_id, id)
);
CREATE INDEX IF NOT EXISTS quality_inspection_requirements_stage_idx ON tenant.quality_inspection_requirements (organization_id, inspection_stage, status);

ALTER TABLE tenant.quality_settings
  ADD COLUMN IF NOT EXISTS spec_prohibit_self_approval boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS spec_approval_note_required boolean NOT NULL DEFAULT false;

-- ============================================================ 6. events
CREATE TABLE IF NOT EXISTS tenant.quality_spec_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  specification_id uuid NOT NULL REFERENCES tenant.quality_inspection_specifications(id),
  version_id uuid REFERENCES tenant.quality_inspection_spec_versions(id),
  action text NOT NULL,
  from_status text,
  to_status text,
  note text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS quality_spec_events_spec_idx ON tenant.quality_spec_events (specification_id, occurred_at);

-- ============================================================ 7. exceptions
CREATE TABLE IF NOT EXISTS tenant.quality_spec_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  exception_code text NOT NULL CHECK (exception_code IN ('SPEC_MISSING', 'APPLICABILITY_CONFLICT', 'SPEC_NOT_EFFECTIVE', 'SPEC_RETIRED')),
  inspection_stage text NOT NULL,
  item_id uuid REFERENCES tenant.items(id),
  supplier_id uuid,
  warehouse_id uuid,
  source_type text NOT NULL,
  source_id uuid,
  source_line_id uuid,
  source_label text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED', 'DISMISSED')),
  resolved_by uuid REFERENCES public.users(id),
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS quality_spec_exceptions_open_idx ON tenant.quality_spec_exceptions (organization_id, exception_code, source_line_id)
  WHERE status = 'OPEN' AND source_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS quality_spec_exceptions_status_idx ON tenant.quality_spec_exceptions (organization_id, status);

-- ============================================================ 8. guards: approved content is immutable
-- Content may change only while the version is a draft (or returned for changes). Approval stamps the content hash once; supersession may
-- end-date a version; nothing else of an approved version changes.
CREATE OR REPLACE FUNCTION tenant.quality_spec_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status NOT IN ('DRAFT', 'CHANGES_REQUESTED') AND (
       (NEW.specification_id, NEW.version_number, NEW.inspection_stage, NEW.inspection_method, NEW.sampling_method, NEW.sampling_basis, NEW.sample_value, NEW.sample_minimum,
        NEW.sample_maximum, NEW.rounding_rule, NEW.sampling_instructions, NEW.decision_rule, NEW.allowed_major_defects, NEW.allowed_minor_defects, NEW.lot_context,
        NEW.effective_from, NEW.revision_reason, NEW.supersedes_version_id)
       IS DISTINCT FROM
       (OLD.specification_id, OLD.version_number, OLD.inspection_stage, OLD.inspection_method, OLD.sampling_method, OLD.sampling_basis, OLD.sample_value, OLD.sample_minimum,
        OLD.sample_maximum, OLD.rounding_rule, OLD.sampling_instructions, OLD.decision_rule, OLD.allowed_major_defects, OLD.allowed_minor_defects, OLD.lot_context,
        OLD.effective_from, OLD.revision_reason, OLD.supersedes_version_id)
       OR (OLD.content_hash IS NOT NULL AND NEW.content_hash IS DISTINCT FROM OLD.content_hash)) THEN
    RAISE EXCEPTION 'QUALITY_SPEC_VERSION_IMMUTABLE: create a revision to change approved criteria' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'quality_spec_version_guard') THEN
    CREATE TRIGGER quality_spec_version_guard BEFORE UPDATE ON tenant.quality_inspection_spec_versions FOR EACH ROW EXECUTE FUNCTION tenant.quality_spec_version_guard();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION tenant.quality_spec_characteristic_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  state text;
BEGIN
  SELECT status INTO state FROM tenant.quality_inspection_spec_versions WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.version_id ELSE NEW.version_id END;
  IF state IS NULL OR state NOT IN ('DRAFT', 'CHANGES_REQUESTED') THEN
    RAISE EXCEPTION 'QUALITY_SPEC_VERSION_IMMUTABLE: the checks of an approved version cannot change' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.version_id IS DISTINCT FROM OLD.version_id THEN
    RAISE EXCEPTION 'QUALITY_SPEC_VERSION_IMMUTABLE: a check belongs to one version' USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'quality_spec_characteristic_guard') THEN
    CREATE TRIGGER quality_spec_characteristic_guard BEFORE INSERT OR UPDATE OR DELETE ON tenant.quality_inspection_characteristics FOR EACH ROW EXECUTE FUNCTION tenant.quality_spec_characteristic_guard();
  END IF;
END $$;

-- ============================================================ 9. the legacy link
-- Each published version is mirrored as an inspection plan (with its points), so the inspection screens keep working; inspections remember the
-- exact specification version and why it was chosen.
ALTER TABLE tenant.quality_plans ADD COLUMN IF NOT EXISTS spec_version_id uuid REFERENCES tenant.quality_inspection_spec_versions(id);
CREATE UNIQUE INDEX IF NOT EXISTS quality_plans_spec_version_idx ON tenant.quality_plans (spec_version_id) WHERE spec_version_id IS NOT NULL;
ALTER TABLE tenant.quality_inspection_points ADD COLUMN IF NOT EXISTS spec_characteristic_id uuid REFERENCES tenant.quality_inspection_characteristics(id);
ALTER TABLE tenant.quality_inspections
  ADD COLUMN IF NOT EXISTS spec_version_id uuid REFERENCES tenant.quality_inspection_spec_versions(id),
  ADD COLUMN IF NOT EXISTS spec_resolution jsonb;
CREATE INDEX IF NOT EXISTS quality_inspections_spec_version_idx ON tenant.quality_inspections (spec_version_id) WHERE spec_version_id IS NOT NULL;

-- ============================================================ isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['quality_inspection_specifications', 'quality_inspection_spec_versions', 'quality_inspection_characteristics', 'quality_spec_applicability_rules',
    'quality_inspection_requirements', 'quality_spec_events', 'quality_spec_exceptions'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.quality_inspection_specifications, tenant.quality_inspection_spec_versions, tenant.quality_spec_applicability_rules,
  tenant.quality_inspection_requirements, tenant.quality_spec_exceptions TO vercent_app, vercent_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.quality_inspection_characteristics TO vercent_app, vercent_worker;
GRANT SELECT, INSERT ON tenant.quality_spec_events TO vercent_app, vercent_worker;

-- ============================================================ 10. carry-over of the existing quality plans
-- Every plan code becomes one specification and each of its plan versions one specification version with the same checks: a draft stays a
-- draft, an active plan is the active version, an inactive one approved but not in use, an obsolete one superseded. The plan itself becomes
-- the mirror of its version, so its inspections keep their plan and now also name the version. Its scope becomes an applicability rule.
DO $$
DECLARE
  g record;
  p record;
  v_spec uuid;
  v_version uuid;
  n integer;
  supplier uuid;
  latest_active uuid;
BEGIN
  FOR g IN SELECT organization_id, code, min(created_by::text)::uuid AS created_by, min(created_at) AS created_at FROM tenant.quality_plans
      WHERE spec_version_id IS NULL GROUP BY organization_id, code LOOP
    SELECT id INTO v_spec FROM tenant.quality_inspection_specifications WHERE organization_id = g.organization_id AND legacy_plan_code = g.code;
    IF v_spec IS NULL THEN
      n := (SELECT count(*) + 1 FROM tenant.quality_inspection_specifications WHERE organization_id = g.organization_id);
      INSERT INTO tenant.quality_inspection_specifications (organization_id, specification_code, name, description, inspection_stage, item_id, item_group_id, legacy_plan_code,
          created_by, created_at)
        SELECT g.organization_id, 'QSP-L' || lpad(n::text, 5, '0'), p0.name, COALESCE(p0.description, ''),
          CASE p0.plan_type WHEN 'incoming' THEN 'INCOMING' WHEN 'supplier' THEN 'INCOMING' WHEN 'in_process' THEN 'IN_PROCESS' WHEN 'final' THEN 'FINAL'
            WHEN 'customer_return' THEN 'RETURN' ELSE 'MANUAL' END,
          p0.item_id, CASE WHEN p0.item_id IS NULL THEN p0.item_group_id END, g.code, g.created_by, g.created_at
          FROM tenant.quality_plans p0 WHERE p0.organization_id = g.organization_id AND p0.code = g.code ORDER BY p0.version DESC LIMIT 1
        RETURNING id INTO v_spec;
    END IF;
    latest_active := NULL;
    FOR p IN SELECT * FROM tenant.quality_plans WHERE organization_id = g.organization_id AND code = g.code AND spec_version_id IS NULL ORDER BY version LOOP
      INSERT INTO tenant.quality_inspection_spec_versions (organization_id, specification_id, version_number, status, inspection_stage, inspection_method, sampling_method, sample_value,
          rounding_rule, decision_rule, effective_from, effective_until, revision_reason, legacy_plan_id, created_by, created_at)
        VALUES (p.organization_id, v_spec, p.version, 'DRAFT', (SELECT inspection_stage FROM tenant.quality_inspection_specifications WHERE id = v_spec),
          CASE p.sampling_method WHEN 'full' THEN 'FULL' ELSE 'SAMPLING' END,
          CASE p.sampling_method WHEN 'full' THEN 'ALL_UNITS' WHEN 'percentage' THEN 'PERCENTAGE' ELSE 'FIXED_COUNT' END,
          CASE WHEN p.sampling_method IN ('full') OR p.sampling_value <= 0 THEN NULL ELSE p.sampling_value END,
          'UP', 'ALL_REQUIRED_PASS', COALESCE(p.effective_from, p.created_at::date), p.effective_to, CASE WHEN p.version > 1 THEN 'Carried over from the quality plan' END,
          p.id, p.created_by, p.created_at)
        RETURNING id INTO v_version;
      INSERT INTO tenant.quality_inspection_characteristics (organization_id, version_id, characteristic_code, sequence, name, check_type, instructions, acceptance_text, unit_code,
          target_value, lower_limit, upper_limit, expected_boolean, allowed_values, judgement, criticality, is_required, instrument_note)
        SELECT pt.organization_id, v_version, 'C' || lpad(pt.sequence::text, 2, '0'), pt.sequence, pt.characteristic,
          CASE pt.result_type WHEN 'numeric' THEN 'NUMERIC_RANGE' WHEN 'boolean' THEN 'BOOLEAN' WHEN 'selection' THEN 'ENUM' ELSE 'TEXT_OBSERVATION' END,
          COALESCE(pt.instructions, ''), NULL, pt.unit, pt.target_value, pt.lower_limit, pt.upper_limit,
          CASE WHEN pt.result_type = 'boolean' THEN true END,
          CASE WHEN pt.result_type = 'selection' THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object('value', v, 'label', v, 'acceptable', true)), '[]'::jsonb) FROM jsonb_array_elements_text(pt.allowed_values) v)
            ELSE '[]'::jsonb END,
          CASE WHEN pt.result_type = 'text' THEN 'INSPECTOR_JUDGEMENT' END,
          CASE WHEN pt.critical THEN 'CRITICAL' ELSE 'MAJOR' END, true, NULLIF(pt.inspection_method, '')
          FROM tenant.quality_inspection_points pt WHERE pt.plan_id = p.id ORDER BY pt.sequence;
      UPDATE tenant.quality_inspection_points pt SET spec_characteristic_id = c.id FROM tenant.quality_inspection_characteristics c
        WHERE pt.plan_id = p.id AND c.version_id = v_version AND c.sequence = pt.sequence;
      UPDATE tenant.quality_inspection_spec_versions SET
          status = CASE p.status WHEN 'draft' THEN 'DRAFT' WHEN 'active' THEN 'ACTIVE' WHEN 'inactive' THEN 'APPROVED' ELSE 'SUPERSEDED' END,
          approved_by = CASE WHEN p.status <> 'draft' THEN p.approved_by END, approved_at = CASE WHEN p.status <> 'draft' THEN COALESCE(p.approved_at, p.updated_at) END,
          published_by = CASE WHEN p.status IN ('active', 'obsolete') THEN p.approved_by END,
          published_at = CASE WHEN p.status IN ('active', 'obsolete') THEN COALESCE(p.approved_at, p.updated_at) END,
          activated_at = CASE WHEN p.status IN ('active', 'obsolete') THEN COALESCE(p.approved_at, p.updated_at) END,
          superseded_at = CASE WHEN p.status = 'obsolete' THEN p.updated_at END
        WHERE id = v_version;
      -- An older active plan of the same code (the plans allowed several) is superseded by the newer.
      IF p.status = 'active' THEN
        IF latest_active IS NOT NULL THEN
          UPDATE tenant.quality_inspection_spec_versions SET status = 'SUPERSEDED', superseded_at = now(), superseded_by_version_id = v_version WHERE id = latest_active;
        END IF;
        latest_active := v_version;
      END IF;
      UPDATE tenant.quality_plans SET spec_version_id = v_version WHERE id = p.id;
      UPDATE tenant.quality_inspections SET spec_version_id = v_version,
          spec_resolution = jsonb_build_object('method', 'CARRIED_OVER', 'planCode', p.code, 'planVersion', p.version)
        WHERE plan_id = p.id AND spec_version_id IS NULL;
      INSERT INTO tenant.quality_spec_events (organization_id, specification_id, version_id, action, to_status, details, actor_user_id)
        VALUES (p.organization_id, v_spec, v_version, 'CARRIED_OVER', (SELECT status FROM tenant.quality_inspection_spec_versions WHERE id = v_version),
          jsonb_build_object('planCode', p.code, 'planVersion', p.version, 'planStatus', p.status), p.created_by);
      -- The plan's scope, once per specification (the newest plan's).
      IF NOT EXISTS (SELECT 1 FROM tenant.quality_spec_applicability_rules r WHERE r.specification_id = v_spec) AND p.status IN ('active', 'inactive') THEN
        supplier := (SELECT s.id FROM tenant.procurement_suppliers s WHERE s.organization_id = p.organization_id AND (s.id = p.supplier_id OR s.party_id = p.supplier_id) LIMIT 1);
        INSERT INTO tenant.quality_spec_applicability_rules (organization_id, specification_id, inspection_stage, scope_kind, item_id, item_group_id, supplier_id, warehouse_id,
            effective_from, effective_until, specificity, reason, created_by)
          VALUES (p.organization_id, v_spec, (SELECT inspection_stage FROM tenant.quality_inspection_specifications WHERE id = v_spec),
            CASE WHEN p.item_id IS NOT NULL THEN 'ITEM' WHEN p.item_group_id IS NOT NULL THEN 'CATEGORY' ELSE 'COMPANY_DEFAULT' END,
            p.item_id, CASE WHEN p.item_id IS NULL THEN p.item_group_id END, supplier, p.warehouse_id,
            COALESCE(p.effective_from, p.created_at::date), p.effective_to,
            (CASE WHEN p.item_id IS NOT NULL THEN 0 WHEN p.item_group_id IS NOT NULL THEN 3 ELSE 6 END) + 2 - (CASE WHEN supplier IS NOT NULL THEN 1 ELSE 0 END)
              - (CASE WHEN p.warehouse_id IS NOT NULL THEN 1 ELSE 0 END),
            'Carried over from the quality plan', p.created_by);
      END IF;
    END LOOP;
    UPDATE tenant.quality_inspection_specifications s SET current_version_id = (
        SELECT v.id FROM tenant.quality_inspection_spec_versions v WHERE v.specification_id = s.id
         ORDER BY (v.status = 'ACTIVE') DESC, (v.status IN ('APPROVED', 'SUPERSEDED')) DESC, v.version_number DESC LIMIT 1),
        status = CASE WHEN EXISTS (SELECT 1 FROM tenant.quality_inspection_spec_versions v WHERE v.specification_id = s.id AND v.status NOT IN ('SUPERSEDED', 'RETIRED', 'REJECTED'))
          THEN 'ACTIVE' ELSE 'RETIRED' END
      WHERE s.id = v_spec;
  END LOOP;
END $$;

-- ============================================================ 11. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('quality.spec.view', 'View inspection specifications', 'Quality', 'See the inspection specifications that apply to your work.'),
  ('quality.spec.create', 'Create inspection specifications', 'Quality', 'Start a new specification as a draft.'),
  ('quality.spec.edit_draft', 'Edit specification drafts', 'Quality', 'Change the checks, sampling and details of a draft version.'),
  ('quality.spec.copy', 'Copy inspection specifications', 'Quality', 'Duplicate a specification or template as a new draft.'),
  ('quality.spec.submit', 'Submit inspection specifications', 'Quality', 'Send a draft version for Quality review.'),
  ('quality.spec.review', 'Review inspection specifications', 'Quality', 'Review a submitted version and ask for changes or reject it.'),
  ('quality.spec.approve', 'Approve inspection specifications', 'Quality', 'Approve a reviewed version.'),
  ('quality.spec.activate', 'Publish inspection specifications', 'Quality', 'Make an approved version effective for new inspections.'),
  ('quality.spec.revise', 'Revise inspection specifications', 'Quality', 'Start a new version of an approved specification.'),
  ('quality.spec.retire', 'Retire inspection specifications', 'Quality', 'Stop a specification being used by new inspections.'),
  ('quality.spec.manage_applicability', 'Manage specification applicability', 'Quality', 'Decide which items, categories, suppliers and sites a specification applies to.'),
  ('quality.spec.view_history', 'View specification history', 'Quality', 'See every version, change and approval.'),
  ('quality.spec.export', 'Export inspection specifications', 'Quality', 'Download specifications and their reports.'),
  ('quality.spec.view_evidence', 'View specification documents', 'Quality', 'Open the documents attached to a specification.')
ON CONFLICT (key) DO NOTHING;

-- The inspection and supervision roles, in every organisation that has Quality.
INSERT INTO public.roles (id, organization_id, name, slug, description, is_system, status, module_key, template_key, assignable, risk_level, version)
SELECT gen_random_uuid(), organization.id, template.name, template.slug, template.description, true, 'active', 'quality', template.slug, true, template.risk, 1
  FROM public.organizations organization
  CROSS JOIN (VALUES
    ('Quality Inspector', 'quality_inspector', 'Performs inspections against the approved specifications and records results.', 'standard'),
    ('Quality Supervisor', 'quality_supervisor', 'Prepares and revises inspection specifications and submits them for approval.', 'standard')
  ) AS template(name, slug, description, risk)
 WHERE EXISTS (SELECT 1 FROM public.roles existing WHERE existing.organization_id = organization.id AND existing.slug = 'quality_manager')
ON CONFLICT (organization_id, slug) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (
    SELECT slug, key FROM (VALUES ('quality_manager'), ('system_administrator'), ('organization_owner')) AS r(slug)
      CROSS JOIN (VALUES ('quality.spec.view'), ('quality.spec.create'), ('quality.spec.edit_draft'), ('quality.spec.copy'), ('quality.spec.submit'), ('quality.spec.review'),
        ('quality.spec.approve'), ('quality.spec.activate'), ('quality.spec.revise'), ('quality.spec.retire'), ('quality.spec.manage_applicability'), ('quality.spec.view_history'),
        ('quality.spec.export'), ('quality.spec.view_evidence')) AS k(key)
    UNION ALL
    SELECT * FROM (VALUES
      ('quality_supervisor', 'quality.view'), ('quality_supervisor', 'quality.inspect'), ('quality_supervisor', 'quality.reports.view'),
      ('quality_supervisor', 'quality.spec.view'), ('quality_supervisor', 'quality.spec.create'), ('quality_supervisor', 'quality.spec.edit_draft'), ('quality_supervisor', 'quality.spec.copy'),
      ('quality_supervisor', 'quality.spec.submit'), ('quality_supervisor', 'quality.spec.revise'), ('quality_supervisor', 'quality.spec.view_history'), ('quality_supervisor', 'quality.spec.export'),
      ('quality_supervisor', 'quality.spec.view_evidence'),
      ('quality_supervisor', 'workspace.view'), ('quality_supervisor', 'notifications.view'), ('quality_supervisor', 'profile.manage'), ('quality_supervisor', 'business_data.view'),
      ('quality_inspector', 'quality.view'), ('quality_inspector', 'quality.inspect'), ('quality_inspector', 'quality.spec.view'), ('quality_inspector', 'quality.spec.view_evidence'),
      ('quality_inspector', 'workspace.view'), ('quality_inspector', 'notifications.view'), ('quality_inspector', 'profile.manage'), ('quality_inspector', 'business_data.view'),
      ('buyer', 'quality.view'), ('buyer', 'quality.spec.view'), ('purchase_manager', 'quality.view'), ('purchase_manager', 'quality.spec.view'),
      ('inventory_manager', 'quality.view'), ('inventory_manager', 'quality.spec.view'), ('inventory_manager', 'quality.spec.view_evidence'),
      ('goods_receipt_user', 'quality.view'), ('goods_receipt_user', 'quality.spec.view'), ('goods_receipt_user', 'quality.spec.view_evidence'),
      ('manufacturing_manager', 'quality.view'), ('manufacturing_manager', 'quality.spec.view'), ('manufacturing_manager', 'quality.spec.view_evidence'),
      ('auditor', 'quality.view'), ('auditor', 'quality.spec.view'), ('auditor', 'quality.spec.view_history'), ('auditor', 'quality.spec.export'), ('auditor', 'quality.spec.view_evidence')
    ) AS pair(slug, key)
  ) AS grant_row ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0162_quality_inspection_specifications.sql', 'quality-inspection-specifications') ON CONFLICT DO NOTHING;
