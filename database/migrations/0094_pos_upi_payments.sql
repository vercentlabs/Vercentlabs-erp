-- 0094 POS UPI & Digital Payments: UPI through a dynamic, amount-bound QR from the outlet's acquiring provider (the default), provider-hosted
-- payment links, and — only where an administrator enables and verifies it — the merchant's own static QR recorded with the UTR as an
-- externally attested payment. A screenshot, an app's success screen, a speaker sound or a cashier's word is never proof: only the
-- provider's verified answer (or a matched settlement) is. Money that does not fit the bill — short, excess, duplicate, late or to the
-- wrong merchant — is never applied or waived silently: it becomes a payment exception for an authorised person to resolve.
--
-- 1. A digital attempt keeps how it was requested (dynamic QR, static QR, UPI intent, payment link, hosted), the request's own reference,
--    the QR payload and image the provider returned (a presentation asset, never an authority), the link, when the request expires and
--    whether it is still live, the amount actually received, the UTR / RRN, the instrument the customer really used (UPI, wallet,
--    netbanking, card) and when it was confirmed. A UTR is applied to one payment only; one live UPI attempt per bill.
-- 2. UPI set-up per outlet (on the provider configuration): the name customers see, the merchant's verified UPI ID for the static QR (who
--    verified it and when), static QR on / off, payment links, UPI intent, other digital methods, and the QR validity.
-- 3. Payment exceptions: credits that cannot simply be applied — short, excess, duplicate, late, unmatched, wrong merchant, conflicting —
--    with the amount, the provider's references, and how they were resolved (refund requested, resolved) and by whom.

-- ============================================================ 1. digital attempts

ALTER TABLE tenant.pos_payments
  ADD COLUMN IF NOT EXISTS payment_mode text,
  ADD COLUMN IF NOT EXISTS payment_request_reference text,
  ADD COLUMN IF NOT EXISTS qr_payload text,
  ADD COLUMN IF NOT EXISTS qr_image_url text,
  ADD COLUMN IF NOT EXISTS payment_link_url text,
  ADD COLUMN IF NOT EXISTS request_status text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS received_amount numeric(20,6),
  ADD COLUMN IF NOT EXISTS provider_transaction_reference text,
  ADD COLUMN IF NOT EXISTS instrument text,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS link_contact_consent boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_payments_digital_check') THEN
    ALTER TABLE tenant.pos_payments ADD CONSTRAINT pos_payments_digital_check CHECK (
      (payment_mode IS NULL OR payment_mode IN ('terminal', 'standalone_terminal', 'dynamic_qr', 'static_qr', 'upi_intent', 'payment_link', 'hosted'))
      AND (request_status IS NULL OR request_status IN ('active', 'expired', 'cancelled', 'consumed'))
      AND (instrument IS NULL OR instrument IN ('upi', 'wallet', 'netbanking', 'card', 'other'))
      AND (received_amount IS NULL OR received_amount >= 0));
  END IF;
END $$;

UPDATE tenant.pos_payments SET payment_mode = CASE WHEN provider_key = 'standalone' THEN 'standalone_terminal' WHEN payment_method = 'card' THEN 'terminal' ELSE 'hosted' END,
       instrument = CASE WHEN payment_method = 'upi' THEN 'upi' WHEN payment_method = 'card' THEN 'card' WHEN payment_method = 'wallet' THEN 'wallet' ELSE 'other' END
 WHERE payment_method <> 'cash' AND payment_mode IS NULL;

-- A UTR / RRN is applied to one payment only (per provider); one live UPI attempt per bill.
CREATE UNIQUE INDEX IF NOT EXISTS pos_payments_transaction_reference_uidx ON tenant.pos_payments (organization_id, provider_key, provider_transaction_reference)
  WHERE provider_transaction_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pos_payments_one_live_upi_uidx ON tenant.pos_payments (organization_id, cart_id)
  WHERE payment_method IN ('upi', 'wallet', 'bank_transfer') AND attempt_status IN ('created', 'awaiting_customer', 'processing', 'authorized', 'capture_pending', 'unknown', 'cancel_pending');

-- ============================================================ 2. UPI set-up

ALTER TABLE tenant.pos_payment_provider_configs
  ADD COLUMN IF NOT EXISTS merchant_display_name text,
  ADD COLUMN IF NOT EXISTS static_qr_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS static_qr_vpa text,
  ADD COLUMN IF NOT EXISTS static_qr_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS static_qr_verified_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS payment_links_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS intent_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS digital_methods jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS qr_validity_seconds integer NOT NULL DEFAULT 300;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_payment_provider_configs_upi_check') THEN
    ALTER TABLE tenant.pos_payment_provider_configs ADD CONSTRAINT pos_payment_provider_configs_upi_check CHECK (
      qr_validity_seconds BETWEEN 60 AND 86400 AND jsonb_typeof(digital_methods) = 'array'
      AND (static_qr_vpa IS NULL OR static_qr_vpa ~ '^[A-Za-z0-9._-]{2,200}@[A-Za-z0-9.-]{2,64}$')
      AND (NOT static_qr_enabled OR (static_qr_vpa IS NOT NULL AND static_qr_verified_at IS NOT NULL)));
  END IF;
END $$;

-- ============================================================ 3. payment exceptions

CREATE TABLE IF NOT EXISTS tenant.pos_payment_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payment_id uuid REFERENCES tenant.pos_payments(id),
  cart_id uuid REFERENCES tenant.pos_carts(id),
  store_id uuid REFERENCES tenant.pos_stores(id),
  provider_key text NOT NULL,
  provider_reference text,
  provider_transaction_reference text,
  exception_type text NOT NULL CHECK (exception_type IN ('short', 'excess', 'duplicate', 'late', 'unmatched', 'wrong_merchant', 'wrong_currency', 'conflicting')),
  amount numeric(20,6),
  expected_amount numeric(20,6),
  currency_code text,
  detail text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'refund_requested', 'refunded', 'resolved')),
  resolution_note text,
  provider_refund_reference text,
  resolved_by uuid REFERENCES public.users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_payment_exceptions_credit_uidx ON tenant.pos_payment_exceptions (organization_id, provider_key, provider_reference, exception_type)
  WHERE provider_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS pos_payment_exceptions_open_idx ON tenant.pos_payment_exceptions (organization_id, status, created_at);
ALTER TABLE tenant.pos_payment_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.pos_payment_exceptions FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'pos_payment_exceptions' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.pos_payment_exceptions USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.pos_payment_exceptions TO vercent_app;
GRANT SELECT ON tenant.pos_payment_exceptions TO vercent_worker;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0094_pos_upi_payments.sql', 'pos-upi-payments') ON CONFLICT DO NOTHING;
