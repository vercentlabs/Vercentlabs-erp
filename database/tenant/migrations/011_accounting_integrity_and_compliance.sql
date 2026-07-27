BEGIN;

-- Enterprise accounting extensions: AP matching, statutory compliance outbox and cash forecasting.
CREATE TABLE IF NOT EXISTS tenant.accounting_vendor_bill_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vendor_bill_id uuid NOT NULL REFERENCES tenant.accounting_vendor_bills(id) ON DELETE CASCADE,
  match_type text NOT NULL DEFAULT 'manual' CHECK (match_type IN ('two_way','three_way','manual')),
  purchase_order_id uuid,
  goods_receipt_id uuid,
  ordered_amount numeric(24,6) NOT NULL DEFAULT 0,
  received_amount numeric(24,6) NOT NULL DEFAULT 0,
  invoiced_amount numeric(24,6) NOT NULL DEFAULT 0,
  quantity_variance numeric(24,10) NOT NULL DEFAULT 0,
  amount_variance numeric(24,6) NOT NULL DEFAULT 0,
  tolerance_amount numeric(24,6) NOT NULL DEFAULT 0 CHECK (tolerance_amount >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','matched','exception','overridden')),
  exceptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  matched_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  matched_at timestamptz,
  override_reason text,
  overridden_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  overridden_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,vendor_bill_id),
  UNIQUE (organization_id,id)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_compliance_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  request_number text NOT NULL,
  compliance_type text NOT NULL CHECK (compliance_type IN ('gst_einvoice','gst_eway_bill','tds_statement','tax_payment','statutory_report','other')),
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','cancelled')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload jsonb,
  external_reference text,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  last_error text,
  next_retry_at timestamptz,
  requested_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,request_number),
  UNIQUE (organization_id,idempotency_key),
  UNIQUE (organization_id,id)
);
CREATE INDEX IF NOT EXISTS accounting_compliance_pending_idx
  ON tenant.accounting_compliance_requests(organization_id,status,next_retry_at,requested_at)
  WHERE status IN ('pending','failed');

CREATE TABLE IF NOT EXISTS tenant.accounting_cash_forecast_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ledger_id uuid NOT NULL REFERENCES tenant.accounting_ledgers(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  currency_code char(3) NOT NULL,
  include_open_receivables boolean NOT NULL DEFAULT true,
  include_open_payables boolean NOT NULL DEFAULT true,
  include_recurring boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','generated','approved','archived')),
  generated_at timestamptz,
  generated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (start_date <= end_date),
  UNIQUE (organization_id,company_id,code),
  UNIQUE (organization_id,id)
);

CREATE TABLE IF NOT EXISTS tenant.accounting_cash_forecast_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  scenario_id uuid NOT NULL REFERENCES tenant.accounting_cash_forecast_scenarios(id) ON DELETE CASCADE,
  forecast_date date NOT NULL,
  source_type text NOT NULL,
  source_id uuid,
  direction text NOT NULL CHECK (direction IN ('inflow','outflow')),
  amount numeric(24,6) NOT NULL CHECK (amount >= 0),
  base_amount numeric(24,6) NOT NULL CHECK (base_amount >= 0),
  probability numeric(9,4) NOT NULL DEFAULT 100 CHECK (probability BETWEEN 0 AND 100),
  category text,
  description text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,scenario_id,source_type,source_id,forecast_date,direction)
);
CREATE INDEX IF NOT EXISTS accounting_cash_forecast_lines_date_idx
  ON tenant.accounting_cash_forecast_lines(organization_id,scenario_id,forecast_date,direction);

-- Governed subledger approval thresholds and evidence.
ALTER TABLE tenant.accounting_settings
  ADD COLUMN IF NOT EXISTS customer_invoice_approval_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS customer_invoice_approval_threshold numeric(24,6) NOT NULL DEFAULT 0 CHECK (customer_invoice_approval_threshold>=0),
  ADD COLUMN IF NOT EXISTS vendor_bill_approval_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS vendor_bill_approval_threshold numeric(24,6) NOT NULL DEFAULT 0 CHECK (vendor_bill_approval_threshold>=0),
  ADD COLUMN IF NOT EXISTS vendor_payment_approval_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS vendor_payment_approval_threshold numeric(24,6) NOT NULL DEFAULT 0 CHECK (vendor_payment_approval_threshold>=0);

ALTER TABLE tenant.accounting_customer_invoices
  ADD COLUMN IF NOT EXISTS approval_request_id uuid REFERENCES public.approval_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE tenant.accounting_vendor_bills
  ADD COLUMN IF NOT EXISTS approval_request_id uuid REFERENCES public.approval_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE tenant.accounting_vendor_payments
  ADD COLUMN IF NOT EXISTS approval_request_id uuid REFERENCES public.approval_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- Settlement allocations preserve source, document and base-currency amounts for multi-currency auditability.
ALTER TABLE tenant.accounting_customer_receipt_allocations
  ADD COLUMN IF NOT EXISTS receipt_amount numeric(24,6),
  ADD COLUMN IF NOT EXISTS invoice_amount numeric(24,6),
  ADD COLUMN IF NOT EXISTS base_receipt_amount numeric(24,6),
  ADD COLUMN IF NOT EXISTS base_invoice_amount numeric(24,6),
  ADD COLUMN IF NOT EXISTS adjustment_journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id) ON DELETE RESTRICT;
UPDATE tenant.accounting_customer_receipt_allocations
SET receipt_amount=COALESCE(receipt_amount,allocated_amount),
    invoice_amount=COALESCE(invoice_amount,allocated_amount),
    base_receipt_amount=COALESCE(base_receipt_amount,allocated_amount),
    base_invoice_amount=COALESCE(base_invoice_amount,allocated_amount)
WHERE receipt_amount IS NULL OR invoice_amount IS NULL OR base_receipt_amount IS NULL OR base_invoice_amount IS NULL;
ALTER TABLE tenant.accounting_customer_receipt_allocations
  ALTER COLUMN receipt_amount SET NOT NULL,
  ALTER COLUMN invoice_amount SET NOT NULL,
  ALTER COLUMN base_receipt_amount SET NOT NULL,
  ALTER COLUMN base_invoice_amount SET NOT NULL,
  ADD CONSTRAINT accounting_customer_allocation_amounts_check CHECK (
    receipt_amount>0 AND invoice_amount>0 AND base_receipt_amount>0 AND base_invoice_amount>0
  );

ALTER TABLE tenant.accounting_vendor_payment_allocations
  ADD COLUMN IF NOT EXISTS payment_amount numeric(24,6),
  ADD COLUMN IF NOT EXISTS bill_amount numeric(24,6),
  ADD COLUMN IF NOT EXISTS base_payment_amount numeric(24,6),
  ADD COLUMN IF NOT EXISTS base_bill_amount numeric(24,6),
  ADD COLUMN IF NOT EXISTS adjustment_journal_entry_id uuid REFERENCES tenant.accounting_journal_entries(id) ON DELETE RESTRICT;
UPDATE tenant.accounting_vendor_payment_allocations
SET payment_amount=COALESCE(payment_amount,allocated_amount),
    bill_amount=COALESCE(bill_amount,allocated_amount),
    base_payment_amount=COALESCE(base_payment_amount,allocated_amount),
    base_bill_amount=COALESCE(base_bill_amount,allocated_amount)
WHERE payment_amount IS NULL OR bill_amount IS NULL OR base_payment_amount IS NULL OR base_bill_amount IS NULL;
ALTER TABLE tenant.accounting_vendor_payment_allocations
  ALTER COLUMN payment_amount SET NOT NULL,
  ALTER COLUMN bill_amount SET NOT NULL,
  ALTER COLUMN base_payment_amount SET NOT NULL,
  ALTER COLUMN base_bill_amount SET NOT NULL,
  ADD CONSTRAINT accounting_vendor_allocation_amounts_check CHECK (
    payment_amount>0 AND bill_amount>0 AND base_payment_amount>0 AND base_bill_amount>0
  );

-- Null schedule IDs must not allow duplicate payment allocations.
CREATE UNIQUE INDEX IF NOT EXISTS accounting_customer_receipt_allocation_identity_uidx
  ON tenant.accounting_customer_receipt_allocations(organization_id,receipt_id,customer_invoice_id,COALESCE(schedule_id,'00000000-0000-0000-0000-000000000000'::uuid));
CREATE UNIQUE INDEX IF NOT EXISTS accounting_vendor_payment_allocation_identity_uidx
  ON tenant.accounting_vendor_payment_allocations(organization_id,payment_id,vendor_bill_id,COALESCE(schedule_id,'00000000-0000-0000-0000-000000000000'::uuid));
CREATE UNIQUE INDEX IF NOT EXISTS accounting_bank_statement_source_uidx
  ON tenant.accounting_bank_statements(organization_id,bank_account_id,source_hash) WHERE source_hash IS NOT NULL;

-- Composite identities support tenant-safe foreign keys.
CREATE UNIQUE INDEX IF NOT EXISTS accounting_customer_invoice_lines_org_id_uidx ON tenant.accounting_customer_invoice_lines(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS accounting_customer_invoice_schedules_org_id_uidx ON tenant.accounting_customer_invoice_schedules(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS accounting_customer_receipts_org_id_uidx ON tenant.accounting_customer_receipts(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS accounting_vendor_bill_lines_org_id_uidx ON tenant.accounting_vendor_bill_lines(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS accounting_vendor_bill_schedules_org_id_uidx ON tenant.accounting_vendor_bill_schedules(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS accounting_vendor_payments_org_id_uidx ON tenant.accounting_vendor_payments(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS accounting_bank_statements_org_id_uidx ON tenant.accounting_bank_statements(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS accounting_bank_statement_lines_org_id_uidx ON tenant.accounting_bank_statement_lines(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS accounting_asset_categories_org_id_uidx ON tenant.accounting_asset_categories(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS accounting_assets_org_id_uidx ON tenant.accounting_assets(organization_id,id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='accounting_journal_lines_entry_org_fkey') THEN
    ALTER TABLE tenant.accounting_journal_lines ADD CONSTRAINT accounting_journal_lines_entry_org_fkey
      FOREIGN KEY (organization_id,journal_entry_id) REFERENCES tenant.accounting_journal_entries(organization_id,id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='accounting_journal_lines_account_org_fkey') THEN
    ALTER TABLE tenant.accounting_journal_lines ADD CONSTRAINT accounting_journal_lines_account_org_fkey
      FOREIGN KEY (organization_id,account_id) REFERENCES tenant.accounting_accounts(organization_id,id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='accounting_customer_invoice_lines_document_org_fkey') THEN
    ALTER TABLE tenant.accounting_customer_invoice_lines ADD CONSTRAINT accounting_customer_invoice_lines_document_org_fkey
      FOREIGN KEY (organization_id,customer_invoice_id) REFERENCES tenant.accounting_customer_invoices(organization_id,id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='accounting_customer_schedules_document_org_fkey') THEN
    ALTER TABLE tenant.accounting_customer_invoice_schedules ADD CONSTRAINT accounting_customer_schedules_document_org_fkey
      FOREIGN KEY (organization_id,customer_invoice_id) REFERENCES tenant.accounting_customer_invoices(organization_id,id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='accounting_vendor_bill_lines_document_org_fkey') THEN
    ALTER TABLE tenant.accounting_vendor_bill_lines ADD CONSTRAINT accounting_vendor_bill_lines_document_org_fkey
      FOREIGN KEY (organization_id,vendor_bill_id) REFERENCES tenant.accounting_vendor_bills(organization_id,id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='accounting_vendor_schedules_document_org_fkey') THEN
    ALTER TABLE tenant.accounting_vendor_bill_schedules ADD CONSTRAINT accounting_vendor_schedules_document_org_fkey
      FOREIGN KEY (organization_id,vendor_bill_id) REFERENCES tenant.accounting_vendor_bills(organization_id,id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='accounting_customer_allocations_receipt_org_fkey') THEN
    ALTER TABLE tenant.accounting_customer_receipt_allocations ADD CONSTRAINT accounting_customer_allocations_receipt_org_fkey
      FOREIGN KEY (organization_id,receipt_id) REFERENCES tenant.accounting_customer_receipts(organization_id,id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='accounting_customer_allocations_invoice_org_fkey') THEN
    ALTER TABLE tenant.accounting_customer_receipt_allocations ADD CONSTRAINT accounting_customer_allocations_invoice_org_fkey
      FOREIGN KEY (organization_id,customer_invoice_id) REFERENCES tenant.accounting_customer_invoices(organization_id,id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='accounting_vendor_allocations_payment_org_fkey') THEN
    ALTER TABLE tenant.accounting_vendor_payment_allocations ADD CONSTRAINT accounting_vendor_allocations_payment_org_fkey
      FOREIGN KEY (organization_id,payment_id) REFERENCES tenant.accounting_vendor_payments(organization_id,id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='accounting_vendor_allocations_bill_org_fkey') THEN
    ALTER TABLE tenant.accounting_vendor_payment_allocations ADD CONSTRAINT accounting_vendor_allocations_bill_org_fkey
      FOREIGN KEY (organization_id,vendor_bill_id) REFERENCES tenant.accounting_vendor_bills(organization_id,id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='accounting_asset_category_org_fkey') THEN
    ALTER TABLE tenant.accounting_assets ADD CONSTRAINT accounting_asset_category_org_fkey
      FOREIGN KEY (organization_id,category_id) REFERENCES tenant.accounting_asset_categories(organization_id,id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;

ALTER TABLE tenant.accounting_journal_lines VALIDATE CONSTRAINT accounting_journal_lines_entry_org_fkey;
ALTER TABLE tenant.accounting_journal_lines VALIDATE CONSTRAINT accounting_journal_lines_account_org_fkey;
ALTER TABLE tenant.accounting_customer_invoice_lines VALIDATE CONSTRAINT accounting_customer_invoice_lines_document_org_fkey;
ALTER TABLE tenant.accounting_customer_invoice_schedules VALIDATE CONSTRAINT accounting_customer_schedules_document_org_fkey;
ALTER TABLE tenant.accounting_vendor_bill_lines VALIDATE CONSTRAINT accounting_vendor_bill_lines_document_org_fkey;
ALTER TABLE tenant.accounting_vendor_bill_schedules VALIDATE CONSTRAINT accounting_vendor_schedules_document_org_fkey;
ALTER TABLE tenant.accounting_customer_receipt_allocations VALIDATE CONSTRAINT accounting_customer_allocations_receipt_org_fkey;
ALTER TABLE tenant.accounting_customer_receipt_allocations VALIDATE CONSTRAINT accounting_customer_allocations_invoice_org_fkey;
ALTER TABLE tenant.accounting_vendor_payment_allocations VALIDATE CONSTRAINT accounting_vendor_allocations_payment_org_fkey;
ALTER TABLE tenant.accounting_vendor_payment_allocations VALIDATE CONSTRAINT accounting_vendor_allocations_bill_org_fkey;
ALTER TABLE tenant.accounting_assets VALIDATE CONSTRAINT accounting_asset_category_org_fkey;

-- Posted subledger documents preserve their commercial identity; only collection, compliance and audit state can progress.
CREATE OR REPLACE FUNCTION tenant.accounting_protect_posted_subledger_document()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_payload jsonb; new_payload jsonb;
BEGIN
  IF TG_OP='DELETE' AND OLD.status IN ('posted','partially_paid','paid','overdue','disputed','reversed') THEN
    RAISE EXCEPTION 'Posted subledger documents cannot be deleted; create a credit note or reversal';
  END IF;
  IF TG_OP='UPDATE' AND OLD.status IN ('posted','partially_paid','paid','overdue','disputed','reversed') THEN
    old_payload := to_jsonb(OLD) - ARRAY['status','outstanding_amount','e_invoice_status','e_invoice_reference','updated_by','updated_at'];
    new_payload := to_jsonb(NEW) - ARRAY['status','outstanding_amount','e_invoice_status','e_invoice_reference','updated_by','updated_at'];
    IF old_payload IS DISTINCT FROM new_payload THEN
      RAISE EXCEPTION 'Posted subledger document commercial fields are immutable';
    END IF;
  END IF;
  RETURN COALESCE(NEW,OLD);
END;
$$;

DROP TRIGGER IF EXISTS accounting_customer_invoice_posted_immutable ON tenant.accounting_customer_invoices;
CREATE TRIGGER accounting_customer_invoice_posted_immutable
  BEFORE UPDATE OR DELETE ON tenant.accounting_customer_invoices
  FOR EACH ROW EXECUTE FUNCTION tenant.accounting_protect_posted_subledger_document();
DROP TRIGGER IF EXISTS accounting_vendor_bill_posted_immutable ON tenant.accounting_vendor_bills;
CREATE TRIGGER accounting_vendor_bill_posted_immutable
  BEFORE UPDATE OR DELETE ON tenant.accounting_vendor_bills
  FOR EACH ROW EXECUTE FUNCTION tenant.accounting_protect_posted_subledger_document();

CREATE OR REPLACE FUNCTION tenant.accounting_protect_posted_subledger_line()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status text;
BEGIN
  IF TG_TABLE_NAME='accounting_customer_invoice_lines' THEN
    SELECT status INTO parent_status FROM tenant.accounting_customer_invoices WHERE id=OLD.customer_invoice_id AND organization_id=OLD.organization_id;
  ELSE
    SELECT status INTO parent_status FROM tenant.accounting_vendor_bills WHERE id=OLD.vendor_bill_id AND organization_id=OLD.organization_id;
  END IF;
  IF parent_status IN ('posted','partially_paid','paid','overdue','disputed','reversed') THEN
    RAISE EXCEPTION 'Lines of a posted subledger document are immutable';
  END IF;
  RETURN COALESCE(NEW,OLD);
END;
$$;
DROP TRIGGER IF EXISTS accounting_customer_invoice_line_immutable ON tenant.accounting_customer_invoice_lines;
CREATE TRIGGER accounting_customer_invoice_line_immutable BEFORE UPDATE OR DELETE ON tenant.accounting_customer_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION tenant.accounting_protect_posted_subledger_line();
DROP TRIGGER IF EXISTS accounting_vendor_bill_line_immutable ON tenant.accounting_vendor_bill_lines;
CREATE TRIGGER accounting_vendor_bill_line_immutable BEFORE UPDATE OR DELETE ON tenant.accounting_vendor_bill_lines
  FOR EACH ROW EXECUTE FUNCTION tenant.accounting_protect_posted_subledger_line();

CREATE OR REPLACE FUNCTION tenant.accounting_allocations_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Posted payment allocations are append-only; reverse the payment or credit allocation';
END;
$$;
DROP TRIGGER IF EXISTS accounting_customer_allocations_append_only ON tenant.accounting_customer_receipt_allocations;
CREATE TRIGGER accounting_customer_allocations_append_only BEFORE UPDATE OR DELETE ON tenant.accounting_customer_receipt_allocations
  FOR EACH ROW EXECUTE FUNCTION tenant.accounting_allocations_append_only();
DROP TRIGGER IF EXISTS accounting_vendor_allocations_append_only ON tenant.accounting_vendor_payment_allocations;
CREATE TRIGGER accounting_vendor_allocations_append_only BEFORE UPDATE OR DELETE ON tenant.accounting_vendor_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION tenant.accounting_allocations_append_only();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'accounting_vendor_bill_matches','accounting_compliance_requests',
    'accounting_cash_forecast_scenarios','accounting_cash_forecast_lines'
  ] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('DROP POLICY IF EXISTS organization_isolation ON tenant.%I',table_name);
    EXECUTE format(
      'CREATE POLICY organization_isolation ON tenant.%I USING (organization_id=tenant.current_organization_id()) WITH CHECK (organization_id=tenant.current_organization_id())',
      table_name
    );
  END LOOP;
END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'accounting_vendor_bill_matches','accounting_compliance_requests','accounting_cash_forecast_scenarios'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON tenant.%I',table_name || '_touch_updated_at',table_name);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON tenant.%I FOR EACH ROW EXECUTE FUNCTION tenant.touch_updated_at()',table_name || '_touch_updated_at',table_name);
  END LOOP;
END $$;


-- Journal classifications used by automated accounting engines remain explicit and auditable.
ALTER TABLE tenant.accounting_journal_entries
  DROP CONSTRAINT IF EXISTS accounting_journal_entries_entry_type_check;
ALTER TABLE tenant.accounting_journal_entries
  ADD CONSTRAINT accounting_journal_entries_entry_type_check CHECK (
    entry_type IN ('standard','opening','closing','adjustment','accrual','deferral','recurring','asset',
                   'revaluation','allocation','reversal','intercompany','subledger')
  );

COMMIT;
