-- Sales Returns.
--
-- A sales return records goods that come back from the customer against a
-- delivery: what came back (line by line, against the delivery lines that
-- sent it), why, in what condition and into which warehouse. A Draft moves
-- no stock; Receive brings the stock back in (sellable for Restock, held in
-- a quality location for Inspection / Hold and Damaged). A received return
-- is never edited, cancelled or deleted. The financial correction is a
-- credit note against the original invoice, made from the return when the
-- goods were invoiced; the return itself never touches receivables.
--
-- 1. tenant.sales_returns and tenant.sales_return_lines.
-- 2. tenant.sales_return_credits: which credit note credits which return line, for how much.
-- 3. tenant.sales_return_events: its history.
-- 4. Received and cancelled returns are fixed.
-- 5. Permissions.
-- The earlier tenant.sales_return_requests table is no longer written.

CREATE TABLE IF NOT EXISTS tenant.sales_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  return_number text NOT NULL,
  sales_order_id uuid NOT NULL REFERENCES tenant.sales_orders(id),
  delivery_id uuid NOT NULL REFERENCES tenant.sales_fulfillment_requests(id),
  party_id uuid NOT NULL REFERENCES tenant.business_parties(id),
  customer_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  customer_po_number text,
  return_date date NOT NULL DEFAULT current_date,
  warehouse_id uuid NOT NULL REFERENCES tenant.warehouses(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'received', 'cancelled')),
  reason_code text NOT NULL CHECK (reason_code IN ('damaged_product', 'defective_product', 'wrong_product', 'wrong_quantity', 'changed_mind', 'not_as_expected',
    'shipping_damage', 'duplicate_shipment', 'quality_issue', 'order_cancellation', 'other')),
  reason_note text,
  customer_notes text,
  internal_notes text,
  idempotency_key text,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  received_by uuid REFERENCES public.users(id),
  received_at timestamptz,
  cancelled_by uuid REFERENCES public.users(id),
  cancelled_at timestamptz,
  cancel_reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, return_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_returns_key_idx ON tenant.sales_returns (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_returns_order_idx ON tenant.sales_returns (organization_id, sales_order_id);
CREATE INDEX IF NOT EXISTS sales_returns_delivery_idx ON tenant.sales_returns (organization_id, delivery_id);
CREATE INDEX IF NOT EXISTS sales_returns_status_idx ON tenant.sales_returns (organization_id, status);
ALTER TABLE tenant.sales_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_returns FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.sales_returns
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, UPDATE ON tenant.sales_returns TO vercent_app;
GRANT SELECT ON tenant.sales_returns TO vercent_worker;

CREATE TABLE IF NOT EXISTS tenant.sales_return_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  sales_return_id uuid NOT NULL REFERENCES tenant.sales_returns(id),
  sequence integer NOT NULL DEFAULT 1,
  delivery_line_id uuid NOT NULL REFERENCES tenant.sales_delivery_lines(id),
  sales_order_line_id uuid NOT NULL REFERENCES tenant.sales_order_lines(id),
  item_id uuid NOT NULL REFERENCES tenant.items(id),
  item_code_snapshot text,
  item_name_snapshot text NOT NULL,
  description_snapshot text,
  uom_id uuid,
  uom_snapshot text,
  quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
  base_quantity numeric(20,6) NOT NULL CHECK (base_quantity > 0),
  disposition text NOT NULL CHECK (disposition IN ('restock', 'inspection', 'damaged', 'other')),
  reason_code text,
  warehouse_location_id uuid,
  stock_movement_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_return_lines_return_idx ON tenant.sales_return_lines (organization_id, sales_return_id);
CREATE INDEX IF NOT EXISTS sales_return_lines_delivery_line_idx ON tenant.sales_return_lines (organization_id, delivery_line_id);
CREATE INDEX IF NOT EXISTS sales_return_lines_order_line_idx ON tenant.sales_return_lines (organization_id, sales_order_line_id);
ALTER TABLE tenant.sales_return_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_return_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.sales_return_lines
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.sales_return_lines TO vercent_app;
GRANT SELECT ON tenant.sales_return_lines TO vercent_worker;

CREATE TABLE IF NOT EXISTS tenant.sales_return_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  sales_return_id uuid NOT NULL REFERENCES tenant.sales_returns(id),
  sales_return_line_id uuid NOT NULL REFERENCES tenant.sales_return_lines(id),
  source_invoice_id uuid NOT NULL REFERENCES tenant.accounting_customer_invoices(id),
  credit_note_id uuid NOT NULL REFERENCES tenant.accounting_customer_invoices(id),
  quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_return_credits_return_idx ON tenant.sales_return_credits (organization_id, sales_return_id);
CREATE INDEX IF NOT EXISTS sales_return_credits_credit_idx ON tenant.sales_return_credits (organization_id, credit_note_id);
ALTER TABLE tenant.sales_return_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_return_credits FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.sales_return_credits
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT ON tenant.sales_return_credits TO vercent_app;
GRANT SELECT ON tenant.sales_return_credits TO vercent_worker;

-- The history of each return (who did what, and what it carried).
CREATE TABLE IF NOT EXISTS tenant.sales_return_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  sales_return_id uuid NOT NULL REFERENCES tenant.sales_returns(id),
  event_type text NOT NULL,
  from_status text,
  to_status text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS sales_return_events_return_idx ON tenant.sales_return_events (organization_id, sales_return_id, occurred_at);
ALTER TABLE tenant.sales_return_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_return_events FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.sales_return_events
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT ON tenant.sales_return_events TO vercent_app;
GRANT SELECT ON tenant.sales_return_events TO vercent_worker;

-- A received return brought stock back: it is history. A cancelled one stays as it was.
CREATE OR REPLACE FUNCTION tenant.sales_return_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE parent_status text;
BEGIN
  IF TG_TABLE_NAME = 'sales_returns' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'A sales return is never deleted; cancel a draft instead';
    END IF;
    IF OLD.status IN ('received', 'cancelled') THEN
      RAISE EXCEPTION 'A % sales return cannot be changed', OLD.status;
    END IF;
    RETURN NEW;
  END IF;
  SELECT status INTO parent_status FROM tenant.sales_returns WHERE id = COALESCE(OLD.sales_return_id, NEW.sales_return_id);
  IF parent_status IN ('received', 'cancelled') THEN
    RAISE EXCEPTION 'The lines of a % sales return cannot be changed', parent_status;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE OR REPLACE TRIGGER sales_returns_guard BEFORE UPDATE OR DELETE ON tenant.sales_returns FOR EACH ROW EXECUTE FUNCTION tenant.sales_return_guard();
CREATE OR REPLACE TRIGGER sales_return_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON tenant.sales_return_lines FOR EACH ROW EXECUTE FUNCTION tenant.sales_return_guard();

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('sales.return.view', 'View sales returns', 'Sales', 'Open the returns of the sales orders the user can see.'),
  ('sales.return.view_all', 'View all sales returns', 'Sales', 'See every sales return, whoever owns the order.'),
  ('sales.return.create', 'Create sales returns', 'Sales', 'Create a draft return from a dispatched delivery.'),
  ('sales.return.edit', 'Edit draft sales returns', 'Sales', 'Change a draft return''s lines, reason, condition and notes, or cancel it.'),
  ('sales.return.receive', 'Receive sales returns', 'Sales', 'Receive a return: the goods come back into stock.'),
  ('sales.return.select_warehouse', 'Choose the return warehouse', 'Sales', 'Receive a return into a warehouse other than the one it was delivered from.'),
  ('sales.return.print', 'Print return notes', 'Sales', 'View, download and print return notes.'),
  ('sales.return.credit_note', 'Create credit notes from returns', 'Sales', 'Create a draft credit note for the invoiced part of a received return.')
ON CONFLICT (key) DO NOTHING;

-- Whoever sees orders, the warehouse and Finance (who credits them) see returns and print them.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['sales.return.view', 'sales.return.print'])
 WHERE existing.permission_key IN ('sales.order.view', 'stock.view', 'accounting.view')
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'sales.return.view_all' FROM public.role_permissions existing WHERE existing.permission_key IN ('sales.order.view_all', 'stock.view', 'accounting.view')
ON CONFLICT DO NOTHING;
-- Whoever creates deliveries, sales managers and the warehouse prepare returns.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['sales.return.create', 'sales.return.edit'])
 WHERE existing.permission_key IN ('sales.fulfillment.request', 'sales.order.confirm', 'stock.receive')
ON CONFLICT DO NOTHING;
-- Receiving moves stock: the warehouse (who receives stock) and sales managers, who also choose the warehouse.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['sales.return.receive', 'sales.return.select_warehouse'])
 WHERE existing.permission_key IN ('stock.receive', 'sales.order.confirm')
ON CONFLICT DO NOTHING;
-- Credit notes from returns: whoever creates credit notes.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'sales.return.credit_note' FROM public.role_permissions existing WHERE existing.permission_key = 'sales.invoice.credit_note'
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0037_sales_returns.sql', 'sales-returns');
