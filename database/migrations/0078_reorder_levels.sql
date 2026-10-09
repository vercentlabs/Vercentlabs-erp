-- Reorder Level / Replenishment Threshold: a static Min/Max planning control per company, warehouse and stock item. It never changes stock,
-- never creates a confirmed purchase order, receipt or transfer: it says when a warehouse needs replenishing and how much, and lets a user
-- open a draft purchase order or a draft internal transfer for it.
--
--   Eligible on hand     stock that can serve ordinary demand: on hand outside quality hold, quarantine, damaged, expired or blocked batches,
--                        non-allocatable or inactive locations (the same rule as Available Stock), negative balances included as they are
--   Firm open demand     confirmed sales orders not yet shipped (their full open quantity: a reservation allocates demand, it never adds to it)
--                        and confirmed warehouse transfers out not yet dispatched
--   Firm incoming        confirmed purchase orders still to receive, and warehouse transfers in that are confirmed or on their way
--   Current position     eligible on hand − firm open demand            Projected position   current + firm incoming
--   Status               reorder_required (projected ≤ reorder level; out_of_stock when nothing eligible is left), below_reorder_covered
--                        (current ≤ reorder level but incoming lifts it above), ok; disabled rules are never evaluated
--   Suggested            target − projected, rounded up to the order multiple (or to whole units), never below zero
--
-- Drafts (quotations, draft orders, purchase orders, transfers, purchase returns, goods issues) never count, nor do sales returns before they
-- are received. All quantities are in the item's base unit. A rule stores only its configuration; the status is a rebuildable projection
-- (tenant.inventory_reorder_status), recalculated by triggers for exactly the item and warehouse a change touches, and reconciled by a daily
-- job. One replenishment recommendation is open per rule at a time; it resolves by itself when the need goes away.
--
-- Replaces the earlier tenant.stock_reorder_rules and tenant.procurement_reorder_requests (empty, kept as history; nothing reads them).

-- ============================================================ 1. rules (configuration only)
CREATE TABLE IF NOT EXISTS tenant.inventory_reorder_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  warehouse_id uuid NOT NULL REFERENCES tenant.warehouses(id),
  item_id uuid NOT NULL REFERENCES tenant.items(id),
  enabled boolean NOT NULL DEFAULT true,
  reorder_level_base_quantity numeric(20,6) NOT NULL CHECK (reorder_level_base_quantity >= 0),
  target_level_base_quantity numeric(20,6) NOT NULL CHECK (target_level_base_quantity > 0),
  order_multiple_base_quantity numeric(20,6) CHECK (order_multiple_base_quantity IS NULL OR order_multiple_base_quantity > 0),
  notes text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, warehouse_id, item_id),
  CHECK (target_level_base_quantity > reorder_level_base_quantity)
);
CREATE INDEX IF NOT EXISTS inventory_reorder_rules_item_idx ON tenant.inventory_reorder_rules (organization_id, item_id, warehouse_id);

-- ============================================================ 2. status projection (rebuildable, never stock truth)
CREATE TABLE IF NOT EXISTS tenant.inventory_reorder_status (
  rule_id uuid PRIMARY KEY REFERENCES tenant.inventory_reorder_rules(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  item_id uuid NOT NULL,
  eligible_on_hand numeric(20,6) NOT NULL DEFAULT 0,
  sales_demand numeric(20,6) NOT NULL DEFAULT 0,
  transfer_demand numeric(20,6) NOT NULL DEFAULT 0,
  firm_open_demand numeric(20,6) NOT NULL DEFAULT 0,
  current_planning_position numeric(20,6) NOT NULL DEFAULT 0,
  purchase_incoming numeric(20,6) NOT NULL DEFAULT 0,
  transfer_incoming numeric(20,6) NOT NULL DEFAULT 0,
  firm_incoming numeric(20,6) NOT NULL DEFAULT 0,
  projected_position numeric(20,6) NOT NULL DEFAULT 0,
  raw_suggested_base_quantity numeric(20,6) NOT NULL DEFAULT 0,
  suggested_base_quantity numeric(20,6) NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('ok', 'below_reorder_covered', 'reorder_required', 'out_of_stock', 'disabled')),
  out_of_stock boolean NOT NULL DEFAULT false,
  earliest_incoming_date date,
  overdue_incoming boolean NOT NULL DEFAULT false,
  calculated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  version integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS inventory_reorder_status_status_idx ON tenant.inventory_reorder_status (organization_id, status, warehouse_id);
CREATE INDEX IF NOT EXISTS inventory_reorder_status_item_idx ON tenant.inventory_reorder_status (organization_id, item_id);

-- ============================================================ 3. recommendations (one open per rule) and history
CREATE TABLE IF NOT EXISTS tenant.inventory_replenishment_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  rule_id uuid NOT NULL REFERENCES tenant.inventory_reorder_rules(id),
  warehouse_id uuid NOT NULL,
  item_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'resolved', 'dismissed')),
  calculated_shortfall numeric(20,6) NOT NULL DEFAULT 0,
  suggested_base_quantity numeric(20,6) NOT NULL DEFAULT 0,
  action_document_type text CHECK (action_document_type IS NULL OR action_document_type IN ('purchase_order', 'inventory_transfer')),
  action_document_id uuid,
  action_document_number text,
  dismiss_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  actioned_at timestamptz,
  actioned_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  dismissed_at timestamptz,
  dismissed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  version integer NOT NULL DEFAULT 1
);
-- Never a second live recommendation for the same rule: recalculation updates the one there is.
CREATE UNIQUE INDEX IF NOT EXISTS inventory_replenishment_recommendations_live_uidx ON tenant.inventory_replenishment_recommendations (rule_id) WHERE status <> 'resolved';
CREATE INDEX IF NOT EXISTS inventory_replenishment_recommendations_idx ON tenant.inventory_replenishment_recommendations (organization_id, status, created_at);

-- Who changed what: rule configuration (old and new values), recommendations created, actioned, dismissed and resolved, drafts opened.
CREATE TABLE IF NOT EXISTS tenant.inventory_reorder_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  rule_id uuid REFERENCES tenant.inventory_reorder_rules(id),
  recommendation_id uuid REFERENCES tenant.inventory_replenishment_recommendations(id),
  event_type text NOT NULL,
  summary text NOT NULL,
  old_values jsonb,
  new_values jsonb,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS inventory_reorder_events_rule_idx ON tenant.inventory_reorder_events (organization_id, rule_id, created_at);

-- ============================================================ 4. the calculation (one definition; JavaScript reads its results)
-- The planning quantities of one item at one warehouse, from the sources themselves.
CREATE OR REPLACE FUNCTION tenant.reorder_planning_position(p_org uuid, p_item uuid, p_warehouse uuid,
  OUT eligible_on_hand numeric, OUT sales_demand numeric, OUT transfer_demand numeric, OUT purchase_incoming numeric, OUT transfer_incoming numeric,
  OUT earliest_incoming date, OUT overdue boolean)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  -- Stock that may serve ordinary demand (the Available Stock eligibility rule), negative balances as they are.
  SELECT COALESCE(sum(balance.quantity), 0) INTO eligible_on_hand
    FROM tenant.stock_balances balance
    LEFT JOIN tenant.warehouse_locations location ON location.organization_id = balance.organization_id AND location.id = balance.warehouse_location_id
    LEFT JOIN tenant.stock_batches batch ON batch.organization_id = balance.organization_id AND batch.id = balance.batch_id
   WHERE balance.organization_id = p_org AND balance.item_id = p_item AND balance.warehouse_id = p_warehouse
     AND NOT (COALESCE(location.disposition, 'available') <> 'available' OR NOT COALESCE(location.allow_allocation, true)
          OR COALESCE(location.location_type, '') = 'quality' OR COALESCE(location.purpose, '') = 'transit' OR COALESCE(location.status, 'active') <> 'active'
          OR COALESCE(batch.status, 'active') <> 'active' OR COALESCE(batch.expires_on < current_date, false));
  -- Confirmed (or held) sales orders: ordered − cancelled − already shipped (delivery lines whose stock was issued), in base units.
  SELECT COALESCE(sum(greatest((progress.confirmed_quantity - progress.cancelled_quantity) * COALESCE(NULLIF(line.conversion_factor, 0), 1)
           - COALESCE((SELECT sum(shipped.base_quantity) FROM tenant.sales_delivery_lines shipped
                        JOIN tenant.sales_fulfillment_requests delivery ON delivery.organization_id = shipped.organization_id AND delivery.id = shipped.delivery_id
                       WHERE shipped.organization_id = line.organization_id AND shipped.sales_order_line_id = line.id AND shipped.stock_issued
                         AND delivery.delivery_status <> 'cancelled'), 0), 0)), 0)
    INTO sales_demand
    FROM tenant.sales_order_line_progress progress
    JOIN tenant.sales_order_lines line ON line.organization_id = progress.organization_id AND line.id = progress.sales_order_line_id
    JOIN tenant.sales_orders sales_order ON sales_order.organization_id = line.organization_id AND sales_order.current_version_id = line.sales_order_version_id
   WHERE progress.organization_id = p_org AND line.item_id = p_item AND COALESCE(progress.fulfillment_warehouse_id, line.warehouse_id) = p_warehouse
     AND sales_order.lifecycle_status IN ('confirmed', 'on_hold');
  -- Warehouse transfers out, confirmed and not yet dispatched (after dispatch the stock has left on hand).
  SELECT COALESCE(sum(line.base_quantity), 0) INTO transfer_demand
    FROM tenant.inventory_transfers transfer
    JOIN tenant.inventory_transfer_lines line ON line.organization_id = transfer.organization_id AND line.transfer_id = transfer.id
   WHERE transfer.organization_id = p_org AND line.item_id = p_item AND transfer.source_warehouse_id = p_warehouse
     AND transfer.transfer_type = 'warehouse' AND transfer.status = 'confirmed';
  -- Confirmed purchase orders still to receive here.
  SELECT COALESCE(sum(progress.remaining_to_receive * line.conversion_factor), 0) INTO purchase_incoming
    FROM tenant.purchase_order_line_status progress
    JOIN tenant.purchase_order_lines line ON line.organization_id = progress.organization_id AND line.id = progress.purchase_order_line_id
    JOIN tenant.purchase_orders purchase_order ON purchase_order.organization_id = line.organization_id AND purchase_order.id = line.purchase_order_id
   WHERE progress.organization_id = p_org AND line.product_id = p_item AND COALESCE(line.receiving_warehouse_id, purchase_order.default_warehouse_id) = p_warehouse
     AND purchase_order.status = 'confirmed' AND progress.remaining_to_receive > 0;
  -- Warehouse transfers in: confirmed (their full quantity) or on their way (dispatched, not yet received or lost). Counted once.
  SELECT COALESCE(sum(CASE WHEN transfer.status = 'confirmed' THEN line.base_quantity
                           ELSE greatest(line.dispatched_base_quantity - line.received_base_quantity - line.lost_base_quantity, 0) END), 0) INTO transfer_incoming
    FROM tenant.inventory_transfers transfer
    JOIN tenant.inventory_transfer_lines line ON line.organization_id = transfer.organization_id AND line.transfer_id = transfer.id
   WHERE transfer.organization_id = p_org AND line.item_id = p_item AND transfer.destination_warehouse_id = p_warehouse
     AND transfer.transfer_type = 'warehouse' AND transfer.status IN ('confirmed', 'dispatched', 'partially_received');
  -- The next expected arrival, and whether an expected date has already passed.
  SELECT min(expected), COALESCE(bool_or(expected < current_date), false) INTO earliest_incoming, overdue FROM (
    SELECT COALESCE(line.expected_delivery_date, purchase_order.expected_delivery_date) AS expected
      FROM tenant.purchase_order_line_status progress
      JOIN tenant.purchase_order_lines line ON line.organization_id = progress.organization_id AND line.id = progress.purchase_order_line_id
      JOIN tenant.purchase_orders purchase_order ON purchase_order.organization_id = line.organization_id AND purchase_order.id = line.purchase_order_id
     WHERE progress.organization_id = p_org AND line.product_id = p_item AND COALESCE(line.receiving_warehouse_id, purchase_order.default_warehouse_id) = p_warehouse
       AND purchase_order.status = 'confirmed' AND progress.remaining_to_receive > 0
    UNION ALL
    SELECT transfer.expected_arrival_date FROM tenant.inventory_transfers transfer
      JOIN tenant.inventory_transfer_lines line ON line.organization_id = transfer.organization_id AND line.transfer_id = transfer.id
     WHERE transfer.organization_id = p_org AND line.item_id = p_item AND transfer.destination_warehouse_id = p_warehouse
       AND transfer.transfer_type = 'warehouse' AND transfer.status IN ('confirmed', 'dispatched', 'partially_received')) arrivals;
END;
$$;

-- Recalculates one rule: its status projection, and its recommendation (opened when replenishment is required, kept up to date, resolved when
-- it no longer is). Returns the status.
CREATE OR REPLACE FUNCTION tenant.refresh_reorder_rule(p_rule uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  rule record;
  position record;
  whole boolean;
  demand numeric;
  incoming numeric;
  current_position numeric;
  projected numeric;
  raw numeric := 0;
  suggested numeric := 0;
  state text;
  live record;
  opened uuid;
BEGIN
  SELECT r.*, item.tracking_type, COALESCE(uom.decimal_places, 6) AS decimals INTO rule
    FROM tenant.inventory_reorder_rules r JOIN tenant.items item ON item.organization_id = r.organization_id AND item.id = r.item_id
    LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = item.organization_id AND uom.id = item.uom_id
   WHERE r.id = p_rule;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO position FROM tenant.reorder_planning_position(rule.organization_id, rule.item_id, rule.warehouse_id);
  demand := position.sales_demand + position.transfer_demand;
  incoming := position.purchase_incoming + position.transfer_incoming;
  current_position := position.eligible_on_hand - demand;
  projected := current_position + incoming;
  whole := rule.tracking_type = 'serial' OR rule.decimals = 0;
  IF NOT rule.enabled THEN
    state := 'disabled';
  ELSIF projected <= rule.reorder_level_base_quantity THEN
    raw := greatest(rule.target_level_base_quantity - projected, 0);
    suggested := CASE WHEN rule.order_multiple_base_quantity IS NOT NULL THEN ceil(raw / rule.order_multiple_base_quantity) * rule.order_multiple_base_quantity
                      WHEN whole THEN ceil(raw) ELSE round(raw, least(rule.decimals, 6)::int) END;
    state := CASE WHEN position.eligible_on_hand <= 0 THEN 'out_of_stock' ELSE 'reorder_required' END;
  ELSIF current_position <= rule.reorder_level_base_quantity THEN
    state := 'below_reorder_covered';
  ELSE
    state := 'ok';
  END IF;

  INSERT INTO tenant.inventory_reorder_status AS s (rule_id, organization_id, warehouse_id, item_id, eligible_on_hand, sales_demand, transfer_demand, firm_open_demand,
      current_planning_position, purchase_incoming, transfer_incoming, firm_incoming, projected_position, raw_suggested_base_quantity, suggested_base_quantity, status,
      out_of_stock, earliest_incoming_date, overdue_incoming, calculated_at)
  VALUES (rule.id, rule.organization_id, rule.warehouse_id, rule.item_id, position.eligible_on_hand, position.sales_demand, position.transfer_demand, demand, current_position,
      position.purchase_incoming, position.transfer_incoming, incoming, projected, raw, suggested, state, position.eligible_on_hand <= 0, position.earliest_incoming,
      position.overdue, clock_timestamp())
  ON CONFLICT (rule_id) DO UPDATE SET warehouse_id = EXCLUDED.warehouse_id, item_id = EXCLUDED.item_id, eligible_on_hand = EXCLUDED.eligible_on_hand,
      sales_demand = EXCLUDED.sales_demand, transfer_demand = EXCLUDED.transfer_demand, firm_open_demand = EXCLUDED.firm_open_demand,
      current_planning_position = EXCLUDED.current_planning_position, purchase_incoming = EXCLUDED.purchase_incoming, transfer_incoming = EXCLUDED.transfer_incoming,
      firm_incoming = EXCLUDED.firm_incoming, projected_position = EXCLUDED.projected_position, raw_suggested_base_quantity = EXCLUDED.raw_suggested_base_quantity,
      suggested_base_quantity = EXCLUDED.suggested_base_quantity, status = EXCLUDED.status, out_of_stock = EXCLUDED.out_of_stock,
      earliest_incoming_date = EXCLUDED.earliest_incoming_date, overdue_incoming = EXCLUDED.overdue_incoming, calculated_at = EXCLUDED.calculated_at, version = s.version + 1
    WHERE (s.eligible_on_hand, s.firm_open_demand, s.firm_incoming, s.suggested_base_quantity, s.status, s.earliest_incoming_date, s.overdue_incoming, s.sales_demand, s.transfer_demand,
           s.purchase_incoming, s.transfer_incoming, s.raw_suggested_base_quantity)
      IS DISTINCT FROM (EXCLUDED.eligible_on_hand, EXCLUDED.firm_open_demand, EXCLUDED.firm_incoming, EXCLUDED.suggested_base_quantity, EXCLUDED.status,
           EXCLUDED.earliest_incoming_date, EXCLUDED.overdue_incoming, EXCLUDED.sales_demand, EXCLUDED.transfer_demand, EXCLUDED.purchase_incoming, EXCLUDED.transfer_incoming,
           EXCLUDED.raw_suggested_base_quantity);

  SELECT * INTO live FROM tenant.inventory_replenishment_recommendations WHERE rule_id = rule.id AND status <> 'resolved' FOR UPDATE;
  IF state IN ('reorder_required', 'out_of_stock') THEN
    IF live.id IS NULL THEN
      INSERT INTO tenant.inventory_replenishment_recommendations (organization_id, rule_id, warehouse_id, item_id, calculated_shortfall, suggested_base_quantity)
      VALUES (rule.organization_id, rule.id, rule.warehouse_id, rule.item_id, raw, suggested) RETURNING id INTO opened;
      INSERT INTO tenant.inventory_reorder_events (organization_id, rule_id, recommendation_id, event_type, summary, details)
      VALUES (rule.organization_id, rule.id, opened, 'recommendation.created', 'Replenishment required: suggested ' || trim(to_char(suggested, 'FM999999999990.######')),
        jsonb_build_object('projected', projected, 'suggested', suggested));
    ELSIF (live.calculated_shortfall, live.suggested_base_quantity) IS DISTINCT FROM (raw, suggested) THEN
      UPDATE tenant.inventory_replenishment_recommendations SET calculated_shortfall = raw, suggested_base_quantity = suggested, updated_at = clock_timestamp(), version = version + 1
       WHERE id = live.id;
    END IF;
  ELSIF live.id IS NOT NULL THEN
    UPDATE tenant.inventory_replenishment_recommendations SET status = 'resolved', resolved_at = clock_timestamp(), calculated_shortfall = 0, suggested_base_quantity = 0,
           updated_at = clock_timestamp(), version = version + 1 WHERE id = live.id;
    INSERT INTO tenant.inventory_reorder_events (organization_id, rule_id, recommendation_id, event_type, summary, details)
    VALUES (rule.organization_id, rule.id, live.id, 'recommendation.resolved',
      CASE WHEN state = 'disabled' THEN 'Resolved: the rule was disabled' ELSE 'Resolved: no additional replenishment is required' END, jsonb_build_object('status', state));
  END IF;
  RETURN state;
END;
$$;

-- The rule (if any) of one item at one warehouse, recalculated.
CREATE OR REPLACE FUNCTION tenant.refresh_reorder_position(p_org uuid, p_item uuid, p_warehouse uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  rule_id uuid;
BEGIN
  IF p_item IS NULL OR p_warehouse IS NULL THEN RETURN; END IF;
  SELECT id INTO rule_id FROM tenant.inventory_reorder_rules WHERE organization_id = p_org AND item_id = p_item AND warehouse_id = p_warehouse;
  IF rule_id IS NOT NULL THEN PERFORM tenant.refresh_reorder_rule(rule_id); END IF;
END;
$$;

-- ============================================================ 5. recalculation on the changes that move a planning position
CREATE OR REPLACE FUNCTION tenant.reorder_on_balance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM tenant.refresh_reorder_position(NEW.organization_id, NEW.item_id, NEW.warehouse_id);
  IF TG_OP = 'UPDATE' AND (OLD.item_id, OLD.warehouse_id) IS DISTINCT FROM (NEW.item_id, NEW.warehouse_id) THEN
    PERFORM tenant.refresh_reorder_position(OLD.organization_id, OLD.item_id, OLD.warehouse_id);
  END IF;
  RETURN NULL;
END;
$$;
CREATE OR REPLACE TRIGGER stock_balances_reorder AFTER INSERT OR UPDATE OF quantity, warehouse_location_id, batch_id ON tenant.stock_balances
  FOR EACH ROW EXECUTE FUNCTION tenant.reorder_on_balance();

-- A sales order line's progress (confirmation, delivery, cancellation, a change of warehouse).
CREATE OR REPLACE FUNCTION tenant.reorder_on_sales_progress() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  line record;
BEGIN
  SELECT item_id, warehouse_id INTO line FROM tenant.sales_order_lines WHERE id = NEW.sales_order_line_id;
  PERFORM tenant.refresh_reorder_position(NEW.organization_id, line.item_id, COALESCE(NEW.fulfillment_warehouse_id, line.warehouse_id));
  IF TG_OP = 'UPDATE' AND OLD.fulfillment_warehouse_id IS DISTINCT FROM NEW.fulfillment_warehouse_id THEN
    PERFORM tenant.refresh_reorder_position(NEW.organization_id, line.item_id, COALESCE(OLD.fulfillment_warehouse_id, line.warehouse_id));
  END IF;
  RETURN NULL;
END;
$$;
CREATE OR REPLACE TRIGGER sales_order_line_progress_reorder AFTER INSERT OR UPDATE ON tenant.sales_order_line_progress
  FOR EACH ROW EXECUTE FUNCTION tenant.reorder_on_sales_progress();

-- A sales order confirmed, held, cancelled, closed or revised: every line of its current version (and of the version it replaced).
CREATE OR REPLACE FUNCTION tenant.reorder_on_sales_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  line record;
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD.lifecycle_status, OLD.current_version_id) IS NOT DISTINCT FROM (NEW.lifecycle_status, NEW.current_version_id) THEN RETURN NULL; END IF;
  FOR line IN SELECT DISTINCT l.item_id, COALESCE(p.fulfillment_warehouse_id, l.warehouse_id) AS warehouse_id FROM tenant.sales_order_lines l
      LEFT JOIN tenant.sales_order_line_progress p ON p.sales_order_line_id = l.id
     WHERE l.organization_id = NEW.organization_id AND l.sales_order_version_id IN (NEW.current_version_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.current_version_id END) LOOP
    PERFORM tenant.refresh_reorder_position(NEW.organization_id, line.item_id, line.warehouse_id);
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE OR REPLACE TRIGGER sales_orders_reorder AFTER INSERT OR UPDATE OF lifecycle_status, current_version_id ON tenant.sales_orders
  FOR EACH ROW EXECUTE FUNCTION tenant.reorder_on_sales_order();

-- A delivery line issued or a delivery cancelled.
CREATE OR REPLACE FUNCTION tenant.reorder_on_delivery_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM tenant.refresh_reorder_position(NEW.organization_id, NEW.item_id, NEW.warehouse_id);
  RETURN NULL;
END;
$$;
CREATE OR REPLACE TRIGGER sales_delivery_lines_reorder AFTER INSERT OR UPDATE OF stock_issued, quantity, base_quantity ON tenant.sales_delivery_lines
  FOR EACH ROW EXECUTE FUNCTION tenant.reorder_on_delivery_line();
CREATE OR REPLACE FUNCTION tenant.reorder_on_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  line record;
BEGIN
  IF OLD.delivery_status IS NOT DISTINCT FROM NEW.delivery_status THEN RETURN NULL; END IF;
  FOR line IN SELECT DISTINCT item_id, warehouse_id FROM tenant.sales_delivery_lines WHERE organization_id = NEW.organization_id AND delivery_id = NEW.id LOOP
    PERFORM tenant.refresh_reorder_position(NEW.organization_id, line.item_id, line.warehouse_id);
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE OR REPLACE TRIGGER sales_fulfillment_requests_reorder AFTER UPDATE OF delivery_status ON tenant.sales_fulfillment_requests
  FOR EACH ROW EXECUTE FUNCTION tenant.reorder_on_delivery();

-- A purchase order confirmed, closed or cancelled; a line added or changed; a receipt posted, cancelled or reversed.
CREATE OR REPLACE FUNCTION tenant.reorder_on_purchase_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  line record;
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD.status, OLD.default_warehouse_id) IS NOT DISTINCT FROM (NEW.status, NEW.default_warehouse_id) THEN RETURN NULL; END IF;
  FOR line IN SELECT DISTINCT l.product_id, warehouse.id AS warehouse_id FROM tenant.purchase_order_lines l
      CROSS JOIN LATERAL (VALUES (COALESCE(l.receiving_warehouse_id, NEW.default_warehouse_id)), (COALESCE(l.receiving_warehouse_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.default_warehouse_id END))) warehouse(id)
     WHERE l.organization_id = NEW.organization_id AND l.purchase_order_id = NEW.id AND l.product_id IS NOT NULL LOOP
    PERFORM tenant.refresh_reorder_position(NEW.organization_id, line.product_id, line.warehouse_id);
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE OR REPLACE TRIGGER purchase_orders_reorder AFTER UPDATE OF status, default_warehouse_id ON tenant.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION tenant.reorder_on_purchase_order();
CREATE OR REPLACE FUNCTION tenant.reorder_on_purchase_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  head record;
BEGIN
  SELECT status, default_warehouse_id INTO head FROM tenant.purchase_orders WHERE id = COALESCE(NEW.purchase_order_id, OLD.purchase_order_id);
  IF head.status IS DISTINCT FROM 'confirmed' THEN RETURN NULL; END IF;
  IF TG_OP <> 'DELETE' THEN PERFORM tenant.refresh_reorder_position(NEW.organization_id, NEW.product_id, COALESCE(NEW.receiving_warehouse_id, head.default_warehouse_id)); END IF;
  IF TG_OP <> 'INSERT' THEN PERFORM tenant.refresh_reorder_position(OLD.organization_id, OLD.product_id, COALESCE(OLD.receiving_warehouse_id, head.default_warehouse_id)); END IF;
  RETURN NULL;
END;
$$;
CREATE OR REPLACE TRIGGER purchase_order_lines_reorder AFTER INSERT OR UPDATE OR DELETE ON tenant.purchase_order_lines
  FOR EACH ROW EXECUTE FUNCTION tenant.reorder_on_purchase_line();
CREATE OR REPLACE FUNCTION tenant.reorder_on_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  line record;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NULL; END IF;
  FOR line IN SELECT DISTINCT r.product_id, r.warehouse_id FROM tenant.goods_receipt_lines r WHERE r.organization_id = NEW.organization_id AND r.goods_receipt_id = NEW.id LOOP
    PERFORM tenant.refresh_reorder_position(NEW.organization_id, line.product_id, COALESCE(line.warehouse_id, NEW.warehouse_id));
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE OR REPLACE TRIGGER goods_receipts_reorder AFTER UPDATE OF status ON tenant.goods_receipts FOR EACH ROW EXECUTE FUNCTION tenant.reorder_on_receipt();

-- A transfer confirmed, dispatched, received, cancelled or reversed; a line changed: both its warehouses.
CREATE OR REPLACE FUNCTION tenant.reorder_on_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  line record;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NULL; END IF;
  FOR line IN SELECT DISTINCT item_id FROM tenant.inventory_transfer_lines WHERE organization_id = NEW.organization_id AND transfer_id = NEW.id LOOP
    PERFORM tenant.refresh_reorder_position(NEW.organization_id, line.item_id, NEW.source_warehouse_id);
    PERFORM tenant.refresh_reorder_position(NEW.organization_id, line.item_id, NEW.destination_warehouse_id);
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE OR REPLACE TRIGGER inventory_transfers_reorder AFTER UPDATE OF status ON tenant.inventory_transfers FOR EACH ROW EXECUTE FUNCTION tenant.reorder_on_transfer();
CREATE OR REPLACE FUNCTION tenant.reorder_on_transfer_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  head record;
BEGIN
  SELECT status, source_warehouse_id, destination_warehouse_id INTO head FROM tenant.inventory_transfers WHERE id = NEW.transfer_id;
  IF head.status IN ('draft', 'completed', 'cancelled', 'reversed') AND TG_OP = 'INSERT' THEN RETURN NULL; END IF;
  PERFORM tenant.refresh_reorder_position(NEW.organization_id, NEW.item_id, head.source_warehouse_id);
  PERFORM tenant.refresh_reorder_position(NEW.organization_id, NEW.item_id, head.destination_warehouse_id);
  RETURN NULL;
END;
$$;
CREATE OR REPLACE TRIGGER inventory_transfer_lines_reorder AFTER INSERT OR UPDATE OF base_quantity, dispatched_base_quantity, received_base_quantity, lost_base_quantity
  ON tenant.inventory_transfer_lines FOR EACH ROW EXECUTE FUNCTION tenant.reorder_on_transfer_line();

-- A batch blocked, expired or re-dated, or a location's disposition or allocation changed: every rule its stock is under.
CREATE OR REPLACE FUNCTION tenant.reorder_on_batch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  position record;
BEGIN
  IF (OLD.status, OLD.expires_on) IS NOT DISTINCT FROM (NEW.status, NEW.expires_on) THEN RETURN NULL; END IF;
  FOR position IN SELECT DISTINCT item_id, warehouse_id FROM tenant.stock_balances WHERE organization_id = NEW.organization_id AND batch_id = NEW.id LOOP
    PERFORM tenant.refresh_reorder_position(NEW.organization_id, position.item_id, position.warehouse_id);
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE OR REPLACE TRIGGER stock_batches_reorder AFTER UPDATE OF status, expires_on ON tenant.stock_batches FOR EACH ROW EXECUTE FUNCTION tenant.reorder_on_batch();
CREATE OR REPLACE FUNCTION tenant.reorder_on_location() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  position record;
BEGIN
  IF (OLD.disposition, OLD.allow_allocation, OLD.status, OLD.location_type, OLD.purpose) IS NOT DISTINCT FROM (NEW.disposition, NEW.allow_allocation, NEW.status, NEW.location_type, NEW.purpose)
    THEN RETURN NULL; END IF;
  FOR position IN SELECT DISTINCT item_id, warehouse_id FROM tenant.stock_balances WHERE organization_id = NEW.organization_id AND warehouse_location_id = NEW.id LOOP
    PERFORM tenant.refresh_reorder_position(NEW.organization_id, position.item_id, position.warehouse_id);
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE OR REPLACE TRIGGER warehouse_locations_reorder AFTER UPDATE OF disposition, allow_allocation, status, location_type, purpose ON tenant.warehouse_locations
  FOR EACH ROW EXECUTE FUNCTION tenant.reorder_on_location();

-- A rule created or changed: recalculated at once.
CREATE OR REPLACE FUNCTION tenant.reorder_on_rule() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM tenant.refresh_reorder_rule(NEW.id);
  RETURN NULL;
END;
$$;
CREATE OR REPLACE TRIGGER inventory_reorder_rules_refresh AFTER INSERT OR UPDATE OF enabled, reorder_level_base_quantity, target_level_base_quantity, order_multiple_base_quantity
  ON tenant.inventory_reorder_rules FOR EACH ROW EXECUTE FUNCTION tenant.reorder_on_rule();

-- ============================================================ 6. isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['inventory_reorder_rules', 'inventory_reorder_status', 'inventory_replenishment_recommendations', 'inventory_reorder_events'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON tenant.%I TO vercent_app', name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON tenant.%I TO vercent_worker', name);
  END LOOP;
END $$;
-- Rules are disabled, never deleted; history is evidence.
REVOKE DELETE ON tenant.inventory_reorder_rules, tenant.inventory_replenishment_recommendations FROM vercent_app;
REVOKE UPDATE, DELETE ON tenant.inventory_reorder_events FROM vercent_app;
REVOKE UPDATE, DELETE ON tenant.inventory_reorder_events FROM vercent_worker;
GRANT DELETE ON tenant.inventory_reorder_status TO vercent_app;

-- ============================================================ 7. permissions
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('stock.reorder.view', 'View reorder levels', 'Inventory', 'See the reorder rules of items and warehouses.'),
  ('stock.reorder.view_requirements', 'View replenishment requirements', 'Inventory', 'See which items need replenishing and how much.'),
  ('stock.reorder.create', 'Create reorder rules', 'Inventory', 'Set a reorder level and target for an item at a warehouse.'),
  ('stock.reorder.edit', 'Edit reorder rules', 'Inventory', 'Change reorder levels, targets and order multiples.'),
  ('stock.reorder.disable', 'Enable and disable reorder rules', 'Inventory', 'Turn a reorder rule off or back on.'),
  ('stock.reorder.import', 'Bulk import reorder rules', 'Inventory', 'Create and update reorder rules from a CSV or XLSX file.'),
  ('stock.reorder.view_demand', 'View replenishment demand', 'Inventory', 'See the sales orders and transfers behind firm demand.'),
  ('stock.reorder.view_incoming', 'View replenishment incoming', 'Inventory', 'See the purchase orders and transfers behind firm incoming.'),
  ('stock.reorder.view_other_stock', 'View other warehouses'' stock for replenishment', 'Inventory', 'See what other warehouses could transfer.'),
  ('stock.reorder.create_purchase_draft', 'Create purchase drafts from replenishment', 'Inventory', 'Open a draft purchase order for a replenishment requirement.'),
  ('stock.reorder.create_transfer_draft', 'Create transfer drafts from replenishment', 'Inventory', 'Open a draft internal transfer for a replenishment requirement.'),
  ('stock.reorder.dismiss', 'Dismiss replenishment recommendations', 'Inventory', 'Dismiss a recommendation (the stock stays below reorder).'),
  ('stock.reorder.export', 'Export replenishment data', 'Inventory', 'Download reorder rules and requirements.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, granted.key FROM public.role_permissions existing
  JOIN (VALUES ('stock.view', 'stock.reorder.view'), ('stock.view', 'stock.reorder.view_requirements'), ('stock.view', 'stock.reorder.view_demand'),
               ('stock.view', 'stock.reorder.view_incoming'), ('stock.view', 'stock.reorder.view_other_stock'),
               ('inventory_setup.manage', 'stock.reorder.view'), ('inventory_setup.manage', 'stock.reorder.view_requirements'), ('inventory_setup.manage', 'stock.reorder.create'),
               ('inventory_setup.manage', 'stock.reorder.edit'), ('inventory_setup.manage', 'stock.reorder.disable'), ('inventory_setup.manage', 'stock.reorder.import'),
               ('inventory_setup.manage', 'stock.reorder.dismiss'), ('inventory_setup.manage', 'stock.reorder.export'),
               ('procurement.po.create', 'stock.reorder.view'), ('procurement.po.create', 'stock.reorder.view_requirements'), ('procurement.po.create', 'stock.reorder.view_incoming'),
               ('procurement.po.create', 'stock.reorder.create_purchase_draft'), ('procurement.po.create', 'stock.reorder.dismiss'), ('procurement.po.create', 'stock.reorder.export'),
               ('stock.transfers.create', 'stock.reorder.view'), ('stock.transfers.create', 'stock.reorder.view_requirements'),
               ('stock.transfers.create', 'stock.reorder.view_other_stock'), ('stock.transfers.create', 'stock.reorder.create_transfer_draft'))
       AS granted(source, key) ON granted.source = existing.permission_key
  JOIN public.permissions permission ON permission.key = granted.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0078_reorder_levels.sql', 'reorder-levels');
