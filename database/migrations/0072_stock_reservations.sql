-- Stock Reservations: the allocation engine behind Reserved Stock. A reservation is a demand — one source document line (a sales order line, a
-- transfer line, a purchase return line, a work order) wanting an item — and its allocations are the physical stock protected for it: a
-- warehouse, optionally a location, a batch or a serial number (the stock_reservations rows, each numbered RSV-…). Reserved Stock is the sum
-- of the active allocations and stays a projection of them.
--
-- This migration adds the reservation (tenant.inventory_reservations) above the allocations: what the source asked for (requested), and what
-- its allocations reserved, consumed, released and still hold, with a status derived from them — kept by a trigger on every allocation change,
-- so no code path can let them disagree. Existing allocations are attached to reservations by their source document and line. Reservations
-- touch neither the Stock Ledger, valuation nor accounting.

-- ============================================================ 1. reservations (the demand)
CREATE TABLE IF NOT EXISTS tenant.inventory_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  item_id uuid NOT NULL REFERENCES tenant.items(id),
  base_uom_id uuid,
  reference_type text NOT NULL CHECK (reference_type IN ('sales_order_line', 'sales_order', 'stock_transfer', 'purchase_return', 'manufacturing_work_order')),
  source_document_type text NOT NULL CHECK (source_document_type IN ('sales_order', 'inventory_transfer', 'purchase_return', 'manufacturing_work_order')),
  source_document_id uuid NOT NULL,
  source_line_id uuid,
  requested_base_quantity numeric(20, 6) NOT NULL DEFAULT 0 CHECK (requested_base_quantity >= 0),
  reserved_base_quantity numeric(20, 6) NOT NULL DEFAULT 0,
  consumed_base_quantity numeric(20, 6) NOT NULL DEFAULT 0,
  released_base_quantity numeric(20, 6) NOT NULL DEFAULT 0,
  active_base_quantity numeric(20, 6) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'consumed', 'released', 'cancelled', 'expired')),
  expires_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);
-- One reservation per source line and item (a document without lines: per document and item).
CREATE UNIQUE INDEX IF NOT EXISTS inventory_reservations_source_uidx ON tenant.inventory_reservations
  (organization_id, reference_type, source_document_id, COALESCE(source_line_id, '00000000-0000-0000-0000-000000000000'::uuid), item_id);
CREATE INDEX IF NOT EXISTS inventory_reservations_item_idx ON tenant.inventory_reservations (organization_id, item_id, status);
CREATE INDEX IF NOT EXISTS inventory_reservations_document_idx ON tenant.inventory_reservations (organization_id, source_document_type, source_document_id);

-- Every allocation belongs to its reservation.
ALTER TABLE tenant.stock_reservations ADD COLUMN IF NOT EXISTS inventory_reservation_id uuid REFERENCES tenant.inventory_reservations(id);
CREATE INDEX IF NOT EXISTS stock_reservations_parent_idx ON tenant.stock_reservations (organization_id, inventory_reservation_id);

-- ============================================================ 2. the reservation follows its allocations
-- Reserved, consumed, released and active are the sums of its allocations; the status is active while anything is held, otherwise cancelled
-- (every allocation cancelled with its source), expired (released because it expired), consumed (anything fulfilled) or released.
CREATE OR REPLACE FUNCTION tenant.refresh_inventory_reservation(reservation uuid) RETURNS void LANGUAGE sql AS $$
  UPDATE tenant.inventory_reservations parent SET
    reserved_base_quantity = totals.reserved, consumed_base_quantity = totals.consumed, released_base_quantity = totals.released, active_base_quantity = totals.active,
    status = CASE WHEN totals.active > 0 THEN 'active' WHEN totals.all_cancelled THEN 'cancelled' WHEN totals.consumed > 0 THEN 'consumed'
                  WHEN totals.all_expired THEN 'expired' ELSE 'released' END,
    updated_at = now(), version = parent.version + 1
  FROM (SELECT COALESCE(sum(quantity), 0) AS reserved, COALESCE(sum(consumed_quantity), 0) AS consumed, COALESCE(sum(released_quantity), 0) AS released,
               COALESCE(sum(active_quantity), 0) AS active, COALESCE(bool_and(status = 'cancelled'), false) AS all_cancelled,
               COALESCE(bool_and(status <> 'active' AND release_reason_code = 'expired'), false) AS all_expired
          FROM tenant.stock_reservations WHERE inventory_reservation_id = reservation) AS totals
  WHERE parent.id = reservation;
$$;
CREATE OR REPLACE FUNCTION tenant.stock_reservation_parent_sync() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.inventory_reservation_id IS NOT NULL THEN PERFORM tenant.refresh_inventory_reservation(NEW.inventory_reservation_id); END IF;
  IF TG_OP = 'UPDATE' AND OLD.inventory_reservation_id IS NOT NULL AND OLD.inventory_reservation_id IS DISTINCT FROM NEW.inventory_reservation_id THEN
    PERFORM tenant.refresh_inventory_reservation(OLD.inventory_reservation_id);
  END IF;
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'stock_reservations_parent_sync') THEN
    CREATE TRIGGER stock_reservations_parent_sync AFTER INSERT OR UPDATE ON tenant.stock_reservations FOR EACH ROW EXECUTE FUNCTION tenant.stock_reservation_parent_sync();
  END IF;
END $$;

-- ============================================================ 3. the allocations already here, attached to their reservations
-- Sales order lines: the order and the line; a transfer: the line named in its reservation key (itr:<transfer>:reserve:<line>:<part>);
-- documents without lines (a make-to-order sales order, a purchase return, a work order): the document.
WITH sources AS (
  SELECT allocation.id, allocation.organization_id, allocation.item_id, allocation.reference_type,
         CASE allocation.reference_type WHEN 'sales_order_line' THEN 'sales_order' WHEN 'sales_order' THEN 'sales_order' WHEN 'stock_transfer' THEN 'inventory_transfer'
              ELSE allocation.reference_type END AS document_type,
         CASE WHEN allocation.reference_type = 'sales_order_line' THEN COALESCE(allocation.sales_order_id, allocation.reference_id) ELSE allocation.reference_id END AS document_id,
         CASE WHEN allocation.reference_type = 'sales_order_line' THEN allocation.reference_id
              WHEN allocation.reference_type = 'stock_transfer' AND allocation.idempotency_key ~ ':reserve:[0-9a-f-]{36}:' THEN substring(allocation.idempotency_key FROM ':reserve:([0-9a-f-]{36}):')::uuid
              END AS line_id,
         allocation.quantity, allocation.reserved_by, allocation.created_at
    FROM tenant.stock_reservations allocation WHERE allocation.inventory_reservation_id IS NULL
)
INSERT INTO tenant.inventory_reservations (organization_id, item_id, base_uom_id, reference_type, source_document_type, source_document_id, source_line_id, requested_base_quantity,
  created_by, created_at)
SELECT sources.organization_id, sources.item_id, (SELECT uom_id FROM tenant.items WHERE id = sources.item_id), sources.reference_type, sources.document_type, sources.document_id,
       sources.line_id, sum(sources.quantity), (array_agg(sources.reserved_by ORDER BY sources.created_at))[1], min(sources.created_at)
  FROM sources GROUP BY sources.organization_id, sources.item_id, sources.reference_type, sources.document_type, sources.document_id, sources.line_id
ON CONFLICT DO NOTHING;

UPDATE tenant.stock_reservations allocation SET inventory_reservation_id = parent.id
  FROM tenant.inventory_reservations parent
 WHERE allocation.inventory_reservation_id IS NULL AND parent.organization_id = allocation.organization_id AND parent.item_id = allocation.item_id
   AND parent.reference_type = allocation.reference_type
   AND parent.source_document_id = CASE WHEN allocation.reference_type = 'sales_order_line' THEN COALESCE(allocation.sales_order_id, allocation.reference_id) ELSE allocation.reference_id END
   AND parent.source_line_id IS NOT DISTINCT FROM (CASE WHEN allocation.reference_type = 'sales_order_line' THEN allocation.reference_id
        WHEN allocation.reference_type = 'stock_transfer' AND allocation.idempotency_key ~ ':reserve:[0-9a-f-]{36}:' THEN substring(allocation.idempotency_key FROM ':reserve:([0-9a-f-]{36}):')::uuid END);

DO $$ BEGIN PERFORM tenant.refresh_inventory_reservation(id) FROM tenant.inventory_reservations; END $$;

-- ============================================================ 4. isolation and grants
ALTER TABLE tenant.inventory_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.inventory_reservations FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'inventory_reservations' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.inventory_reservations USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
-- A reservation is never deleted: it ends consumed, released, cancelled or expired.
GRANT SELECT, INSERT, UPDATE ON tenant.inventory_reservations TO vercent_app;
GRANT SELECT ON tenant.inventory_reservations TO vercent_worker;

-- ============================================================ 5. permissions
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('stock.reservations.view', 'View stock reservations', 'Inventory', 'See reservations: what each source document reserved, consumed and released.'),
  ('stock.reservations.view_sources', 'View reservation source breakdown', 'Inventory', 'See which documents hold an item''s reserved stock.'),
  ('stock.reservations.view_allocations', 'View reservation allocations', 'Inventory', 'See the location, batch and serial number each reservation holds.'),
  ('stock.reservations.reserve_purchase_return', 'Reserve stock for purchase returns', 'Inventory', 'Reserve the stock a purchase return will send back.'),
  ('stock.reservations.reallocate_warehouse', 'Reallocate reservations to another warehouse', 'Inventory', 'Move a reservation to another warehouse.'),
  ('stock.reservations.resolve_exceptions', 'Resolve reservation exceptions', 'Inventory', 'Work the reservation exceptions: ineligible stock, missing serials, closed sources.'),
  ('stock.reservations.reconcile', 'Reconcile reservations', 'Inventory', 'Check reserved stock against the reservations and their sources.'),
  ('stock.reservations.rebuild', 'Rebuild reserved stock', 'Inventory', 'Rebuild the reserved stock projection from the reservations.'),
  ('sales.order.reserve_partial', 'Partially reserve sales orders', 'Sales', 'Reserve what is available when a sales order line cannot be reserved in full.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, granted.key FROM public.role_permissions existing
  JOIN (VALUES ('stock.view', 'stock.reservations.view'), ('stock.view', 'stock.reservations.view_sources'), ('stock.view', 'stock.reservations.view_allocations'),
               ('procurement.returns.post', 'stock.reservations.reserve_purchase_return'), ('stock.reservation.reallocate', 'stock.reservations.reallocate_warehouse'),
               ('stock.reservation.release', 'stock.reservations.resolve_exceptions'), ('stock.adjust', 'stock.reservations.reconcile'),
               ('inventory_setup.manage', 'stock.reservations.reconcile'), ('inventory_setup.manage', 'stock.reservations.rebuild'),
               ('sales.order.reserve', 'sales.order.reserve_partial'))
       AS granted(source, key) ON granted.source = existing.permission_key
  JOIN public.permissions permission ON permission.key = granted.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0072_stock_reservations.sql', 'stock-reservations');
