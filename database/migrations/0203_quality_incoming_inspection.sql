-- Quality — Incoming Inspection (MVP 31; Final MVP Scope Part A features 3, 6, 9, 10, 15, 16). The execution of a receiving inspection on the inspection record a goods receipt (or an authorized person)
-- created: assignment, priority and due date, the sampling plan frozen from the bound specification version, identified samples, sample-level
-- observations evaluated against the frozen criteria (with amendment history), submission, review, finalized evidence, and the authorized
-- Quality disposition — accept, partly accept, reject, reinspect, conditional acceptance, return to supplier, scrap, hold for review — whose
-- quantities Inventory and Procurement then carry out. Execution status and lot disposition are tracked separately. Additive:
--
--   1. inspections     workflow status, source receipt line, obligation and control point version, population and sampling snapshots,
--                      inspector, priority, due date, review state, disposition totals, reinspection lineage.
--   2. samples         S01, S02 … (or the serial number), how and by whom each was selected.
--   3. observations    one current observation per sample and characteristic; corrections supersede, never overwrite.
--   4. reviews         every submission and review decision (append-only).
--   5. dispositions    the authorized decisions with their quantities (append-only; a later decision supersedes nothing silently).
--   6. settings        the review policy and default due days.
--   7. carry-over      existing inspections get their workflow status; legacy results stay readable.
--   8. permissions     quality.incoming.* and quality.disposition.*.

-- ============================================================ 1. inspections
ALTER TABLE tenant.quality_inspections
  ADD COLUMN IF NOT EXISTS workflow_status text NOT NULL DEFAULT 'PENDING' CHECK (workflow_status IN ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'AWAITING_REVIEW', 'CHANGES_REQUESTED', 'EVALUATED',
    'COMPLETED', 'CANCELLED', 'RECOVERY_REQUIRED')),
  ADD COLUMN IF NOT EXISTS goods_receipt_line_id uuid,
  ADD COLUMN IF NOT EXISTS obligation_id uuid REFERENCES tenant.quality_inspection_obligations(id),
  ADD COLUMN IF NOT EXISTS qcp_version_id uuid REFERENCES tenant.quality_control_point_versions(id),
  ADD COLUMN IF NOT EXISTS population_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS sampling_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS assigned_inspector_id uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS proposed_outcome text CHECK (proposed_outcome IS NULL OR proposed_outcome IN ('PASS', 'FAIL', 'REVIEW_REQUIRED')),
  ADD COLUMN IF NOT EXISTS critical_failure boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS evaluation jsonb,
  ADD COLUMN IF NOT EXISTS disposition_status text NOT NULL DEFAULT 'NONE' CHECK (disposition_status IN ('NONE', 'PARTIAL', 'DECIDED')),
  ADD COLUMN IF NOT EXISTS reinspection_of_id uuid REFERENCES tenant.quality_inspections(id),
  ADD COLUMN IF NOT EXISTS reinspection_reason text,
  ADD COLUMN IF NOT EXISTS standard_decision text,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS source_reversed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS quality_inspections_workflow_idx ON tenant.quality_inspections (organization_id, workflow_status);
CREATE INDEX IF NOT EXISTS quality_inspections_line_idx ON tenant.quality_inspections (organization_id, goods_receipt_line_id) WHERE goods_receipt_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS quality_inspections_assignee_idx ON tenant.quality_inspections (organization_id, assigned_inspector_id) WHERE assigned_inspector_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS quality_inspections_key_idx ON tenant.quality_inspections (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
-- One open inspection per obligation (a reinspection is created only after the earlier one is completed).
CREATE UNIQUE INDEX IF NOT EXISTS quality_inspections_obligation_open_idx ON tenant.quality_inspections (obligation_id)
  WHERE obligation_id IS NOT NULL AND workflow_status NOT IN ('COMPLETED', 'CANCELLED');

-- ============================================================ 2. samples
CREATE TABLE IF NOT EXISTS tenant.quality_inspection_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  inspection_id uuid NOT NULL REFERENCES tenant.quality_inspections(id),
  sample_code text NOT NULL CHECK (sample_code ~ '^[A-Za-z0-9_./-]{1,60}$'),
  sequence integer NOT NULL CHECK (sequence > 0),
  scope text NOT NULL DEFAULT 'UNIT' CHECK (scope IN ('UNIT', 'DOCUMENT', 'LOT')),
  batch_id uuid,
  serial_id uuid,
  serial_number text,
  selection_method text NOT NULL CHECK (selection_method IN ('SEQUENTIAL', 'SERIAL', 'MANUAL', 'DOCUMENT')),
  selected_by uuid REFERENCES public.users(id),
  selected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  note text,
  CONSTRAINT quality_inspection_samples_code_key UNIQUE (inspection_id, sample_code),
  CONSTRAINT quality_inspection_samples_sequence_key UNIQUE (inspection_id, sequence)
);

-- ============================================================ 3. observations
CREATE TABLE IF NOT EXISTS tenant.quality_inspection_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  inspection_id uuid NOT NULL REFERENCES tenant.quality_inspections(id),
  sample_id uuid NOT NULL REFERENCES tenant.quality_inspection_samples(id),
  characteristic_id uuid NOT NULL REFERENCES tenant.quality_inspection_characteristics(id),
  numeric_value numeric(24,10),
  unit_code text,
  boolean_value boolean,
  choice text,
  judgement text CHECK (judgement IS NULL OR judgement IN ('PASS', 'FAIL')),
  text_value text,
  not_applicable boolean NOT NULL DEFAULT false,
  na_reason text,
  outcome text NOT NULL CHECK (outcome IN ('PASS', 'FAIL', 'NOT_EVALUATED', 'NOT_APPLICABLE', 'REQUIRES_REVIEW', 'RECORDED')),
  outcome_reason text,
  measured_value text,
  evidence_file_ids uuid[] NOT NULL DEFAULT '{}',
  instrument_note text,
  notes text,
  evaluation_version text NOT NULL DEFAULT 'qs-1',
  is_current boolean NOT NULL DEFAULT true,
  supersedes_id uuid REFERENCES tenant.quality_inspection_observations(id),
  amendment_reason text,
  recorded_by uuid REFERENCES public.users(id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT quality_inspection_observations_na_check CHECK (NOT not_applicable OR length(btrim(COALESCE(na_reason, ''))) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS quality_inspection_observations_current_idx ON tenant.quality_inspection_observations (sample_id, characteristic_id) WHERE is_current;
CREATE INDEX IF NOT EXISTS quality_inspection_observations_inspection_idx ON tenant.quality_inspection_observations (inspection_id);

-- ============================================================ 4. reviews
CREATE TABLE IF NOT EXISTS tenant.quality_inspection_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  inspection_id uuid NOT NULL REFERENCES tenant.quality_inspections(id),
  action text NOT NULL CHECK (action IN ('SUBMITTED', 'APPROVED', 'CHANGES_REQUESTED', 'COMPLETED')),
  submission_number integer NOT NULL,
  proposed_outcome text,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text,
  actor_user_id uuid REFERENCES public.users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS quality_inspection_reviews_inspection_idx ON tenant.quality_inspection_reviews (inspection_id, occurred_at);

-- ============================================================ 5. dispositions
CREATE TABLE IF NOT EXISTS tenant.quality_dispositions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  disposition_number text NOT NULL,
  inspection_id uuid NOT NULL REFERENCES tenant.quality_inspections(id),
  obligation_id uuid REFERENCES tenant.quality_inspection_obligations(id),
  decision text NOT NULL CHECK (decision IN ('ACCEPT', 'PARTIAL_ACCEPT', 'REJECT', 'REINSPECT', 'CONDITIONAL_ACCEPT', 'RETURN_TO_SUPPLIER', 'SCRAP', 'HOLD_FOR_REVIEW')),
  accept_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (accept_quantity >= 0),
  conditional_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (conditional_quantity >= 0),
  reject_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (reject_quantity >= 0),
  reinspect_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (reinspect_quantity >= 0),
  hold_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (hold_quantity >= 0),
  reject_route text CHECK (reject_route IS NULL OR reject_route IN ('HOLD', 'RETURN_TO_SUPPLIER', 'SCRAP')),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  conditions text,
  evidence_reference text,
  nonconformance_id uuid REFERENCES tenant.quality_nonconformances(id),
  rejection_id uuid,
  reinspection_id uuid REFERENCES tenant.quality_inspections(id),
  decided_by uuid REFERENCES public.users(id),
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  idempotency_key text,
  CONSTRAINT quality_dispositions_number_key UNIQUE (organization_id, disposition_number)
);
CREATE INDEX IF NOT EXISTS quality_dispositions_inspection_idx ON tenant.quality_dispositions (inspection_id);
CREATE UNIQUE INDEX IF NOT EXISTS quality_dispositions_key_idx ON tenant.quality_dispositions (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE tenant.quality_nonconformances ADD COLUMN IF NOT EXISTS observation_ids uuid[] NOT NULL DEFAULT '{}';

-- ============================================================ 6. settings
ALTER TABLE tenant.quality_settings
  ADD COLUMN IF NOT EXISTS incoming_review_policy text NOT NULL DEFAULT 'ON_FAILURE' CHECK (incoming_review_policy IN ('ALWAYS', 'ON_FAILURE')),
  ADD COLUMN IF NOT EXISTS incoming_due_days integer NOT NULL DEFAULT 2 CHECK (incoming_due_days BETWEEN 0 AND 60);

-- ============================================================ isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['quality_inspection_samples', 'quality_inspection_observations', 'quality_inspection_reviews', 'quality_dispositions'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.quality_inspection_samples, tenant.quality_inspection_observations TO vercent_app, vercent_worker;
GRANT SELECT, INSERT ON tenant.quality_inspection_reviews, tenant.quality_dispositions TO vercent_app, vercent_worker;
-- A disposition is never edited; only its link to the rejection case Procurement opens for it is filled in afterwards.
GRANT UPDATE (rejection_id) ON tenant.quality_dispositions TO vercent_app, vercent_worker;

-- ============================================================ 7. carry-over
-- The workflow status of existing inspections from their status; their receipt line and obligation where known.
UPDATE tenant.quality_inspections SET workflow_status = CASE status WHEN 'draft' THEN 'PENDING' WHEN 'in_progress' THEN 'IN_PROGRESS' WHEN 'cancelled' THEN 'CANCELLED' ELSE 'COMPLETED' END,
    disposition_status = CASE WHEN status IN ('passed', 'failed', 'conditionally_accepted') THEN 'DECIDED' ELSE disposition_status END,
    completed_at = CASE WHEN status IN ('passed', 'failed', 'conditionally_accepted') THEN COALESCE(inspected_at, updated_at) ELSE completed_at END
  WHERE workflow_status = 'PENDING' AND status <> 'draft';
UPDATE tenant.quality_inspections i SET goods_receipt_line_id = d.goods_receipt_line_id FROM tenant.goods_receipt_dispositions d
  WHERE d.quality_inspection_id = i.id AND i.goods_receipt_line_id IS NULL;
UPDATE tenant.quality_inspections i SET obligation_id = o.id, qcp_version_id = o.qcp_version_id, goods_receipt_line_id = COALESCE(i.goods_receipt_line_id, o.source_line_id)
  FROM tenant.quality_inspection_obligations o WHERE o.inspection_id = i.id AND i.obligation_id IS NULL;

-- ============================================================ 8. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('quality.incoming.view', 'View incoming inspections', 'Quality', 'See receiving inspections and their results.'),
  ('quality.incoming.create', 'Create incoming inspections', 'Quality', 'Start an authorized manual inspection for a goods receipt line.'),
  ('quality.incoming.assign', 'Assign incoming inspections', 'Quality', 'Assign or reassign the inspector.'),
  ('quality.incoming.start', 'Start incoming inspections', 'Quality', 'Begin an inspection and select its samples.'),
  ('quality.incoming.record_result', 'Record inspection results', 'Quality', 'Save measurements and observations.'),
  ('quality.incoming.submit', 'Submit incoming inspections', 'Quality', 'Submit the results for evaluation and review.'),
  ('quality.incoming.review', 'Review incoming inspections', 'Quality', 'Review submitted results.'),
  ('quality.incoming.request_changes', 'Return inspections for changes', 'Quality', 'Send results back to the inspector.'),
  ('quality.incoming.complete', 'Complete incoming inspections', 'Quality', 'Finalize the inspection evidence.'),
  ('quality.incoming.reinspect', 'Request reinspection', 'Quality', 'Request an authorized retest of a defined quantity.'),
  ('quality.incoming.correct', 'Correct inspection results', 'Quality', 'Amend a recorded result with a reason (history kept).'),
  ('quality.incoming.cancel', 'Cancel incoming inspections', 'Quality', 'Cancel an eligible inspection.'),
  ('quality.incoming.export', 'Export incoming inspections', 'Quality', 'Download inspections and their reports.'),
  ('quality.incoming.view_audit', 'View inspection history', 'Quality', 'See every result, amendment, review and decision.'),
  ('quality.disposition.approve', 'Approve quality dispositions', 'Quality', 'Decide what happens to inspected goods: accept, partly accept, reject, return, scrap, reinspect.'),
  ('quality.disposition.waive', 'Approve conditional acceptance', 'Quality', 'Approve a permitted deviation (conditional acceptance).')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (
    SELECT slug, key FROM (VALUES ('quality_manager'), ('system_administrator'), ('organization_owner')) AS r(slug)
      CROSS JOIN (VALUES ('quality.incoming.view'), ('quality.incoming.create'), ('quality.incoming.assign'), ('quality.incoming.start'), ('quality.incoming.record_result'),
        ('quality.incoming.submit'), ('quality.incoming.review'), ('quality.incoming.request_changes'), ('quality.incoming.complete'), ('quality.incoming.reinspect'), ('quality.incoming.correct'),
        ('quality.incoming.cancel'), ('quality.incoming.export'), ('quality.incoming.view_audit'), ('quality.disposition.approve'), ('quality.disposition.waive')) AS k(key)
    UNION ALL
    SELECT * FROM (VALUES
      ('quality_supervisor', 'quality.incoming.view'), ('quality_supervisor', 'quality.incoming.create'), ('quality_supervisor', 'quality.incoming.assign'), ('quality_supervisor', 'quality.incoming.start'),
      ('quality_supervisor', 'quality.incoming.record_result'), ('quality_supervisor', 'quality.incoming.submit'), ('quality_supervisor', 'quality.incoming.review'),
      ('quality_supervisor', 'quality.incoming.request_changes'), ('quality_supervisor', 'quality.incoming.complete'), ('quality_supervisor', 'quality.incoming.reinspect'),
      ('quality_supervisor', 'quality.incoming.correct'), ('quality_supervisor', 'quality.incoming.export'), ('quality_supervisor', 'quality.incoming.view_audit'),
      ('quality_inspector', 'quality.incoming.view'), ('quality_inspector', 'quality.incoming.start'), ('quality_inspector', 'quality.incoming.record_result'), ('quality_inspector', 'quality.incoming.submit'),
      ('buyer', 'quality.incoming.view'), ('purchase_manager', 'quality.incoming.view'), ('supplier_manager', 'quality.view'), ('supplier_manager', 'quality.incoming.view'),
      ('inventory_manager', 'quality.incoming.view'), ('goods_receipt_user', 'quality.incoming.view'),
      ('auditor', 'quality.incoming.view'), ('auditor', 'quality.incoming.export'), ('auditor', 'quality.incoming.view_audit')
    ) AS pair(slug, key)
  ) AS grant_row ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0203_quality_incoming_inspection.sql', 'quality-incoming-inspection') ON CONFLICT DO NOTHING;
