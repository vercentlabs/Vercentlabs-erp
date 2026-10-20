-- Quality — Inspection Linked to Delivery (MVP 34). The shared inspection engine (0203) applied to a Sales delivery before dispatch: the
-- "Delivery ready for dispatch" trigger checks each delivery line a pre-dispatch control point covers. Under a mandatory check the line is
-- dispatched only up to what Quality cleared (Sales enforces it in dispatch, fail-closed); units Quality rejects go onto an Inventory quality
-- hold case, so no other delivery or POS sale takes them.
--   1. sources: a delivery (inspection) and a delivery line (requirement, keyed by the delivery and its sales order line, which stays the same
--      when a draft delivery's lines are edited); a hold case opened from a Quality disposition;
--   2. quality_dispatch_contexts: the frozen delivery context of each pre-dispatch inspection (order, delivery, line, customer, warehouse);
--   3. the disposition remembers the hold case it opened for rejected units;
--   4. permissions quality.dispatch.* and role grants.
-- Re-runnable.

-- ============================================================ 1. sources
ALTER TABLE tenant.quality_inspections DROP CONSTRAINT IF EXISTS quality_inspections_source_type_check;
ALTER TABLE tenant.quality_inspections ADD CONSTRAINT quality_inspections_source_type_check
  CHECK (source_type IN ('procurement_receipt', 'stock_batch', 'stock_serial', 'manufacturing_work_order', 'manufacturing_posting', 'sales_return', 'pos_return', 'manual',
    'production_entry', 'sales_delivery'));
ALTER TABLE tenant.quality_inspection_obligations DROP CONSTRAINT IF EXISTS quality_inspection_obligations_source_type_check;
ALTER TABLE tenant.quality_inspection_obligations ADD CONSTRAINT quality_inspection_obligations_source_type_check
  CHECK (source_type IN ('goods_receipt', 'manual', 'production_entry', 'production_run', 'sales_delivery_line'));
ALTER TABLE tenant.inventory_stock_holds DROP CONSTRAINT IF EXISTS inventory_stock_holds_source_document_type_check;
ALTER TABLE tenant.inventory_stock_holds ADD CONSTRAINT inventory_stock_holds_source_document_type_check
  CHECK (source_document_type IN ('manual', 'goods_receipt', 'sales_return', 'existing_stock', 'quality_disposition'));

-- ============================================================ 2. the delivery context
CREATE TABLE IF NOT EXISTS tenant.quality_dispatch_contexts (
  inspection_id uuid PRIMARY KEY REFERENCES tenant.quality_inspections(id),
  organization_id uuid NOT NULL,
  delivery_id uuid NOT NULL,
  sales_order_line_id uuid NOT NULL,
  sales_order_id uuid NOT NULL,
  delivery_number text NOT NULL,
  order_number text NOT NULL,
  customer_id uuid,
  customer_name text,
  warehouse_id uuid,
  line_quantity numeric(20,6) NOT NULL DEFAULT 0,
  checkpoint_type text NOT NULL CHECK (checkpoint_type IN ('PRE_DISPATCH', 'MANUAL', 'REINSPECTION')),
  source_event_key text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS quality_dispatch_contexts_delivery_idx ON tenant.quality_dispatch_contexts (organization_id, delivery_id);
CREATE INDEX IF NOT EXISTS quality_dispatch_contexts_line_idx ON tenant.quality_dispatch_contexts (organization_id, delivery_id, sales_order_line_id);
CREATE INDEX IF NOT EXISTS quality_dispatch_contexts_order_idx ON tenant.quality_dispatch_contexts (organization_id, sales_order_id);
CREATE UNIQUE INDEX IF NOT EXISTS quality_dispatch_contexts_event_uidx ON tenant.quality_dispatch_contexts (organization_id, source_event_key) WHERE source_event_key IS NOT NULL;

DO $$
BEGIN
  ALTER TABLE tenant.quality_dispatch_contexts ENABLE ROW LEVEL SECURITY;
  ALTER TABLE tenant.quality_dispatch_contexts FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'quality_dispatch_contexts' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.quality_dispatch_contexts USING (organization_id = tenant.current_organization_id())
      WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
-- The context is frozen; only the line quantity follows the delivery while nothing is decided on it.
GRANT SELECT, INSERT ON tenant.quality_dispatch_contexts TO vercent_app, vercent_worker;
GRANT UPDATE (line_quantity) ON tenant.quality_dispatch_contexts TO vercent_app, vercent_worker;

-- ============================================================ 3. the hold case a rejection opened
ALTER TABLE tenant.quality_dispositions ADD COLUMN IF NOT EXISTS stock_hold_id uuid;
GRANT UPDATE (stock_hold_id) ON tenant.quality_dispositions TO vercent_app, vercent_worker;

-- ============================================================ 4. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('quality.dispatch.view', 'View pre-dispatch inspections', 'Quality', 'See delivery inspections, their results and what they hold back from dispatch.'),
  ('quality.dispatch.create', 'Request pre-dispatch inspections', 'Quality', 'Request an inspection of a delivery line before it is dispatched.'),
  ('quality.dispatch.assign', 'Assign pre-dispatch inspections', 'Quality', 'Assign or reassign the inspector.'),
  ('quality.dispatch.start', 'Start pre-dispatch inspections', 'Quality', 'Begin an inspection and select its samples.'),
  ('quality.dispatch.record_result', 'Record pre-dispatch inspection results', 'Quality', 'Save measurements and observations.'),
  ('quality.dispatch.submit', 'Submit pre-dispatch inspections', 'Quality', 'Submit the results for evaluation and review.'),
  ('quality.dispatch.review', 'Review pre-dispatch inspections', 'Quality', 'Review submitted results.'),
  ('quality.dispatch.request_changes', 'Return pre-dispatch inspections', 'Quality', 'Send results back to the inspector.'),
  ('quality.dispatch.complete', 'Complete pre-dispatch inspections', 'Quality', 'Finalize the inspection evidence.'),
  ('quality.dispatch.reinspect', 'Request pre-dispatch reinspection', 'Quality', 'Request a retest of a defined quantity of a delivery line.'),
  ('quality.dispatch.correct', 'Correct pre-dispatch inspection results', 'Quality', 'Amend a recorded result with a reason (history kept).'),
  ('quality.dispatch.cancel', 'Cancel pre-dispatch inspections', 'Quality', 'Cancel an eligible inspection.'),
  ('quality.dispatch.export', 'Export pre-dispatch inspections', 'Quality', 'Download inspections and their reports.'),
  ('quality.dispatch.view_audit', 'View pre-dispatch inspection history', 'Quality', 'See every result, amendment, review and decision.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (
    SELECT slug, key FROM (VALUES ('quality_manager'), ('system_administrator'), ('organization_owner')) AS r(slug)
      CROSS JOIN (VALUES ('quality.dispatch.view'), ('quality.dispatch.create'), ('quality.dispatch.assign'), ('quality.dispatch.start'), ('quality.dispatch.record_result'),
        ('quality.dispatch.submit'), ('quality.dispatch.review'), ('quality.dispatch.request_changes'), ('quality.dispatch.complete'), ('quality.dispatch.reinspect'),
        ('quality.dispatch.correct'), ('quality.dispatch.cancel'), ('quality.dispatch.export'), ('quality.dispatch.view_audit')) AS k(key)
    UNION ALL
    SELECT * FROM (VALUES
      ('quality_supervisor', 'quality.dispatch.view'), ('quality_supervisor', 'quality.dispatch.create'), ('quality_supervisor', 'quality.dispatch.assign'),
      ('quality_supervisor', 'quality.dispatch.start'), ('quality_supervisor', 'quality.dispatch.record_result'), ('quality_supervisor', 'quality.dispatch.submit'),
      ('quality_supervisor', 'quality.dispatch.review'), ('quality_supervisor', 'quality.dispatch.request_changes'), ('quality_supervisor', 'quality.dispatch.complete'),
      ('quality_supervisor', 'quality.dispatch.reinspect'), ('quality_supervisor', 'quality.dispatch.correct'), ('quality_supervisor', 'quality.dispatch.export'),
      ('quality_supervisor', 'quality.dispatch.view_audit'),
      ('quality_inspector', 'quality.dispatch.view'), ('quality_inspector', 'quality.dispatch.start'), ('quality_inspector', 'quality.dispatch.record_result'),
      ('quality_inspector', 'quality.dispatch.submit'),
      ('sales_manager', 'quality.dispatch.view'), ('sales_manager', 'quality.dispatch.create'), ('sales_manager', 'quality.dispatch.export'),
      ('sales_head', 'quality.dispatch.view'), ('sales_head', 'quality.dispatch.export'), ('sales_operations', 'quality.dispatch.view'), ('sales_operations', 'quality.dispatch.create'),
      ('inventory_manager', 'quality.dispatch.view'), ('inventory_manager', 'quality.dispatch.create'), ('warehouse_operator', 'quality.dispatch.view'),
      ('warehouse_operator', 'quality.dispatch.create'),
      ('auditor', 'quality.dispatch.view'), ('auditor', 'quality.dispatch.export'), ('auditor', 'quality.dispatch.view_audit')
    ) AS pair(slug, key)
  ) AS grant_row ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0206_quality_dispatch_inspection.sql', 'quality-dispatch-inspection') ON CONFLICT DO NOTHING;
