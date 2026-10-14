-- Manufacturing from Sales demand: confirmed customer demand for manufactured products, what already covers it, and which manufacturing
-- orders are assigned to it. Sales stays the authority on what was ordered, cancelled and delivered; Inventory on reservations and stock;
-- Manufacturing Orders on production. These tables record the planning link between them.
--
--   item policies   per product: make to order or make to stock, the production lead time, a minimum batch and increment, default warehouses.
--   demands         one per confirmed Sales Order line of a manufactured product (re-bound to the same line, by sequence and product, when an
--                   order is reopened and confirmed again): the quantities Sales and Inventory report, kept as a refreshable projection, and
--                   the derived planning status.
--   allocations     manufacturing-order supply assigned to a demand: proposed while the order is a draft, committed once released; the
--                   received, reserved and delivered parts are projections from Inventory and Sales. Many to many: an order may cover several
--                   lines of the same product, a line several orders.
--   events          the append-only history of every evaluation change, allocation, receipt attribution, reservation and release.

-- ============================================================ 1. item manufacturing policy
CREATE TABLE IF NOT EXISTS tenant.manufacturing_item_policies (
  organization_id uuid NOT NULL,
  item_id uuid NOT NULL REFERENCES tenant.items(id),
  supply_policy text NOT NULL DEFAULT 'MAKE_TO_ORDER' CHECK (supply_policy IN ('MAKE_TO_ORDER', 'MAKE_TO_STOCK')),
  lead_time_days integer CHECK (lead_time_days IS NULL OR (lead_time_days >= 0 AND lead_time_days <= 365)),
  minimum_batch_quantity numeric(20, 6) CHECK (minimum_batch_quantity IS NULL OR minimum_batch_quantity > 0),
  quantity_increment numeric(20, 6) CHECK (quantity_increment IS NULL OR quantity_increment > 0),
  default_material_warehouse_id uuid REFERENCES tenant.warehouses(id),
  default_manufacturing_warehouse_id uuid REFERENCES tenant.warehouses(id),
  updated_by uuid REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, item_id)
);

-- ============================================================ 2. demands
CREATE TABLE IF NOT EXISTS tenant.manufacturing_sales_demands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  sales_order_id uuid NOT NULL REFERENCES tenant.sales_orders(id),
  sales_order_line_id uuid NOT NULL REFERENCES tenant.sales_order_lines(id),
  line_sequence integer NOT NULL,
  item_id uuid NOT NULL REFERENCES tenant.items(id),
  fulfillment_warehouse_id uuid REFERENCES tenant.warehouses(id),
  required_date date,
  source_version_number integer NOT NULL,
  -- Base-unit projections of what Sales and Inventory report (refreshed on every evaluation; never typed in).
  ordered_quantity numeric(20, 6) NOT NULL DEFAULT 0,
  cancelled_quantity numeric(20, 6) NOT NULL DEFAULT 0,
  delivered_quantity numeric(20, 6) NOT NULL DEFAULT 0,
  reserved_quantity numeric(20, 6) NOT NULL DEFAULT 0,
  outstanding_quantity numeric(20, 6) NOT NULL DEFAULT 0,
  planning_status text NOT NULL DEFAULT 'NEEDS_REVIEW' CHECK (planning_status IN ('NEEDS_REVIEW', 'PARTIALLY_COVERED', 'COVERED', 'IN_PRODUCTION', 'READY_FOR_FULFILLMENT', 'FULFILLED', 'ON_HOLD', 'CANCELLED')),
  exception text,
  planner_user_id uuid REFERENCES public.users(id),
  last_evaluated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_sales_demands_line_uidx ON tenant.manufacturing_sales_demands (organization_id, sales_order_line_id);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_sales_demands_slot_uidx ON tenant.manufacturing_sales_demands (organization_id, sales_order_id, line_sequence) WHERE planning_status <> 'CANCELLED';
CREATE INDEX IF NOT EXISTS manufacturing_sales_demands_status_idx ON tenant.manufacturing_sales_demands (organization_id, planning_status, required_date);
CREATE INDEX IF NOT EXISTS manufacturing_sales_demands_item_idx ON tenant.manufacturing_sales_demands (organization_id, item_id);

-- ============================================================ 3. allocations
CREATE TABLE IF NOT EXISTS tenant.manufacturing_demand_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  demand_id uuid NOT NULL REFERENCES tenant.manufacturing_sales_demands(id),
  manufacturing_order_id uuid NOT NULL REFERENCES tenant.manufacturing_orders(id),
  allocated_quantity numeric(20, 6) NOT NULL CHECK (allocated_quantity > 0),
  -- Projections: output received and attributed to this demand, reserved for it in Inventory, delivered by Sales.
  received_quantity numeric(20, 6) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  reserved_quantity numeric(20, 6) NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  fulfilled_quantity numeric(20, 6) NOT NULL DEFAULT 0 CHECK (fulfilled_quantity >= 0),
  status text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'COMMITTED', 'PARTIALLY_RECEIVED', 'AVAILABLE_FOR_FULFILLMENT', 'FULFILLED', 'RELEASED', 'EXCEPTION')),
  exception text,
  release_reason text,
  released_by uuid REFERENCES public.users(id),
  released_at timestamptz,
  idempotency_key text,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (received_quantity <= allocated_quantity),
  CHECK (status <> 'RELEASED' OR release_reason IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_demand_allocations_live_uidx ON tenant.manufacturing_demand_allocations (demand_id, manufacturing_order_id) WHERE status <> 'RELEASED';
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_demand_allocations_key_uidx ON tenant.manufacturing_demand_allocations (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS manufacturing_demand_allocations_order_idx ON tenant.manufacturing_demand_allocations (organization_id, manufacturing_order_id);

-- An allocation keeps its demand and order; a released one never changes again; nothing is deleted.
CREATE OR REPLACE FUNCTION tenant.manufacturing_demand_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A demand allocation is released, never deleted.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.demand_id <> OLD.demand_id OR NEW.manufacturing_order_id <> OLD.manufacturing_order_id OR NEW.organization_id <> OLD.organization_id THEN
    RAISE EXCEPTION 'A demand allocation keeps its demand and manufacturing order; release it and allocate again.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'RELEASED' THEN
    RAISE EXCEPTION 'A released demand allocation does not change.' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_demand_allocations_guard' AND tgrelid = 'tenant.manufacturing_demand_allocations'::regclass) THEN
    CREATE TRIGGER manufacturing_demand_allocations_guard BEFORE UPDATE OR DELETE ON tenant.manufacturing_demand_allocations FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_demand_allocation_guard();
  END IF;
END $$;

-- An order's live allocations never exceed what it plans to make (checked under a lock on the order, so two allocations cannot both pass).
CREATE OR REPLACE FUNCTION tenant.manufacturing_demand_capacity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  capacity numeric;
  used numeric;
BEGIN
  IF NEW.status = 'RELEASED' THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('manufacturing_order_supply:' || NEW.manufacturing_order_id::text, 0));
  SELECT planned_base_quantity INTO capacity FROM tenant.manufacturing_orders WHERE id = NEW.manufacturing_order_id;
  SELECT COALESCE(sum(allocated_quantity), 0) INTO used FROM tenant.manufacturing_demand_allocations
   WHERE manufacturing_order_id = NEW.manufacturing_order_id AND status <> 'RELEASED' AND id <> NEW.id;
  IF used + NEW.allocated_quantity > capacity THEN
    RAISE EXCEPTION 'The manufacturing order''s output is already assigned to customer demand.' USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_demand_allocations_capacity' AND tgrelid = 'tenant.manufacturing_demand_allocations'::regclass) THEN
    CREATE TRIGGER manufacturing_demand_allocations_capacity BEFORE INSERT OR UPDATE OF allocated_quantity, status ON tenant.manufacturing_demand_allocations
      FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_demand_capacity_guard();
  END IF;
END $$;

-- ============================================================ 4. events
CREATE TABLE IF NOT EXISTS tenant.manufacturing_demand_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  demand_id uuid NOT NULL REFERENCES tenant.manufacturing_sales_demands(id),
  allocation_id uuid REFERENCES tenant.manufacturing_demand_allocations(id),
  manufacturing_order_id uuid REFERENCES tenant.manufacturing_orders(id),
  action text NOT NULL,
  quantity numeric(20, 6),
  source_type text,
  source_id uuid,
  summary text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS manufacturing_demand_events_demand_idx ON tenant.manufacturing_demand_events (organization_id, demand_id, occurred_at);
-- A finished-goods receipt is attributed to an allocation once.
CREATE UNIQUE INDEX IF NOT EXISTS manufacturing_demand_events_receipt_uidx ON tenant.manufacturing_demand_events (allocation_id, source_id) WHERE action = 'OUTPUT_RECEIVED';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturing_demand_events_append_only' AND tgrelid = 'tenant.manufacturing_demand_events'::regclass) THEN
    CREATE TRIGGER manufacturing_demand_events_append_only BEFORE UPDATE OR DELETE ON tenant.manufacturing_demand_events FOR EACH ROW EXECUTE FUNCTION tenant.manufacturing_bom_append_only();
  END IF;
END $$;

-- ============================================================ 5. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('manufacturing.demand.view', 'View manufacturing demand', 'Manufacturing', 'See confirmed customer demand for manufactured products and its coverage.'),
  ('manufacturing.demand.plan', 'Plan manufacturing demand', 'Manufacturing', 'Review demand coverage and production recommendations.'),
  ('manufacturing.demand.create_mo', 'Create orders from demand', 'Manufacturing', 'Create a draft manufacturing order from customer demand.'),
  ('manufacturing.demand.allocate', 'Allocate supply to demand', 'Manufacturing', 'Assign manufacturing-order output to customer demand.'),
  ('manufacturing.demand.reallocate', 'Reassign supply', 'Manufacturing', 'Move assigned output from one customer demand to another.'),
  ('manufacturing.demand.release_allocation', 'Release allocations', 'Manufacturing', 'Give back output assigned to customer demand.'),
  ('manufacturing.demand.approve_exception', 'Approve demand exceptions', 'Manufacturing', 'Approve a deviation: a late plan, an overcommitment, a cancelled demand with production.'),
  ('manufacturing.demand.view_cost', 'View demand cost impact', 'Manufacturing', 'See the material cost of demand plans.'),
  ('manufacturing.demand.export', 'Export demand plans', 'Manufacturing', 'Export manufacturing demand reports.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('manufacturing_manager', 'manufacturing.demand.view'), ('manufacturing_manager', 'manufacturing.demand.plan'), ('manufacturing_manager', 'manufacturing.demand.create_mo'),
    ('manufacturing_manager', 'manufacturing.demand.allocate'), ('manufacturing_manager', 'manufacturing.demand.reallocate'), ('manufacturing_manager', 'manufacturing.demand.release_allocation'),
    ('manufacturing_manager', 'manufacturing.demand.approve_exception'), ('manufacturing_manager', 'manufacturing.demand.view_cost'), ('manufacturing_manager', 'manufacturing.demand.export'),
    ('production_planner', 'manufacturing.demand.view'), ('production_planner', 'manufacturing.demand.plan'), ('production_planner', 'manufacturing.demand.create_mo'),
    ('production_planner', 'manufacturing.demand.allocate'), ('production_planner', 'manufacturing.demand.release_allocation'), ('production_planner', 'manufacturing.demand.view_cost'),
    ('production_planner', 'manufacturing.demand.export'),
    ('inventory_manager', 'manufacturing.demand.view'), ('sales_manager', 'manufacturing.demand.view')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

-- ============================================================ 6. isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['manufacturing_item_policies', 'manufacturing_sales_demands', 'manufacturing_demand_allocations', 'manufacturing_demand_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.manufacturing_item_policies, tenant.manufacturing_sales_demands, tenant.manufacturing_demand_allocations TO vercent_app;
GRANT SELECT, INSERT ON tenant.manufacturing_demand_events TO vercent_app;
GRANT SELECT ON tenant.manufacturing_item_policies, tenant.manufacturing_sales_demands, tenant.manufacturing_demand_allocations, tenant.manufacturing_demand_events TO vercent_worker;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0113_manufacturing_sales_demand.sql', 'manufacturing-sales-demand') ON CONFLICT DO NOTHING;
