BEGIN;

-- Commercial model: three plans.
--   Free        - up to 3 users, no charge.
--   Standard    - the same 3 users included; every additional user is Rs 1,000 per month.
--   Enterprise  - coming soon (visible, not purchasable).
-- The earlier flat-price catalogue (launch / growth / scale) is archived, not deleted, because historical
-- subscriptions and invoices may still point at those price rows.

ALTER TABLE billing_plans
  ADD COLUMN IF NOT EXISTS availability text NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS pricing_model text NOT NULL DEFAULT 'flat',
  ADD COLUMN IF NOT EXISTS included_users integer;

ALTER TABLE billing_plans DROP CONSTRAINT IF EXISTS billing_plans_availability_check;
ALTER TABLE billing_plans ADD CONSTRAINT billing_plans_availability_check CHECK (availability IN ('available', 'coming_soon'));
ALTER TABLE billing_plans DROP CONSTRAINT IF EXISTS billing_plans_pricing_model_check;
ALTER TABLE billing_plans ADD CONSTRAINT billing_plans_pricing_model_check CHECK (pricing_model IN ('flat', 'free', 'per_seat'));
ALTER TABLE billing_plans DROP CONSTRAINT IF EXISTS billing_plans_included_users_check;
ALTER TABLE billing_plans ADD CONSTRAINT billing_plans_included_users_check CHECK (included_users IS NULL OR included_users >= 0);

-- paid_seats: users bought beyond the plan's included users. pending_paid_seats: a reduction that takes effect
-- at the next renewal. seat_overage_since: when the organisation first held more users than it pays for.
ALTER TABLE organization_subscriptions
  ADD COLUMN IF NOT EXISTS paid_seats integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_paid_seats integer,
  ADD COLUMN IF NOT EXISTS included_users_snapshot integer,
  ADD COLUMN IF NOT EXISTS seat_overage_since timestamptz;

ALTER TABLE organization_subscriptions DROP CONSTRAINT IF EXISTS organization_subscriptions_paid_seats_check;
ALTER TABLE organization_subscriptions ADD CONSTRAINT organization_subscriptions_paid_seats_check
  CHECK (paid_seats >= 0 AND (pending_paid_seats IS NULL OR pending_paid_seats >= 0));

-- Every seat quantity change is a row, so a charge can always be explained.
CREATE TABLE IF NOT EXISTS billing_seat_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES organization_subscriptions(id) ON DELETE SET NULL,
  from_paid_seats integer NOT NULL CHECK (from_paid_seats >= 0),
  to_paid_seats integer NOT NULL CHECK (to_paid_seats >= 0),
  effective text NOT NULL CHECK (effective IN ('now', 'cycle_end')),
  status text NOT NULL DEFAULT 'applied' CHECK (status IN ('pending', 'applied', 'failed', 'cancelled')),
  reason text NOT NULL DEFAULT '',
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  provider_reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_seat_changes_org_idx ON billing_seat_changes(organization_id, created_at DESC);

INSERT INTO billing_plans (code, name, description, display_order, trial_days, is_public, availability, pricing_model, included_users, features, modules, limits, cost_model) VALUES
  (
    'free', 'Free', 'Everything in Vercentlabs for a small team: up to 3 users at no charge.', 10, 0, true, 'available', 'free', 3,
    '["Up to 3 users", "All released modules", "Email support"]'::jsonb,
    '["*"]'::jsonb,
    '{"companies": 3, "branches": 10, "storage_gb": 50, "api_requests_monthly": 200000, "automation_actions_monthly": 10000, "outbound_messages_monthly": 10000, "imports_rows_monthly": 100000}'::jsonb,
    '{"estimated_direct_cost_paise": 0, "gateway_reserve_percent": 0, "minimum_margin_percent": 0}'::jsonb
  ),
  (
    'standard', 'Standard', 'Your first 3 users are included. Each additional user is Rs 1,000 per month.', 20, 0, true, 'available', 'per_seat', 3,
    '["First 3 users included", "Rs 1,000 per additional user per month", "All released modules", "Add or remove users any time", "Priority email support"]'::jsonb,
    '["*"]'::jsonb,
    '{"companies": 10, "branches": 50, "storage_gb": 500, "api_requests_monthly": 2000000, "automation_actions_monthly": 100000, "outbound_messages_monthly": 100000, "imports_rows_monthly": 1000000}'::jsonb,
    '{"estimated_direct_cost_paise": 0, "gateway_reserve_percent": 4, "minimum_margin_percent": 0}'::jsonb
  )
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, display_order = EXCLUDED.display_order,
  trial_days = EXCLUDED.trial_days, is_public = EXCLUDED.is_public, availability = EXCLUDED.availability,
  pricing_model = EXCLUDED.pricing_model, included_users = EXCLUDED.included_users, features = EXCLUDED.features,
  modules = EXCLUDED.modules, limits = EXCLUDED.limits, cost_model = EXCLUDED.cost_model, status = 'active';

-- Third plan: shown as coming soon and refused at checkout.
UPDATE billing_plans SET
  availability = 'coming_soon', is_public = true, display_order = 30, status = 'active',
  description = 'Coming soon: dedicated infrastructure, custom controls and contracted service levels.',
  features = '["Coming soon"]'::jsonb
WHERE code = 'enterprise';

UPDATE billing_plans SET status = 'archived', is_public = false WHERE code IN ('launch', 'growth', 'scale');

WITH prices(plan_code, billing_period, amount_paise) AS (
  VALUES ('free', 'monthly', 0::bigint), ('standard', 'monthly', 100000::bigint)
)
INSERT INTO billing_plan_prices (plan_id, billing_period, amount_paise, onboarding_fee_paise, version)
SELECT plan.id, prices.billing_period, prices.amount_paise, 0, 1
FROM prices JOIN billing_plans plan ON plan.code = prices.plan_code
ON CONFLICT (plan_id, billing_period, version) DO UPDATE SET
  amount_paise = EXCLUDED.amount_paise, onboarding_fee_paise = 0, active = true, retired_at = NULL;

-- Organisations on the retired trial catalogue with no payment provider subscription move to Free. A converted
-- organisation already holding more than 3 users starts a 14 day period to add seats or remove users.
-- Internal (founder preview) organisations are left alone.
WITH free_price AS (
  SELECT price.id, plan.modules, plan.limits, plan.included_users, plan.code, plan.name, price.amount_paise, price.currency
  FROM billing_plans plan JOIN billing_plan_prices price ON price.plan_id = plan.id AND price.billing_period = 'monthly' AND price.active
  WHERE plan.code = 'free'
)
UPDATE organization_subscriptions subscription SET
  plan_price_id = free_price.id,
  status = 'active',
  billing_period = 'monthly',
  trial_started_at = NULL, trial_ends_at = NULL, grace_ends_at = NULL,
  current_period_started_at = now(), current_period_ends_at = NULL,
  cancel_at_cycle_end = false, cancelled_at = NULL,
  price_snapshot = jsonb_build_object('plan_code', free_price.code, 'plan_name', free_price.name, 'amount_paise', free_price.amount_paise, 'currency', free_price.currency),
  modules_snapshot = free_price.modules,
  limits_snapshot = free_price.limits,
  included_users_snapshot = free_price.included_users,
  paid_seats = 0, pending_paid_seats = NULL,
  metadata = subscription.metadata || jsonb_build_object('migrated_to_free_by', '054_seat_based_plans'),
  seat_overage_since = CASE
    WHEN (SELECT count(*) FROM organization_memberships m WHERE m.organization_id = subscription.organization_id AND m.status = 'active') > free_price.included_users
    THEN now() ELSE NULL END
FROM free_price
WHERE subscription.provider_subscription_id IS NULL
  AND subscription.status IN ('trialing', 'checkout_pending', 'expired', 'cancelled', 'completed');

CREATE OR REPLACE FUNCTION ensure_organization_subscription()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO organization_subscriptions (
    organization_id, plan_price_id, status, billing_period,
    current_period_started_at,
    price_snapshot, modules_snapshot, limits_snapshot, included_users_snapshot, metadata
  )
  SELECT
    NEW.id, price.id, 'active', 'monthly', now(),
    jsonb_build_object('plan_code', plan.code, 'plan_name', plan.name, 'amount_paise', price.amount_paise, 'currency', price.currency),
    plan.modules, plan.limits, plan.included_users,
    jsonb_build_object('source', 'organizations_ensure_subscription_trigger')
  FROM billing_plans plan
  JOIN billing_plan_prices price ON price.plan_id = plan.id AND price.billing_period = 'monthly' AND price.active
  WHERE plan.code = 'free'
  ON CONFLICT (organization_id) DO NOTHING;
  RETURN NEW;
END;
$$;

COMMIT;
