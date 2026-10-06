-- Payment Terms.
--
-- A payment term says when payment is due: Due on Receipt (the invoice
-- date), Net N days (N calendar days after the invoice date) or Custom (a
-- commercial condition in words, such as "50% advance, balance before
-- dispatch", with no automatic due date). It is a shared master
-- (tenant.payment_terms), usable for Sales now and Purchases later. A
-- document keeps the term it was agreed with as a snapshot; the master never
-- rewrites history. The due date itself belongs to each invoice: worked out
-- by the server from the invoice date and the invoice's own snapshot, or
-- entered by an authorised user with a reason.
--
-- 1. tenant.payment_terms: how the due date is worked out, and where the term can be used.
-- 2. The seeded "Immediate" becomes "Due on Receipt"; every organisation gets a "Custom / as agreed" term.
-- 3. tenant.payment_term_events: who changed what on a term.
-- 4. tenant.sales_invoices: the calculated due date beside the one in force, and why it was overridden.
-- 5. A posted invoice's due date can be corrected (by permission, with a reason); nothing else on it changes.
-- 6. Permissions.

ALTER TABLE tenant.payment_terms ADD COLUMN IF NOT EXISTS calculation_type text NOT NULL DEFAULT 'net_days'
  CHECK (calculation_type IN ('due_on_receipt', 'net_days', 'custom'));
ALTER TABLE tenant.payment_terms ADD COLUMN IF NOT EXISTS is_sales_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE tenant.payment_terms ADD COLUMN IF NOT EXISTS is_purchase_enabled boolean NOT NULL DEFAULT true;

-- Zero-day terms were "due immediately": Due on Receipt.
UPDATE tenant.payment_terms SET calculation_type = 'due_on_receipt' WHERE default_due_days = 0 AND calculation_type = 'net_days';
UPDATE tenant.payment_terms
   SET name = 'Due on Receipt', description = 'Payment is due on receipt of the invoice.'
 WHERE code = 'IMMEDIATE' AND name = 'Immediate';

INSERT INTO tenant.payment_terms (organization_id, code, name, description, default_due_days, calculation_type)
SELECT organization.id, 'CUSTOM', 'Custom / as agreed', 'Payment as mutually agreed.', 0, 'custom'
  FROM public.organizations organization
 WHERE EXISTS (SELECT 1 FROM tenant.payment_terms existing WHERE existing.organization_id = organization.id)
ON CONFLICT (organization_id, code) DO NOTHING;

CREATE TABLE IF NOT EXISTS tenant.payment_term_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  payment_term_id uuid NOT NULL REFERENCES tenant.payment_terms(id),
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS payment_term_events_term_idx ON tenant.payment_term_events (organization_id, payment_term_id, occurred_at);
ALTER TABLE tenant.payment_term_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.payment_term_events FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.payment_term_events
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT ON tenant.payment_term_events TO vercent_app;
GRANT SELECT ON tenant.payment_term_events TO vercent_worker;

-- The invoice's due date in force is Finance's (accounting_customer_invoices.due_date). Sales keeps beside it what the
-- terms worked out (empty when the terms set no date) and, when someone set another date, that it was overridden and why.
ALTER TABLE tenant.sales_invoices ADD COLUMN IF NOT EXISTS calculated_due_date date;
ALTER TABLE tenant.sales_invoices ADD COLUMN IF NOT EXISTS due_date_overridden boolean NOT NULL DEFAULT false;
ALTER TABLE tenant.sales_invoices ADD COLUMN IF NOT EXISTS due_date_override_reason text;

-- A posted invoice's Sales record stays fixed, except its sending, its reversal and a due-date correction.
CREATE OR REPLACE FUNCTION tenant.sales_invoice_posted_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  invoice_status text;
  open_columns text[] := ARRAY['sent_at', 'sent_by', 'sent_to', 'sent_channel', 'reversed_at', 'reversed_by', 'reversal_reason', 'reversal_journal_entry_id',
    'calculated_due_date', 'due_date_overridden', 'due_date_override_reason', 'updated_at'];
BEGIN
  SELECT status INTO invoice_status FROM tenant.accounting_customer_invoices WHERE id = OLD.customer_invoice_id;
  IF invoice_status IN ('posted', 'partially_paid', 'paid', 'overdue', 'disputed', 'reversed', 'cancelled') THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'A posted invoice cannot be changed; use a credit note or a reversal';
    END IF;
    IF TG_TABLE_NAME = 'sales_invoices' THEN
      IF (to_jsonb(OLD) - open_columns) IS DISTINCT FROM (to_jsonb(NEW) - open_columns) THEN
        RAISE EXCEPTION 'A posted invoice cannot be changed; use a credit note or a reversal';
      END IF;
    ELSE
      RAISE EXCEPTION 'A posted invoice cannot be changed; use a credit note or a reversal';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Finance's posted documents stay fixed, except what settlement changes and a due-date correction (made only through
-- the application, by permission and with a reason kept in the document's history).
CREATE OR REPLACE FUNCTION tenant.accounting_protect_posted_subledger_document() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  old_payload jsonb;
  new_payload jsonb;
  open_columns text[] := ARRAY['status', 'outstanding_amount', 'e_invoice_status', 'e_invoice_reference', 'due_date', 'updated_by', 'updated_at'];
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status IN ('posted', 'partially_paid', 'paid', 'overdue', 'disputed', 'reversed') THEN
    RAISE EXCEPTION 'Posted subledger documents cannot be deleted; create a credit note or reversal';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('posted', 'partially_paid', 'paid', 'overdue', 'disputed', 'reversed') THEN
    old_payload := to_jsonb(OLD) - open_columns;
    new_payload := to_jsonb(NEW) - open_columns;
    IF old_payload IS DISTINCT FROM new_payload THEN
      RAISE EXCEPTION 'Posted subledger document commercial fields are immutable';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('payment_terms.view', 'View payment terms', 'Sales', 'See the payment terms master.'),
  ('payment_terms.manage', 'Manage payment terms', 'Sales', 'Create, edit, activate and deactivate payment terms.'),
  ('payment_terms.set_default', 'Set the default payment term', 'Sales', 'Choose the payment term new sales documents use when the customer has none.'),
  ('sales.quotation.change_payment_terms', 'Change quotation payment terms', 'Sales', 'Choose payment terms on a quotation other than the customer''s or the company default.'),
  ('sales.order.change_payment_terms', 'Change sales order payment terms', 'Sales', 'Choose payment terms on a sales order other than the ones it started with.'),
  ('sales.invoice.change_payment_terms', 'Change draft invoice payment terms', 'Sales', 'Choose other payment terms on a draft invoice; the due date is worked out again.'),
  ('sales.invoice.override_due_date', 'Override invoice due date', 'Sales', 'Set a draft invoice''s due date by hand, with a reason.'),
  ('sales.invoice.change_posted_due_date', 'Change a posted invoice''s due date', 'Sales', 'Correct the due date of a posted invoice, with a reason.')
ON CONFLICT (key) DO NOTHING;

-- Whoever works in Sales or sees the books sees the terms; whoever manages Sales settings maintains them.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'payment_terms.view' FROM public.role_permissions existing WHERE existing.permission_key IN ('sales.view', 'accounting.view')
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['payment_terms.manage', 'payment_terms.set_default'])
 WHERE existing.permission_key = 'sales.settings.manage'
ON CONFLICT DO NOTHING;
-- Whoever prepares a document may choose its terms, as before.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'sales.quotation.change_payment_terms' FROM public.role_permissions existing WHERE existing.permission_key = 'sales.quotation.create'
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'sales.order.change_payment_terms' FROM public.role_permissions existing WHERE existing.permission_key = 'sales.order.create'
ON CONFLICT DO NOTHING;
-- On an invoice, the terms and a hand-set due date are for sales managers and Finance; a posted invoice's due date for Finance.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['sales.invoice.change_payment_terms', 'sales.invoice.override_due_date'])
 WHERE existing.permission_key IN ('sales.order.confirm', 'accounting.receivables.manage')
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'sales.invoice.change_posted_due_date' FROM public.role_permissions existing WHERE existing.permission_key = 'accounting.receivables.manage'
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0040_payment_terms.sql', 'payment-terms');
