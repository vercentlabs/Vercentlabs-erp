BEGIN;

-- F051–F057: the after-sales requests could be created but never moved on —
-- returns stayed pending, credit notes/refunds pending, drop-ships requested,
-- advances recorded and commissions accrued forever. These columns carry the
-- governed transitions (who decided, when, why, and what it reconciled to).

-- F052: an advance is applied to the invoice request that bills the order.
ALTER TABLE tenant.sales_advance_payments
  ADD COLUMN IF NOT EXISTS applied_invoice_request_id uuid REFERENCES tenant.sales_invoice_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS applied_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_reason text;
CREATE UNIQUE INDEX IF NOT EXISTS sales_advance_payments_reference_uidx
  ON tenant.sales_advance_payments (organization_id, sales_order_id, lower(payment_reference))
  WHERE status <> 'cancelled';

-- F055: approval of a credit note/refund request (Accounting still posts it).
ALTER TABLE tenant.sales_credit_adjustment_requests
  ADD COLUMN IF NOT EXISTS decided_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS decision_note text;

-- F056: supplier-direct shipment evidence.
ALTER TABLE tenant.sales_drop_ship_requests
  ADD COLUMN IF NOT EXISTS carrier text,
  ADD COLUMN IF NOT EXISTS tracking_number text,
  ADD COLUMN IF NOT EXISTS shipped_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_note text;

-- F057: why a commission is what it is, and its reversal.
ALTER TABLE tenant.sales_commission_entries
  ADD COLUMN IF NOT EXISTS explanation jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversal_reason text;

COMMIT;
