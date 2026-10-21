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
