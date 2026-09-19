BEGIN;

-- Shared-platform completion pass: "ensure the normal organization-
-- creation process does not produce new organizations without initialized
-- billing state." There is no application code path that creates an
-- organization today (confirmed by exhaustive search of services/api/src
-- and apps/web/src -- organization creation is invite-only/administrative
-- per SP004, never self-serve), so there is no single function to make
-- "always create the subscription row too." Relying on every future
-- caller -- application code, an operational script, a future self-serve
-- flow -- to remember to do this is exactly the kind of fragile,
-- easy-to-forget discipline this pass's billing-safety correction was
-- meant to move away from.
--
-- A database trigger makes the invariant structural instead: the instant
-- ANY row is inserted into organizations, through ANY path, it
-- automatically receives a real, auditable 'internal' (Founder Preview)
-- subscription row -- the exact same mechanism (same plan, same $0 custom
-- price) migrations 005 and 049 already used for the historical backfill,
-- not a new or different kind of record. This is explicit initialization,
-- not a bypass: it is a real row, visible in organization_subscriptions
-- like any other, that a billing administrator can see and upgrade.
CREATE OR REPLACE FUNCTION ensure_organization_subscription()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO organization_subscriptions (
    organization_id, plan_price_id, status, billing_period,
    current_period_started_at, current_period_ends_at, grace_ends_at,
    price_snapshot, modules_snapshot, limits_snapshot, metadata
  )
  SELECT
    NEW.id,
    price.id,
    'internal',
    'custom',
    now(),
    now() + interval '90 days',
    now() + interval '97 days',
    jsonb_build_object('plan_code', plan.code, 'amount_paise', price.amount_paise, 'currency', price.currency),
    plan.modules,
    plan.limits,
    jsonb_build_object('source', 'organizations_ensure_subscription_trigger', 'preview_until', (now() + interval '90 days'))
  FROM billing_plans plan
  JOIN billing_plan_prices price ON price.plan_id = plan.id AND price.billing_period = 'custom' AND price.active
  WHERE plan.code = 'founder-preview'
  ON CONFLICT (organization_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizations_ensure_subscription ON organizations;
CREATE TRIGGER organizations_ensure_subscription
  AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION ensure_organization_subscription();

COMMIT;
