-- Assets — Asset Maintenance. Requests (an issue reported, triaged), Work Orders (the authoritative record of maintenance execution: approval,
-- technician or vendor, diagnosis, checklist, completion, verification, return to service), preventive service plans with one occurrence per
-- due date, source-owned maintenance restrictions (so availability is recomputed from every restriction, and closing one Work Order never
-- clears another's or a Hold), and cost links to the authoritative Inventory, Procurement and Finance documents — never a second stock,
-- supplier or expense ledger. Additive:
--
--   1. requests        reported problems: type, priority, safety concern, condition, triage, duplicate link, Work Order.
--   2. work orders     the execution record and its states; internal, external or mixed; outcome; follow-up link.
--   3. checklist       per Work Order: mandatory or optional checks, pass / fail / not applicable.
--   4. verifications   the authorized check of a repair and the return-to-service decision (append-only).
--   5. restrictions    why an asset is not in normal use (a safety report, a Work Order): start, end, released by whom.
--   6. cost links      each authoritative source (goods issue, supplier bill, purchase order, capitalization adjustment) linked once.
--   7. plans           preventive service plans (every N days or months, or once) and their occurrences, one per due date.
--   8. events          an append-only history of requests, Work Orders and plans.
--   9. availability    effective availability also reads active maintenance restrictions.
--  10. carry-over      open Work Orders and active plans of the older maintenance list.
--  11. permissions     view, request, triage, create, assign, approve, schedule, execute, parts, cost, complete, verify, release, plans,
--                      cancel, reopen, export, audit.

-- ============================================================ 1. requests
CREATE TABLE IF NOT EXISTS tenant.asset_maintenance_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  request_number text NOT NULL,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  maintenance_type text NOT NULL DEFAULT 'CORRECTIVE' CHECK (maintenance_type IN ('CORRECTIVE', 'PREVENTIVE', 'INSPECTION', 'EMERGENCY')),
  priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  description text NOT NULL CHECK (length(btrim(description)) >= 5),
  symptoms text,
  safety_concern text NOT NULL DEFAULT 'UNKNOWN' CHECK (safety_concern IN ('YES', 'NO', 'UNKNOWN')),
  observed_condition text CHECK (observed_condition IS NULL OR observed_condition IN ('NEW', 'GOOD', 'FAIR', 'DAMAGED', 'UNSERVICEABLE')),
  location_id uuid,
  location_label text,
  custodian_label text,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'NEEDS_INFORMATION', 'ACCEPTED', 'REJECTED', 'CLOSED')),
  triage_note text,
  triaged_by uuid REFERENCES public.users(id),
  triaged_at timestamptz,
  duplicate_of_request_id uuid REFERENCES tenant.asset_maintenance_requests(id),
  work_order_id uuid,
  reported_by uuid REFERENCES public.users(id),
  reported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  idempotency_key text,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT asset_maintenance_requests_number_key UNIQUE (organization_id, request_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_maintenance_requests_key_idx ON tenant.asset_maintenance_requests (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS asset_maintenance_requests_asset_idx ON tenant.asset_maintenance_requests (asset_id, status);

-- ============================================================ 2. work orders
CREATE TABLE IF NOT EXISTS tenant.asset_maintenance_work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  work_order_number text NOT NULL,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  request_id uuid REFERENCES tenant.asset_maintenance_requests(id),
  plan_id uuid,
  occurrence_id uuid,
  follow_up_of_id uuid REFERENCES tenant.asset_maintenance_work_orders(id),
  maintenance_type text NOT NULL CHECK (maintenance_type IN ('CORRECTIVE', 'PREVENTIVE', 'INSPECTION', 'EMERGENCY')),
  priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  execution text NOT NULL DEFAULT 'INTERNAL' CHECK (execution IN ('INTERNAL', 'EXTERNAL', 'MIXED')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'IN_PROGRESS', 'WAITING_FOR_PARTS', 'WAITING_FOR_VENDOR', 'WORK_COMPLETED',
    'PENDING_VERIFICATION', 'CLOSED', 'CANCELLED', 'RECOVERY_REQUIRED')),
  title text NOT NULL,
  problem text,
  technician_user_id uuid REFERENCES public.users(id),
  supplier_id uuid,
  responsible_user_id uuid REFERENCES public.users(id),
  scheduled_start_at timestamptz,
  expected_completion_at timestamptz,
  actual_start_at timestamptz,
  work_completed_at timestamptz,
  closed_at timestamptz,
  estimate_amount numeric(18,2) CHECK (estimate_amount IS NULL OR estimate_amount >= 0),
  approval_required boolean NOT NULL DEFAULT false,
  approved_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  restrict_use boolean NOT NULL DEFAULT true,
  diagnosis text,
  root_cause text,
  work_performed text,
  remaining_issues text,
  recommendation text,
  intake_condition text CHECK (intake_condition IS NULL OR intake_condition IN ('NEW', 'GOOD', 'FAIR', 'DAMAGED', 'UNSERVICEABLE')),
  completion_condition text CHECK (completion_condition IS NULL OR completion_condition IN ('NEW', 'GOOD', 'FAIR', 'DAMAGED', 'UNSERVICEABLE')),
  outcome text CHECK (outcome IS NULL OR outcome IN ('REPAIRED', 'REPAIRED_WITH_LIMITATIONS', 'UNREPAIRABLE', 'REQUIRES_FURTHER_WORK', 'CANCELLED_NO_WORK', 'DUPLICATE_REQUEST')),
  warranty_status text,
  warranty_claim_reference text,
  warranty_claim_status text CHECK (warranty_claim_status IS NULL OR warranty_claim_status IN ('PENDING', 'APPROVED', 'DENIED')),
  transfer_id uuid,
  cancel_reason text,
  reopened_count integer NOT NULL DEFAULT 0,
  idempotency_key text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version integer NOT NULL DEFAULT 1,
  legacy_order_id uuid,
  CONSTRAINT asset_maintenance_work_orders_number_key UNIQUE (organization_id, work_order_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_maintenance_work_orders_key_idx ON tenant.asset_maintenance_work_orders (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
-- One preventive occurrence produces one Work Order, and one request at most one live Work Order.
CREATE UNIQUE INDEX IF NOT EXISTS asset_maintenance_work_orders_occurrence_idx ON tenant.asset_maintenance_work_orders (occurrence_id) WHERE occurrence_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS asset_maintenance_work_orders_request_idx ON tenant.asset_maintenance_work_orders (request_id) WHERE request_id IS NOT NULL AND status <> 'CANCELLED';
CREATE INDEX IF NOT EXISTS asset_maintenance_work_orders_asset_idx ON tenant.asset_maintenance_work_orders (asset_id, status);

-- ============================================================ 3. checklist
CREATE TABLE IF NOT EXISTS tenant.asset_maintenance_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  work_order_id uuid NOT NULL REFERENCES tenant.asset_maintenance_work_orders(id),
  line_number integer NOT NULL,
  item_text text NOT NULL,
  mandatory boolean NOT NULL DEFAULT true,
  result text CHECK (result IS NULL OR result IN ('PASS', 'FAIL', 'NOT_APPLICABLE')),
  notes text,
  completed_by uuid REFERENCES public.users(id),
  completed_at timestamptz,
  CONSTRAINT asset_maintenance_checklist_items_key UNIQUE (work_order_id, line_number)
);

-- ============================================================ 4. verifications
CREATE TABLE IF NOT EXISTS tenant.asset_maintenance_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  work_order_id uuid NOT NULL REFERENCES tenant.asset_maintenance_work_orders(id),
  verifier_user_id uuid REFERENCES public.users(id),
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  identity_confirmed boolean NOT NULL,
  final_condition text NOT NULL CHECK (final_condition IN ('NEW', 'GOOD', 'FAIR', 'DAMAGED', 'UNSERVICEABLE')),
  tests_passed boolean NOT NULL,
  test_results text,
  decision text NOT NULL CHECK (decision IN ('RETURN_TO_SERVICE', 'RETURN_WITH_LIMITATIONS', 'KEEP_RESTRICTED', 'NOT_REPAIRABLE')),
  evidence text,
  notes text
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_maintenance_verifications_append_only') THEN
    CREATE TRIGGER asset_maintenance_verifications_append_only BEFORE UPDATE OR DELETE ON tenant.asset_maintenance_verifications FOR EACH ROW EXECUTE FUNCTION tenant.assets_history_append_only();
  END IF;
END $$;

-- ============================================================ 5. restrictions
CREATE TABLE IF NOT EXISTS tenant.asset_maintenance_restrictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  source_type text NOT NULL CHECK (source_type IN ('SAFETY_REPORT', 'WORK_ORDER')),
  source_id uuid NOT NULL,
  restriction_type text NOT NULL CHECK (restriction_type IN ('SAFETY', 'UNDER_MAINTENANCE', 'LIMITATION')),
  reason text,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ended_at timestamptz,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RELEASED')),
  created_by uuid REFERENCES public.users(id),
  released_by uuid REFERENCES public.users(id),
  release_reason text,
  release_verification_id uuid REFERENCES tenant.asset_maintenance_verifications(id),
  CONSTRAINT asset_maintenance_restrictions_release_check CHECK ((status = 'ACTIVE') = (ended_at IS NULL)),
  CONSTRAINT asset_maintenance_restrictions_interval_check CHECK (ended_at IS NULL OR ended_at >= started_at)
);
-- A source owns at most one live restriction of each kind.
CREATE UNIQUE INDEX IF NOT EXISTS asset_maintenance_restrictions_live_idx ON tenant.asset_maintenance_restrictions (source_type, source_id, restriction_type) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS asset_maintenance_restrictions_asset_idx ON tenant.asset_maintenance_restrictions (asset_id, status);
-- A released restriction stays released; its source, kind and start are never rewritten.
CREATE OR REPLACE FUNCTION tenant.asset_maintenance_restrictions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A maintenance restriction is released, never deleted.' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status = 'RELEASED' THEN RAISE EXCEPTION 'A released restriction stays released.' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.asset_id <> OLD.asset_id OR NEW.source_id <> OLD.source_id OR NEW.source_type <> OLD.source_type OR NEW.restriction_type <> OLD.restriction_type OR NEW.started_at <> OLD.started_at THEN
    RAISE EXCEPTION 'A restriction keeps its asset, source, kind and start.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_maintenance_restrictions_guard') THEN
    CREATE TRIGGER asset_maintenance_restrictions_guard BEFORE UPDATE OR DELETE ON tenant.asset_maintenance_restrictions FOR EACH ROW EXECUTE FUNCTION tenant.asset_maintenance_restrictions_guard();
  END IF;
END $$;

-- ============================================================ 6. cost links
CREATE TABLE IF NOT EXISTS tenant.asset_maintenance_cost_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  work_order_id uuid NOT NULL REFERENCES tenant.asset_maintenance_work_orders(id),
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  source_type text NOT NULL CHECK (source_type IN ('GOODS_ISSUE', 'SUPPLIER_BILL', 'PURCHASE_ORDER', 'CAPITALIZATION_ADJUSTMENT')),
  source_id uuid NOT NULL,
  source_number text,
  cost_role text NOT NULL CHECK (cost_role IN ('PARTS', 'EXTERNAL_SERVICE', 'COMMITMENT', 'CAPITAL_IMPROVEMENT')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'UNLINKED')),
  linked_by uuid REFERENCES public.users(id),
  linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  unlinked_by uuid REFERENCES public.users(id),
  unlinked_at timestamptz,
  unlink_reason text,
  command_id text
);
-- One authoritative source is linked to one Work Order at a time: its cost is never counted twice.
CREATE UNIQUE INDEX IF NOT EXISTS asset_maintenance_cost_links_source_idx ON tenant.asset_maintenance_cost_links (organization_id, source_type, source_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS asset_maintenance_cost_links_work_order_idx ON tenant.asset_maintenance_cost_links (work_order_id);

-- ============================================================ 7. plans and occurrences
CREATE TABLE IF NOT EXISTS tenant.asset_maintenance_service_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  plan_number text NOT NULL,
  asset_id uuid NOT NULL REFERENCES tenant.assets(id),
  name text NOT NULL CHECK (length(btrim(name)) >= 2),
  maintenance_type text NOT NULL DEFAULT 'PREVENTIVE' CHECK (maintenance_type IN ('PREVENTIVE', 'INSPECTION')),
  frequency_type text NOT NULL CHECK (frequency_type IN ('DAYS', 'MONTHS', 'ONCE')),
  interval_value integer CHECK ((frequency_type = 'ONCE') OR (interval_value BETWEEN 1 AND 3650)),
  start_date date NOT NULL,
  next_due_date date,
  -- The next due date follows the previous scheduled date, or the previous actual completion.
  due_rule text NOT NULL DEFAULT 'SCHEDULED_DATE' CHECK (due_rule IN ('SCHEDULED_DATE', 'COMPLETION_DATE')),
  lead_days integer NOT NULL DEFAULT 7 CHECK (lead_days BETWEEN 0 AND 120),
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  technician_user_id uuid REFERENCES public.users(id),
  supplier_id uuid,
  estimated_minutes integer CHECK (estimated_minutes IS NULL OR estimated_minutes > 0),
  default_priority text NOT NULL DEFAULT 'NORMAL' CHECK (default_priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'INACTIVE')),
  last_completed_date date,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  legacy_plan_id uuid,
  CONSTRAINT asset_maintenance_service_plans_number_key UNIQUE (organization_id, plan_number)
);
CREATE TABLE IF NOT EXISTS tenant.asset_maintenance_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  plan_id uuid NOT NULL REFERENCES tenant.asset_maintenance_service_plans(id),
  due_date date NOT NULL,
  occurrence_index integer NOT NULL,
  status text NOT NULL DEFAULT 'GENERATED' CHECK (status IN ('GENERATED', 'COMPLETED', 'SKIPPED', 'CANCELLED')),
  work_order_id uuid REFERENCES tenant.asset_maintenance_work_orders(id),
  generated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  -- One due service is one occurrence: a retried scheduler finds it instead of creating another.
  CONSTRAINT asset_maintenance_occurrences_key UNIQUE (plan_id, due_date)
);

-- ============================================================ 8. events
CREATE TABLE IF NOT EXISTS tenant.asset_maintenance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  asset_id uuid REFERENCES tenant.assets(id),
  request_id uuid REFERENCES tenant.asset_maintenance_requests(id),
  work_order_id uuid REFERENCES tenant.asset_maintenance_work_orders(id),
  plan_id uuid REFERENCES tenant.asset_maintenance_service_plans(id),
  action text NOT NULL,
  from_status text,
  to_status text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  actor_user_id uuid REFERENCES public.users(id),
  command_id text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS asset_maintenance_events_work_order_idx ON tenant.asset_maintenance_events (work_order_id, occurred_at);
CREATE INDEX IF NOT EXISTS asset_maintenance_events_asset_idx ON tenant.asset_maintenance_events (asset_id, occurred_at);
CREATE UNIQUE INDEX IF NOT EXISTS asset_maintenance_events_command_idx ON tenant.asset_maintenance_events (organization_id, command_id) WHERE command_id IS NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'asset_maintenance_events_append_only') THEN
    CREATE TRIGGER asset_maintenance_events_append_only BEFORE UPDATE OR DELETE ON tenant.asset_maintenance_events FOR EACH ROW EXECUTE FUNCTION tenant.assets_history_append_only();
  END IF;
END $$;

-- ============================================================ 9. effective availability
-- Recomputed from every authoritative restriction: an active maintenance or safety restriction makes the asset under maintenance; a
-- limitation alone does not take it out of use. Releasing one restriction never overrides another, a transfer or a hold.
CREATE OR REPLACE FUNCTION tenant.asset_effective_availability(a tenant.assets) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN a.lifecycle_status <> 'ACTIVE' THEN 'NOT_AVAILABLE'
    WHEN a.availability_status = 'MAINTENANCE'
      OR EXISTS (SELECT 1 FROM tenant.asset_maintenance_orders m WHERE m.asset_id = a.id AND m.status = 'in_progress' AND m.took_asset_out_of_service IS NOT FALSE)
      OR EXISTS (SELECT 1 FROM tenant.asset_maintenance_restrictions r WHERE r.asset_id = a.id AND r.status = 'ACTIVE' AND r.restriction_type IN ('SAFETY', 'UNDER_MAINTENANCE')) THEN 'UNDER_MAINTENANCE'
    WHEN EXISTS (SELECT 1 FROM tenant.asset_transfer_lines t WHERE t.asset_id = a.id AND t.line_status IN ('DISPATCHED', 'RECEIPT_EXCEPTION', 'RETURN_IN_PROGRESS')) THEN 'IN_TRANSFER'
    WHEN a.current_user_id IS NOT NULL OR a.current_department_id IS NOT NULL OR a.availability_status = 'ASSIGNED' THEN 'ASSIGNED'
    WHEN a.availability_status = 'RESTRICTED' OR a.condition = 'UNSERVICEABLE' THEN 'NOT_AVAILABLE'
    ELSE 'AVAILABLE' END
$$;

-- ============================================================ settings
-- Work above this estimate, or done by an outside vendor, needs approval before it starts.
ALTER TABLE tenant.asset_settings
  ADD COLUMN IF NOT EXISTS maintenance_approval_threshold numeric(18,2) NOT NULL DEFAULT 10000 CHECK (maintenance_approval_threshold >= 0),
  ADD COLUMN IF NOT EXISTS maintenance_restrict_on_safety boolean NOT NULL DEFAULT true;

-- ============================================================ isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['asset_maintenance_requests', 'asset_maintenance_work_orders', 'asset_maintenance_checklist_items', 'asset_maintenance_verifications', 'asset_maintenance_restrictions',
    'asset_maintenance_cost_links', 'asset_maintenance_service_plans', 'asset_maintenance_occurrences', 'asset_maintenance_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.asset_maintenance_requests, tenant.asset_maintenance_work_orders, tenant.asset_maintenance_checklist_items, tenant.asset_maintenance_restrictions,
  tenant.asset_maintenance_cost_links, tenant.asset_maintenance_service_plans, tenant.asset_maintenance_occurrences TO vercent_app, vercent_worker;
GRANT SELECT, INSERT ON tenant.asset_maintenance_verifications, tenant.asset_maintenance_events TO vercent_app, vercent_worker;

-- ============================================================ 10. carry-over of the older maintenance list
-- An open older Work Order continues as a new one (its out-of-service flag becomes a restriction); the older row is closed with a pointer.
-- An active older plan continues as a service plan. Re-running moves nothing twice.
DO $$
DECLARE
  o record;
  wo uuid;
  n integer;
BEGIN
  FOR o IN SELECT m.* FROM tenant.asset_maintenance_orders m WHERE m.status IN ('planned', 'scheduled', 'in_progress', 'on_hold')
      AND NOT EXISTS (SELECT 1 FROM tenant.asset_maintenance_work_orders w WHERE w.legacy_order_id = m.id) LOOP
    n := (SELECT count(*) + 1 FROM tenant.asset_maintenance_work_orders w WHERE w.organization_id = o.organization_id);
    INSERT INTO tenant.asset_maintenance_work_orders (organization_id, work_order_number, asset_id, maintenance_type, priority, status, title, problem, technician_user_id, supplier_id,
        scheduled_start_at, expected_completion_at, actual_start_at, restrict_use, diagnosis, created_by, created_at, legacy_order_id)
      VALUES (o.organization_id, 'AMW-C' || lpad(n::text, 5, '0'), o.asset_id,
        CASE WHEN o.maintenance_type = 'breakdown' THEN 'EMERGENCY' WHEN o.maintenance_type IN ('inspection', 'calibration', 'statutory') THEN 'INSPECTION' WHEN o.maintenance_type IN ('preventive', 'predictive') THEN 'PREVENTIVE' ELSE 'CORRECTIVE' END,
        upper(COALESCE(o.priority, 'normal')), CASE o.status WHEN 'in_progress' THEN 'IN_PROGRESS' WHEN 'on_hold' THEN 'WAITING_FOR_PARTS' WHEN 'scheduled' THEN 'SCHEDULED' ELSE 'APPROVED' END,
        COALESCE(left(o.problem_description, 200), 'Carried over: ' || o.work_order_number), o.problem_description, o.internal_owner_user_id, o.supplier_id, o.scheduled_start_at, o.scheduled_end_at,
        o.actual_start_at, COALESCE(o.took_asset_out_of_service, false), o.findings, o.created_by, o.created_at, o.id)
      RETURNING id INTO wo;
    IF o.took_asset_out_of_service THEN
      INSERT INTO tenant.asset_maintenance_restrictions (organization_id, asset_id, source_type, source_id, restriction_type, reason, started_at, created_by)
        VALUES (o.organization_id, o.asset_id, 'WORK_ORDER', wo, 'UNDER_MAINTENANCE', 'Carried over from ' || o.work_order_number, COALESCE(o.actual_start_at, o.created_at), o.created_by);
    END IF;
    INSERT INTO tenant.asset_maintenance_events (organization_id, asset_id, work_order_id, action, details) VALUES (o.organization_id, o.asset_id, wo, 'CARRIED_OVER', jsonb_build_object('legacyOrder', o.work_order_number));
    UPDATE tenant.asset_maintenance_orders SET status = 'cancelled', cancelled_reason = 'Carried over to the new maintenance workflow', took_asset_out_of_service = false WHERE id = o.id;
  END LOOP;
  INSERT INTO tenant.asset_maintenance_service_plans (organization_id, plan_number, asset_id, name, maintenance_type, frequency_type, interval_value, start_date, next_due_date, lead_days, supplier_id,
      estimated_minutes, last_completed_date, created_by, created_at, legacy_plan_id)
  SELECT p.organization_id, 'AMP-C' || lpad(row_number() OVER (PARTITION BY p.organization_id ORDER BY p.created_at)::text, 5, '0'), p.asset_id, p.name,
    CASE WHEN p.maintenance_type IN ('inspection', 'calibration', 'statutory') THEN 'INSPECTION' ELSE 'PREVENTIVE' END,
    CASE p.frequency_unit WHEN 'days' THEN 'DAYS' WHEN 'weeks' THEN 'DAYS' ELSE 'MONTHS' END,
    CASE p.frequency_unit WHEN 'weeks' THEN p.frequency_value * 7 WHEN 'years' THEN p.frequency_value * 12 ELSE p.frequency_value END,
    COALESCE(p.next_due_date, current_date), COALESCE(p.next_due_date, current_date), COALESCE(p.lead_days, 7), p.supplier_id,
    CASE WHEN p.estimated_hours > 0 THEN (p.estimated_hours * 60)::integer END, p.last_completed_date, p.created_by, p.created_at, p.id
  FROM tenant.asset_maintenance_plans p
  WHERE p.active AND p.asset_id IS NOT NULL AND p.frequency_unit IN ('days', 'weeks', 'months', 'years') AND p.frequency_value > 0
    AND NOT EXISTS (SELECT 1 FROM tenant.asset_maintenance_service_plans s WHERE s.legacy_plan_id = p.id);
  UPDATE tenant.asset_maintenance_plans p SET active = false WHERE p.active AND EXISTS (SELECT 1 FROM tenant.asset_maintenance_service_plans s WHERE s.legacy_plan_id = p.id);
END $$;

-- ============================================================ 11. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('assets.maintenance.view', 'View asset maintenance', 'Assets', 'See the maintenance requests and Work Orders you are permitted to see.'),
  ('assets.maintenance.request', 'Report asset problems', 'Assets', 'Report a problem with an asset you hold or may report on.'),
  ('assets.maintenance.triage', 'Triage maintenance requests', 'Assets', 'Accept, reject, ask for information on or mark requests as duplicates.'),
  ('assets.maintenance.create_work_order', 'Create maintenance Work Orders', 'Assets', 'Open Work Orders from requests or directly.'),
  ('assets.maintenance.assign', 'Assign maintenance work', 'Assets', 'Assign a technician or a service vendor.'),
  ('assets.maintenance.approve', 'Approve maintenance work', 'Assets', 'Authorize work that needs approval.'),
  ('assets.maintenance.schedule', 'Schedule maintenance work', 'Assets', 'Plan when work is done.'),
  ('assets.maintenance.execute', 'Carry out maintenance work', 'Assets', 'Start work and record diagnosis, work and checklist results.'),
  ('assets.maintenance.record_parts', 'Link maintenance parts', 'Assets', 'Link Inventory goods issues to Work Orders.'),
  ('assets.maintenance.view_cost', 'View maintenance costs', 'Assets', 'See estimates, linked costs and cost reports.'),
  ('assets.maintenance.complete', 'Complete maintenance work', 'Assets', 'Record that the technician''s work is finished.'),
  ('assets.maintenance.verify', 'Verify maintenance work', 'Assets', 'Check a repair and record the verification.'),
  ('assets.maintenance.release', 'Return assets to service', 'Assets', 'Authorize the return to service after verification.'),
  ('assets.maintenance.manage_plans', 'Manage preventive plans', 'Assets', 'Create and change preventive service plans.'),
  ('assets.maintenance.cancel', 'Cancel maintenance work', 'Assets', 'Cancel requests and Work Orders with a reason.'),
  ('assets.maintenance.reopen', 'Reopen maintenance work', 'Assets', 'Reopen a closed Work Order for a controlled correction.'),
  ('assets.maintenance.export', 'Export maintenance', 'Assets', 'Download maintenance records and reports.'),
  ('assets.maintenance.view_audit', 'View maintenance history', 'Assets', 'See every maintenance event.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('asset_manager', 'assets.maintenance.view'), ('asset_manager', 'assets.maintenance.request'), ('asset_manager', 'assets.maintenance.triage'), ('asset_manager', 'assets.maintenance.create_work_order'),
    ('asset_manager', 'assets.maintenance.assign'), ('asset_manager', 'assets.maintenance.approve'), ('asset_manager', 'assets.maintenance.schedule'), ('asset_manager', 'assets.maintenance.execute'),
    ('asset_manager', 'assets.maintenance.record_parts'), ('asset_manager', 'assets.maintenance.view_cost'), ('asset_manager', 'assets.maintenance.complete'), ('asset_manager', 'assets.maintenance.verify'),
    ('asset_manager', 'assets.maintenance.release'), ('asset_manager', 'assets.maintenance.manage_plans'), ('asset_manager', 'assets.maintenance.cancel'), ('asset_manager', 'assets.maintenance.reopen'),
    ('asset_manager', 'assets.maintenance.export'), ('asset_manager', 'assets.maintenance.view_audit'),
    ('employee', 'assets.maintenance.view'), ('employee', 'assets.maintenance.request'),
    ('inventory_manager', 'assets.maintenance.view'), ('inventory_manager', 'assets.maintenance.record_parts'),
    ('finance_manager', 'assets.maintenance.view'), ('finance_manager', 'assets.maintenance.view_cost'), ('finance_manager', 'assets.maintenance.export'),
    ('auditor', 'assets.maintenance.view'), ('auditor', 'assets.maintenance.view_cost'), ('auditor', 'assets.maintenance.export'), ('auditor', 'assets.maintenance.view_audit')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0158_assets_maintenance.sql', 'assets-maintenance') ON CONFLICT DO NOTHING;
