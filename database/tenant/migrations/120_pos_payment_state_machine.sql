BEGIN;

-- F283/F284/F285/F286: tenant.pos_payments already IS the per-tender-leg
-- table this subsystem needs (one row per payment method on a sale) --
-- extended here with the columns needed for a real async provider
-- lifecycle (initiated -> pending/authorized -> captured/failed/voided ->
-- refunded/partially_refunded) instead of inventing a parallel table.
--
-- A payment attempt is now initiated BEFORE the sale exists (a cashier
-- taps "Card" and the terminal starts talking to the provider before the
-- cart is ever completed), so sale_id must become nullable and a cart_id
-- is added; a row always belongs to exactly one of the two.

ALTER TABLE tenant.pos_payments
  ALTER COLUMN sale_id DROP NOT NULL,
  ALTER COLUMN captured_at DROP NOT NULL,
  ALTER COLUMN captured_at DROP DEFAULT;

ALTER TABLE tenant.pos_payments
  ADD COLUMN IF NOT EXISTS cart_id uuid REFERENCES tenant.pos_carts(id),
  ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES tenant.pos_stores(id),
  ADD COLUMN IF NOT EXISTS currency_code text,
  ADD COLUMN IF NOT EXISTS provider_key text NOT NULL DEFAULT 'sandbox',
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS refunded_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  ADD COLUMN IF NOT EXISTS failure_reason text,
  ADD COLUMN IF NOT EXISTS initiated_by uuid,
  ADD COLUMN IF NOT EXISTS initiated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS voided_at timestamptz;

ALTER TABLE tenant.pos_payments
  DROP CONSTRAINT IF EXISTS pos_payments_sale_or_cart_check;
ALTER TABLE tenant.pos_payments
  ADD CONSTRAINT pos_payments_sale_or_cart_check CHECK (sale_id IS NOT NULL OR cart_id IS NOT NULL);

ALTER TABLE tenant.pos_payments
  DROP CONSTRAINT IF EXISTS pos_payments_status_check;
ALTER TABLE tenant.pos_payments
  ADD CONSTRAINT pos_payments_status_check CHECK (
    status IN ('initiated','pending','authorized','captured','failed','voided','refunded','partially_refunded')
  );

-- An idempotency key is unique per organization+company when present (cash
-- legs created inline by completePosCart never carry one -- their
-- idempotency is the sale's own operation key already enforced upstream).
CREATE UNIQUE INDEX IF NOT EXISTS pos_payments_idempotency_key_uidx
  ON tenant.pos_payments(organization_id,company_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS pos_payments_cart_idx
  ON tenant.pos_payments(organization_id,cart_id,status) WHERE cart_id IS NOT NULL;

-- Webhook-delivery dedupe: a DIFFERENT idempotency axis than the command
-- idempotency key above -- a provider redelivering the exact same event id
-- (its own retry-on-timeout behaviour) must be a detectable no-op, never a
-- second state transition.
CREATE TABLE IF NOT EXISTS tenant.pos_payment_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  provider_key text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  payment_id uuid REFERENCES tenant.pos_payments(id),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,provider_key,event_id)
);

ALTER TABLE tenant.pos_payment_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.pos_payment_webhook_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pos_payment_webhook_events_organization_isolation ON tenant.pos_payment_webhook_events;
CREATE POLICY pos_payment_webhook_events_organization_isolation ON tenant.pos_payment_webhook_events
  USING (organization_id=tenant.current_organization_id())
  WITH CHECK (organization_id=tenant.current_organization_id());

COMMIT;
