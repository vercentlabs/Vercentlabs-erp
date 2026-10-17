-- Projects — Invoice From Billable Time. Approved, contract-authorized minutes (0134 timesheets, 0135 billing requests) become a Sales Invoice
-- Draft through the existing Sales invoice engine — its numbering, tax and posting stay Sales' and Finance's. This adds what that handoff
-- needs to stay traceable and safe:
--
--   1. the draft link    the Sales Invoice Draft (and its line) a billing request was turned into, the order it bills, the billing period
--                        and the key that created it — so a retry never creates a second invoice. A posted draft makes the request
--                        invoiced; a cancelled draft releases its minutes; both are read back from Sales.
--   2. adjustments       what happened to invoiced minutes when the invoice was reversed or credited: the document, the minutes, and the
--                        authorized disposition — rebillable (the minutes become available again) or not (a price concession, the
--                        minutes stay consumed). A credit note never restores minutes by itself. Append-only.

-- ============================================================ 1. the draft link
ALTER TABLE tenant.project_time_billing_requests ADD COLUMN IF NOT EXISTS sales_order_id uuid REFERENCES tenant.sales_orders(id);
ALTER TABLE tenant.project_time_billing_requests ADD COLUMN IF NOT EXISTS billing_period_start date;
ALTER TABLE tenant.project_time_billing_requests ADD COLUMN IF NOT EXISTS billing_period_end date;
ALTER TABLE tenant.project_time_billing_requests ADD COLUMN IF NOT EXISTS draft_invoice_id uuid REFERENCES tenant.accounting_customer_invoices(id);
-- No foreign key: Sales rewrites a draft's lines when it posts; the line is found again by the order line it bills.
ALTER TABLE tenant.project_time_billing_requests ADD COLUMN IF NOT EXISTS draft_invoice_line_id uuid;
ALTER TABLE tenant.project_time_billing_requests ADD COLUMN IF NOT EXISTS draft_created_by uuid REFERENCES public.users(id);
ALTER TABLE tenant.project_time_billing_requests ADD COLUMN IF NOT EXISTS draft_created_at timestamptz;
ALTER TABLE tenant.project_time_billing_requests ADD COLUMN IF NOT EXISTS draft_key text;
CREATE INDEX IF NOT EXISTS project_time_billing_requests_draft_idx ON tenant.project_time_billing_requests (organization_id, draft_invoice_id) WHERE draft_invoice_id IS NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_time_billing_requests_period_check') THEN
    ALTER TABLE tenant.project_time_billing_requests ADD CONSTRAINT project_time_billing_requests_period_check
      CHECK (billing_period_start IS NULL OR billing_period_end IS NULL OR billing_period_end >= billing_period_start);
  END IF;
END $$;
-- The order each existing request bills (its contract line's order).
UPDATE tenant.project_time_billing_requests request SET sales_order_id = line.sales_order_id
  FROM tenant.project_time_contract_lines line WHERE line.id = request.contract_line_id AND request.sales_order_id IS NULL;

-- ============================================================ 2. adjustments
CREATE TABLE IF NOT EXISTS tenant.project_time_billing_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  billing_request_id uuid NOT NULL REFERENCES tenant.project_time_billing_requests(id),
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  document_kind text NOT NULL CHECK (document_kind IN ('CREDIT_NOTE', 'INVOICE_REVERSED', 'INVOICE_CANCELLED')),
  document_id uuid NOT NULL REFERENCES tenant.accounting_customer_invoices(id),
  document_number text,
  minutes integer NOT NULL CHECK (minutes > 0),
  disposition text NOT NULL CHECK (disposition IN ('REBILLABLE', 'NOT_REBILLABLE')),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  decided_by uuid REFERENCES public.users(id),
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (billing_request_id, document_id)
);
CREATE INDEX IF NOT EXISTS project_time_billing_adjustments_project_idx ON tenant.project_time_billing_adjustments (organization_id, project_id, decided_at);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_time_billing_adjustments_append_only') THEN
    CREATE TRIGGER project_time_billing_adjustments_append_only BEFORE UPDATE OR DELETE ON tenant.project_time_billing_adjustments FOR EACH ROW EXECUTE FUNCTION tenant.projects_append_only();
  END IF;
END $$;
ALTER TABLE tenant.project_time_billing_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.project_time_billing_adjustments FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'project_time_billing_adjustments' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.project_time_billing_adjustments USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT ON tenant.project_time_billing_adjustments TO vercent_app;
GRANT SELECT ON tenant.project_time_billing_adjustments TO vercent_worker;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0139_projects_time_invoicing.sql', 'projects-time-invoicing') ON CONFLICT DO NOTHING;
