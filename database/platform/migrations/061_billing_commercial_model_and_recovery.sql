BEGIN;

-- SaaS billing (Vercentlabs charging its own customers; never tenant Accounting).
--
-- 1. Commercial model: Free = 1 included user; Standard = first user included,
--    Rs 1,000 (100000 paise) per additional user per month; Custom (plan code
--    `enterprise`, kept for history) is contracted and never self-serve.
-- 2. Price versions become immutable. Commercial terms (amount, currency,
--    period, included users) belong to a price VERSION; a change creates a new
--    version. The Free/Standard v1 rows (3 included users) are retired, not
--    edited, so every historical subscription, checkout, payment and provider
--    plan still points at the terms it was sold under.
-- 3. Existing organisations:
--    - Free: moved to Free v2 (1 included user). Nobody is removed or disabled.
--      Organisations using more than 1 user (active members + valid pending
--      invitations) start the existing 14-day seat-overage grace.
--    - Standard with a provider subscription: UNCHANGED. Their price version,
--      included users (3), paid seats, provider plan, period and history are
--      preserved; their next charge does not change. Moving them to the new
--      terms needs a deliberate provider-side plan change, never this migration.
--    - Standard without a provider subscription (not a real paid contract):
--      moved to Standard v2 keeping paid seats; the overage grace applies if
--      the smaller capacity no longer covers usage.
--    - Internal (founder preview) and custom contracts: untouched.
-- 4. Durable intent / recovery columns for the checkout, seat-change and
--    cancellation sagas and for leased webhook processing.

-- ------------------------------------------------------------------ catalogue
ALTER TABLE billing_plan_prices ADD COLUMN IF NOT EXISTS included_users integer;
ALTER TABLE billing_plan_prices DROP CONSTRAINT IF EXISTS billing_plan_prices_included_users_check;
ALTER TABLE billing_plan_prices ADD CONSTRAINT billing_plan_prices_included_users_check CHECK (included_users IS NULL OR included_users >= 0);

-- The v1 seat prices were sold with 3 included users (migration 054).
UPDATE billing_plan_prices price SET included_users = 3
  FROM billing_plans plan
 WHERE plan.id = price.plan_id AND plan.code IN ('free', 'standard') AND price.version = 1 AND price.included_users IS NULL;

ALTER TABLE billing_plans DROP CONSTRAINT IF EXISTS billing_plans_availability_check;
ALTER TABLE billing_plans ADD CONSTRAINT billing_plans_availability_check CHECK (availability IN ('available', 'coming_soon', 'contact_sales'));
ALTER TABLE billing_plans DROP CONSTRAINT IF EXISTS billing_plans_pricing_model_check;
ALTER TABLE billing_plans ADD CONSTRAINT billing_plans_pricing_model_check CHECK (pricing_model IN ('flat', 'free', 'per_seat', 'custom'));

-- Retire superseded versions (history keeps them; new checkout never uses them).
UPDATE billing_plan_prices price SET active = false, retired_at = COALESCE(price.retired_at, now())
  FROM billing_plans plan
 WHERE plan.id = price.plan_id AND price.active
   AND ((plan.code IN ('free', 'standard') AND price.version = 1) OR plan.status = 'archived');

INSERT INTO billing_plan_prices (plan_id, billing_period, currency, amount_paise, onboarding_fee_paise, version, included_users, active, effective_at)
SELECT plan.id, 'monthly', 'INR', terms.amount_paise, 0, 2, 1, true, now()
  FROM (VALUES ('free', 0::bigint), ('standard', 100000::bigint)) AS terms(code, amount_paise)
  JOIN billing_plans plan ON plan.code = terms.code
ON CONFLICT (plan_id, billing_period, version) DO NOTHING;

UPDATE billing_plans SET
  included_users = 1, availability = 'available', pricing_model = 'free', status = 'active', is_public = true, display_order = 10,
  description = 'For one person getting started: 1 user at no charge.',
  features = '["1 user included", "All released modules", "Email support"]'::jsonb
WHERE code = 'free';

UPDATE billing_plans SET
  included_users = 1, availability = 'available', pricing_model = 'per_seat', status = 'active', is_public = true, display_order = 20,
  description = 'Your first user is included. Each additional user is ₹1,000 per month.',
  features = '["First user included", "₹1,000 per additional user per month", "All released modules", "Add or remove users any time", "Priority email support"]'::jsonb
WHERE code = 'standard';

-- Custom keeps its historical code `enterprise`; it is contracted, never bought online.
UPDATE billing_plans SET
  name = 'Custom', availability = 'contact_sales', pricing_model = 'custom', included_users = NULL, status = 'active', is_public = true, display_order = 30,
  description = 'Contracted pricing, users, modules and limits for larger organisations.',
  features = '["Contracted users and limits", "Selected modules", "Custom onboarding and support"]'::jsonb
WHERE code = 'enterprise';

-- One current price per plan and period.
CREATE UNIQUE INDEX IF NOT EXISTS billing_plan_prices_one_active_uidx ON billing_plan_prices(plan_id, billing_period) WHERE active;

CREATE OR REPLACE FUNCTION guard_billing_price_version()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.plan_id IS DISTINCT FROM OLD.plan_id OR NEW.billing_period IS DISTINCT FROM OLD.billing_period
     OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.amount_paise IS DISTINCT FROM OLD.amount_paise
     OR NEW.onboarding_fee_paise IS DISTINCT FROM OLD.onboarding_fee_paise OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.included_users IS DISTINCT FROM OLD.included_users OR NEW.provider IS DISTINCT FROM OLD.provider THEN
    RAISE EXCEPTION 'billing price version % is immutable; create a new version instead', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.provider_plan_id IS NOT NULL AND NEW.provider_plan_id IS DISTINCT FROM OLD.provider_plan_id THEN
    RAISE EXCEPTION 'billing price version % is permanently linked to its provider plan', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NOT OLD.active AND NEW.active THEN
    RAISE EXCEPTION 'retired billing price version % cannot be reactivated', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS billing_plan_prices_immutable ON billing_plan_prices;
CREATE TRIGGER billing_plan_prices_immutable BEFORE UPDATE ON billing_plan_prices FOR EACH ROW EXECUTE FUNCTION guard_billing_price_version();

-- ------------------------------------------------------------------ existing organisations
WITH v1 AS (
  SELECT price.id, plan.code FROM billing_plan_prices price JOIN billing_plans plan ON plan.id = price.plan_id
   WHERE plan.code IN ('free', 'standard') AND price.version = 1
), v2 AS (
  SELECT price.id, plan.code, plan.name, plan.modules, plan.limits, price.amount_paise, price.currency, price.version
    FROM billing_plan_prices price JOIN billing_plans plan ON plan.id = price.plan_id
   WHERE plan.code IN ('free', 'standard') AND price.version = 2
), usage AS (
  SELECT subscription.organization_id,
         (SELECT count(*) FROM organization_memberships m WHERE m.organization_id = subscription.organization_id AND m.status = 'active')
       + (SELECT count(DISTINCT lower(i.email)) FROM organization_invitations i
           WHERE i.organization_id = subscription.organization_id AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
             AND NOT EXISTS (SELECT 1 FROM organization_memberships m JOIN users u ON u.id = m.user_id
                              WHERE m.organization_id = i.organization_id AND m.status = 'active' AND lower(u.email) = lower(i.email))) AS used
    FROM organization_subscriptions subscription
)
UPDATE organization_subscriptions subscription SET
  plan_price_id = v2.id,
  included_users_snapshot = 1,
  price_snapshot = jsonb_build_object('plan_code', v2.code, 'plan_name', v2.name, 'amount_paise', v2.amount_paise, 'currency', v2.currency,
                                      'billing_period', 'monthly', 'version', v2.version, 'included_users', 1),
  modules_snapshot = v2.modules,
  limits_snapshot = v2.limits,
  seat_overage_since = CASE WHEN usage.used > 1 + subscription.paid_seats THEN COALESCE(subscription.seat_overage_since, now()) ELSE NULL END,
  metadata = subscription.metadata || jsonb_build_object('commercial_model_migration', '061', 'previous_included_users', subscription.included_users_snapshot)
FROM v1, v2, usage
WHERE subscription.plan_price_id = v1.id AND v2.code = v1.code AND usage.organization_id = subscription.organization_id
  AND subscription.provider_subscription_id IS NULL;

-- Real paid contracts keep their v1 terms; mark them so the UI and support can explain the difference.
UPDATE organization_subscriptions subscription SET
  metadata = subscription.metadata || jsonb_build_object('legacy_commercial_terms', true, 'legacy_terms_reason', '061: provider subscription preserved on v1 terms')
FROM billing_plan_prices price JOIN billing_plans plan ON plan.id = price.plan_id
WHERE subscription.plan_price_id = price.id AND plan.code = 'standard' AND price.version = 1
  AND subscription.provider_subscription_id IS NOT NULL AND NOT (subscription.metadata ? 'legacy_commercial_terms');

-- New organisations: current Free version, included users from the version.
CREATE OR REPLACE FUNCTION ensure_organization_subscription()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO organization_subscriptions (
    organization_id, plan_price_id, status, billing_period, current_period_started_at,
    price_snapshot, modules_snapshot, limits_snapshot, included_users_snapshot, metadata
  )
  SELECT
    NEW.id, price.id, 'active', 'monthly', now(),
    jsonb_build_object('plan_code', plan.code, 'plan_name', plan.name, 'amount_paise', price.amount_paise, 'currency', price.currency,
                       'billing_period', price.billing_period, 'version', price.version, 'included_users', price.included_users),
    plan.modules, plan.limits, price.included_users,
    jsonb_build_object('source', 'organizations_ensure_subscription_trigger')
  FROM billing_plans plan
  JOIN billing_plan_prices price ON price.plan_id = plan.id AND price.billing_period = 'monthly' AND price.active
  WHERE plan.code = 'free'
  ON CONFLICT (organization_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------ subscription state / intents
ALTER TABLE organization_subscriptions
  ADD COLUMN IF NOT EXISTS last_provider_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciliation_required_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciliation_note text,
  ADD COLUMN IF NOT EXISTS cancellation_state text,
  ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancel_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancel_next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_last_error text;
ALTER TABLE organization_subscriptions DROP CONSTRAINT IF EXISTS organization_subscriptions_cancellation_state_check;
ALTER TABLE organization_subscriptions ADD CONSTRAINT organization_subscriptions_cancellation_state_check
  CHECK (cancellation_state IS NULL OR cancellation_state IN ('provider_pending', 'scheduled', 'failed'));
CREATE INDEX IF NOT EXISTS billing_subscriptions_reconcile_idx ON organization_subscriptions(last_provider_sync_at)
  WHERE provider_subscription_id IS NOT NULL;

ALTER TABLE billing_checkout_sessions
  ADD COLUMN IF NOT EXISTS provider_payment_id text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS expected_provider_plan_id text,
  ADD COLUMN IF NOT EXISTS expected_quantity integer,
  ADD COLUMN IF NOT EXISTS attention_required_at timestamptz;
CREATE INDEX IF NOT EXISTS billing_checkout_recovery_idx ON billing_checkout_sessions(next_recovery_at)
  WHERE status IN ('provider_creating', 'provider_link_pending', 'provider_recovery_pending', 'verifying', 'cancel_pending', 'created');

ALTER TABLE billing_seat_changes
  ADD COLUMN IF NOT EXISTS operation text NOT NULL DEFAULT 'change',
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS provider_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS applied_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE billing_seat_changes DROP CONSTRAINT IF EXISTS billing_seat_changes_status_check;
ALTER TABLE billing_seat_changes ADD CONSTRAINT billing_seat_changes_status_check
  CHECK (status IN ('provider_pending', 'pending', 'applied', 'failed', 'cancelled', 'superseded'));
ALTER TABLE billing_seat_changes DROP CONSTRAINT IF EXISTS billing_seat_changes_operation_check;
ALTER TABLE billing_seat_changes ADD CONSTRAINT billing_seat_changes_operation_check CHECK (operation IN ('change', 'cancel_reduction'));
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY organization_id ORDER BY created_at DESC, id DESC) AS rank
    FROM billing_seat_changes WHERE status = 'pending'
)
UPDATE billing_seat_changes change SET status = 'superseded' FROM ranked WHERE ranked.id = change.id AND ranked.rank > 1;
-- At most one in-flight provider operation and one scheduled reduction per organisation.
CREATE UNIQUE INDEX IF NOT EXISTS billing_seat_changes_one_inflight_uidx ON billing_seat_changes(organization_id) WHERE status = 'provider_pending';
CREATE UNIQUE INDEX IF NOT EXISTS billing_seat_changes_one_scheduled_uidx ON billing_seat_changes(organization_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS billing_seat_changes_recovery_idx ON billing_seat_changes(next_attempt_at) WHERE status = 'provider_pending';
DROP TRIGGER IF EXISTS billing_seat_changes_touch_updated_at ON billing_seat_changes;
CREATE TRIGGER billing_seat_changes_touch_updated_at BEFORE UPDATE ON billing_seat_changes FOR EACH ROW EXECUTE FUNCTION touch_billing_updated_at();

-- ------------------------------------------------------------------ webhooks
-- Leased processing owner. New rows no longer store the signature: it only
-- authenticates ingestion. Historical values are left as they are.
ALTER TABLE billing_webhook_events
  ADD COLUMN IF NOT EXISTS processing_owner text,
  ADD COLUMN IF NOT EXISTS event_id_source text NOT NULL DEFAULT 'header';
ALTER TABLE billing_webhook_events DROP CONSTRAINT IF EXISTS billing_webhook_events_event_id_source_check;
ALTER TABLE billing_webhook_events ADD CONSTRAINT billing_webhook_events_event_id_source_check CHECK (event_id_source IN ('header', 'derived'));
CREATE INDEX IF NOT EXISTS billing_webhook_claim_idx ON billing_webhook_events(COALESCE(next_attempt_at, created_at))
  WHERE processing_status IN ('received', 'failed', 'processing');

-- ------------------------------------------------------------------ payments / documents
ALTER TABLE billing_payments
  ADD COLUMN IF NOT EXISTS amount_refunded_paise bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_status text;
ALTER TABLE billing_payments DROP CONSTRAINT IF EXISTS billing_payments_amounts_check;
ALTER TABLE billing_payments ADD CONSTRAINT billing_payments_amounts_check CHECK (amount_paise >= 0 AND amount_refunded_paise >= 0);
-- Documents recorded here are the payment provider's invoices/receipts, not Vercentlabs tax invoices.
ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS document_kind text NOT NULL DEFAULT 'provider_invoice';
ALTER TABLE billing_invoices DROP CONSTRAINT IF EXISTS billing_invoices_document_kind_check;
ALTER TABLE billing_invoices ADD CONSTRAINT billing_invoices_document_kind_check CHECK (document_kind IN ('provider_invoice'));

-- ------------------------------------------------------------------ billing profile
ALTER TABLE billing_customers
  ADD COLUMN IF NOT EXISTS address_line1 text,
  ADD COLUMN IF NOT EXISTS address_line2 text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS state_code text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS country_code text NOT NULL DEFAULT 'IN';
UPDATE billing_customers SET
  address_line1 = COALESCE(address_line1, NULLIF(billing_address->>'line1', '')),
  city = COALESCE(city, NULLIF(billing_address->>'city', '')),
  state = COALESCE(state, NULLIF(billing_address->>'state', '')),
  postal_code = COALESCE(postal_code, NULLIF(billing_address->>'postalCode', '')),
  country_code = CASE WHEN upper(billing_address->>'country') ~ '^[A-Z]{2}$' THEN upper(billing_address->>'country') ELSE country_code END
WHERE billing_address <> '{}'::jsonb;
ALTER TABLE billing_customers DROP CONSTRAINT IF EXISTS billing_customers_state_code_check;
ALTER TABLE billing_customers ADD CONSTRAINT billing_customers_state_code_check CHECK (state_code IS NULL OR state_code ~ '^[0-9]{2}$');
ALTER TABLE billing_customers DROP CONSTRAINT IF EXISTS billing_customers_country_code_check;
ALTER TABLE billing_customers ADD CONSTRAINT billing_customers_country_code_check CHECK (country_code ~ '^[A-Z]{2}$');

COMMIT;
