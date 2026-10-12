-- 0099 POS Returns: taking goods back against a completed sale — never editing, deleting or recreating it. A return is prepared (draft),
-- approved when an exception needs it, inspected when the company requires it, then posted: stock received by its condition, the sale's
-- returned quantities, the credit note, and the refund obligations — whose own status (processing, succeeded, failed) is kept apart from
-- the return's.
--
-- 1. Returns: a lifecycle of their own (draft → awaiting approval / awaiting inspection → approved → posted; rejected, cancelled, recovery
--    required) beside the old status, which is kept in step for the readers that use it (accounting, day-end, reports); full or partial;
--    whether the receipt was presented; the processing outlet (cross-outlet only when allowed); the value before tax, the tax adjustment
--    and the refund due; the exceptions that needed approval, who approved which version; the refund status; a version for concurrency.
-- 2. Return lines: one reason (and note) and one physical condition per line; the disposition of the goods (restocked, held for inspection,
--    damaged, quarantined, not received, not a stock item); the item, unit and base quantity; the serial / batch returned; an active claim
--    (a draft or approved return holds its quantity, so two counters cannot return the same last unit, and a serial is never returned twice).
-- 3. Cash refunds may wait for the cashier to confirm the cash was handed over; the refund ledger keeps whether it is waiting.
-- 4. Return policy settings: returns on/off, the return window, no-receipt returns, required reason and condition, partial returns,
--    cross-outlet returns, inspection before refund, approval above an amount, allowed reasons, item/category restrictions.
-- 5. The sale line's returned quantity can never pass what was sold.

-- ============================================================ 1. returns

ALTER TABLE tenant.pos_returns
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS return_type text NOT NULL DEFAULT 'partial',
  ADD COLUMN IF NOT EXISTS receipt_present boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS customer_id uuid,
  ADD COLUMN IF NOT EXISTS original_invoice_id uuid REFERENCES tenant.gst_invoices(id),
  ADD COLUMN IF NOT EXISTS sale_store_id uuid REFERENCES tenant.pos_stores(id),
  ADD COLUMN IF NOT EXISTS currency_code text,
  ADD COLUMN IF NOT EXISTS return_value numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_adjustment_amount numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_status text NOT NULL DEFAULT 'not_initiated',
  ADD COLUMN IF NOT EXISTS exceptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS override_reason text,
  ADD COLUMN IF NOT EXISTS approved_version integer,
  ADD COLUMN IF NOT EXISTS approval_note text,
  ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS inspected_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS inspected_at timestamptz,
  ADD COLUMN IF NOT EXISTS posted_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS posted_at timestamptz,
  ADD COLUMN IF NOT EXISTS posting_shift_id uuid REFERENCES tenant.pos_shifts(id),
  ADD COLUMN IF NOT EXISTS recovery_reason text,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_returns_lifecycle_check') THEN
    ALTER TABLE tenant.pos_returns ADD CONSTRAINT pos_returns_lifecycle_check CHECK (
      lifecycle_status IN ('draft', 'awaiting_approval', 'awaiting_inspection', 'approved', 'posting', 'posted', 'rejected', 'cancelled', 'recovery_required')
      AND return_type IN ('full', 'partial')
      AND refund_status IN ('not_initiated', 'pending', 'processing', 'partially_refunded', 'succeeded', 'failed', 'unknown', 'not_required'));
  END IF;
END $$;

-- Returns made before this lifecycle existed keep their meaning.
UPDATE tenant.pos_returns SET lifecycle_status = CASE status WHEN 'pending_approval' THEN 'awaiting_approval' WHEN 'completed' THEN 'posted' ELSE status END,
       posted_at = CASE WHEN status = 'completed' THEN COALESCE(posted_at, completed_at) ELSE posted_at END,
       posted_by = CASE WHEN status = 'completed' THEN COALESCE(posted_by, completed_by) ELSE posted_by END,
       refund_status = CASE WHEN status = 'completed' THEN 'succeeded' ELSE refund_status END
 WHERE lifecycle_status = 'draft' AND status <> 'draft';
UPDATE tenant.pos_returns ret SET sale_store_id = sale.store_id, currency_code = COALESCE(ret.currency_code, sale.currency_code), customer_id = COALESCE(ret.customer_id, sale.customer_id)
  FROM tenant.pos_sales sale WHERE sale.organization_id = ret.organization_id AND sale.id = ret.sale_id AND ret.sale_store_id IS NULL;

CREATE INDEX IF NOT EXISTS pos_returns_lifecycle_idx ON tenant.pos_returns (organization_id, lifecycle_status, created_at DESC);
CREATE INDEX IF NOT EXISTS pos_returns_refund_status_idx ON tenant.pos_returns (organization_id, refund_status) WHERE refund_status IN ('pending', 'processing', 'failed', 'unknown');

-- A posted return is never edited: only its refund progress, accounting posting and documents move on.
CREATE OR REPLACE FUNCTION tenant.pos_return_posted_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.lifecycle_status = 'posted' AND (NEW.lifecycle_status <> 'posted' OR NEW.refund_total IS DISTINCT FROM OLD.refund_total OR NEW.return_value IS DISTINCT FROM OLD.return_value
     OR NEW.tax_adjustment_amount IS DISTINCT FROM OLD.tax_adjustment_amount OR NEW.sale_id IS DISTINCT FROM OLD.sale_id OR NEW.store_id IS DISTINCT FROM OLD.store_id
     OR NEW.return_number IS DISTINCT FROM OLD.return_number OR NEW.posted_at IS DISTINCT FROM OLD.posted_at) THEN
    RAISE EXCEPTION 'A posted return cannot be changed; record a compensating operation.' USING ERRCODE = 'check_violation', CONSTRAINT = 'pos_return_posted_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER pos_returns_posted_guard BEFORE UPDATE ON tenant.pos_returns FOR EACH ROW EXECUTE FUNCTION tenant.pos_return_posted_guard();

-- ============================================================ 2. return lines

ALTER TABLE tenant.pos_return_lines
  ADD COLUMN IF NOT EXISTS item_id uuid,
  ADD COLUMN IF NOT EXISTS uom_id uuid,
  ADD COLUMN IF NOT EXISTS base_quantity numeric(20,6),
  ADD COLUMN IF NOT EXISTS batch_id uuid,
  ADD COLUMN IF NOT EXISTS serial_id uuid,
  ADD COLUMN IF NOT EXISTS tracking_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS reason_code text,
  ADD COLUMN IF NOT EXISTS reason_note text,
  ADD COLUMN IF NOT EXISTS condition_code text,
  ADD COLUMN IF NOT EXISTS disposition_code text,
  ADD COLUMN IF NOT EXISTS gross_amount numeric(20,6),
  ADD COLUMN IF NOT EXISTS stock_location_id uuid,
  ADD COLUMN IF NOT EXISTS released_movement_id uuid,
  ADD COLUMN IF NOT EXISTS released_disposition text,
  ADD COLUMN IF NOT EXISTS claim_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_return_lines_codes_check') THEN
    ALTER TABLE tenant.pos_return_lines ADD CONSTRAINT pos_return_lines_codes_check CHECK (
      (reason_code IS NULL OR reason_code IN ('damaged_product', 'defective_product', 'wrong_item', 'wrong_size_variant', 'customer_changed_mind', 'quality_issue', 'not_as_described', 'other'))
      AND (reason_code IS DISTINCT FROM 'other' OR reason_note IS NOT NULL)
      AND (condition_code IS NULL OR condition_code IN ('unopened', 'good', 'opened', 'damaged', 'defective', 'not_applicable'))
      AND (disposition_code IS NULL OR disposition_code IN ('return_hold', 'restock_approved', 'damaged', 'quarantined', 'rejected_not_received', 'not_applicable'))
      AND (released_disposition IS NULL OR released_disposition IN ('restock_approved', 'damaged', 'quarantined'))
      AND quantity > 0);
  END IF;
END $$;
-- Returns made before keep their meaning: a restocked line was restocked; the others were not received into stock.
UPDATE tenant.pos_return_lines line SET disposition_code = CASE WHEN line.restock THEN 'restock_approved' ELSE 'rejected_not_received' END,
       claim_active = ret.lifecycle_status NOT IN ('rejected', 'cancelled')
  FROM tenant.pos_returns ret WHERE ret.organization_id = line.organization_id AND ret.id = line.return_id AND line.disposition_code IS NULL;
UPDATE tenant.pos_return_lines line SET item_id = sale_line.item_id, uom_id = sale_line.uom_id, serial_id = COALESCE(line.serial_id, sale_line.serial_id), batch_id = COALESCE(line.batch_id, sale_line.batch_id)
  FROM tenant.pos_sale_lines sale_line WHERE sale_line.organization_id = line.organization_id AND sale_line.id = line.sale_line_id AND line.item_id IS NULL;

-- One serial is returned once: an active claim on it blocks any other return of it.
CREATE UNIQUE INDEX IF NOT EXISTS pos_return_lines_serial_claim_uidx ON tenant.pos_return_lines (organization_id, serial_id) WHERE serial_id IS NOT NULL AND claim_active;
CREATE INDEX IF NOT EXISTS pos_return_lines_sale_line_idx ON tenant.pos_return_lines (organization_id, sale_line_id) WHERE claim_active;

-- The quantities claimed on a sale line by active returns can never pass what was sold — whatever two counters do at once.
CREATE OR REPLACE FUNCTION tenant.pos_return_line_claim_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  sold numeric;
  claimed numeric;
BEGIN
  IF NEW.claim_active THEN
    SELECT quantity INTO sold FROM tenant.pos_sale_lines WHERE organization_id = NEW.organization_id AND id = NEW.sale_line_id FOR UPDATE;
    SELECT COALESCE(sum(quantity), 0) INTO claimed FROM tenant.pos_return_lines
     WHERE organization_id = NEW.organization_id AND sale_line_id = NEW.sale_line_id AND claim_active AND id <> NEW.id;
    IF claimed + NEW.quantity > sold THEN
      RAISE EXCEPTION 'Returned quantity would exceed the quantity sold.' USING ERRCODE = 'check_violation', CONSTRAINT = 'pos_return_line_quantity_claim';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER pos_return_lines_claim_guard BEFORE INSERT OR UPDATE OF quantity, claim_active ON tenant.pos_return_lines FOR EACH ROW EXECUTE FUNCTION tenant.pos_return_line_claim_guard();

-- ============================================================ 3. refunds waiting for a cash payout

ALTER TABLE tenant.pos_return_payment_refunds
  ADD COLUMN IF NOT EXISTS cash_movement_id uuid,
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
-- The refund ledger stays evidence: never deleted; the return, payment, method and amount never change; a completed refund is final. Only
-- its progress moves — pending → completed / failed, failed → pending for a retry — with the provider reference, the cash payout and who
-- confirmed it.
CREATE OR REPLACE FUNCTION tenant.pos_return_payment_refunds_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'pos_return_payment_refunds rows are immutable evidence and cannot be updated or deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'completed' OR NEW.return_id IS DISTINCT FROM OLD.return_id OR NEW.sale_id IS DISTINCT FROM OLD.sale_id OR NEW.payment_id IS DISTINCT FROM OLD.payment_id
     OR NEW.payment_method IS DISTINCT FROM OLD.payment_method OR NEW.refund_amount IS DISTINCT FROM OLD.refund_amount OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR (OLD.status = 'pending' AND NEW.status NOT IN ('pending', 'completed', 'failed')) OR (OLD.status = 'failed' AND NEW.status NOT IN ('failed', 'pending')) THEN
    RAISE EXCEPTION 'pos_return_payment_refunds rows are immutable evidence and cannot be updated or deleted' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- One refund line per original payment per return: a retried posting never refunds a tender twice.
CREATE UNIQUE INDEX IF NOT EXISTS pos_return_payment_refunds_once_uidx ON tenant.pos_return_payment_refunds (organization_id, return_id, payment_id);
GRANT UPDATE ON tenant.pos_return_payment_refunds TO vercent_app;

-- ============================================================ 4. return policy settings

ALTER TABLE tenant.pos_settings
  ADD COLUMN IF NOT EXISTS returns_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS return_window_days integer DEFAULT 30,
  ADD COLUMN IF NOT EXISTS allow_no_receipt_returns boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS require_return_reason boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS require_return_condition boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_partial_returns boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_cross_outlet_returns boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS require_inspection_before_refund boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS return_approval_above numeric(20,6),
  ADD COLUMN IF NOT EXISTS return_reasons jsonb NOT NULL DEFAULT '["damaged_product","defective_product","wrong_item","wrong_size_variant","customer_changed_mind","quality_issue","not_as_described","other"]'::jsonb,
  ADD COLUMN IF NOT EXISTS return_restrictions jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_settings_return_policy_check') THEN
    ALTER TABLE tenant.pos_settings ADD CONSTRAINT pos_settings_return_policy_check CHECK (
      (return_window_days IS NULL OR return_window_days BETWEEN 0 AND 3650) AND (return_approval_above IS NULL OR return_approval_above > 0)
      AND jsonb_typeof(return_reasons) = 'array' AND jsonb_typeof(return_restrictions) = 'array');
  END IF;
END $$;

-- ============================================================ 5. the sale line's returned quantity

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_sale_lines_returned_quantity_check') THEN
    ALTER TABLE tenant.pos_sale_lines ADD CONSTRAINT pos_sale_lines_returned_quantity_check CHECK (returned_quantity >= 0 AND returned_quantity <= quantity);
  END IF;
END $$;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0099_pos_returns.sql', 'pos-returns') ON CONFLICT DO NOTHING;
