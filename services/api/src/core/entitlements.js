// Ported from docs/frontend-rebuild/recovered-platform-code/apps/web/src/
// core/billing.ts. Named "entitlements.js" (not "billing.js") to avoid
// colliding with the existing services/api/src/core/billing.js, which
// handles Razorpay plan/status-mapping only — a distinct concern from the
// usage/entitlement policy ported here.
//
// Security/business properties preserved: enforcement-mode awareness
// (observe vs enforce, defaulting to enforce only in production) so a
// billing lookup failure never silently blocks in non-production;
// idempotency-key-checked usage increments with divergence detection;
// advisory-lock-serialized organization-limit checks (companies/branches)
// to prevent a race from exceeding a plan's seat/company limit.
//
// hasWriteAccess is imported from billing.js, not redefined here -- this
// file's own port originally DID redefine it, and because both modules
// are re-exported with `export *` from the same services/api barrel
// (index.js), the two same-named bindings collided: whichever module's
// `export *` Node resolves last silently wins the whole app's actual
// behavior, with no error and no indication the other definition was ever
// dead. Confirmed empirically, not assumed -- importing hasWriteAccess
// from "@vercentlabs/api" resolved to billing.js's version regardless of
// what entitlements.js's own copy said, which is exactly "a competing
// billing status predicate" this file must never have.
import { hasWriteAccess } from "./billing.js";

export class EntitlementError extends Error {
  constructor(status, message, code = "ENTITLEMENT_ERROR") {
    super(message);
    this.name = "EntitlementError";
    this.status = status;
    this.code = code;
  }
}

const SEAT_OVERAGE_GRACE_DAYS = 14;

const DEFAULT_LIMITS = Object.freeze({
  companies: 1,
  branches: 2,
  storage_gb: 25,
  api_requests_monthly: 100_000,
  automation_actions_monthly: 5_000,
  outbound_messages_monthly: 5_000,
  imports_rows_monthly: 25_000,
});

function limits(value) {
  if (!value || typeof value !== "object") return { ...DEFAULT_LIMITS };
  return { ...DEFAULT_LIMITS, ...value };
}

function iso(value) {
  return value ? new Date(value).toISOString() : null;
}

export function billingEnforcementMode(env = process.env) {
  const configured = env.BILLING_ENFORCEMENT_MODE?.toLowerCase();
  if (configured === "observe" || configured === "enforce") return configured;
  return env.NODE_ENV === "production" ? "enforce" : "observe";
}

export async function getBillingSummary(client, organizationId, env = process.env) {
  const rows = await client.query(
    `SELECT
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
        subscription.limits_snapshot,
        subscription.paid_seats,
        subscription.included_users_snapshot,
        subscription.seat_overage_since
      FROM organization_subscriptions subscription
      JOIN billing_plan_prices price ON price.id = subscription.plan_price_id
      JOIN billing_plans plan ON plan.id = price.plan_id
      WHERE subscription.organization_id = $1
      LIMIT 1`,
    [organizationId],
  );
  const row = rows.rows[0];
  if (!row) throw new EntitlementError(409, "Billing is not initialised for this organisation.");

  // Sequential, not Promise.all: a single pg client/connection can only
  // run one query at a time -- two queries issued concurrently on the
  // same client is a deprecated pattern (pg queues them internally today,
  // but warns, and pg@9 removes the queueing) that surfaced as a real
  // console warning in production usage (getAccessibleModules calls
  // resolveModuleAccess, which calls this, for all 12 modules concurrently
  // via its own Promise.all -- compounding the same mistake at two
  // levels).
  const usageRows = await client.query(
    `SELECT metric, quantity FROM billing_usage_monthly
      WHERE organization_id = $1 AND month_start = date_trunc('month', current_date)::date`,
    [organizationId],
  );
  const overrideRows = await client.query(
    `SELECT entitlement_key, entitlement_value FROM billing_entitlement_overrides
      WHERE organization_id = $1 AND (expires_at IS NULL OR expires_at > now())`,
    [organizationId],
  );
  const usage = Object.fromEntries(usageRows.rows.map((item) => [item.metric, Number(item.quantity)]));
  const effectiveLimits = limits(row.limits_snapshot);
  let effectiveModules = Array.isArray(row.modules_snapshot) ? row.modules_snapshot.map(String) : [];
  for (const override of overrideRows.rows) {
    if (override.entitlement_key === "modules") {
      if (Array.isArray(override.entitlement_value)) {
        effectiveModules = override.entitlement_value.map(String);
      }
      continue;
    }
    if (!(override.entitlement_key in effectiveLimits)) continue;
    const value = Number(override.entitlement_value);
    if (!Number.isFinite(value) || value < 0) continue;
    effectiveLimits[override.entitlement_key] = value;
  }

  // A plan with a user allowance stays writable while the organisation holds more users than it pays for, but only
  // for a grace period; after that the organisation is read-only until it adds seats or removes users.
  const includedUsers = row.included_users_snapshot === null || row.included_users_snapshot === undefined ? null : Number(row.included_users_snapshot);
  const overageSince = row.seat_overage_since ? new Date(row.seat_overage_since) : null;
  const overageLockedAt = overageSince ? new Date(overageSince.getTime() + SEAT_OVERAGE_GRACE_DAYS * 86_400_000) : null;
  const seatLocked = includedUsers !== null && overageLockedAt !== null && overageLockedAt.getTime() < Date.now();

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
    seats: { includedUsers, paidSeats: Number(row.paid_seats || 0), capacity: includedUsers === null ? null : includedUsers + Number(row.paid_seats || 0) },
    seatOverage: seatLocked ? { since: iso(overageSince), lockedAt: iso(overageLockedAt) } : null,
    writeAccess:
      !seatLocked &&
      hasWriteAccess({
        status: row.status,
        trialEndsAt: row.trial_ends_at,
        graceEndsAt: row.grace_ends_at,
      }),
    enforcementMode: billingEnforcementMode(env),
  };
}

// A synthetic summary used ONLY when no organization_subscriptions row
// exists AND enforcement is not active (billingEnforcementMode() !==
// "enforce" -- the default everywhere except NODE_ENV=production, unless
// BILLING_ENFORCEMENT_MODE is set explicitly). It grants unrestricted
// module/limit access, matching this codebase's existing "observe mode
// never blocks" contract, but it is an explicit, typed sentinel rather
// than a bare null -- callers such as assertModuleEntitlement/
// assertOrganizationLimit read summary.modules/summary.limits
// unconditionally, so returning null here was a latent crash waiting for
// the first real caller.
function unprovisionedObserveSummary(env) {
  return {
    status: "unprovisioned",
    planCode: null,
    planName: "Unprovisioned",
    billingPeriod: null,
    currentPeriodEndsAt: null,
    trialEndsAt: null,
    graceEndsAt: null,
    cancelAtCycleEnd: false,
    providerSubscriptionId: null,
    limits: { ...DEFAULT_LIMITS },
    modules: ["*"],
    usage: {},
    writeAccess: true,
    enforcementMode: billingEnforcementMode(env),
  };
}

export async function requireBillingWriteAccess(client, organizationId, env = process.env) {
  let summary;
  try {
    summary = await getBillingSummary(client, organizationId, env);
  } catch (error) {
    if (!(error instanceof EntitlementError) || error.status !== 409) throw error;
    // "Billing is not initialised" (no organization_subscriptions row at
    // all) must NEVER be treated as unrestricted access on its own -- an
    // absent subscription record is not proof of entitlement. Outside
    // enforce mode (local/dev/test default, and any environment that
    // hasn't explicitly turned enforcement on) this still doesn't block,
    // matching the existing "observe mode never blocks" contract. Once
    // enforcement is actually active, a missing row is treated exactly
    // like an inactive subscription: deny ordinary business writes. Every
    // real organization is expected to carry an explicit, auditable
    // subscription row (see migrations 005 and 049's founder-preview
    // backfill) -- a row still missing at that point is a genuine
    // provisioning gap, not license to bypass billing.
    if (billingEnforcementMode(env) !== "enforce") return unprovisionedObserveSummary(env);
    throw new EntitlementError(
      402,
      "Billing is not initialised for this organisation. Contact an account owner or support before continuing.",
      "ENTITLEMENT_SUBSCRIPTION_MISSING",
    );
  }
  if (!summary.writeAccess && summary.enforcementMode === "enforce" && summary.seatOverage) {
    throw new EntitlementError(
      402,
      "This organisation has more users than its plan covers. Add seats or remove users in Billing. Read and export access remains available.",
      "ENTITLEMENT_SEAT_OVERAGE",
    );
  }
  if (!summary.writeAccess && summary.enforcementMode === "enforce") {
    throw new EntitlementError(
      402,
      "The subscription is not active. Billing owners can renew from the Billing workspace. Read and export access remains available.",
      "ENTITLEMENT_SUBSCRIPTION_INACTIVE",
    );
  }
  return summary;
}

function usageLimit(summary, metric) {
  if (metric === "storage_bytes") return Number(summary.limits.storage_gb || 0) * 1024 * 1024 * 1024;
  return Number(summary.limits[metric] || 0);
}

export async function incrementBillingUsage(
  client,
  organizationId,
  metric,
  quantity = 1,
  { idempotencyKey = "", source = "runtime", env = process.env } = {},
) {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new EntitlementError(400, "Usage quantity must be a positive integer.");
  }
  const key = String(idempotencyKey || "").trim();
  if (key.length > 240) throw new EntitlementError(400, "Usage idempotency key is too long.");
  const normalizedSource = String(source || "runtime").trim() || "runtime";
  if (normalizedSource.length > 120) throw new EntitlementError(400, "Usage source is too long.");

  const summary = await requireBillingWriteAccess(client, organizationId, env);
  const maximum = usageLimit(summary, metric);

  if (key) {
    const event = await client.query(
      `INSERT INTO billing_usage_events (
         organization_id, month_start, metric, quantity, idempotency_key, source
       ) VALUES ($1, date_trunc('month', current_date)::date, $2, $3, $4, $5)
       ON CONFLICT (organization_id, metric, idempotency_key) DO NOTHING
       RETURNING id`,
      [organizationId, metric, quantity, key, normalizedSource],
    );
    if (!event.rows[0]) {
      const prior = await client.query(
        `SELECT quantity,source FROM billing_usage_events
          WHERE organization_id=$1 AND metric=$2 AND idempotency_key=$3`,
        [organizationId, metric, key],
      );
      if (!prior.rows[0] || Number(prior.rows[0].quantity) !== quantity || prior.rows[0].source !== normalizedSource) {
        throw new EntitlementError(409, "The usage idempotency key was already used with different input.", "BILLING_IDEMPOTENCY_CONFLICT");
      }
      const current = await client.query(
        `SELECT quantity FROM billing_usage_monthly
          WHERE organization_id=$1 AND month_start=date_trunc('month', current_date)::date AND metric=$2`,
        [organizationId, metric],
      );
      return { replayed: true, quantity: current.rows[0] ? Number(current.rows[0].quantity) : null };
    }
  }

  await client.query(
    `INSERT INTO billing_usage_monthly (organization_id, month_start, metric, quantity)
     VALUES ($1, date_trunc('month', current_date)::date, $2, 0)
     ON CONFLICT (organization_id, month_start, metric) DO NOTHING`,
    [organizationId, metric],
  );

  if (summary.enforcementMode === "enforce" && maximum > 0) {
    const updated = await client.query(
      `UPDATE billing_usage_monthly
          SET quantity = quantity + $3, updated_at = now()
        WHERE organization_id = $1
          AND month_start = date_trunc('month', current_date)::date
          AND metric = $2
          AND quantity + $3 <= $4
        RETURNING quantity`,
      [organizationId, metric, quantity, maximum],
    );
    if (!updated.rows[0]) {
      throw new EntitlementError(
        402,
        `The ${summary.planName} plan has reached its ${metric.replaceAll("_", " ")} allowance. Upgrade or add capacity before continuing.`,
      );
    }
    return { replayed: false, quantity: Number(updated.rows[0].quantity) };
  }

  const updated = await client.query(
    `UPDATE billing_usage_monthly
        SET quantity = quantity + $3, updated_at = now()
      WHERE organization_id = $1
        AND month_start = date_trunc('month', current_date)::date
        AND metric = $2
      RETURNING quantity`,
    [organizationId, metric, quantity],
  );
  return { replayed: false, quantity: updated.rows[0] ? Number(updated.rows[0].quantity) : null };
}

export async function assertModuleEntitlement(client, organizationId, moduleKey, env = process.env) {
  const summary = await requireBillingWriteAccess(client, organizationId, env);
  const allowed = summary.modules.includes("*") || summary.modules.includes(moduleKey);
  if (!allowed && summary.enforcementMode === "enforce") {
    throw new EntitlementError(
      402,
      `The ${summary.planName} plan does not include the ${moduleKey.replaceAll("-", " ")} module. Upgrade the subscription before enabling it.`,
    );
  }
  return summary;
}

export async function assertOrganizationLimit(client, organizationId, limitKey, env = process.env) {
  const summary = await requireBillingWriteAccess(client, organizationId, env);
  const maximum = Number(summary.limits[limitKey] || 0);
  if (maximum <= 0 || summary.enforcementMode !== "enforce") return;

  await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
    organizationId,
    `billing-limit:${limitKey}`,
  ]);
  const table = limitKey === "companies" ? "companies" : "branches";
  const result = await client.query(
    `SELECT count(*)::int AS count FROM ${table} WHERE organization_id = $1 AND status = 'active'`,
    [organizationId],
  );
  const current = result.rows[0]?.count || 0;
  if (current >= maximum) {
    throw new EntitlementError(
      402,
      `The ${summary.planName} plan includes ${maximum} ${limitKey}. Upgrade the subscription before adding another.`,
    );
  }
}
