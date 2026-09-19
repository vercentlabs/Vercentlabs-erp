BEGIN;

-- POS Completion Program Prompt 2, financial-integrity Gap B (refund
-- tender allocation): accounting-posting.js's buildReturnJournalLines
-- previously RECONSTRUCTED how a return's refund split across a sale's
-- non-cash tender legs, proportionally to each leg's CURRENT captured
-- amount -- exact only for the common case (one tender, or cash + one
-- other), an approximation for a sale split across multiple non-cash
-- methods, and worse, only aware of the payments table's CURRENT running
-- refunded_amount total, not what THIS specific return actually refunded
-- (a sale returned more than once has no way to attribute the right
-- portion to the right return after the fact).
--
-- return-lifecycle.js's completePointOfSaleReturn ALREADY computes an
-- exact per-payment-id share via allocateRefundAcrossPayments before
-- calling refundPosPayment/inserting the cash movement -- that exact
-- figure was simply never persisted anywhere after being used. This table
-- is that persistence: one immutable row per (return, original payment)
-- pair, written at the exact moment the real refund is executed, so
-- Accounting (and any other future consumer) reads a real fact instead of
-- reconstructing a guess.
CREATE TABLE IF NOT EXISTS tenant.pos_return_payment_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  return_id uuid NOT NULL REFERENCES tenant.pos_returns(id),
  sale_id uuid NOT NULL REFERENCES tenant.pos_sales(id),
  payment_id uuid REFERENCES tenant.pos_payments(id),
  payment_method text NOT NULL,
  provider_reference text,
  refund_amount numeric(20,6) NOT NULL CHECK (refund_amount > 0),
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','pending','failed')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pos_return_payment_refunds_return_idx
  ON tenant.pos_return_payment_refunds(organization_id,company_id,return_id);
CREATE INDEX IF NOT EXISTS pos_return_payment_refunds_payment_idx
  ON tenant.pos_return_payment_refunds(organization_id,payment_id) WHERE payment_id IS NOT NULL;

ALTER TABLE tenant.pos_return_payment_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.pos_return_payment_refunds FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pos_return_payment_refunds_organization_isolation ON tenant.pos_return_payment_refunds;
CREATE POLICY pos_return_payment_refunds_organization_isolation ON tenant.pos_return_payment_refunds
  USING (organization_id=tenant.current_organization_id())
  WITH CHECK (organization_id=tenant.current_organization_id());

CREATE OR REPLACE FUNCTION tenant.pos_return_payment_refunds_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'pos_return_payment_refunds rows are immutable evidence and cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pos_return_payment_refunds_no_update ON tenant.pos_return_payment_refunds;
CREATE TRIGGER pos_return_payment_refunds_no_update
  BEFORE UPDATE OR DELETE ON tenant.pos_return_payment_refunds
  FOR EACH ROW EXECUTE FUNCTION tenant.pos_return_payment_refunds_immutable();

-- Gap C (historical loyalty valuation): F305's loyalty-accrual journal
-- line valued every accrual at the loyalty program's CURRENT
-- redemption_value_per_point, not the rate actually in effect when the
-- sale happened -- if an admin ever changes the program's rate, every
-- NOT-YET-POSTED historical sale would silently accrue at today's rate
-- instead of the rate the customer actually earned under. The resolved
-- program row (including its rate) is already looked up once during cart
-- pricing/legacy-line pricing -- this snapshots that same rate onto the
-- sale row at completion time, the same "capture history at the moment
-- of the fact, don't recompute it later from a live, mutable source"
-- principle this module already applies to price lists, tax rates and
-- promotion discounts.
ALTER TABLE tenant.pos_sales
  ADD COLUMN IF NOT EXISTS loyalty_redemption_value_per_point_snapshot numeric(20,10);

COMMIT;
