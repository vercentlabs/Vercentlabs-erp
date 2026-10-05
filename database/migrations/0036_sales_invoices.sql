-- Sales Invoices.
--
-- A Sales Invoice is Finance's customer invoice (tenant.accounting_customer_
-- invoices: number, dates, amounts, lines, AR balance, journal, tax ledger),
-- made from a sales order or a delivery by Sales. Sales keeps beside it what
-- Finance does not: the customer, contact, addresses and seller as they were
-- invoiced, the salesperson, customer and internal notes, the product
-- details and the tax components of each line, and whether it was sent.
-- Once the invoice is posted, its Sales record is as fixed as Finance's:
-- only its sending and its reversal are recorded afterwards.
--
-- 1. tenant.sales_invoices: one per customer invoice made by Sales.
-- 2. tenant.sales_invoice_lines: the product snapshot of each invoice line.
-- 3. tenant.sales_invoice_line_taxes: each line's tax components (CGST, SGST, IGST, CESS).
-- 4. tenant.sales_invoice_sends: every send of the invoice to the customer.
-- 5. Invoices already made from sales orders get their Sales record.
-- 6. Permissions.

CREATE TABLE IF NOT EXISTS tenant.sales_invoices (
  customer_invoice_id uuid PRIMARY KEY REFERENCES tenant.accounting_customer_invoices(id),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  sales_order_id uuid NOT NULL REFERENCES tenant.sales_orders(id),
  sales_order_version_id uuid REFERENCES tenant.sales_order_versions(id),
  idempotency_key text,
  quantity_basis text NOT NULL DEFAULT 'ordered' CHECK (quantity_basis IN ('ordered', 'delivered')),
  customer_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  contact_id uuid,
  contact_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  shipping_address_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  seller_registration_id uuid,
  seller_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  place_of_supply_name text,
  supply_nature text,
  customer_po_number text,
  owner_user_id uuid REFERENCES public.users(id),
  customer_notes text,
  internal_notes text,
  version integer NOT NULL DEFAULT 1,
  sent_at timestamptz,
  sent_by uuid REFERENCES public.users(id),
  sent_to text,
  sent_channel text,
  reversed_at timestamptz,
  reversed_by uuid REFERENCES public.users(id),
  reversal_reason text,
  reversal_journal_entry_id uuid,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_invoices_key_idx ON tenant.sales_invoices (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_invoices_order_idx ON tenant.sales_invoices (organization_id, sales_order_id);
ALTER TABLE tenant.sales_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.sales_invoices
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, UPDATE ON tenant.sales_invoices TO vercent_app;
GRANT SELECT ON tenant.sales_invoices TO vercent_worker;

CREATE TABLE IF NOT EXISTS tenant.sales_invoice_lines (
  customer_invoice_line_id uuid PRIMARY KEY REFERENCES tenant.accounting_customer_invoice_lines(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  customer_invoice_id uuid NOT NULL REFERENCES tenant.accounting_customer_invoices(id),
  item_code_snapshot text,
  item_name_snapshot text NOT NULL,
  description_snapshot text,
  hsn_sac_kind text,
  uom_snapshot text,
  list_unit_price numeric(20,6),
  gross_amount numeric(20,6) NOT NULL DEFAULT 0,
  line_discount_amount numeric(20,6) NOT NULL DEFAULT 0,
  document_discount_amount numeric(20,6) NOT NULL DEFAULT 0,
  tax_category_id uuid,
  tax_rate numeric(10,4),
  tax_treatment text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_invoice_lines_invoice_idx ON tenant.sales_invoice_lines (organization_id, customer_invoice_id);
ALTER TABLE tenant.sales_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_invoice_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.sales_invoice_lines
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, DELETE ON tenant.sales_invoice_lines TO vercent_app;
GRANT SELECT ON tenant.sales_invoice_lines TO vercent_worker;

CREATE TABLE IF NOT EXISTS tenant.sales_invoice_line_taxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  customer_invoice_id uuid NOT NULL REFERENCES tenant.accounting_customer_invoices(id),
  customer_invoice_line_id uuid NOT NULL REFERENCES tenant.accounting_customer_invoice_lines(id) ON DELETE CASCADE,
  sequence integer NOT NULL DEFAULT 1,
  tax_type text NOT NULL,
  label text,
  rate numeric(10,4) NOT NULL DEFAULT 0,
  taxable_amount numeric(20,6) NOT NULL DEFAULT 0,
  tax_amount numeric(20,6) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sales_invoice_line_taxes_invoice_idx ON tenant.sales_invoice_line_taxes (organization_id, customer_invoice_id);
ALTER TABLE tenant.sales_invoice_line_taxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_invoice_line_taxes FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.sales_invoice_line_taxes
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, DELETE ON tenant.sales_invoice_line_taxes TO vercent_app;
GRANT SELECT ON tenant.sales_invoice_line_taxes TO vercent_worker;

CREATE TABLE IF NOT EXISTS tenant.sales_invoice_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  customer_invoice_id uuid NOT NULL REFERENCES tenant.accounting_customer_invoices(id),
  channel text NOT NULL CHECK (channel IN ('email', 'other')),
  recipients text,
  subject text,
  note text,
  message_id text,
  pdf_file_id uuid,
  idempotency_key text,
  sent_by uuid REFERENCES public.users(id),
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_invoice_sends_key_idx ON tenant.sales_invoice_sends (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_invoice_sends_invoice_idx ON tenant.sales_invoice_sends (organization_id, customer_invoice_id);
ALTER TABLE tenant.sales_invoice_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_invoice_sends FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.sales_invoice_sends
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT ON tenant.sales_invoice_sends TO vercent_app;
GRANT SELECT ON tenant.sales_invoice_sends TO vercent_worker;

-- A posted invoice's Sales record is history: only its sending and its reversal are recorded afterwards.
CREATE OR REPLACE FUNCTION tenant.sales_invoice_posted_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE invoice_status text;
BEGIN
  SELECT status INTO invoice_status FROM tenant.accounting_customer_invoices WHERE id = OLD.customer_invoice_id;
  IF invoice_status IN ('posted', 'partially_paid', 'paid', 'overdue', 'disputed', 'reversed', 'cancelled') THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'A posted invoice cannot be changed; use a credit note or a reversal';
    END IF;
    IF TG_TABLE_NAME = 'sales_invoices' THEN
      IF (to_jsonb(OLD) - ARRAY['sent_at', 'sent_by', 'sent_to', 'sent_channel', 'reversed_at', 'reversed_by', 'reversal_reason', 'reversal_journal_entry_id', 'updated_at'])
         IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['sent_at', 'sent_by', 'sent_to', 'sent_channel', 'reversed_at', 'reversed_by', 'reversal_reason', 'reversal_journal_entry_id', 'updated_at']) THEN
        RAISE EXCEPTION 'A posted invoice cannot be changed; use a credit note or a reversal';
      END IF;
    ELSE
      RAISE EXCEPTION 'A posted invoice cannot be changed; use a credit note or a reversal';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE OR REPLACE TRIGGER sales_invoices_posted_guard BEFORE UPDATE OR DELETE ON tenant.sales_invoices FOR EACH ROW EXECUTE FUNCTION tenant.sales_invoice_posted_guard();
CREATE OR REPLACE TRIGGER sales_invoice_lines_posted_guard BEFORE UPDATE OR DELETE ON tenant.sales_invoice_lines FOR EACH ROW EXECUTE FUNCTION tenant.sales_invoice_posted_guard();
CREATE OR REPLACE TRIGGER sales_invoice_line_taxes_posted_guard BEFORE UPDATE OR DELETE ON tenant.sales_invoice_line_taxes FOR EACH ROW EXECUTE FUNCTION tenant.sales_invoice_posted_guard();

-- Invoices already made from sales orders: their Sales record from the order version they billed.
INSERT INTO tenant.sales_invoices (customer_invoice_id, organization_id, sales_order_id, sales_order_version_id, quantity_basis, customer_snapshot, contact_id, contact_snapshot,
    shipping_address_snapshot, seller_registration_id, seller_snapshot, place_of_supply_name, supply_nature, customer_po_number, owner_user_id, customer_notes, created_by, created_at)
SELECT invoice.id, invoice.organization_id, invoice.source_sales_order_id, version.id,
       CASE WHEN request.quantity_basis = 'fulfilled' THEN 'delivered' ELSE 'ordered' END,
       COALESCE(version.customer_snapshot, invoice.customer_snapshot, '{}'::jsonb), sales_order.contact_id, COALESCE(version.contact_snapshot, '{}'::jsonb),
       COALESCE(version.shipping_address_snapshot, '{}'::jsonb), version.seller_registration_id, COALESCE(version.seller_snapshot, '{}'::jsonb), version.place_of_supply_name,
       version.supply_nature, version.customer_po_number, sales_order.owner_user_id, version.customer_notes, invoice.created_by, invoice.created_at
  FROM tenant.accounting_customer_invoices invoice
  JOIN tenant.sales_orders sales_order ON sales_order.organization_id = invoice.organization_id AND sales_order.id = invoice.source_sales_order_id
  LEFT JOIN tenant.sales_invoice_requests request ON request.organization_id = invoice.organization_id AND request.id = invoice.source_sales_invoice_request_id
  LEFT JOIN tenant.sales_order_versions version ON version.organization_id = invoice.organization_id AND version.id = COALESCE(request.sales_order_version_id, sales_order.current_version_id)
 WHERE invoice.invoice_type = 'invoice' AND invoice.source_sales_order_id IS NOT NULL
ON CONFLICT (customer_invoice_id) DO NOTHING;

INSERT INTO tenant.sales_invoice_lines (customer_invoice_line_id, organization_id, customer_invoice_id, item_code_snapshot, item_name_snapshot, description_snapshot, hsn_sac_kind,
    uom_snapshot, list_unit_price, gross_amount, line_discount_amount, document_discount_amount, tax_category_id, tax_rate, tax_treatment)
SELECT line.id, line.organization_id, line.customer_invoice_id, source.item_code_snapshot, COALESCE(source.item_name_snapshot, line.description), source.description_snapshot, source.hsn_sac_kind,
       source.uom_snapshot, source.list_unit_price, round(line.quantity * line.unit_price, 2), line.discount_amount, 0, source.tax_category_id, source.tax_rate, source.tax_treatment
  FROM tenant.accounting_customer_invoice_lines line
  JOIN tenant.sales_invoices sales_invoice ON sales_invoice.customer_invoice_id = line.customer_invoice_id
  LEFT JOIN tenant.sales_order_lines source ON source.organization_id = line.organization_id AND source.id = line.source_sales_order_line_id
ON CONFLICT (customer_invoice_line_id) DO NOTHING;

INSERT INTO tenant.sales_invoice_line_taxes (organization_id, customer_invoice_id, customer_invoice_line_id, sequence, tax_type, label, rate, taxable_amount, tax_amount)
SELECT line.organization_id, line.customer_invoice_id, line.id, component.ordinality, COALESCE(component.value->>'taxType', 'other'), component.value->>'label',
       COALESCE(NULLIF(component.value->>'rate', '')::numeric, 0), COALESCE(NULLIF(component.value->>'taxableAmount', '')::numeric, line.net_amount),
       COALESCE(NULLIF(component.value->>'taxAmount', '')::numeric, 0)
  FROM tenant.accounting_customer_invoice_lines line
  JOIN tenant.sales_invoices sales_invoice ON sales_invoice.customer_invoice_id = line.customer_invoice_id
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(line.tax_details) = 'array' THEN line.tax_details ELSE '[]'::jsonb END) WITH ORDINALITY AS component(value, ordinality)
 WHERE NOT EXISTS (SELECT 1 FROM tenant.sales_invoice_line_taxes existing WHERE existing.customer_invoice_line_id = line.id);

-- The setting reads "Invoice based on: Sales Order / Delivery".
UPDATE public.permissions SET name = 'Create draft invoices', description = 'Create draft sales invoices from confirmed sales orders and deliveries.' WHERE key = 'sales.invoice.request';
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('sales.invoice.view', 'View sales invoices', 'Sales', 'Open the invoices of the sales orders the user can see, with their amounts, balance and payment status.'),
  ('sales.invoice.view_all', 'View all sales invoices', 'Sales', 'See every sales invoice, whoever owns the order.'),
  ('sales.invoice.edit', 'Edit draft invoices', 'Sales', 'Change the quantities, dates and notes of a draft invoice, or cancel it.'),
  ('sales.invoice.post', 'Post invoices', 'Sales', 'Post a sales invoice: it becomes the customer''s receivable and is entered in the books.'),
  ('sales.invoice.reverse', 'Reverse invoices', 'Sales', 'Reverse a posted invoice with no payments or credits applied.'),
  ('sales.invoice.send', 'Send invoices', 'Sales', 'Email the invoice to the customer or record that it was sent.'),
  ('sales.invoice.print', 'Print invoices', 'Sales', 'View, download and print invoice PDFs.'),
  ('sales.invoice.credit_note', 'Create credit notes', 'Sales', 'Create a draft credit note against a posted invoice.'),
  ('sales.invoice.payments.view', 'View invoice payments', 'Sales', 'See the receipts and credits applied to an invoice.'),
  ('sales.invoice.accounting.view', 'View invoice accounting', 'Sales', 'See the journal entry of a posted invoice.'),
  ('sales.invoice.change_posting_date', 'Change posting date', 'Sales', 'Post an invoice on an accounting date other than its invoice date, or change its due date.')
ON CONFLICT (key) DO NOTHING;

-- Whoever sees orders sees their invoices, their payments and prints them; Finance sees every invoice.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['sales.invoice.view', 'sales.invoice.print', 'sales.invoice.payments.view'])
 WHERE existing.permission_key IN ('sales.order.view', 'accounting.view')
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'sales.invoice.view_all' FROM public.role_permissions existing WHERE existing.permission_key IN ('sales.order.view_all', 'accounting.view')
ON CONFLICT DO NOTHING;
-- Whoever creates invoices edits and sends them.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['sales.invoice.edit', 'sales.invoice.send'])
 WHERE existing.permission_key IN ('sales.invoice.request', 'accounting.receivables.manage')
ON CONFLICT DO NOTHING;
-- Posting makes the receivable: sales managers and Finance. Reversal, credit notes and posting dates are Finance's.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'sales.invoice.post' FROM public.role_permissions existing WHERE existing.permission_key IN ('sales.order.confirm', 'accounting.receivables.manage')
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['sales.invoice.reverse', 'sales.invoice.credit_note', 'sales.invoice.change_posting_date'])
 WHERE existing.permission_key = 'accounting.receivables.manage'
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'sales.invoice.accounting.view' FROM public.role_permissions existing WHERE existing.permission_key = 'accounting.view'
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0036_sales_invoices.sql', 'sales-invoices');
