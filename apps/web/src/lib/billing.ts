import type { PoolClient } from "pg";

import { hasWriteAccess } from "@vercentlabs/api";
import type {
  BillingPlanLimits,
  BillingPlanPrice,
  BillingSummary,
  BillingUsageMetric,
} from "@vercentlabs/shared-types";

import { query, transaction } from "@/lib/db";
import { HttpError } from "@/lib/http";

const DEFAULT_LIMITS: BillingPlanLimits = {
  companies: 1,
  branches: 2,
  storage_gb: 25,
  api_requests_monthly: 100_000,
  automation_actions_monthly: 5_000,
  outbound_messages_monthly: 5_000,
  imports_rows_monthly: 25_000,
};

export function billingEnforcementMode(): "observe" | "enforce" {
  const configured = process.env.BILLING_ENFORCEMENT_MODE?.toLowerCase();
  if (configured === "observe" || configured === "enforce") return configured;
  return process.env.NODE_ENV === "production" ? "enforce" : "observe";
}

function limits(value: unknown): BillingPlanLimits {
  if (!value || typeof value !== "object") return DEFAULT_LIMITS;
  return { ...DEFAULT_LIMITS, ...(value as Partial<BillingPlanLimits>) };
}

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  return new Date(value).toISOString();
}

export async function ensureOrganizationBilling(
  client: PoolClient,
  input: { organizationId: string; ownerUserId: string },
) {
  await client.query(
    `
      INSERT INTO billing_customers (organization_id, legal_name, billing_email)
      SELECT $1, o.name, u.email
      FROM organizations o
      JOIN users u ON u.id = $2
      WHERE o.id = $1
      ON CONFLICT (organization_id) DO NOTHING
    `,
    [input.organizationId, input.ownerUserId],
  );

  await client.query(
    `
      INSERT INTO organization_subscriptions (
        organization_id, plan_price_id, status, billing_period,
        trial_started_at, trial_ends_at, grace_ends_at,
        price_snapshot, modules_snapshot, limits_snapshot, metadata
      )
      SELECT
        $1,
        price.id,
        'trialing',
        'monthly',
        now(),
        now() + (plan.trial_days * interval '1 day'),
        now() + ((plan.trial_days + 7) * interval '1 day'),
        jsonb_build_object(
          'plan_code', plan.code,
          'plan_name', plan.name,
          'amount_paise', price.amount_paise,
          'currency', price.currency,
          'billing_period', price.billing_period,
          'version', price.version
        ),
        plan.modules,
        plan.limits,
        jsonb_build_object('source', 'organisation-onboarding')
      FROM billing_plans plan
      JOIN billing_plan_prices price
        ON price.plan_id = plan.id
       AND price.billing_period = 'monthly'
       AND price.active
      WHERE plan.code = 'launch'
      ON CONFLICT (organization_id) DO NOTHING
    `,
    [input.organizationId],
  );
}

export async function listBillingPlans(): Promise<BillingPlanPrice[]> {
  const rows = await query<{
    id: string;
    plan_code: BillingPlanPrice["planCode"];
    plan_name: string;
    description: string;
    billing_period: BillingPlanPrice["billingPeriod"];
    currency: string;
    amount_paise: string | number;
    onboarding_fee_paise: string | number;
    trial_days: number;
    features: string[];
    modules: string[];
    limits: BillingPlanLimits;
    provider_plan_id: string | null;
  }>(
    `
      SELECT
        price.id,
        plan.code AS plan_code,
        plan.name AS plan_name,
        plan.description,
        price.billing_period,
        price.currency,
        price.amount_paise,
        price.onboarding_fee_paise,
        plan.trial_days,
        plan.features,
        plan.modules,
        plan.limits,
        price.provider_plan_id
      FROM billing_plans plan
      JOIN billing_plan_prices price ON price.plan_id = plan.id
      WHERE plan.status = 'active'
        AND plan.is_public
        AND price.active
        AND price.billing_period IN ('monthly', 'yearly')
      ORDER BY plan.display_order, CASE price.billing_period WHEN 'monthly' THEN 0 ELSE 1 END
    `,
  );

  return rows.map((row) => ({
    id: row.id,
    planCode: row.plan_code,
    planName: row.plan_name,
    description: row.description,
    billingPeriod: row.billing_period,
    currency: row.currency,
    amountPaise: Number(row.amount_paise),
    onboardingFeePaise: Number(row.onboarding_fee_paise),
    trialDays: row.trial_days,
    features: Array.isArray(row.features) ? row.features : [],
    modules: Array.isArray(row.modules) ? row.modules.map(String) : [],
    limits: limits(row.limits),
    providerPlanReady: Boolean(row.provider_plan_id),
  }));
}

export async function getBillingSummary(
  organizationId: string,
): Promise<BillingSummary> {
  const rows = await query<{
    status: BillingSummary["status"];
    plan_code: BillingSummary["planCode"];
    plan_name: string;
    billing_period: BillingSummary["billingPeriod"];
    current_period_ends_at: Date | null;
    trial_ends_at: Date | null;
    grace_ends_at: Date | null;
    cancel_at_cycle_end: boolean;
    provider_subscription_id: string | null;
    modules_snapshot: string[];
    limits_snapshot: BillingPlanLimits;
  }>(
    `
      SELECT
        subscription.status,
        plan.code AS plan_code,
        plan.name AS plan_name,
        subscription.billing_period,
        subscription.current_period_ends_at,
        subscription.trial_ends_at,
        subscription.grace_ends_at,
        subscription.cancel_at_cycle_end,
        subscription.provider_subscription_id,
        subscription.modules_snapshot,
        subscription.limits_snapshot
      FROM organization_subscriptions subscription
      JOIN billing_plan_prices price ON price.id = subscription.plan_price_id
      JOIN billing_plans plan ON plan.id = price.plan_id
      WHERE subscription.organization_id = $1
      LIMIT 1
    `,
    [organizationId],
  );

  const row = rows[0];
  if (!row) {
    throw new HttpError(
      409,
      "Billing is not initialised for this organisation.",
    );
  }

  const [usageRows, overrideRows] = await Promise.all([
    query<{ metric: string; quantity: string | number }>(
      `
        SELECT metric, quantity
        FROM billing_usage_monthly
        WHERE organization_id = $1
          AND month_start = date_trunc('month', current_date)::date
      `,
      [organizationId],
    ),
    query<{ entitlement_key: string; entitlement_value: unknown }>(
      `
        SELECT entitlement_key, entitlement_value
        FROM billing_entitlement_overrides
        WHERE organization_id = $1
          AND (expires_at IS NULL OR expires_at > now())
      `,
      [organizationId],
    ),
  ]);
  const usage = Object.fromEntries(
    usageRows.map((item) => [item.metric, Number(item.quantity)]),
  );
  const effectiveLimits = limits(row.limits_snapshot);
  let effectiveModules = Array.isArray(row.modules_snapshot)
    ? row.modules_snapshot.map(String)
    : [];
  for (const override of overrideRows) {
    if (override.entitlement_key === "modules") {
      if (Array.isArray(override.entitlement_value)) {
        effectiveModules = override.entitlement_value.map(String);
      }
      continue;
    }
    if (!(override.entitlement_key in effectiveLimits)) continue;
    const value = Number(override.entitlement_value);
    if (!Number.isFinite(value) || value < 0) continue;
    effectiveLimits[override.entitlement_key as keyof BillingPlanLimits] =
      value;
  }
  const current = {
    status: row.status,
    trialEndsAt: row.trial_ends_at,
    graceEndsAt: row.grace_ends_at,
  };

  return {
    status: row.status,
    planCode: row.plan_code,
    planName: row.plan_name,
    billingPeriod: row.billing_period,
    currentPeriodEndsAt: iso(row.current_period_ends_at),
    trialEndsAt: iso(row.trial_ends_at),
    graceEndsAt: iso(row.grace_ends_at),
    cancelAtCycleEnd: row.cancel_at_cycle_end,
    providerSubscriptionId: row.provider_subscription_id,
    limits: effectiveLimits,
    modules: effectiveModules,
    usage,
    writeAccess: hasWriteAccess(current),
    enforcementMode: billingEnforcementMode(),
  };
}

export async function requireBillingWriteAccess(organizationId: string) {
  const summary = await getBillingSummary(organizationId);
  if (!summary.writeAccess && summary.enforcementMode === "enforce") {
    throw new HttpError(
      402,
      "The subscription is not active. Billing owners can renew from the Billing workspace. Read and export access remains available.",
    );
  }
  return summary;
}

function usageLimit(summary: BillingSummary, metric: BillingUsageMetric) {
  if (metric === "storage_bytes") {
    return Number(summary.limits.storage_gb || 0) * 1024 * 1024 * 1024;
  }
  return Number(summary.limits[metric] || 0);
}

export async function incrementBillingUsage(
  organizationId: string,
  metric: BillingUsageMetric,
  quantity = 1,
) {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new HttpError(400, "Usage quantity must be a positive integer.");
  }

  const summary = await requireBillingWriteAccess(organizationId);
  const maximum = usageLimit(summary, metric);

  if (summary.enforcementMode !== "enforce" || maximum <= 0) {
    await query(
      `
        INSERT INTO billing_usage_monthly (organization_id, month_start, metric, quantity)
        VALUES ($1, date_trunc('month', current_date)::date, $2, $3)
        ON CONFLICT (organization_id, month_start, metric)
        DO UPDATE SET
          quantity = billing_usage_monthly.quantity + EXCLUDED.quantity,
          updated_at = now()
      `,
      [organizationId, metric, quantity],
    );
    return;
  }

  const updated = await transaction(async (client) => {
    await client.query(
      `
        INSERT INTO billing_usage_monthly (organization_id, month_start, metric, quantity)
        VALUES ($1, date_trunc('month', current_date)::date, $2, 0)
        ON CONFLICT (organization_id, month_start, metric) DO NOTHING
      `,
      [organizationId, metric],
    );
    const result = await client.query<{ quantity: string | number }>(
      `
        UPDATE billing_usage_monthly
        SET quantity = quantity + $3, updated_at = now()
        WHERE organization_id = $1
          AND month_start = date_trunc('month', current_date)::date
          AND metric = $2
          AND quantity + $3 <= $4
        RETURNING quantity
      `,
      [organizationId, metric, quantity, maximum],
    );
    return result.rows[0] || null;
  });

  if (!updated) {
    throw new HttpError(
      402,
      `The ${summary.planName} plan has reached its ${metric.replaceAll("_", " ")} allowance. Upgrade or add capacity before continuing.`,
    );
  }
}

export async function assertModuleEntitlement(
  organizationId: string,
  moduleKey: string,
) {
  const summary = await requireBillingWriteAccess(organizationId);
  const allowed =
    summary.modules.includes("*") || summary.modules.includes(moduleKey);
  if (!allowed && summary.enforcementMode === "enforce") {
    throw new HttpError(
      402,
      `The ${summary.planName} plan does not include the ${moduleKey.replaceAll("-", " ")} module. Upgrade the subscription before enabling it.`,
    );
  }
  return summary;
}

export async function assertOrganizationLimit(
  organizationId: string,
  limitKey: "companies" | "branches",
  clientOverride?: PoolClient,
) {
  const summary = await requireBillingWriteAccess(organizationId);
  const maximum = Number(summary.limits[limitKey] || 0);
  if (maximum <= 0 || summary.enforcementMode !== "enforce") return;

  const check = async (client: PoolClient) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      [organizationId, `billing-limit:${limitKey}`],
    );
    const table = limitKey === "companies" ? "companies" : "branches";
    const result = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM ${table} WHERE organization_id = $1 AND status = 'active'`,
      [organizationId],
    );
    const current = result.rows[0]?.count || 0;
    if (current >= maximum) {
      throw new HttpError(
        402,
        `The ${summary.planName} plan includes ${maximum} ${limitKey}. Upgrade the subscription before adding another.`,
      );
    }
  };

  if (clientOverride) return check(clientOverride);
  return transaction(check);
}

export async function replaceOrganizationSubscriptionWithClient(
  client: PoolClient,
  input: {
    organizationId: string;
    planPriceId: string;
    providerSubscriptionId: string;
    checkoutSessionId: string;
  },
) {
    const price = await client.query<{
      billing_period: BillingSummary["billingPeriod"];
      amount_paise: string | number;
      currency: string;
      version: number;
      plan_code: string;
      plan_name: string;
      modules: string[];
      limits: BillingPlanLimits;
    }>(
      `
        SELECT price.billing_period, price.amount_paise, price.currency, price.version,
          plan.code AS plan_code, plan.name AS plan_name, plan.modules, plan.limits
        FROM billing_plan_prices price
        JOIN billing_plans plan ON plan.id = price.plan_id
        WHERE price.id = $1 AND price.active
      `,
      [input.planPriceId],
    );
    const selected = price.rows[0];
    if (!selected)
      throw new HttpError(404, "The selected billing price is unavailable.");

    const result = await client.query<{ id: string }>(
      `
        INSERT INTO organization_subscriptions (
          organization_id, plan_price_id, provider_subscription_id,
          status, provider_status, billing_period,
          price_snapshot, modules_snapshot, limits_snapshot, metadata
        ) VALUES (
          $1, $2, $3, 'checkout_pending', 'created', $4,
          $5::jsonb, $6::jsonb, $7::jsonb, jsonb_build_object('checkout_session_id', $8)
        )
        ON CONFLICT (organization_id) DO UPDATE SET
          plan_price_id = EXCLUDED.plan_price_id,
          provider_subscription_id = EXCLUDED.provider_subscription_id,
          status = EXCLUDED.status,
          provider_status = EXCLUDED.provider_status,
          billing_period = EXCLUDED.billing_period,
          price_snapshot = EXCLUDED.price_snapshot,
          modules_snapshot = EXCLUDED.modules_snapshot,
          limits_snapshot = EXCLUDED.limits_snapshot,
          metadata = EXCLUDED.metadata,
          trial_started_at = NULL,
          trial_ends_at = NULL,
          grace_ends_at = now() + interval '1 day',
          cancel_at_cycle_end = false,
          cancelled_at = NULL
        RETURNING id
      `,
      [
        input.organizationId,
        input.planPriceId,
        input.providerSubscriptionId,
        selected.billing_period,
        JSON.stringify({
          plan_code: selected.plan_code,
          plan_name: selected.plan_name,
          amount_paise: Number(selected.amount_paise),
          currency: selected.currency,
          billing_period: selected.billing_period,
          version: selected.version,
        }),
        JSON.stringify(selected.modules),
        JSON.stringify(selected.limits),
        input.checkoutSessionId,
      ],
    );

    await client.query(
      `
        UPDATE billing_checkout_sessions
        SET subscription_id = $1, provider_subscription_id = $2
        WHERE id = $3 AND organization_id = $4
      `,
      [
        result.rows[0].id,
        input.providerSubscriptionId,
        input.checkoutSessionId,
        input.organizationId,
      ],
    );
    return result.rows[0];
}

export async function replaceOrganizationSubscription(input: {
  organizationId: string;
  planPriceId: string;
  providerSubscriptionId: string;
  checkoutSessionId: string;
}) {
  return transaction((client) =>
    replaceOrganizationSubscriptionWithClient(client, input),
  );
}
