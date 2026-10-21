-- CRM & Sales line-by-line code audit (22 Oct 2026).

-- 1. Indexes the invoice list, order list, customer balances and invoicing joins look up by (P1–P3).
CREATE INDEX IF NOT EXISTS accounting_customer_receipt_allocations_invoice_idx
  ON tenant.accounting_customer_receipt_allocations (organization_id, customer_invoice_id);
CREATE INDEX IF NOT EXISTS accounting_customer_invoices_source_order_idx
  ON tenant.accounting_customer_invoices (organization_id, source_sales_order_id) WHERE source_sales_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS accounting_customer_invoices_source_invoice_idx
  ON tenant.accounting_customer_invoices (organization_id, source_invoice_id) WHERE source_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS accounting_customer_invoice_lines_source_order_line_idx
  ON tenant.accounting_customer_invoice_lines (source_sales_order_line_id) WHERE source_sales_order_line_id IS NOT NULL;

-- 2. Customers with no salesperson (X9): seen by every salesperson only when the company says so. Companies already using Sales keep
--    today's behaviour; a new company's salespeople see only their own customers until it is switched on.
ALTER TABLE tenant.sales_settings ADD COLUMN IF NOT EXISTS unassigned_customers_visible boolean NOT NULL DEFAULT false;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE filename = '0219_line_audit.sql') THEN
    UPDATE tenant.sales_settings SET unassigned_customers_visible = true;
  END IF;
END
$$;

-- 3. A delivery's transport for Part B of the e-way bill (S22): the transporter's ID (GSTIN or TRANSIN), the mode, the distance and
--    the transport document (LR, RR, airway bill or bill of lading) with its date. The e-way bill starts from them.
ALTER TABLE tenant.sales_fulfillment_requests ADD COLUMN IF NOT EXISTS transporter_id text CHECK (transporter_id IS NULL OR transporter_id ~ '^[0-9A-Z]{15}$');
ALTER TABLE tenant.sales_fulfillment_requests ADD COLUMN IF NOT EXISTS transport_mode text CHECK (transport_mode IS NULL OR transport_mode IN ('road', 'rail', 'air', 'ship'));
ALTER TABLE tenant.sales_fulfillment_requests ADD COLUMN IF NOT EXISTS distance_km integer CHECK (distance_km IS NULL OR distance_km BETWEEN 0 AND 4000);
ALTER TABLE tenant.sales_fulfillment_requests ADD COLUMN IF NOT EXISTS transport_document_number text CHECK (transport_document_number IS NULL OR char_length(transport_document_number) <= 30);
ALTER TABLE tenant.sales_fulfillment_requests ADD COLUMN IF NOT EXISTS transport_document_date date;

-- 4. A return still owing a credit note is kept on the return (P6), instead of a window query per row of the returns list. It is the
--    same rule as before: the received returns' share of what was invoiced but came back, the latest returns of an order line first,
--    is more than what credit notes that still stand credited for them. Refreshed per order whenever its returns, its lines' progress,
--    the returns' credits or those credit notes change.
ALTER TABLE tenant.sales_returns ADD COLUMN IF NOT EXISTS credit_due boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS sales_returns_credit_due_idx ON tenant.sales_returns (organization_id) WHERE credit_due;

-- A received or cancelled return stays as it was; only the credit-due flag the database keeps may change.
CREATE OR REPLACE FUNCTION tenant.sales_return_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE parent_status text;
BEGIN
  IF TG_TABLE_NAME = 'sales_returns' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'A sales return is never deleted; cancel a draft instead';
    END IF;
    IF OLD.status IN ('received', 'cancelled') AND (to_jsonb(NEW) - 'credit_due') IS DISTINCT FROM (to_jsonb(OLD) - 'credit_due') THEN
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

CREATE OR REPLACE FUNCTION tenant.sales_returns_refresh_credit_due(p_order_ids uuid[]) RETURNS void
LANGUAGE sql AS $$
  UPDATE tenant.sales_returns target SET credit_due = calc.due
    FROM (
      SELECT sales_return.id, (sales_return.status = 'received' AND EXISTS (SELECT 1 FROM (
          SELECT line.id, line.sales_return_id,
                 GREATEST(0, LEAST(line.quantity, due.quantity - (sum(line.quantity) OVER (PARTITION BY line.sales_order_line_id ORDER BY received.received_at DESC, line.id) - line.quantity))) AS invoiced
            FROM tenant.sales_return_lines line
            JOIN tenant.sales_returns received ON received.id = line.sales_return_id AND received.status = 'received'
            JOIN (SELECT progress.sales_order_line_id,
                         LEAST(progress.returned_quantity, GREATEST(0, progress.invoiced_quantity - (progress.fulfilled_quantity - progress.returned_quantity))) AS quantity
                    FROM tenant.sales_order_line_progress progress) due ON due.sales_order_line_id = line.sales_order_line_id
           WHERE received.sales_order_id = sales_return.sales_order_id) allocation
         WHERE allocation.sales_return_id = sales_return.id
           AND allocation.invoiced > COALESCE((SELECT sum(credit.quantity) FROM tenant.sales_return_credits credit
                                                JOIN tenant.accounting_customer_invoices credit_note ON credit_note.id = credit.credit_note_id AND credit_note.status NOT IN ('cancelled', 'reversed')
                                               WHERE credit.sales_return_line_id = allocation.id), 0) + 0.000001)) AS due
        FROM tenant.sales_returns sales_return
       WHERE sales_return.sales_order_id = ANY (p_order_ids)
    ) calc
   WHERE target.id = calc.id AND target.credit_due IS DISTINCT FROM calc.due;
$$;

CREATE OR REPLACE FUNCTION tenant.sales_returns_credit_due_on_return() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM tenant.sales_returns_refresh_credit_due(ARRAY[NEW.sales_order_id]);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS sales_returns_credit_due ON tenant.sales_returns;
CREATE TRIGGER sales_returns_credit_due AFTER INSERT OR UPDATE OF status ON tenant.sales_returns
  FOR EACH ROW EXECUTE FUNCTION tenant.sales_returns_credit_due_on_return();

CREATE OR REPLACE FUNCTION tenant.sales_returns_credit_due_on_progress() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM tenant.sales_returns_refresh_credit_due(ARRAY(
    SELECT DISTINCT sales_return.sales_order_id FROM changed
      JOIN tenant.sales_return_lines line ON line.sales_order_line_id = changed.sales_order_line_id
      JOIN tenant.sales_returns sales_return ON sales_return.id = line.sales_return_id));
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS sales_order_line_progress_credit_due ON tenant.sales_order_line_progress;
CREATE TRIGGER sales_order_line_progress_credit_due AFTER UPDATE ON tenant.sales_order_line_progress
  REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION tenant.sales_returns_credit_due_on_progress();

CREATE OR REPLACE FUNCTION tenant.sales_returns_credit_due_on_credit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM tenant.sales_returns_refresh_credit_due(ARRAY(SELECT sales_order_id FROM tenant.sales_returns WHERE id = COALESCE(NEW.sales_return_id, OLD.sales_return_id)));
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS sales_return_credits_credit_due ON tenant.sales_return_credits;
CREATE TRIGGER sales_return_credits_credit_due AFTER INSERT OR DELETE ON tenant.sales_return_credits
  FOR EACH ROW EXECUTE FUNCTION tenant.sales_returns_credit_due_on_credit();

CREATE OR REPLACE FUNCTION tenant.sales_returns_credit_due_on_credit_note() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM tenant.sales_returns_refresh_credit_due(ARRAY(
    SELECT DISTINCT sales_return.sales_order_id FROM tenant.sales_return_credits credit
      JOIN tenant.sales_returns sales_return ON sales_return.id = credit.sales_return_id
     WHERE credit.credit_note_id = NEW.id));
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS accounting_customer_invoices_credit_due ON tenant.accounting_customer_invoices;
CREATE TRIGGER accounting_customer_invoices_credit_due AFTER UPDATE OF status ON tenant.accounting_customer_invoices
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.invoice_type = 'credit_note')
  EXECUTE FUNCTION tenant.sales_returns_credit_due_on_credit_note();

SELECT tenant.sales_returns_refresh_credit_due(ARRAY(SELECT DISTINCT sales_order_id FROM tenant.sales_returns WHERE status = 'received'));

-- 5. Lead scoring learns from the last year's closed leads once a day (P11, C13), not on every lead saved: the learned conversion
--    rates are kept here and read by each scoring.
CREATE TABLE IF NOT EXISTS tenant.crm_lead_scoring_history (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  history jsonb NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tenant.crm_lead_scoring_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_scoring_history FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'crm_lead_scoring_history' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.crm_lead_scoring_history USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END
$$;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.crm_lead_scoring_history TO vercent_app, vercent_worker;

-- 6. Sales imports too large to run while the person waits run in the background (P5): each run, its uploaded file and the file of rows
--    it could not take. The run uses the requester's permissions as they are when it runs.
CREATE TABLE IF NOT EXISTS tenant.sales_data_jobs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity text NOT NULL CHECK (entity IN ('customers', 'customer_addresses', 'customer_contacts', 'prices')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  file_name text,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_file_id uuid REFERENCES public.attachments(id),
  output_file_id uuid REFERENCES public.attachments(id),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  job_id uuid,
  requested_by uuid NOT NULL REFERENCES public.users(id),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS sales_data_jobs_requester_idx ON tenant.sales_data_jobs (organization_id, requested_by, requested_at DESC);
ALTER TABLE tenant.sales_data_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.sales_data_jobs FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'sales_data_jobs' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.sales_data_jobs USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END
$$;
GRANT SELECT, INSERT, UPDATE ON tenant.sales_data_jobs TO vercent_app, vercent_worker;
