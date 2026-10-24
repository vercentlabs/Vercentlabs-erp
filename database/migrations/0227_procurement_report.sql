-- Procurement report, Phase 1.

-- Supplier categories come from the managed list in Procurement Setup (tenant.procurement_categories), so a supplier's category is no
-- longer one of eight fixed codes. The app checks it against the list; the database only asks that there is one.
ALTER TABLE tenant.procurement_suppliers DROP CONSTRAINT IF EXISTS procurement_suppliers_category_check;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'procurement_suppliers_category_present_check') THEN
    ALTER TABLE tenant.procurement_suppliers ADD CONSTRAINT procurement_suppliers_category_present_check CHECK (length(btrim(category)) > 0);
  END IF;
END $$;

-- A cancelled bill takes its landed costs off the goods again; the cost records when.
ALTER TABLE tenant.procurement_bill_landed_costs ADD COLUMN IF NOT EXISTS reversed_at timestamptz;

-- An indent line keeps its unit's conversion to the base unit, so what was ordered (in any unit) is compared in base units.
ALTER TABLE tenant.purchase_indent_lines ADD COLUMN IF NOT EXISTS conversion_factor numeric(20,9) NOT NULL DEFAULT 1;
UPDATE tenant.purchase_indent_lines line SET conversion_factor = conversion.conversion_factor
  FROM tenant.items item, tenant.item_uom_conversions conversion
 WHERE item.organization_id = line.organization_id AND item.id = line.item_id AND line.uom_id IS NOT NULL AND line.uom_id <> item.uom_id
   AND conversion.organization_id = line.organization_id AND conversion.item_id = line.item_id AND conversion.from_uom_id = line.uom_id AND conversion.to_uom_id = item.uom_id
   AND conversion.status = 'active' AND line.conversion_factor = 1;

-- Rate contracts: a cancellation gives its reason, and every step (recorded, changed, sent for approval, approved, activated, cancelled)
-- is kept in the contract's history. Activating follows the approval rules for rate contracts.
ALTER TABLE tenant.purchase_rate_contracts ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE tenant.purchase_rate_contracts ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE tenant.purchase_rate_contracts ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS tenant.purchase_rate_contract_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL,
  event_type text NOT NULL,
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, contract_id) REFERENCES tenant.purchase_rate_contracts(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS purchase_rate_contract_events_contract_idx ON tenant.purchase_rate_contract_events (organization_id, contract_id, created_at);
ALTER TABLE tenant.purchase_rate_contract_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.purchase_rate_contract_events FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'purchase_rate_contract_events' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.purchase_rate_contract_events USING (organization_id = tenant.current_organization_id())
      WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT ON tenant.purchase_rate_contract_events TO vercent_app;
GRANT SELECT ON tenant.purchase_rate_contract_events TO vercent_worker;

-- Supplier Rates (report H1): the supplier price list gets the supplier's own item code, the lead time, a note, and the preferred flag
-- (one preferred supplier per item). The rows price new order lines after a rate contract and tell reorder whom to buy from.
ALTER TABLE tenant.procurement_supplier_prices ADD COLUMN IF NOT EXISTS supplier_item_code text;
ALTER TABLE tenant.procurement_supplier_prices ADD COLUMN IF NOT EXISTS lead_time_days integer CHECK (lead_time_days IS NULL OR lead_time_days BETWEEN 0 AND 3650);
ALTER TABLE tenant.procurement_supplier_prices ADD COLUMN IF NOT EXISTS is_preferred boolean NOT NULL DEFAULT false;
ALTER TABLE tenant.procurement_supplier_prices ADD COLUMN IF NOT EXISTS notes text;
CREATE UNIQUE INDEX IF NOT EXISTS procurement_supplier_prices_preferred_uidx ON tenant.procurement_supplier_prices (organization_id, item_id) WHERE is_preferred AND status = 'active';
CREATE INDEX IF NOT EXISTS procurement_supplier_prices_item_idx ON tenant.procurement_supplier_prices (organization_id, item_id, status);

-- TDS on supplier advances: an advance deducts its TDS when paid (Finance books it with the payment); the order's bill then deducts only
-- the balance, recorded as the bill's advance credit and taken from the advances when the bill is finalised (given back if it is cancelled).
-- 194Q applies only above ₹10 crore turnover: a company switch, off by default.
ALTER TABLE tenant.accounting_vendor_payments ADD COLUMN IF NOT EXISTS withholding_section_id uuid REFERENCES tenant.withholding_tax_sections(id);
ALTER TABLE tenant.accounting_vendor_payments ADD COLUMN IF NOT EXISTS withholding_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (withholding_amount >= 0);
ALTER TABLE tenant.accounting_vendor_payments ADD COLUMN IF NOT EXISTS withholding_used numeric(20,6) NOT NULL DEFAULT 0 CHECK (withholding_used >= 0);
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS advance_withholding_credit numeric(20,6) NOT NULL DEFAULT 0 CHECK (advance_withholding_credit >= 0);
ALTER TABLE tenant.procurement_settings ADD COLUMN IF NOT EXISTS tds_194q_applies boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS tenant.procurement_advance_tds_uses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vendor_bill_id uuid NOT NULL REFERENCES tenant.accounting_vendor_bills(id),
  vendor_payment_id uuid NOT NULL REFERENCES tenant.accounting_vendor_payments(id),
  amount numeric(20,6) NOT NULL CHECK (amount > 0),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz
);
CREATE INDEX IF NOT EXISTS procurement_advance_tds_uses_bill_idx ON tenant.procurement_advance_tds_uses (organization_id, vendor_bill_id);
ALTER TABLE tenant.procurement_advance_tds_uses ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.procurement_advance_tds_uses FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'procurement_advance_tds_uses' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.procurement_advance_tds_uses USING (organization_id = tenant.current_organization_id())
      WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.procurement_advance_tds_uses TO vercent_app;
GRANT SELECT ON tenant.procurement_advance_tds_uses TO vercent_worker;

-- The supplier's e-invoice: a bill keeps the IRN (and its date) read from the invoice's QR; one bill per e-invoice.
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS irn text CHECK (irn IS NULL OR irn ~ '^[0-9a-f]{64}$');
ALTER TABLE tenant.accounting_vendor_bills ADD COLUMN IF NOT EXISTS irn_date date;
CREATE UNIQUE INDEX IF NOT EXISTS accounting_vendor_bills_irn_uidx ON tenant.accounting_vendor_bills (organization_id, irn)
  WHERE irn IS NOT NULL AND status NOT IN ('cancelled', 'reversed');

-- TDS deposits (challans, ITNS 281): each challan pays some of the supplier TDS waiting on the tax ledger; its items name those rows (marked
-- paid), so the quarter's 26Q and each supplier's Form 16A show the challan the TDS went under. A challan recorded by mistake is cancelled
-- (its journal reversed, its TDS waiting again).
CREATE TABLE IF NOT EXISTS tenant.accounting_tds_challans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  deposit_date date NOT NULL,
  bsr_code text NOT NULL CHECK (bsr_code ~ '^[0-9]{7}$'),
  challan_serial text NOT NULL CHECK (challan_serial ~ '^[0-9]{5}$'),
  tax_amount numeric(20,6) NOT NULL CHECK (tax_amount > 0),
  interest_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (interest_amount >= 0),
  fee_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  bank_account_id uuid,
  extra_account_id uuid,
  journal_entry_id uuid,
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'cancelled')),
  notes text,
  cancel_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS accounting_tds_challans_number_uidx ON tenant.accounting_tds_challans (organization_id, bsr_code, deposit_date, challan_serial) WHERE status = 'posted';
CREATE TABLE IF NOT EXISTS tenant.accounting_tds_challan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  challan_id uuid NOT NULL,
  tax_ledger_id uuid NOT NULL REFERENCES tenant.accounting_tax_ledger(id),
  amount numeric(20,6) NOT NULL,
  released_at timestamptz,
  FOREIGN KEY (organization_id, challan_id) REFERENCES tenant.accounting_tds_challans(organization_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS accounting_tds_challan_items_live_uidx ON tenant.accounting_tds_challan_items (organization_id, tax_ledger_id) WHERE released_at IS NULL;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['accounting_tds_challans', 'accounting_tds_challan_items'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = t AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', t);
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON tenant.%I TO vercent_app', t);
    EXECUTE format('GRANT SELECT ON tenant.%I TO vercent_worker', t);
  END LOOP;
END $$;

-- The bank payment file: its layout and the account the bank pays from (Procurement Setup), and when each payment went into a file.
ALTER TABLE tenant.procurement_settings ADD COLUMN IF NOT EXISTS bank_file_layout text NOT NULL DEFAULT 'csv_header' CHECK (bank_file_layout IN ('csv_header', 'csv_plain'));
ALTER TABLE tenant.procurement_settings ADD COLUMN IF NOT EXISTS bank_file_debit_account text CHECK (bank_file_debit_account IS NULL OR bank_file_debit_account ~ '^[0-9A-Za-z]{6,34}$');
ALTER TABLE tenant.accounting_vendor_payments ADD COLUMN IF NOT EXISTS bank_file_exported_at timestamptz;

-- Payment advice: each advice sent to a supplier (or that could not go, and why); sending it automatically is a Setup switch, on by default.
ALTER TABLE tenant.procurement_settings ADD COLUMN IF NOT EXISTS payment_advice_auto boolean NOT NULL DEFAULT true;
CREATE TABLE IF NOT EXISTS tenant.procurement_payment_advice_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vendor_payment_id uuid NOT NULL REFERENCES tenant.accounting_vendor_payments(id),
  channel text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  recipients text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('sent', 'not_sent')),
  message_id text,
  reason text,
  automatic boolean NOT NULL DEFAULT false,
  sent_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS procurement_payment_advice_sends_payment_idx ON tenant.procurement_payment_advice_sends (organization_id, vendor_payment_id, created_at);
ALTER TABLE tenant.procurement_payment_advice_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.procurement_payment_advice_sends FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'procurement_payment_advice_sends' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.procurement_payment_advice_sends USING (organization_id = tenant.current_organization_id())
      WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT ON tenant.procurement_payment_advice_sends TO vercent_app;
GRANT SELECT ON tenant.procurement_payment_advice_sends TO vercent_worker;

-- The supplier's page (report H5): a link per order, and per supplier asked on a price request; the date a supplier proposes for an
-- order; and the invoices suppliers send through it (the file, and the draft bill made from it when the order has something to bill).
ALTER TABLE tenant.procurement_share_links DROP CONSTRAINT IF EXISTS procurement_share_links_document_type_check;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'procurement_share_links_document_type_kinds_check') THEN
    ALTER TABLE tenant.procurement_share_links ADD CONSTRAINT procurement_share_links_document_type_kinds_check CHECK (document_type IN ('purchase_order', 'rfq_supplier'));
  END IF;
END $$;
ALTER TABLE tenant.purchase_orders ADD COLUMN IF NOT EXISTS supplier_proposed_date date;
ALTER TABLE tenant.purchase_orders ADD COLUMN IF NOT EXISTS supplier_proposed_note text;
CREATE TABLE IF NOT EXISTS tenant.procurement_supplier_invoice_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  purchase_order_id uuid NOT NULL REFERENCES tenant.purchase_orders(id),
  invoice_number text NOT NULL,
  invoice_date date NOT NULL,
  total numeric(20,2),
  file_id uuid,
  vendor_bill_id uuid REFERENCES tenant.accounting_vendor_bills(id),
  status text NOT NULL CHECK (status IN ('waiting', 'draft_bill', 'billed', 'rejected')),
  note text,
  sent_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS procurement_supplier_invoice_uploads_order_idx ON tenant.procurement_supplier_invoice_uploads (organization_id, purchase_order_id, created_at);
ALTER TABLE tenant.procurement_supplier_invoice_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.procurement_supplier_invoice_uploads FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'procurement_supplier_invoice_uploads' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.procurement_supplier_invoice_uploads USING (organization_id = tenant.current_organization_id())
      WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.procurement_supplier_invoice_uploads TO vercent_app;
GRANT SELECT ON tenant.procurement_supplier_invoice_uploads TO vercent_worker;

-- Receipt reminders: off (default), preview or sending; days before the expected date and after it; a log that reminds each order once
-- per kind (before, overdue). The worker runs them once a day.
ALTER TABLE tenant.procurement_settings ADD COLUMN IF NOT EXISTS receipt_reminders_mode text NOT NULL DEFAULT 'off' CHECK (receipt_reminders_mode IN ('off', 'preview', 'sending'));
ALTER TABLE tenant.procurement_settings ADD COLUMN IF NOT EXISTS receipt_reminder_days_before integer NOT NULL DEFAULT 2 CHECK (receipt_reminder_days_before BETWEEN 0 AND 30);
ALTER TABLE tenant.procurement_settings ADD COLUMN IF NOT EXISTS receipt_reminder_days_after integer NOT NULL DEFAULT 1 CHECK (receipt_reminder_days_after BETWEEN 0 AND 30);
CREATE TABLE IF NOT EXISTS tenant.procurement_receipt_reminder_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  purchase_order_id uuid NOT NULL REFERENCES tenant.purchase_orders(id),
  kind text NOT NULL CHECK (kind IN ('before', 'overdue')),
  run_on date NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'previewed', 'failed', 'skipped')),
  recipients text NOT NULL DEFAULT '',
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, purchase_order_id, kind, status)
);
ALTER TABLE tenant.procurement_receipt_reminder_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.procurement_receipt_reminder_log FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'procurement_receipt_reminder_log' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.procurement_receipt_reminder_log USING (organization_id = tenant.current_organization_id())
      WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT ON tenant.procurement_receipt_reminder_log TO vercent_app, vercent_worker;
-- The worker reads orders and suppliers and makes the supplier's link when it sends a reminder.
GRANT SELECT ON tenant.purchase_orders, tenant.purchase_order_line_status, tenant.procurement_suppliers, tenant.procurement_supplier_defaults, tenant.procurement_supplier_contacts,
  tenant.contacts, tenant.business_parties, tenant.procurement_settings TO vercent_worker;
GRANT SELECT, INSERT ON tenant.procurement_share_links TO vercent_worker;

-- Lines without an item (report Phase 3) on purchase requests, price requests, supplier quotations and rate contracts, as orders already
-- allow: a description and a unit, a service or a non-stock purchase, and (until it is ordered, optional) its expense account and tax.
ALTER TABLE tenant.purchase_indent_lines ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE tenant.purchase_rfq_lines ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE tenant.supplier_quotation_lines ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE tenant.purchase_rate_contract_lines ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE tenant.purchase_rate_contract_lines ADD COLUMN IF NOT EXISTS description text;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['purchase_indent_lines', 'purchase_rfq_lines', 'supplier_quotation_lines', 'purchase_rate_contract_lines'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ADD COLUMN IF NOT EXISTS one_off_type text CHECK (one_off_type IS NULL OR one_off_type IN (''service'', ''non_stock''))', t);
    EXECUTE format('ALTER TABLE tenant.%I ADD COLUMN IF NOT EXISTS expense_account_id uuid', t);
    EXECUTE format('ALTER TABLE tenant.%I ADD COLUMN IF NOT EXISTS one_off_no_tax boolean NOT NULL DEFAULT false', t);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_item_or_description_check') THEN
      EXECUTE format('ALTER TABLE tenant.%I ADD CONSTRAINT %I CHECK (item_id IS NOT NULL OR (length(btrim(COALESCE(description, ''''))) > 0 AND one_off_type IS NOT NULL AND uom_id IS NOT NULL))',
        t, t || '_item_or_description_check');
    END IF;
  END LOOP;
END $$;
ALTER TABLE tenant.purchase_indent_lines ADD COLUMN IF NOT EXISTS tax_category_id uuid;
ALTER TABLE tenant.purchase_rfq_lines ADD COLUMN IF NOT EXISTS tax_category_id uuid;
ALTER TABLE tenant.purchase_rate_contract_lines ADD COLUMN IF NOT EXISTS tax_category_id uuid;

-- Departments for purchase requests (report Phase 3): each with its head, who approves the department's requests first; then the approval
-- rules for purchase requests by amount. The request records the head's approval.
CREATE TABLE IF NOT EXISTS tenant.procurement_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  head_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS procurement_departments_name_uidx ON tenant.procurement_departments (organization_id, lower(name));
ALTER TABLE tenant.procurement_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.procurement_departments FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'procurement_departments' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.procurement_departments USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.procurement_departments TO vercent_app;
GRANT SELECT ON tenant.procurement_departments TO vercent_worker;
ALTER TABLE tenant.purchase_indents ADD COLUMN IF NOT EXISTS head_approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE tenant.purchase_indents ADD COLUMN IF NOT EXISTS head_approved_at timestamptz;

-- Purchase warnings (report Phase 3): a message on a supplier, shown when it is chosen; on an item, shown (warn) or stopping new purchases (block).
ALTER TABLE tenant.procurement_suppliers ADD COLUMN IF NOT EXISTS purchase_warning text;
ALTER TABLE tenant.items ADD COLUMN IF NOT EXISTS purchase_warning text;
ALTER TABLE tenant.items ADD COLUMN IF NOT EXISTS purchase_warning_level text NOT NULL DEFAULT 'none';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_purchase_warning_level_check') THEN
    ALTER TABLE tenant.items ADD CONSTRAINT items_purchase_warning_level_check CHECK (purchase_warning_level IN ('none', 'warn', 'block'));
  END IF;
END $$;

-- Incoterms on an order (report Phase 3): who pays freight and insurance and where the risk passes (Incoterms 2020), with the named
-- place; and a cost centre on each order line, carried to the bill line.
ALTER TABLE tenant.purchase_orders ADD COLUMN IF NOT EXISTS incoterm text CHECK (incoterm IS NULL OR incoterm IN ('EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'));
ALTER TABLE tenant.purchase_orders ADD COLUMN IF NOT EXISTS incoterm_place text;
ALTER TABLE tenant.purchase_order_lines ADD COLUMN IF NOT EXISTS cost_center_id uuid;

-- Bill basis per item (report Phase 3): an item may be billed on the quantity ordered (an annual maintenance contract, a fixed-price job)
-- or on what was received, whatever the order's policy. The item's choice is copied to the order line when the line is written, so a
-- later change to the item never moves an order already placed; the line status view uses the line's basis first.
ALTER TABLE tenant.items ADD COLUMN IF NOT EXISTS purchase_bill_basis text CHECK (purchase_bill_basis IS NULL OR purchase_bill_basis IN ('order', 'receipt'));
ALTER TABLE tenant.purchase_order_lines ADD COLUMN IF NOT EXISTS bill_basis text CHECK (bill_basis IS NULL OR bill_basis IN ('order', 'receipt'));

CREATE OR REPLACE VIEW tenant.purchase_order_line_progress WITH (security_invoker = true) AS
SELECT line.organization_id, line.purchase_order_id, line.id AS purchase_order_line_id, line.line_number, line.product_type, line.ordered_quantity,
       line.expected_delivery_date,
       COALESCE(received.accepted, 0) AS accepted_quantity, COALESCE(received.held, 0) AS held_quantity, COALESCE(received.rejected, 0) AS rejected_quantity,
       COALESCE(received.draft, 0) AS draft_receipt_quantity,
       COALESCE(returned.quantity, 0) AS returned_quantity, 0::numeric AS returned_for_replacement_quantity,
       COALESCE(cancelled.quantity, 0) AS cancelled_quantity,
       COALESCE(billed.posted, 0) AS billed_quantity, COALESCE(billed.posted, 0) AS posted_billed_quantity, COALESCE(billed.unposted, 0) AS unposted_billed_quantity,
       COALESCE(line.bill_basis, CASE po.matching_policy WHEN 'two_way' THEN 'order' WHEN 'three_way_accepted' THEN 'receipt' WHEN 'three_way_received' THEN 'receipt'
         ELSE COALESCE(settings.billing_basis, 'receipt') END) AS billing_basis,
       COALESCE(received.damaged, 0) AS damaged_quantity,
       COALESCE(held.released, 0) AS released_quantity,
       COALESCE(held.open_inspection, 0) AS open_inspection_quantity,
       COALESCE(held.open_damaged, 0) AS open_damaged_quantity,
       COALESCE(returned.from_stock, 0) AS returned_from_stock_quantity,
       CASE po.matching_policy WHEN 'three_way_received' THEN true WHEN 'three_way_accepted' THEN false WHEN 'two_way' THEN false
         ELSE COALESCE(settings.bill_held_goods, false) END AS bill_held_goods,
       COALESCE(rejections.refused_at_dock, 0) AS refused_at_dock_quantity,
       COALESCE(rejections.after_custody, 0) AS quality_rejected_quantity,
       COALESCE(rejections.from_stock_open, 0) AS rejected_from_stock_quantity,
       COALESCE(rejections.open_cases, 0) AS open_rejection_cases,
       line.unit_price, COALESCE(billed.posted_amount, 0) AS billed_amount, COALESCE(billed.unposted_amount, 0) AS unposted_billed_amount,
       COALESCE(billed.amount_lines, 0) AS amount_billed_lines
  FROM tenant.purchase_order_lines line
  JOIN tenant.purchase_orders po ON po.organization_id = line.organization_id AND po.id = line.purchase_order_id
  LEFT JOIN tenant.procurement_settings settings ON settings.organization_id = line.organization_id
  LEFT JOIN LATERAL (
    SELECT sum(receipt_line.accepted_quantity) FILTER (WHERE receipt.status = 'posted' AND receipt.reversed_at IS NULL) AS accepted,
           sum(receipt_line.held_quantity) FILTER (WHERE receipt.status = 'posted' AND receipt.reversed_at IS NULL) AS held,
           sum(receipt_line.damaged_quantity) FILTER (WHERE receipt.status = 'posted' AND receipt.reversed_at IS NULL) AS damaged,
           sum(receipt_line.rejected_quantity) FILTER (WHERE receipt.status = 'posted' AND receipt.reversed_at IS NULL) AS rejected,
           sum(receipt_line.accepted_quantity + receipt_line.held_quantity) FILTER (WHERE receipt.status = 'draft') AS draft
      FROM tenant.goods_receipt_lines receipt_line
      JOIN tenant.goods_receipts receipt ON receipt.organization_id = receipt_line.organization_id AND receipt.id = receipt_line.goods_receipt_id
     WHERE receipt_line.organization_id = line.organization_id AND receipt_line.purchase_order_line_id = line.id) received ON true
  LEFT JOIN LATERAL (
    SELECT sum(disposition.released_quantity) AS released,
           sum(disposition.quantity - disposition.released_quantity - disposition.returned_quantity - disposition.disposed_quantity - disposition.blocked_quantity)
             FILTER (WHERE disposition.disposition = 'inspection_hold') AS open_inspection,
           sum(CASE WHEN disposition.disposition = 'damaged'
                    THEN disposition.quantity - disposition.released_quantity - disposition.returned_quantity - disposition.disposed_quantity
                    ELSE disposition.blocked_quantity END) AS open_damaged
      FROM tenant.goods_receipt_dispositions disposition
      JOIN tenant.goods_receipt_lines receipt_line ON receipt_line.organization_id = disposition.organization_id AND receipt_line.id = disposition.goods_receipt_line_id
      JOIN tenant.goods_receipts receipt ON receipt.organization_id = disposition.organization_id AND receipt.id = disposition.goods_receipt_id
     WHERE disposition.organization_id = line.organization_id AND receipt_line.purchase_order_line_id = line.id AND receipt.reversed_at IS NULL) held ON true
  LEFT JOIN LATERAL (
    SELECT sum(return_line.quantity) AS quantity, sum(return_line.quantity) FILTER (WHERE return_line.disposition_id IS NULL AND NOT return_line.from_hold) AS from_stock
      FROM tenant.purchase_return_lines return_line
     WHERE return_line.organization_id = line.organization_id AND return_line.purchase_order_line_id = line.id
       AND EXISTS (SELECT 1 FROM tenant.purchase_returns posted_return WHERE posted_return.organization_id = return_line.organization_id
         AND posted_return.id = return_line.purchase_return_id AND posted_return.document_status = 'posted')) returned ON true
  LEFT JOIN LATERAL (
    SELECT sum(cancellation.quantity) AS quantity FROM tenant.purchase_order_line_cancellations cancellation
     WHERE cancellation.organization_id = line.organization_id AND cancellation.purchase_order_line_id = line.id) cancelled ON true
  LEFT JOIN LATERAL (
    SELECT sum(CASE WHEN bill.bill_type = 'credit_note' THEN -bill_line.quantity ELSE bill_line.quantity END) AS quantity,
           sum(CASE WHEN bill.bill_type = 'credit_note' THEN -bill_line.quantity ELSE bill_line.quantity END)
             FILTER (WHERE bill.status IN ('posted', 'partially_paid', 'paid', 'overdue', 'disputed')) AS posted,
           sum(CASE WHEN bill.bill_type = 'credit_note' THEN -bill_line.quantity ELSE bill_line.quantity END)
             FILTER (WHERE bill.status IN ('draft', 'pending_approval', 'approved')) AS unposted,
           sum(CASE WHEN bill.bill_type = 'credit_note' THEN -1 ELSE 1 END * COALESCE(bill_line.billed_amount, round(bill_line.quantity * line.unit_price, 2)))
             FILTER (WHERE bill.status IN ('posted', 'partially_paid', 'paid', 'overdue', 'disputed')) AS posted_amount,
           sum(CASE WHEN bill.bill_type = 'credit_note' THEN -1 ELSE 1 END * COALESCE(bill_line.billed_amount, round(bill_line.quantity * line.unit_price, 2)))
             FILTER (WHERE bill.status IN ('draft', 'pending_approval', 'approved')) AS unposted_amount,
           count(*) FILTER (WHERE bill_line.billing_basis = 'amount') AS amount_lines
      FROM tenant.accounting_vendor_bill_lines bill_line
      JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = bill_line.organization_id AND bill.id = bill_line.vendor_bill_id
     WHERE bill_line.organization_id = line.organization_id AND bill_line.purchase_order_line_id = line.id
       AND bill.bill_type IN ('bill', 'credit_note') AND bill.status NOT IN ('cancelled', 'reversed')) billed ON true
  LEFT JOIN LATERAL (
    SELECT sum(rejection.rejected_quantity) FILTER (WHERE rejection.rejection_stage = 'before_custody') AS refused_at_dock,
           sum(rejection.rejected_quantity) FILTER (WHERE rejection.rejection_stage = 'after_custody') AS after_custody,
           sum(rejection.rejected_quantity - rejection.released_quantity - rejection.returned_quantity) FILTER (WHERE rejection.stock_source = 'usable_stock') AS from_stock_open,
           count(*) FILTER (WHERE rejection.status = 'open') AS open_cases
      FROM tenant.receiving_rejections rejection
     WHERE rejection.organization_id = line.organization_id AND rejection.purchase_order_line_id = line.id AND rejection.status <> 'cancelled') rejections ON true;

GRANT SELECT ON tenant.purchase_order_line_progress, tenant.purchase_order_line_status TO vercent_app, vercent_worker;

-- Bills by email (report Phase 3): an inbound address for purchase bills; each PDF or photo attached is kept as an entry with its
-- e-invoice QR read, until it becomes a bill or is set aside.
ALTER TABLE public.inbound_mail_routes DROP CONSTRAINT IF EXISTS inbound_mail_routes_target_check;
ALTER TABLE public.inbound_mail_routes ADD CONSTRAINT inbound_mail_routes_target_check
  CHECK (target IN ('support.email_to_ticket', 'crm.email_to_lead', 'sales.email_replies', 'procurement.bills_by_email'));
CREATE TABLE IF NOT EXISTS tenant.supplier_bill_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  inbound_event_id uuid,
  message_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  from_email text,
  from_name text,
  subject text,
  file_id uuid NOT NULL,
  file_name text NOT NULL,
  supplier_id uuid,
  qr_read jsonb,
  irn text,
  problems jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'billed', 'set_aside')),
  bill_id uuid,
  billed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  billed_at timestamptz,
  set_aside_reason text,
  set_aside_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  set_aside_at timestamptz,
  UNIQUE (organization_id, message_id, file_name)
);
CREATE INDEX IF NOT EXISTS supplier_bill_inbox_open_idx ON tenant.supplier_bill_inbox (organization_id, status, received_at DESC);
ALTER TABLE tenant.supplier_bill_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.supplier_bill_inbox FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_isolation ON tenant.supplier_bill_inbox;
CREATE POLICY organization_isolation ON tenant.supplier_bill_inbox USING (organization_id = tenant.current_organization_id())
  WITH CHECK (organization_id = tenant.current_organization_id());
GRANT SELECT, INSERT, UPDATE ON tenant.supplier_bill_inbox TO vercent_app;
GRANT SELECT ON tenant.supplier_bill_inbox TO vercent_worker;

-- Dropship (report Phase 3): a sales order line can be shipped by the supplier straight to the customer. Its purchase order keeps the sales
-- order and each line its sales line; the goods receipt recorded when the supplier delivered keeps the sales delivery it completed.
ALTER TABLE tenant.sales_order_lines DROP CONSTRAINT IF EXISTS sales_order_lines_supply_route_check;
ALTER TABLE tenant.sales_order_lines ADD CONSTRAINT sales_order_lines_supply_route_check CHECK (supply_route IN ('stock', 'buy', 'make', 'dropship'));
ALTER TABLE tenant.sales_order_supply DROP CONSTRAINT IF EXISTS sales_order_supply_route_check;
ALTER TABLE tenant.sales_order_supply ADD CONSTRAINT sales_order_supply_route_check CHECK (route IN ('buy', 'make', 'dropship'));
ALTER TABLE tenant.purchase_orders ADD COLUMN IF NOT EXISTS dropship_sales_order_id uuid;
ALTER TABLE tenant.purchase_orders ADD COLUMN IF NOT EXISTS dropship_sales_order_number text;
ALTER TABLE tenant.purchase_orders ADD COLUMN IF NOT EXISTS dropship_customer_name text;
ALTER TABLE tenant.purchase_order_lines ADD COLUMN IF NOT EXISTS dropship_sales_order_line_id uuid;
ALTER TABLE tenant.goods_receipts ADD COLUMN IF NOT EXISTS dropship_delivery_id uuid;
ALTER TABLE tenant.goods_receipts ADD COLUMN IF NOT EXISTS dropship_delivery_number text;
CREATE INDEX IF NOT EXISTS purchase_orders_dropship_idx ON tenant.purchase_orders (organization_id, dropship_sales_order_id) WHERE dropship_sales_order_id IS NOT NULL;

-- Job work (report Phase 3; GST s.143, Form ITC-04): material sent to a job worker on a job-work challan, and what came back processed,
-- unprocessed or as waste. The "At job workers" warehouse holds the stocked material while it is away.
ALTER TABLE tenant.procurement_settings ADD COLUMN IF NOT EXISTS job_work_warehouse_id uuid;
CREATE TABLE IF NOT EXISTS tenant.job_work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  number text NOT NULL,
  supplier_id uuid NOT NULL,
  job_worker_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  goods_kind text NOT NULL DEFAULT 'inputs' CHECK (goods_kind IN ('inputs', 'capital_goods')),
  nature_of_job text,
  warehouse_id uuid,
  purchase_order_id uuid,
  vehicle_number text,
  notes text,
  total_value numeric(18,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'partly_returned', 'completed', 'cancelled')),
  sent_date date,
  due_date date,
  transfer_id uuid,
  sent_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  sent_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number)
);
CREATE TABLE IF NOT EXISTS tenant.job_work_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_work_order_id uuid NOT NULL REFERENCES tenant.job_work_orders(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  item_id uuid,
  description text NOT NULL,
  hsn_sac_code text,
  uqc text,
  quantity numeric(24,6) NOT NULL CHECK (quantity > 0),
  unit_value numeric(24,6) NOT NULL DEFAULT 0,
  value numeric(18,2) NOT NULL DEFAULT 0,
  processed_quantity numeric(24,6) NOT NULL DEFAULT 0,
  returned_quantity numeric(24,6) NOT NULL DEFAULT 0,
  waste_quantity numeric(24,6) NOT NULL DEFAULT 0,
  CHECK (processed_quantity + returned_quantity + waste_quantity <= quantity + 0.000001)
);
CREATE TABLE IF NOT EXISTS tenant.job_work_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_work_order_id uuid NOT NULL REFERENCES tenant.job_work_orders(id) ON DELETE CASCADE,
  line_id uuid NOT NULL REFERENCES tenant.job_work_order_lines(id) ON DELETE CASCADE,
  return_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('processed', 'unprocessed', 'waste')),
  quantity numeric(24,6) NOT NULL CHECK (quantity > 0),
  job_worker_challan_number text,
  job_worker_challan_date date,
  goods_receipt_id uuid,
  notes text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_work_orders_open_idx ON tenant.job_work_orders (organization_id, status, due_date);
CREATE INDEX IF NOT EXISTS job_work_order_lines_order_idx ON tenant.job_work_order_lines (organization_id, job_work_order_id);
CREATE INDEX IF NOT EXISTS job_work_returns_order_idx ON tenant.job_work_returns (organization_id, job_work_order_id, return_date);
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['job_work_orders', 'job_work_order_lines', 'job_work_returns'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    EXECUTE format('DROP POLICY IF EXISTS organization_isolation ON tenant.%I', name);
    EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON tenant.%I TO vercent_app', name);
    EXECUTE format('GRANT SELECT ON tenant.%I TO vercent_worker', name);
  END LOOP;
END $$;
