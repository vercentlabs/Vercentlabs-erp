-- Billing: every new company starts on a 30-day trial of Standard (every app, any number of users) with no payment asked.
--
-- The subscription is the Standard monthly price with status 'trialing' and trial_ends_at 30 days out. No users are included or paid
-- for during the trial (included_users_snapshot NULL = no user limit), so inviting the team is never blocked. When the trial ends the
-- apps stop until the company subscribes to Standard or moves to Free (1 user, 1 app); its data is kept either way. Companies that
-- already exist keep their plan. If no Standard monthly price is on sale, a new company starts on Free as before.
CREATE OR REPLACE FUNCTION public.ensure_organization_subscription() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO organization_subscriptions (
    organization_id, plan_price_id, status, billing_period, current_period_started_at, current_period_ends_at, trial_started_at, trial_ends_at,
    price_snapshot, modules_snapshot, limits_snapshot, included_users_snapshot, paid_seats, metadata
  )
  SELECT
    NEW.id, price.id, 'trialing', 'monthly', now(), now() + interval '30 days', now(), now() + interval '30 days',
    jsonb_build_object('plan_code', plan.code, 'plan_name', plan.name, 'amount_paise', price.amount_paise, 'currency', price.currency,
                       'billing_period', price.billing_period, 'version', price.version, 'included_users', price.included_users),
    plan.modules, plan.limits, NULL, 0,
    jsonb_build_object('source', 'organizations_ensure_subscription_trigger', 'trial_days', 30)
  FROM billing_plans plan
  JOIN billing_plan_prices price ON price.plan_id = plan.id AND price.billing_period = 'monthly' AND price.active
  WHERE plan.code = 'standard'
  ORDER BY price.version DESC
  LIMIT 1
  ON CONFLICT (organization_id) DO NOTHING;

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
