BEGIN;

-- F283 (card) / F284 (UPI/digital) / F285 (split tender) / F286 (multiple
-- payment methods) -- ONE payment-tender subsystem. This migration adds the
-- provider-configuration surface: which adapter (sandbox, or a real named
-- provider once one is genuinely implemented) is active for a given store
-- and payment method, and which store-level payment methods are even
-- offered at checkout. A provider row NEVER stores a credential value --
-- only the NAME of an environment variable the real credential would live
-- in (credential_env_var). Activating a real (non-sandbox) provider_key is
-- an explicit, disclosed "EXTERNAL ACTIVATION BLOCKED" configuration point
-- enforced in code (services/api/src/modules/point-of-sale/payments/
-- adapter.js's resolvePaymentAdapter) -- this table only records intent,
-- it never fabricates a live-payment success path.

ALTER TABLE tenant.pos_stores
  ADD COLUMN IF NOT EXISTS allowed_payment_methods text[] NOT NULL DEFAULT ARRAY['cash']::text[];

CREATE TABLE IF NOT EXISTS tenant.pos_payment_provider_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  store_id uuid NOT NULL REFERENCES tenant.pos_stores(id),
  payment_method text NOT NULL
    CHECK (payment_method IN ('card','upi','wallet','bank_transfer')),
  provider_key text NOT NULL DEFAULT 'sandbox',
  credential_env_var text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,store_id,payment_method)
);

CREATE INDEX IF NOT EXISTS pos_payment_provider_configs_store_idx
  ON tenant.pos_payment_provider_configs(organization_id,store_id,active);

ALTER TABLE tenant.pos_payment_provider_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.pos_payment_provider_configs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pos_payment_provider_configs_organization_isolation ON tenant.pos_payment_provider_configs;
CREATE POLICY pos_payment_provider_configs_organization_isolation ON tenant.pos_payment_provider_configs
  USING (organization_id=tenant.current_organization_id())
  WITH CHECK (organization_id=tenant.current_organization_id());

COMMIT;
