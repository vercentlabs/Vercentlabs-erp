-- Credit Notes.
--
-- A credit note reduces what a customer owes on a posted sales invoice: for
-- goods returned (by quantity, at the invoice's own price, discounts and tax)
-- or for a commercial correction (an amount, taxed at the invoice line's own
-- rates). It is Finance's customer credit note (tenant.accounting_customer_
-- invoices, invoice_type 'credit_note'); Sales keeps beside it the source
-- invoice and return, the reason, the customer and seller as credited, each
-- line's source invoice line, type and product details, the tax components,
-- the notes and whether it was sent. Posting applies it to the source
-- invoice; what is left is the customer's credit. Once posted it is fixed:
-- only its sending and its reversal are recorded afterwards.
--
-- 1. tenant.sales_credit_notes, tenant.sales_credit_note_lines, tenant.sales_credit_note_line_taxes,
--    tenant.sales_credit_note_sends, tenant.sales_credit_note_events.
-- 2. Posted credit notes are fixed.
-- 3. Credit notes Sales already made get their Sales record.
-- 4. Permissions. sales.invoice.credit_note becomes sales.credit_note.create.
-- 5. The earlier credit and refund requests (tenant.sales_credit_adjustment_requests) are no longer written.

CREATE TABLE IF NOT EXISTS tenant.sales_credit_notes (
  customer_invoice_id uuid PRIMARY KEY REFERENCES tenant.accounting_customer_invoices(id),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  source_invoice_id uuid NOT NULL REFERENCES tenant.accounting_customer_invoices(id),
  sales_order_id uuid NOT NULL REFERENCES tenant.sales_orders(id),
  sales_return_id uuid REFERENCES tenant.sales_returns(id),
  idempotency_key text,
  reason_code text NOT NULL CHECK (reason_code IN ('sales_return', 'damaged_goods', 'billing_error', 'price_adjustment', 'post_sale_discount', 'short_supply', 'tax_correction',
    'order_cancellation', 'service_adjustment', 'other')),
  reason_note text,
  customer_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  contact_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  seller_registration_id uuid,
  seller_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  place_of_supply_name text,
  supply_nature text,
  customer_po_number text,
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
CREATE UNIQUE INDEX IF NOT EXISTS sales_credit_notes_key_idx ON tenant.sales_credit_notes (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_credit_notes_source_idx ON tenant.sales_credit_notes (organization_id, source_invoice_id);
CREATE INDEX IF NOT EXISTS sales_credit_notes_return_idx ON tenant.sales_credit_notes (organization_id, sales_return_id) WHERE sales_return_id IS NOT NULL;
ALTER TABLE tenant.sales_credit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_credit_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.sales_credit_notes
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, UPDATE ON tenant.sales_credit_notes TO vercent_app;
GRANT SELECT ON tenant.sales_credit_notes TO vercent_worker;

CREATE TABLE IF NOT EXISTS tenant.sales_credit_note_lines (
  customer_invoice_line_id uuid PRIMARY KEY REFERENCES tenant.accounting_customer_invoice_lines(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  customer_invoice_id uuid NOT NULL REFERENCES tenant.accounting_customer_invoices(id),
  source_invoice_line_id uuid NOT NULL REFERENCES tenant.accounting_customer_invoice_lines(id),
  sales_return_line_id uuid REFERENCES tenant.sales_return_lines(id),
  credit_type text NOT NULL CHECK (credit_type IN ('quantity', 'amount')),
  item_code_snapshot text,
  item_name_snapshot text NOT NULL,
  description_snapshot text,
  hsn_sac_kind text,
  uom_snapshot text,
  gross_amount numeric(20,6) NOT NULL DEFAULT 0,
  line_discount_amount numeric(20,6) NOT NULL DEFAULT 0,
  document_discount_amount numeric(20,6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_credit_note_lines_note_idx ON tenant.sales_credit_note_lines (organization_id, customer_invoice_id);
CREATE INDEX IF NOT EXISTS sales_credit_note_lines_source_idx ON tenant.sales_credit_note_lines (organization_id, source_invoice_line_id);
ALTER TABLE tenant.sales_credit_note_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_credit_note_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.sales_credit_note_lines
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, DELETE ON tenant.sales_credit_note_lines TO vercent_app;
GRANT SELECT ON tenant.sales_credit_note_lines TO vercent_worker;

CREATE TABLE IF NOT EXISTS tenant.sales_credit_note_line_taxes (
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
CREATE INDEX IF NOT EXISTS sales_credit_note_line_taxes_note_idx ON tenant.sales_credit_note_line_taxes (organization_id, customer_invoice_id);
ALTER TABLE tenant.sales_credit_note_line_taxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_credit_note_line_taxes FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.sales_credit_note_line_taxes
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, DELETE ON tenant.sales_credit_note_line_taxes TO vercent_app;
GRANT SELECT ON tenant.sales_credit_note_line_taxes TO vercent_worker;

CREATE TABLE IF NOT EXISTS tenant.sales_credit_note_sends (
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
CREATE UNIQUE INDEX IF NOT EXISTS sales_credit_note_sends_key_idx ON tenant.sales_credit_note_sends (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE tenant.sales_credit_note_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_credit_note_sends FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.sales_credit_note_sends
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT ON tenant.sales_credit_note_sends TO vercent_app;
GRANT SELECT ON tenant.sales_credit_note_sends TO vercent_worker;

CREATE TABLE IF NOT EXISTS tenant.sales_credit_note_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  customer_invoice_id uuid NOT NULL REFERENCES tenant.accounting_customer_invoices(id),
  event_type text NOT NULL,
  from_status text,
  to_status text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS sales_credit_note_events_note_idx ON tenant.sales_credit_note_events (organization_id, customer_invoice_id, occurred_at);
ALTER TABLE tenant.sales_credit_note_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_credit_note_events FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.sales_credit_note_events
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT ON tenant.sales_credit_note_events TO vercent_app;
GRANT SELECT ON tenant.sales_credit_note_events TO vercent_worker;

-- A posted credit note's Sales record is history: only its sending and its reversal are recorded afterwards.
CREATE OR REPLACE FUNCTION tenant.sales_credit_note_posted_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE note_status text;
BEGIN
  SELECT status INTO note_status FROM tenant.accounting_customer_invoices WHERE id = OLD.customer_invoice_id;
  IF note_status IN ('posted', 'partially_paid', 'paid', 'overdue', 'disputed', 'reversed', 'cancelled') THEN
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'sales_credit_notes'
       AND (to_jsonb(OLD) - ARRAY['sent_at', 'sent_by', 'sent_to', 'sent_channel', 'reversed_at', 'reversed_by', 'reversal_reason', 'reversal_journal_entry_id', 'updated_at'])
           IS NOT DISTINCT FROM (to_jsonb(NEW) - ARRAY['sent_at', 'sent_by', 'sent_to', 'sent_channel', 'reversed_at', 'reversed_by', 'reversal_reason', 'reversal_journal_entry_id', 'updated_at']) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'A posted credit note cannot be changed; reverse it';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE OR REPLACE TRIGGER sales_credit_notes_posted_guard BEFORE UPDATE OR DELETE ON tenant.sales_credit_notes FOR EACH ROW EXECUTE FUNCTION tenant.sales_credit_note_posted_guard();
CREATE OR REPLACE TRIGGER sales_credit_note_lines_posted_guard BEFORE UPDATE OR DELETE ON tenant.sales_credit_note_lines FOR EACH ROW EXECUTE FUNCTION tenant.sales_credit_note_posted_guard();
CREATE OR REPLACE TRIGGER sales_credit_note_line_taxes_posted_guard BEFORE UPDATE OR DELETE ON tenant.sales_credit_note_line_taxes FOR EACH ROW EXECUTE FUNCTION tenant.sales_credit_note_posted_guard();

-- Credit notes Sales already made against its invoices: their Sales record, by quantity, from the lines they credit.
INSERT INTO tenant.sales_credit_notes (customer_invoice_id, organization_id, source_invoice_id, sales_order_id, sales_return_id, reason_code, reason_note, customer_snapshot,
    contact_snapshot, seller_registration_id, seller_snapshot, place_of_supply_name, supply_nature, customer_po_number, created_by, created_at)
SELECT credit.id, credit.organization_id, credit.source_invoice_id, source.sales_order_id,
       (SELECT returned.sales_return_id FROM tenant.sales_return_credits returned WHERE returned.credit_note_id = credit.id LIMIT 1),
       CASE WHEN EXISTS (SELECT 1 FROM tenant.sales_return_credits returned WHERE returned.credit_note_id = credit.id) THEN 'sales_return' ELSE 'other' END,
       COALESCE(credit.notes, 'Credit note'), source.customer_snapshot, source.contact_snapshot, source.seller_registration_id, source.seller_snapshot,
       source.place_of_supply_name, source.supply_nature, source.customer_po_number, credit.created_by, credit.created_at
  FROM tenant.accounting_customer_invoices credit
  JOIN tenant.sales_invoices source ON source.customer_invoice_id = credit.source_invoice_id
 WHERE credit.invoice_type = 'credit_note'
ON CONFLICT (customer_invoice_id) DO NOTHING;

INSERT INTO tenant.sales_credit_note_lines (customer_invoice_line_id, organization_id, customer_invoice_id, source_invoice_line_id, sales_return_line_id, credit_type,
    item_code_snapshot, item_name_snapshot, description_snapshot, hsn_sac_kind, uom_snapshot, gross_amount, line_discount_amount)
SELECT line.id, line.organization_id, line.customer_invoice_id, source_line.id,
       (SELECT returned.sales_return_line_id FROM tenant.sales_return_credits returned WHERE returned.credit_note_id = line.customer_invoice_id
          AND returned.source_invoice_id = credit.source_invoice_id LIMIT 1),
       'quantity', snapshot.item_code_snapshot, COALESCE(snapshot.item_name_snapshot, line.description), snapshot.description_snapshot, snapshot.hsn_sac_kind, snapshot.uom_snapshot,
       round(line.quantity * line.unit_price, 2), line.discount_amount
  FROM tenant.accounting_customer_invoice_lines line
  JOIN tenant.sales_credit_notes credit ON credit.customer_invoice_id = line.customer_invoice_id
  JOIN LATERAL (SELECT source_line.id FROM tenant.accounting_customer_invoice_lines source_line
                 WHERE source_line.customer_invoice_id = credit.source_invoice_id AND source_line.source_sales_order_line_id = line.source_sales_order_line_id
                 ORDER BY source_line.sequence LIMIT 1) source_line ON true
  LEFT JOIN tenant.sales_invoice_lines snapshot ON snapshot.customer_invoice_line_id = source_line.id
ON CONFLICT (customer_invoice_line_id) DO NOTHING;

INSERT INTO tenant.sales_credit_note_line_taxes (organization_id, customer_invoice_id, customer_invoice_line_id, sequence, tax_type, label, rate, taxable_amount, tax_amount)
SELECT line.organization_id, line.customer_invoice_id, line.id, component.ordinality, COALESCE(component.value->>'taxType', 'other'), component.value->>'label',
       COALESCE(NULLIF(component.value->>'rate', '')::numeric, 0), COALESCE(NULLIF(component.value->>'taxableAmount', '')::numeric, line.net_amount),
       COALESCE(NULLIF(component.value->>'taxAmount', '')::numeric, 0)
  FROM tenant.accounting_customer_invoice_lines line
  JOIN tenant.sales_credit_notes credit ON credit.customer_invoice_id = line.customer_invoice_id
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(line.tax_details) = 'array' THEN line.tax_details ELSE '[]'::jsonb END) WITH ORDINALITY AS component(value, ordinality)
 WHERE NOT EXISTS (SELECT 1 FROM tenant.sales_credit_note_line_taxes existing WHERE existing.customer_invoice_line_id = line.id);

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('sales.credit_note.view', 'View credit notes', 'Sales', 'Open the credit notes of the sales orders the user can see.'),
  ('sales.credit_note.view_all', 'View all credit notes', 'Sales', 'See every credit note, whoever owns the order.'),
  ('sales.credit_note.create', 'Create draft credit notes', 'Sales', 'Create a draft credit note against a posted sales invoice, by quantity.'),
  ('sales.credit_note.amount', 'Create amount credit notes', 'Sales', 'Credit an amount (a price adjustment or post-sale discount) rather than a quantity.'),
  ('sales.credit_note.edit', 'Edit draft credit notes', 'Sales', 'Change a draft credit note''s lines, dates, reason and notes, or cancel it.'),
  ('sales.credit_note.post', 'Post credit notes', 'Sales', 'Post a credit note: the customer owes less and the books are adjusted.'),
  ('sales.credit_note.reverse', 'Reverse credit notes', 'Sales', 'Reverse a posted credit note posted in error.'),
  ('sales.credit_note.send', 'Send credit notes', 'Sales', 'Email the credit note to the customer or record that it was sent.'),
  ('sales.credit_note.print', 'Print credit notes', 'Sales', 'View, download and print credit note PDFs.'),
  ('sales.credit_note.application.view', 'View credit application', 'Sales', 'See which invoices a credit note was applied to and the customer credit left.'),
  ('sales.credit_note.accounting.view', 'View credit note accounting', 'Sales', 'See the journal entry of a posted credit note.')
ON CONFLICT (key) DO NOTHING;

-- Whoever sees invoices sees and prints their credit notes and how they were applied.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['sales.credit_note.view', 'sales.credit_note.print', 'sales.credit_note.application.view'])
 WHERE existing.permission_key = 'sales.invoice.view'
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'sales.credit_note.view_all' FROM public.role_permissions existing WHERE existing.permission_key = 'sales.invoice.view_all'
ON CONFLICT DO NOTHING;
-- Sales managers and Finance prepare (by quantity, also from received returns), edit and send them.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['sales.credit_note.create', 'sales.credit_note.edit', 'sales.credit_note.send', 'sales.return.credit_note'])
 WHERE existing.permission_key IN ('sales.invoice.credit_note', 'sales.order.confirm', 'accounting.receivables.manage')
ON CONFLICT DO NOTHING;
-- Amount credits, posting and reversal change what the customer owes: Finance.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['sales.credit_note.amount', 'sales.credit_note.post', 'sales.credit_note.reverse'])
 WHERE existing.permission_key = 'accounting.receivables.manage'
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'sales.credit_note.accounting.view' FROM public.role_permissions existing WHERE existing.permission_key = 'accounting.view'
ON CONFLICT DO NOTHING;
-- The earlier permission is replaced by sales.credit_note.create.
DELETE FROM public.role_permissions WHERE permission_key = 'sales.invoice.credit_note';
DELETE FROM public.permissions WHERE key = 'sales.invoice.credit_note';

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0038_sales_credit_notes.sql', 'sales-credit-notes');
