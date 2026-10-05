-- Order Confirmation.
--
-- 1. Confirmation snapshot: each time a sales order is confirmed, an
--    immutable record of exactly what was confirmed (header, customer,
--    addresses, lines, tax and totals as they were) with a revision number.
--    The order keeps its lines; the snapshot is the evidence of what the
--    customer was told. Reopening an order supersedes its current
--    confirmation; confirming it again makes revision 2. A snapshot is never
--    edited or deleted.
-- 2. Confirmation sends: every time the confirmation went out, by email from
--    Vercentlabs (with the exact PDF kept) or marked as sent another way.
-- 3. Customer acknowledgement, recorded on the confirmation.
-- 4. Sales settings: a customer PO and a requested delivery date can be
--    required before an order is confirmed.
-- 5. Permissions to send, mark as sent, record acknowledgement, and to confirm
--    an order that differs from its accepted quotation.

ALTER TABLE tenant.sales_orders ADD COLUMN IF NOT EXISTS confirmation_version integer NOT NULL DEFAULT 0;

ALTER TABLE tenant.sales_settings
  ADD COLUMN IF NOT EXISTS require_customer_po boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS require_requested_delivery_date boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS tenant.sales_order_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sales_order_id uuid NOT NULL REFERENCES tenant.sales_orders(id) ON DELETE CASCADE,
  sales_order_version_id uuid NOT NULL REFERENCES tenant.sales_order_versions(id),
  version integer NOT NULL CHECK (version > 0),
  order_number text NOT NULL,
  -- { order, lines, taxLines, company }: what was confirmed, never internal notes, cost or margin.
  snapshot jsonb NOT NULL,
  -- How the order differed from its accepted quotation when confirmed, and why that was accepted.
  quotation_variance jsonb,
  variance_reason text,
  confirmed_by uuid,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  -- The latest send (every send is in sales_order_confirmation_sends).
  sent_at timestamptz,
  sent_by uuid,
  sent_to text,
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  acknowledgement_reference text,
  acknowledgement_note text,
  superseded_at timestamptz,
  superseded_by uuid,
  superseded_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, sales_order_id, version)
);
-- One current confirmation per order.
CREATE UNIQUE INDEX IF NOT EXISTS sales_order_confirmations_current_idx
  ON tenant.sales_order_confirmations (organization_id, sales_order_id) WHERE superseded_at IS NULL;
ALTER TABLE tenant.sales_order_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_order_confirmations FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.sales_order_confirmations
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, UPDATE ON tenant.sales_order_confirmations TO vercent_app;
GRANT SELECT ON tenant.sales_order_confirmations TO vercent_worker;

-- What was confirmed never changes: only sending, acknowledgement and superseding are recorded later.
CREATE OR REPLACE FUNCTION tenant.sales_order_confirmation_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'An order confirmation is never deleted.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.version IS DISTINCT FROM OLD.version OR NEW.sales_order_id IS DISTINCT FROM OLD.sales_order_id
     OR NEW.sales_order_version_id IS DISTINCT FROM OLD.sales_order_version_id OR NEW.order_number IS DISTINCT FROM OLD.order_number
     OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by
     OR NEW.quotation_variance IS DISTINCT FROM OLD.quotation_variance OR NEW.variance_reason IS DISTINCT FROM OLD.variance_reason
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR (OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at) THEN
    RAISE EXCEPTION 'What an order confirmation says cannot be changed.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sales_order_confirmation_immutable
  BEFORE UPDATE OR DELETE ON tenant.sales_order_confirmations
  FOR EACH ROW EXECUTE FUNCTION tenant.sales_order_confirmation_immutable();

CREATE TABLE IF NOT EXISTS tenant.sales_order_confirmation_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  confirmation_id uuid NOT NULL REFERENCES tenant.sales_order_confirmations(id) ON DELETE CASCADE,
  sales_order_id uuid NOT NULL REFERENCES tenant.sales_orders(id) ON DELETE CASCADE,
  -- email: sent from Vercentlabs. Otherwise sent another way and marked as sent.
  channel text NOT NULL CHECK (channel IN ('email', 'external_email', 'whatsapp', 'printed', 'other')),
  recipients text,
  subject text,
  note text,
  message_id text,
  -- The exact PDF that was emailed.
  pdf_file_id uuid,
  idempotency_key text,
  sent_by uuid,
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_order_confirmation_sends_key_idx
  ON tenant.sales_order_confirmation_sends (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_order_confirmation_sends_confirmation_idx ON tenant.sales_order_confirmation_sends (organization_id, confirmation_id);
ALTER TABLE tenant.sales_order_confirmation_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_order_confirmation_sends FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.sales_order_confirmation_sends
  USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT ON tenant.sales_order_confirmation_sends TO vercent_app;
GRANT SELECT ON tenant.sales_order_confirmation_sends TO vercent_worker;

-- Orders confirmed before this migration get revision 1, built from the
-- version they were confirmed with (the same shape the application writes).
INSERT INTO tenant.sales_order_confirmations (organization_id, sales_order_id, sales_order_version_id, version, order_number, snapshot, confirmed_by, confirmed_at, sent_at, sent_by, sent_to)
SELECT sales_order.organization_id, sales_order.id, version.id, 1, sales_order.sales_order_number,
       jsonb_build_object(
         'order', (to_jsonb(version) - ARRAY['internal_notes', 'cost_total', 'margin_amount', 'margin_percent', 'pricing_trace', 'tax_trace', 'content_hash'])
           || jsonb_build_object(
             'sales_order_number', sales_order.sales_order_number, 'order_date', sales_order.order_date, 'requested_delivery_date', sales_order.requested_delivery_date,
             'owner_name', owner.full_name, 'source_quotation_number', quotation.quotation_number, 'confirmed_at', sales_order.confirmed_at,
             'confirmed_by_name', confirmer.full_name, 'currency_code', btrim(version.currency_code)),
         'lines', COALESCE((SELECT jsonb_agg(to_jsonb(line) - ARRAY['standard_cost', 'cost_amount', 'margin_amount', 'margin_percent', 'pricing_trace', 'tax_trace'] ORDER BY line.sequence)
                     FROM tenant.sales_order_lines line WHERE line.organization_id = version.organization_id AND line.sales_order_version_id = version.id), '[]'::jsonb),
         'taxLines', COALESCE((SELECT jsonb_agg(jsonb_build_object('tax_type', tax.tax_type, 'label', tax.label, 'rate', tax.rate, 'taxable_amount', tax.taxable_amount, 'tax_amount', tax.tax_amount)
                                          ORDER BY tax.tax_type, tax.rate)
                        FROM (SELECT tax_type, label, rate, sum(taxable_amount) AS taxable_amount, sum(tax_amount) AS tax_amount FROM tenant.sales_order_tax_lines
                               WHERE organization_id = version.organization_id AND sales_order_version_id = version.id GROUP BY tax_type, label, rate) tax), '[]'::jsonb),
         'company', jsonb_build_object('name', COALESCE(NULLIF(organization.legal_name, ''), organization.name), 'tradingName', organization.name, 'taxId', organization.tax_id)),
       sales_order.confirmed_by, sales_order.confirmed_at, sales_order.confirmation_sent_at, sales_order.confirmation_sent_by, sales_order.confirmation_sent_to
  FROM tenant.sales_orders sales_order
  JOIN tenant.sales_order_versions version ON version.organization_id = sales_order.organization_id AND version.id = sales_order.current_version_id
  JOIN public.organizations organization ON organization.id = sales_order.organization_id
  LEFT JOIN tenant.sales_quotations quotation ON quotation.organization_id = sales_order.organization_id AND quotation.id = sales_order.source_quotation_id
  LEFT JOIN public.users owner ON owner.id = sales_order.owner_user_id
  LEFT JOIN public.users confirmer ON confirmer.id = sales_order.confirmed_by
 WHERE sales_order.confirmed_at IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM tenant.sales_order_confirmations existing WHERE existing.organization_id = sales_order.organization_id AND existing.sales_order_id = sales_order.id);

INSERT INTO tenant.sales_order_confirmation_sends (organization_id, confirmation_id, sales_order_id, channel, recipients, sent_by, sent_at)
SELECT confirmation.organization_id, confirmation.id, confirmation.sales_order_id, 'email', confirmation.sent_to, confirmation.sent_by, confirmation.sent_at
  FROM tenant.sales_order_confirmations confirmation
 WHERE confirmation.sent_at IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM tenant.sales_order_confirmation_sends send WHERE send.confirmation_id = confirmation.id);

UPDATE tenant.sales_orders sales_order SET confirmation_version = confirmation.version
  FROM tenant.sales_order_confirmations confirmation
 WHERE confirmation.organization_id = sales_order.organization_id AND confirmation.sales_order_id = sales_order.id AND sales_order.confirmation_version = 0;

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('sales.order.confirmation.send', 'Send order confirmations', 'Sales', 'Email the order confirmation to the customer.'),
  ('sales.order.confirmation.mark_sent', 'Mark order confirmations as sent', 'Sales', 'Record that the order confirmation was sent outside Vercentlabs.'),
  ('sales.order.confirmation.acknowledge', 'Record customer acknowledgement', 'Sales', 'Record that the customer acknowledged the order confirmation.'),
  ('sales.order.confirm_quote_variance', 'Confirm orders that differ from the quotation', 'Sales', 'Confirm a sales order whose quantities or total differ from its accepted quotation, with a reason.')
ON CONFLICT (key) DO NOTHING;

-- Whoever creates or confirms orders sends their confirmations and records the customer's answer.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key
  FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['sales.order.confirmation.send', 'sales.order.confirmation.mark_sent', 'sales.order.confirmation.acknowledge'])
 WHERE existing.permission_key IN ('sales.order.create', 'sales.order.confirm')
ON CONFLICT DO NOTHING;

-- Whoever may reopen a confirmed order may also confirm one that departs from its quotation.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, 'sales.order.confirm_quote_variance'
  FROM public.role_permissions existing
 WHERE existing.permission_key = 'sales.order.reopen'
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0030_sales_order_confirmations.sql', 'sales-order-confirmations');
