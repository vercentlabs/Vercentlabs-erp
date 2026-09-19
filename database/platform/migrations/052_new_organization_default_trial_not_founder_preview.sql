BEGIN;

-- SECURITY/BUSINESS-INTEGRITY FIX (visual-QA preflight, flagged before any
-- UI work began): migration 051's organizations_ensure_subscription
-- trigger granted EVERY newly-created organization -- not just the
-- historical orgs migrations 005/049 deliberately backfilled -- a
-- 'status = internal' (Founder Preview) subscription: unconditional write
-- access (hasWriteAccess() never expires 'internal'), every module
-- (founder-preview's modules snapshot is the wildcard '["*"]'), at
-- amount_paise = 0, forever. Founder Preview was always meant for
-- "existing development organisations" (migration 005's own plan
-- description), not a silent default for every future organization,
-- ordinary paying customers included. Left as-is, this would have made
-- the entire billing/entitlement system meaningless for any organization
-- created after 051 shipped -- nobody would ever need to pay or even
-- start a real trial.
--
-- The fix: new organizations now default to a genuine, real TRIAL of the
-- base paid plan ('launch') -- real trial_days from that plan's own
-- catalog row, real (narrower) module/limit entitlements, a real
-- trial_ends_at that hasWriteAccess() actually enforces once it passes.
-- Founder Preview/'internal' status is no longer granted automatically by
-- anything -- it now only ever exists on an organization through an
-- explicit, deliberate action (the historical migration 049 backfill, or
-- a future admin operation), never as a side effect of organization
-- creation.
CREATE OR REPLACE FUNCTION ensure_organization_subscription()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO organization_subscriptions (
    organization_id, plan_price_id, status, billing_period,
    trial_started_at, trial_ends_at,
    current_period_started_at, current_period_ends_at,
    price_snapshot, modules_snapshot, limits_snapshot, metadata
  )
  SELECT
    NEW.id,
    price.id,
    'trialing',
    'monthly',
    now(),
    now() + make_interval(days => GREATEST(plan.trial_days, 1)),
    now(),
    now() + make_interval(days => GREATEST(plan.trial_days, 1)),
    jsonb_build_object('plan_code', plan.code, 'amount_paise', price.amount_paise, 'currency', price.currency),
    plan.modules,
    plan.limits,
    jsonb_build_object('source', 'organizations_ensure_subscription_trigger', 'trial_days', plan.trial_days)
  FROM billing_plans plan
  JOIN billing_plan_prices price ON price.plan_id = plan.id AND price.billing_period = 'monthly' AND price.active
  WHERE plan.code = 'launch'
  ON CONFLICT (organization_id) DO NOTHING;
  RETURN NEW;
END;
$$;

COMMIT;
