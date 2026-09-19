BEGIN;

-- Shared-platform gap closure: requireBillingWriteAccess (services/api/src/
-- core/entitlements.js) previously treated "no organization_subscriptions
-- row" as unrestricted write access for every organization, with no regard
-- for billing enforcement mode. That is unsafe — an absent subscription
-- record must never itself grant unrestricted access. The corrected
-- function now fails closed (denies ordinary business writes) when no row
-- exists and enforcement is active.
--
-- Migration 005 already backfilled every organization that existed at that
-- time with an explicit, auditable 'internal' (Founder Preview) subscription
-- row via an INSERT ... SELECT ... ON CONFLICT (organization_id) DO NOTHING.
-- That was a one-time statement: any organization inserted after migration
-- 005 ran (by a seed script, an operational/admin process, or a test
-- fixture) never received the same treatment, because there is no ongoing
-- trigger — organization creation is invite-only and administrative by
-- design (SP004), not a runtime self-serve flow, so there is no single
-- application code path to hook a "create the subscription atomically"
-- rule into.
--
-- This migration re-runs that exact same backfill, idempotently, so every
-- organization existing today ends up with a real, recorded subscription
-- row rather than being tolerated by a fail-open code path. Organizations
-- created after this migration runs are the operational team's
-- responsibility to provision with a real plan the same way; the corrected
-- entitlement logic now fails closed for any that are missed, instead of
-- silently granting access.
INSERT INTO organization_subscriptions (
  organization_id, plan_price_id, status, billing_period,
  current_period_started_at, current_period_ends_at, grace_ends_at,
  price_snapshot, modules_snapshot, limits_snapshot, metadata
)
SELECT
  o.id,
  price.id,
  'internal',
  'custom',
  now(),
  now() + interval '90 days',
  now() + interval '97 days',
  jsonb_build_object('plan_code', plan.code, 'amount_paise', price.amount_paise, 'currency', price.currency),
  plan.modules,
  plan.limits,
  jsonb_build_object('source', 'billing-entitlement-backfill-migration-049', 'preview_until', (now() + interval '90 days'))
FROM organizations o
JOIN billing_plans plan ON plan.code = 'founder-preview'
JOIN billing_plan_prices price ON price.plan_id = plan.id AND price.billing_period = 'custom' AND price.active
WHERE NOT EXISTS (
  SELECT 1 FROM organization_subscriptions existing WHERE existing.organization_id = o.id
)
ON CONFLICT (organization_id) DO NOTHING;

COMMIT;
