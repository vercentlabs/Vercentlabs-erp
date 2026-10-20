-- Quality — Nonconformance (NCR), resolution and closure (MVP 36). Rebuilt over tenant.quality_nonconformances (additive):
--   1. the NCR workflow OPEN → UNDER_REVIEW → ACTION_REQUIRED → VERIFICATION_PENDING → RESOLVED → CLOSED (or CANCELLED); earlier rows mapped;
--      the record gains its title, detection, containment, investigation (root cause), resolution, verification and closure fields;
--   2. quality_nonconformance_items: the affected population (item, batch / serial, warehouse, quantity);
--   3. quality_nonconformance_actions: containment, correction, corrective and preventive actions — owner, due date, completion with
--      evidence, and their verification (never deleted: cancelled with a reason);
--   4. quality_nonconformance_links: dependencies outside Quality (a supplier claim, a credit note, a customer complaint …) that stay visible
--      and, when marked so, must be done before closure;
--   5. permissions quality.nonconformance.* and role grants.
-- The old generic quality_capa table is no longer used (its cleanup is handed over separately). Re-runnable.

-- ============================================================ 1. the record and its workflow
ALTER TABLE tenant.quality_nonconformances DROP CONSTRAINT IF EXISTS quality_nonconformances_status_check;
UPDATE tenant.quality_nonconformances SET status = CASE status
  WHEN 'open' THEN 'OPEN' WHEN 'under_review' THEN 'UNDER_REVIEW' WHEN 'contained' THEN 'ACTION_REQUIRED' WHEN 'corrective_action' THEN 'ACTION_REQUIRED'
  WHEN 'verified' THEN 'RESOLVED' WHEN 'closed' THEN 'CLOSED' WHEN 'cancelled' THEN 'CANCELLED' ELSE status END
 WHERE status IN ('open', 'under_review', 'contained', 'corrective_action', 'verified', 'closed', 'cancelled');
ALTER TABLE tenant.quality_nonconformances ADD CONSTRAINT quality_nonconformances_status_check
  CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'ACTION_REQUIRED', 'VERIFICATION_PENDING', 'RESOLVED', 'CLOSED', 'CANCELLED'));
ALTER TABLE tenant.quality_nonconformances ALTER COLUMN status SET DEFAULT 'OPEN';
ALTER TABLE tenant.quality_nonconformances
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS source_label text,
  ADD COLUMN IF NOT EXISTS detected_at timestamptz,
  ADD COLUMN IF NOT EXISTS detected_by uuid,
  ADD COLUMN IF NOT EXISTS defect_code text,
  ADD COLUMN IF NOT EXISTS containment_due date,
  ADD COLUMN IF NOT EXISTS contained_at timestamptz,
  ADD COLUMN IF NOT EXISTS contained_by uuid,
  ADD COLUMN IF NOT EXISTS root_cause_method text,
  ADD COLUMN IF NOT EXISTS root_cause text,
  ADD COLUMN IF NOT EXISTS investigation_summary text,
  ADD COLUMN IF NOT EXISTS investigated_at timestamptz,
  ADD COLUMN IF NOT EXISTS investigated_by uuid,
  ADD COLUMN IF NOT EXISTS resolution_summary text,
  ADD COLUMN IF NOT EXISTS verification_summary text,
  ADD COLUMN IF NOT EXISTS verified_by uuid,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS closure_note text,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS reopened_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;
UPDATE tenant.quality_nonconformances SET title = left(description, 120) WHERE title IS NULL;
UPDATE tenant.quality_nonconformances SET detected_at = created_at, detected_by = created_by WHERE detected_at IS NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quality_nonconformances_root_cause_method_check') THEN
    ALTER TABLE tenant.quality_nonconformances ADD CONSTRAINT quality_nonconformances_root_cause_method_check
      CHECK (root_cause_method IS NULL OR root_cause_method IN ('FIVE_WHYS', 'FISHBONE', 'FAULT_TREE', 'EIGHT_D', 'OTHER'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS quality_nonconformances_key_idx ON tenant.quality_nonconformances (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS quality_nonconformances_status_idx ON tenant.quality_nonconformances (organization_id, status);
CREATE INDEX IF NOT EXISTS quality_nonconformances_owner_idx ON tenant.quality_nonconformances (organization_id, owner_user_id);
GRANT SELECT, INSERT, UPDATE ON tenant.quality_nonconformances TO vercent_app, vercent_worker;

-- ============================================================ 2. the affected population
CREATE TABLE IF NOT EXISTS tenant.quality_nonconformance_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  nonconformance_id uuid NOT NULL REFERENCES tenant.quality_nonconformances(id),
  item_id uuid,
  batch_id uuid,
  serial_id uuid,
  warehouse_id uuid,
  quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  description text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS quality_nonconformance_items_nc_idx ON tenant.quality_nonconformance_items (organization_id, nonconformance_id);

-- ============================================================ 3. the actions
CREATE TABLE IF NOT EXISTS tenant.quality_nonconformance_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  nonconformance_id uuid NOT NULL REFERENCES tenant.quality_nonconformances(id),
  sequence integer NOT NULL,
  action_type text NOT NULL CHECK (action_type IN ('CONTAINMENT', 'CORRECTION', 'CORRECTIVE', 'PREVENTIVE')),
  description text NOT NULL CHECK (length(btrim(description)) > 0),
  owner_user_id uuid,
  due_date date,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'DONE', 'CANCELLED')),
  completed_by uuid,
  completed_at timestamptz,
  completion_note text,
  evidence_file_ids uuid[] NOT NULL DEFAULT '{}',
  effectiveness text CHECK (effectiveness IS NULL OR effectiveness IN ('EFFECTIVE', 'NOT_EFFECTIVE')),
  verified_by uuid,
  verified_at timestamptz,
  verification_note text,
  cancel_reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (nonconformance_id, sequence)
);
CREATE INDEX IF NOT EXISTS quality_nonconformance_actions_owner_idx ON tenant.quality_nonconformance_actions (organization_id, owner_user_id, status);

-- ============================================================ 4. dependencies outside Quality
CREATE TABLE IF NOT EXISTS tenant.quality_nonconformance_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  nonconformance_id uuid NOT NULL REFERENCES tenant.quality_nonconformances(id),
  link_type text NOT NULL CHECK (link_type IN ('SUPPLIER_CLAIM', 'CREDIT_NOTE', 'DEBIT_NOTE', 'CUSTOMER_COMPLAINT', 'PURCHASE_RETURN', 'ACCOUNTING', 'OTHER')),
  reference text NOT NULL CHECK (length(btrim(reference)) > 0),
  note text,
  blocks_closure boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'DONE')),
  done_by uuid,
  done_at timestamptz,
  done_note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS quality_nonconformance_links_nc_idx ON tenant.quality_nonconformance_links (organization_id, nonconformance_id);

DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['quality_nonconformance_items', 'quality_nonconformance_actions', 'quality_nonconformance_links'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
-- Items and actions are never deleted (an action is cancelled with a reason); evidence stays.
GRANT SELECT, INSERT ON tenant.quality_nonconformance_items TO vercent_app, vercent_worker;
GRANT SELECT, INSERT, UPDATE ON tenant.quality_nonconformance_actions TO vercent_app, vercent_worker;
GRANT SELECT, INSERT, UPDATE ON tenant.quality_nonconformance_links TO vercent_app, vercent_worker;

-- ============================================================ 5. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('quality.nonconformance.view', 'View nonconformances', 'Quality', 'See nonconformance reports, their actions, evidence and history.'),
  ('quality.nonconformance.manage', 'Manage nonconformances', 'Quality', 'Raise NCRs, record containment and investigation, and plan and complete actions.'),
  ('quality.nonconformance.verify', 'Verify nonconformance actions', 'Quality', 'Verify that the corrective actions were effective and resolve the NCR.'),
  ('quality.nonconformance.close', 'Close nonconformances', 'Quality', 'Authorize the closure of a resolved NCR, or reopen one.'),
  ('quality.nonconformance.export', 'Export nonconformances', 'Quality', 'Download nonconformance registers and reports.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (
    SELECT slug, key FROM (VALUES ('quality_manager'), ('system_administrator'), ('organization_owner')) AS r(slug)
      CROSS JOIN (VALUES ('quality.nonconformance.view'), ('quality.nonconformance.manage'), ('quality.nonconformance.verify'), ('quality.nonconformance.close'),
        ('quality.nonconformance.export')) AS k(key)
    UNION ALL
    SELECT * FROM (VALUES
      ('quality_supervisor', 'quality.nonconformance.view'), ('quality_supervisor', 'quality.nonconformance.manage'), ('quality_supervisor', 'quality.nonconformance.verify'),
      ('quality_supervisor', 'quality.nonconformance.export'),
      ('quality_inspector', 'quality.nonconformance.view'), ('quality_inspector', 'quality.nonconformance.manage'),
      ('manufacturing_manager', 'quality.nonconformance.view'), ('production_supervisor', 'quality.nonconformance.view'), ('purchase_manager', 'quality.nonconformance.view'),
      ('supplier_manager', 'quality.nonconformance.view'), ('inventory_manager', 'quality.nonconformance.view'), ('sales_manager', 'quality.nonconformance.view'),
      ('auditor', 'quality.nonconformance.view'), ('auditor', 'quality.nonconformance.export')
    ) AS pair(slug, key)
  ) AS grant_row ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0207_quality_nonconformance.sql', 'quality-nonconformance') ON CONFLICT DO NOTHING;
