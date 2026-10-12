-- 0093 POS Card Payments: debit and credit cards taken through a payment terminal and an acquiring provider, confirmed by the provider before a
-- sale is finalised; or, where the merchant explicitly allows it, recorded from a standalone bank card machine as a cashier-attested payment
-- that settlement reconciliation must confirm. No card number, CVV, PIN or track data is ever stored — only provider references and the
-- masked metadata a provider returns.
--
-- 1. Payment terminals: the card devices of an outlet (provider, merchant account, the provider's device reference, integrated or
--    standalone), with the one payment currently in progress on each (so two checkouts can never drive one device).
-- 2. Card configuration per outlet (on the existing provider configuration): merchant account, integrated / standalone, standalone
--    allowed, provisional acceptance of attested payments, refunds allowed, settlement source, readiness, currency and limits.
-- 3. A card attempt's full lifecycle (created → awaiting customer → processing → authorised / capture pending → captured; declined, failed,
--    unknown, cancel pending, cancelled, reconciliation required, externally attested) and how it was verified (provider verified,
--    externally attested, unresolved), beside the existing coarse status; the terminal and merchant account; provider order / capture
--    references; masked card metadata; a sanitised failure code and a message fit to show; the standalone machine's approval reference.
--    A provider reference is unique per provider; a standalone reference per terminal and day; one live card attempt per bill.
-- 4. Card refunds with their own lifecycle (requested, processing, succeeded, failed, unknown, reconciliation required).
-- 5. Settlement detail: fee tax, refund adjustments, net amount, the provider's settlement id, merchant account, and a reconciliation status
--    that also says when amounts disagree or the payment is missing.

-- ============================================================ 1. payment terminals

CREATE TABLE IF NOT EXISTS tenant.pos_payment_terminals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES tenant.pos_stores(id),
  provider_key text NOT NULL,
  merchant_account_reference text,
  provider_terminal_reference text NOT NULL,
  name text NOT NULL,
  integration_mode text NOT NULL DEFAULT 'integrated' CHECK (integration_mode IN ('integrated', 'standalone')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  connection_status text NOT NULL DEFAULT 'unknown' CHECK (connection_status IN ('unknown', 'online', 'offline')),
  active_payment_id uuid REFERENCES tenant.pos_payments(id),
  active_since timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.users(id),
  updated_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider_key, provider_terminal_reference)
);
CREATE INDEX IF NOT EXISTS pos_payment_terminals_store_idx ON tenant.pos_payment_terminals (organization_id, store_id, status);
ALTER TABLE tenant.pos_payment_terminals ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.pos_payment_terminals FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'pos_payment_terminals' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.pos_payment_terminals USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.pos_payment_terminals TO vercent_app;
GRANT SELECT ON tenant.pos_payment_terminals TO vercent_worker;

-- ============================================================ 2. card configuration

ALTER TABLE tenant.pos_payment_provider_configs
  ADD COLUMN IF NOT EXISTS merchant_account_reference text,
  ADD COLUMN IF NOT EXISTS integration_mode text NOT NULL DEFAULT 'integrated',
  ADD COLUMN IF NOT EXISTS standalone_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS provisional_acceptance boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS standalone_approval_above numeric(20,6),
  ADD COLUMN IF NOT EXISTS refund_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS settlement_source text NOT NULL DEFAULT 'provider_api',
  ADD COLUMN IF NOT EXISTS configuration_status text NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS supported_currency text NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS max_amount numeric(20,6);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_payment_provider_configs_card_check') THEN
    ALTER TABLE tenant.pos_payment_provider_configs ADD CONSTRAINT pos_payment_provider_configs_card_check CHECK (
      integration_mode IN ('integrated', 'standalone', 'both') AND settlement_source IN ('provider_api', 'import')
      AND configuration_status IN ('ready', 'incomplete', 'disabled') AND (max_amount IS NULL OR max_amount > 0)
      AND (standalone_approval_above IS NULL OR standalone_approval_above > 0));
  END IF;
END $$;

-- ============================================================ 3. card attempts

ALTER TABLE tenant.pos_payments
  ADD COLUMN IF NOT EXISTS attempt_status text,
  ADD COLUMN IF NOT EXISTS verification_status text,
  ADD COLUMN IF NOT EXISTS payment_terminal_id uuid REFERENCES tenant.pos_payment_terminals(id),
  ADD COLUMN IF NOT EXISTS merchant_account_reference text,
  ADD COLUMN IF NOT EXISTS provider_order_id text,
  ADD COLUMN IF NOT EXISTS provider_capture_id text,
  ADD COLUMN IF NOT EXISTS card_network text,
  ADD COLUMN IF NOT EXISTS card_type text,
  ADD COLUMN IF NOT EXISTS card_last_four text,
  ADD COLUMN IF NOT EXISTS failure_code text,
  ADD COLUMN IF NOT EXISTS display_message text,
  ADD COLUMN IF NOT EXISTS authorized_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_status_check_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_check_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS external_reference text,
  ADD COLUMN IF NOT EXISTS external_reference_date date,
  ADD COLUMN IF NOT EXISTS attested_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS attested_at timestamptz,
  ADD COLUMN IF NOT EXISTS recovery_status text;

UPDATE tenant.pos_payments SET attempt_status = CASE status
    WHEN 'initiated' THEN 'created' WHEN 'pending' THEN 'processing' WHEN 'authorized' THEN 'authorized' WHEN 'failed' THEN 'failed'
    WHEN 'voided' THEN 'cancelled' ELSE 'captured' END,
  verification_status = CASE WHEN status IN ('captured', 'refunded', 'partially_refunded') THEN 'provider_verified' ELSE 'unresolved' END
 WHERE payment_method <> 'cash' AND attempt_status IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_payments_attempt_status_check') THEN
    ALTER TABLE tenant.pos_payments ADD CONSTRAINT pos_payments_attempt_status_check CHECK (attempt_status IS NULL OR attempt_status IN (
      'created', 'awaiting_customer', 'processing', 'authorized', 'capture_pending', 'captured', 'declined', 'failed', 'unknown', 'cancel_pending',
      'cancelled', 'reconciliation_required', 'externally_attested'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_payments_verification_status_check') THEN
    ALTER TABLE tenant.pos_payments ADD CONSTRAINT pos_payments_verification_status_check CHECK (verification_status IS NULL OR verification_status IN (
      'provider_verified', 'externally_attested', 'unresolved'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_payments_card_metadata_check') THEN
    ALTER TABLE tenant.pos_payments ADD CONSTRAINT pos_payments_card_metadata_check CHECK (
      (card_last_four IS NULL OR card_last_four ~ '^[0-9]{4}$') AND (card_type IS NULL OR card_type IN ('debit', 'credit', 'prepaid', 'unknown'))
      AND (recovery_status IS NULL OR recovery_status IN ('finalization_failed', 'refund_requested', 'refunded', 'resolved')));
  END IF;
END $$;

-- A provider's payment reference identifies one payment; a standalone machine's approval reference, one payment per terminal and day.
CREATE UNIQUE INDEX IF NOT EXISTS pos_payments_provider_reference_uidx ON tenant.pos_payments (organization_id, provider_key, provider_reference)
  WHERE provider_reference IS NOT NULL AND payment_method <> 'cash';
CREATE UNIQUE INDEX IF NOT EXISTS pos_payments_external_reference_uidx ON tenant.pos_payments (organization_id, payment_terminal_id, external_reference, external_reference_date)
  WHERE external_reference IS NOT NULL;
-- One live card attempt per bill.
CREATE UNIQUE INDEX IF NOT EXISTS pos_payments_one_live_card_uidx ON tenant.pos_payments (organization_id, cart_id)
  WHERE payment_method = 'card' AND attempt_status IN ('created', 'awaiting_customer', 'processing', 'authorized', 'capture_pending', 'unknown', 'cancel_pending');

-- ============================================================ 4. card refunds

CREATE TABLE IF NOT EXISTS tenant.pos_card_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  original_payment_id uuid NOT NULL REFERENCES tenant.pos_payments(id),
  return_id uuid REFERENCES tenant.pos_returns(id),
  provider_key text NOT NULL,
  provider_refund_reference text,
  refund_amount numeric(20,6) NOT NULL CHECK (refund_amount > 0),
  currency_code text,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'processing', 'succeeded', 'failed', 'unknown', 'reconciliation_required')),
  reason text,
  failure_message text,
  idempotency_key text NOT NULL,
  requested_by uuid REFERENCES public.users(id),
  approval_id uuid,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS pos_card_refunds_payment_idx ON tenant.pos_card_refunds (organization_id, original_payment_id, status);
ALTER TABLE tenant.pos_card_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.pos_card_refunds FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'pos_card_refunds' AND policyname = 'organization_isolation') THEN
    CREATE POLICY organization_isolation ON tenant.pos_card_refunds USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.pos_card_refunds TO vercent_app;
GRANT SELECT ON tenant.pos_card_refunds TO vercent_worker;

-- ============================================================ 5. settlement detail

ALTER TABLE tenant.pos_settlement_entries
  ADD COLUMN IF NOT EXISTS fee_tax_amount numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_adjustment numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount numeric(20,6),
  ADD COLUMN IF NOT EXISTS provider_settlement_id text,
  ADD COLUMN IF NOT EXISTS merchant_account_reference text,
  ADD COLUMN IF NOT EXISTS reconciliation_status text,
  ADD COLUMN IF NOT EXISTS discrepancy_amount numeric(20,6),
  ADD COLUMN IF NOT EXISTS finance_reference text;

UPDATE tenant.pos_settlement_entries SET reconciliation_status = match_status WHERE reconciliation_status IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_settlement_entries_reconciliation_status_check') THEN
    ALTER TABLE tenant.pos_settlement_entries ADD CONSTRAINT pos_settlement_entries_reconciliation_status_check CHECK (reconciliation_status IS NULL OR reconciliation_status IN (
      'matched', 'unmatched', 'duplicate', 'amount_mismatch', 'disputed'));
  END IF;
END $$;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0093_pos_card_payments.sql', 'pos-card-payments') ON CONFLICT DO NOTHING;
