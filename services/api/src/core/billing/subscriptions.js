// Subscription state application, reverting to Free, cancellation saga and
// Custom contract provisioning. Functions named *InTx expect the caller's
// transaction and a locked subscription row.
import { ERP_MODULE_CATALOG } from "@vercentlabs/shared-types";

import { currentPrice } from "./catalogue.js";
import { BillingServiceError, isDefiniteProviderRejection, redactedErrorText } from "./errors.js";
import { billingEvent } from "./observability.js";
import { reconcileSeatOverage } from "./seats.js";
import { assertTransition, canTransition, mapProviderSubscriptionStatus, shouldApplyProviderEvent, TERMINAL_STATUSES } from "./state.js";
import { billingAudit, epoch, recoveryBackoffSeconds, subscriptionRow, tx } from "./shared.js";

const PAST_DUE_GRACE_DAYS = 7;
const MAX_CANCEL_ATTEMPTS = 8;

// Moves the organisation onto a paid price version with the given paid seats.
export async function applyPaidPlanInTx(client, { organizationId, priceId, providerSubscriptionId, paidSeats, status, source, periodStart = null, periodEnd = null, metadata = {} }) {
  const sub = await subscriptionRow(client, organizationId, { lock: true });
  assertTransition(sub.status, status, source);
  const price = (
    await client.query(
      `SELECT price.amount_paise, price.currency, price.billing_period, price.version, price.included_users, plan.code, plan.name, plan.modules, plan.limits, plan.included_users AS plan_included_users
         FROM billing_plan_prices price JOIN billing_plans plan ON plan.id = price.plan_id WHERE price.id = $1`,
      [priceId],
    )
  ).rows[0];
  const includedUsers = price.included_users ?? price.plan_included_users;
  await client.query(
    `UPDATE organization_subscriptions SET plan_price_id=$2, provider_subscription_id=$3, status=$4, provider_status=$5,
            billing_period=$6, trial_started_at=NULL, trial_ends_at=NULL, grace_ends_at=NULL, cancel_at_cycle_end=false, cancelled_at=NULL,
            cancellation_state=NULL, price_snapshot=$7::jsonb, modules_snapshot=$8::jsonb, limits_snapshot=$9::jsonb, included_users_snapshot=$10,
            paid_seats=$11, pending_paid_seats=NULL, current_period_started_at=COALESCE($12, current_period_started_at),
            current_period_ends_at=COALESCE($13, current_period_ends_at), last_provider_sync_at=now(), metadata = metadata || $14::jsonb
      WHERE organization_id=$1`,
    [
      organizationId, priceId, providerSubscriptionId, status, status === "past_due" ? "pending" : status, price.billing_period,
      JSON.stringify({ plan_code: price.code, plan_name: price.name, amount_paise: Number(price.amount_paise), currency: price.currency, billing_period: price.billing_period, version: price.version, included_users: includedUsers }),
      JSON.stringify(price.modules), JSON.stringify(price.limits), includedUsers, paidSeats, periodStart, periodEnd, JSON.stringify(metadata),
    ],
  );
  return { before: sub };
}

// Back to the current Free version. Used when a paid subscription ends.
export async function revertToFreeInTx(client, organizationId, reason, actorUserId = null) {
  const free = await currentPrice(client, "free");
  if (!free) throw new BillingServiceError(500, "The Free plan is not configured.", "BILLING_FREE_PLAN_MISSING");
  const before = await subscriptionRow(client, organizationId, { lock: true });
  await client.query(
    `UPDATE organization_subscriptions SET plan_price_id=$2, status='active', provider_status=NULL, provider_subscription_id=NULL, billing_period='monthly',
            trial_started_at=NULL, trial_ends_at=NULL, grace_ends_at=NULL, current_period_started_at=now(), current_period_ends_at=NULL,
            cancel_at_cycle_end=false, cancellation_state=NULL, cancelled_at=now(), price_snapshot=$3::jsonb, modules_snapshot=$4::jsonb, limits_snapshot=$5::jsonb,
            included_users_snapshot=$6, paid_seats=0, pending_paid_seats=NULL, reconciliation_required_at=NULL, reconciliation_note=NULL,
            metadata = metadata || jsonb_build_object('reverted_to_free', $7::text, 'previous_provider_subscription_id', $8::text)
      WHERE organization_id=$1`,
    [
      organizationId, free.price_id,
      JSON.stringify({ plan_code: free.code, plan_name: free.name, amount_paise: Number(free.amount_paise), currency: free.currency, billing_period: "monthly", version: free.version, included_users: free.included_users }),
      JSON.stringify(free.modules), JSON.stringify(free.limits), free.included_users, reason, before?.provider_subscription_id ?? null,
    ],
  );
  await client.query(`UPDATE billing_seat_changes SET status='cancelled' WHERE organization_id=$1 AND status IN ('pending','provider_pending')`, [organizationId]);
  await reconcileSeatOverage(client, organizationId);
  await billingAudit(client, {
    organizationId, actorUserId, eventType: "billing.reverted_to_free", entityId: before?.id, metadata: { reason },
    beforeData: { planCode: before?.plan_code, status: before?.status, paidSeats: Number(before?.paid_seats ?? 0) }, afterData: { planCode: "free", status: "active" },
  });
}

async function flagReconciliation(client, organizationId, note) {
  await client.query(
    `UPDATE organization_subscriptions SET reconciliation_required_at = COALESCE(reconciliation_required_at, now()), reconciliation_note = $2 WHERE organization_id = $1`,
    [organizationId, note.slice(0, 300)],
  );
  billingEvent("billing.reconciliation.mismatch", { organizationId, note }, {});
}

// Applies a provider subscription entity (from a signed webhook or an
// authenticated provider fetch) to the CURRENT local subscription. The caller
// has confirmed entity.id is this organisation's provider subscription.
export async function applySubscriptionEntityInTx(client, { organizationId, entity, eventAt, source }) {
  const sub = await subscriptionRow(client, organizationId, { lock: true });
  if (!sub || sub.provider_subscription_id !== entity.id) return { status: "ignored", reason: "not_current_subscription" };
  if (!shouldApplyProviderEvent(sub.last_provider_event_at, eventAt)) return { status: "ignored", reason: "stale_event" };

  const providerStatus = String(entity.status || "").toLowerCase();
  const mapped = mapProviderSubscriptionStatus(providerStatus);
  const touchWatermark = () =>
    eventAt
      ? client.query(`UPDATE organization_subscriptions SET last_provider_event_at = GREATEST(COALESCE(last_provider_event_at, $2), $2) WHERE organization_id=$1`, [organizationId, eventAt])
      : null;

  if (TERMINAL_STATUSES.includes(mapped)) {
    await revertToFreeInTx(client, organizationId, `provider_${providerStatus}`);
    billingEvent("billing.cancellation.scheduled", { organizationId, applied: true }, { outcome: providerStatus });
    return { status: "processed", outcome: "reverted_to_free" };
  }
  if (providerStatus === "paused") {
    await client.query(`UPDATE organization_subscriptions SET provider_status='paused' WHERE organization_id=$1`, [organizationId]);
    await flagReconciliation(client, organizationId, "The provider reports this subscription as paused; Vercentlabs never pauses subscriptions.");
    await touchWatermark();
    return { status: "processed", outcome: "attention" };
  }
  if (!mapped) {
    await touchWatermark();
    return { status: "ignored", reason: `provider_status_${providerStatus || "unknown"}` };
  }

  // authenticated never downgrades an active/past_due subscription.
  let status = mapped;
  if (mapped === "authenticated" && ["active", "past_due"].includes(sub.status)) status = sub.status;
  if (!canTransition(sub.status, status)) {
    await flagReconciliation(client, organizationId, `Provider reported ${providerStatus} while the subscription is ${sub.status}.`);
    return { status: "ignored", reason: "invalid_transition" };
  }

  // Seats: increases are provider-confirmed and apply at once. A scheduled
  // reduction applies only when a NEW cycle shows the scheduled quantity.
  const quantity = entity.quantity === undefined || entity.quantity === null ? null : Number(entity.quantity);
  const paid = Number(sub.paid_seats);
  const pending = sub.pending_paid_seats === null ? null : Number(sub.pending_paid_seats);
  const start = epoch(entity.current_start);
  const end = epoch(entity.current_end);
  let seats = paid;
  let applyPending = false;
  if (quantity !== null && quantity > paid) seats = quantity;
  if (quantity !== null && quantity < paid && pending !== null && quantity === pending) {
    const newCycle = start && sub.current_period_started_at && start.getTime() > new Date(sub.current_period_started_at).getTime();
    if (newCycle) {
      seats = quantity;
      applyPending = true;
    }
  }

  await client.query(
    `UPDATE organization_subscriptions SET
        status = $2, provider_status = $3,
        current_period_started_at = COALESCE($4, current_period_started_at),
        current_period_ends_at = COALESCE($5, current_period_ends_at),
        grace_ends_at = CASE WHEN $2 = 'past_due' THEN COALESCE(grace_ends_at, now() + make_interval(days => $8))
                             WHEN $2 = 'halted' THEN LEAST(COALESCE(grace_ends_at, now()), now())
                             ELSE NULL END,
        paid_seats = $6, pending_paid_seats = CASE WHEN $7::boolean THEN NULL ELSE pending_paid_seats END
      WHERE organization_id=$1`,
    [organizationId, status, providerStatus, start, end, seats, applyPending, PAST_DUE_GRACE_DAYS],
  );
  if (applyPending) {
    await client.query(`UPDATE billing_seat_changes SET status='applied', applied_at=now() WHERE organization_id=$1 AND status='pending'`, [organizationId]);
    await billingAudit(client, { organizationId, eventType: "billing.seats.reduction_applied", entityId: sub.id, beforeData: { paidSeats: paid }, afterData: { paidSeats: seats } });
  }
  if (seats !== paid) await reconcileSeatOverage(client, organizationId);
  await touchWatermark();
  if (source === "reconciliation" || source === "provider_fetch") {
    await client.query(`UPDATE organization_subscriptions SET last_provider_sync_at = now() WHERE organization_id=$1`, [organizationId]);
  }
  return { status: "processed", outcome: status };
}

// ------------------------------------------------------------------ cancellation saga
// Self-service cancellation always takes effect at the end of the paid
// period: service continues until then, then the provider's cancellation
// moves the organisation to Free. No refund is implied or issued.
export async function cancelPaidSubscription(client, ctx, provider) {
  const prepared = await tx(client, async () => {
    const sub = await subscriptionRow(client, ctx.organizationId, { lock: true });
    if (!sub || !sub.provider_subscription_id || sub.pricing_model !== "per_seat") {
      throw new BillingServiceError(409, "There is no paid subscription to cancel.", "BILLING_NOT_PAID");
    }
    if (sub.cancel_at_cycle_end) return { done: { state: "scheduled", effective: "cycle_end", endsAt: sub.current_period_ends_at ? new Date(sub.current_period_ends_at).toISOString() : null, alreadyScheduled: true } };
    if (sub.cancellation_state === "provider_pending") return { done: { state: "pending" } };
    if (!["active", "authenticated"].includes(sub.status)) {
      throw new BillingServiceError(409, "This subscription has an outstanding payment issue. Contact support to cancel it.", "BILLING_PAYMENT_ISSUE");
    }
    await client.query(
      `UPDATE organization_subscriptions SET cancellation_state='provider_pending', cancel_requested_at=now(), cancel_requested_by=$2, cancel_attempts=0,
              cancel_next_attempt_at=now() + interval '2 minutes', cancel_last_error=NULL WHERE organization_id=$1`,
      [ctx.organizationId, ctx.userId],
    );
    return { sub };
  });
  if (prepared.done) return prepared.done;
  const { sub } = prepared;
  try {
    const remote = await provider.cancelSubscription(sub.provider_subscription_id, true);
    return await finalizeCancellation(client, ctx.organizationId, remote, { actorUserId: ctx.userId });
  } catch (error) {
    if (isDefiniteProviderRejection(error)) {
      await failCancellation(client, ctx.organizationId, error, ctx.userId);
      throw new BillingServiceError(502, "The payment provider did not accept the cancellation. Your subscription is unchanged.", "BILLING_CANCEL_REJECTED");
    }
    await client.query(`UPDATE organization_subscriptions SET cancel_last_error=$2 WHERE organization_id=$1`, [ctx.organizationId, redactedErrorText(error)]);
    return { state: "pending" };
  }
}

async function failCancellation(client, organizationId, error, actorUserId = null) {
  await tx(client, async () => {
    const updated = await client.query(
      `UPDATE organization_subscriptions SET cancellation_state='failed', cancel_last_error=$2 WHERE organization_id=$1 AND cancellation_state='provider_pending' RETURNING id`,
      [organizationId, redactedErrorText(error)],
    );
    if (updated.rows[0]) await billingAudit(client, { organizationId, actorUserId, eventType: "billing.cancel.failed", entityId: updated.rows[0].id });
  });
}

export async function finalizeCancellation(client, organizationId, remote, { actorUserId = null } = {}) {
  return tx(client, async () => {
    const sub = await subscriptionRow(client, organizationId, { lock: true });
    if (!sub || sub.cancellation_state !== "provider_pending") return { state: sub?.cancel_at_cycle_end ? "scheduled" : "none" };
    if (TERMINAL_STATUSES.includes(mapProviderSubscriptionStatus(remote?.status))) {
      await revertToFreeInTx(client, organizationId, "cancelled", actorUserId);
      return { state: "cancelled", effective: "now" };
    }
    await client.query(`UPDATE organization_subscriptions SET cancel_at_cycle_end=true, cancellation_state='scheduled', cancel_last_error=NULL WHERE organization_id=$1`, [organizationId]);
    await billingAudit(client, {
      organizationId, actorUserId, eventType: "billing.cancel.scheduled", entityId: sub.id,
      metadata: { periodEnds: sub.current_period_ends_at ? new Date(sub.current_period_ends_at).toISOString() : null },
    });
    billingEvent("billing.cancellation.scheduled", { organizationId }, { outcome: "scheduled" });
    return { state: "scheduled", effective: "cycle_end", endsAt: sub.current_period_ends_at ? new Date(sub.current_period_ends_at).toISOString() : null };
  });
}

export async function recoverCancellation(client, sub, provider) {
  const attempts = Number(sub.cancel_attempts) + 1;
  await client.query(`UPDATE organization_subscriptions SET cancel_attempts=$2 WHERE organization_id=$1`, [sub.organization_id, attempts]);
  try {
    const remote = await provider.cancelSubscription(sub.provider_subscription_id, true).catch(async (error) => {
      if (!isDefiniteProviderRejection(error)) throw error;
      // Rejected on retry: the earlier request may have taken effect. Ask the provider.
      const current = await provider.fetchSubscription(sub.provider_subscription_id);
      if (TERMINAL_STATUSES.includes(mapProviderSubscriptionStatus(current.status))) return current;
      throw error;
    });
    return await finalizeCancellation(client, sub.organization_id, remote);
  } catch (error) {
    if (isDefiniteProviderRejection(error) || attempts >= MAX_CANCEL_ATTEMPTS) {
      await failCancellation(client, sub.organization_id, error);
      return { state: "failed" };
    }
    await client.query(`UPDATE organization_subscriptions SET cancel_last_error=$2, cancel_next_attempt_at = now() + make_interval(secs => $3) WHERE organization_id=$1`, [
      sub.organization_id, redactedErrorText(error), recoveryBackoffSeconds(attempts),
    ]);
    return { state: "retry" };
  }
}

// Support-only: immediate cancellation (not exposed to tenants).
export async function cancelSubscriptionImmediately(client, { organizationId, actorUserId = null, reason }, provider) {
  const sub = await subscriptionRow(client, organizationId);
  if (!sub?.provider_subscription_id) throw new BillingServiceError(409, "There is no paid subscription to cancel.", "BILLING_NOT_PAID");
  const remote = await provider.cancelSubscription(sub.provider_subscription_id, false);
  if (!TERMINAL_STATUSES.includes(mapProviderSubscriptionStatus(remote?.status))) {
    throw new BillingServiceError(502, "The provider did not confirm the cancellation.", "BILLING_CANCEL_UNCONFIRMED");
  }
  await tx(client, () => revertToFreeInTx(client, organizationId, `support_cancel: ${String(reason || "").slice(0, 200)}`, actorUserId));
  return { state: "cancelled" };
}

// ------------------------------------------------------------------ Custom contracts
// Internal provisioning path for contracted Custom plans (never reachable by
// tenant users; see scripts/billing/provision-custom-subscription.mjs).
const MODULE_KEYS = new Set(ERP_MODULE_CATALOG.map((module) => module.key));

export async function provisionCustomSubscription(client, input) {
  const { organizationId, actorUserId = null, users, modules, limits = {}, contractReference, startsAt, endsAt, notes = "" } = input;
  if (!Number.isInteger(users) || users < 1 || users > 100_000) throw new BillingServiceError(422, "Contracted users must be a positive whole number.", "BILLING_CUSTOM_INVALID");
  if (!Array.isArray(modules) || !modules.length || !(modules.length === 1 && modules[0] === "*") && !modules.every((key) => MODULE_KEYS.has(key))) {
    throw new BillingServiceError(422, "Modules must be [\"*\"] or known module keys.", "BILLING_CUSTOM_INVALID");
  }
  const reference = String(contractReference || "").trim();
  if (!reference || reference.length > 100) throw new BillingServiceError(422, "A contract reference is required.", "BILLING_CUSTOM_INVALID");
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new BillingServiceError(422, "The contract needs a valid start and a later end date.", "BILLING_CUSTOM_INVALID");
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new BillingServiceError(422, `Limit ${key} must be a non-negative whole number.`, "BILLING_CUSTOM_INVALID");
  }
  const price = await currentPrice(client, "enterprise");
  if (!price) throw new BillingServiceError(500, "The Custom plan is not configured.", "BILLING_CUSTOM_PLAN_MISSING");

  return tx(client, async () => {
    const before = await subscriptionRow(client, organizationId, { lock: true });
    if (!before) throw new BillingServiceError(404, "Organisation not found.", "BILLING_NOT_INITIALISED");
    if (before.provider_subscription_id && ["active", "authenticated", "past_due"].includes(before.status)) {
      throw new BillingServiceError(409, "Cancel the organisation's online Standard subscription before provisioning a Custom contract.", "BILLING_ALREADY_SUBSCRIBED");
    }
    const effectiveLimits = { ...price.limits, ...limits };
    await client.query(
      `UPDATE organization_subscriptions SET plan_price_id=$2, status='active', provider_status=NULL, provider_subscription_id=NULL, billing_period='custom',
              trial_started_at=NULL, trial_ends_at=NULL, grace_ends_at=NULL, current_period_started_at=$3, current_period_ends_at=$4,
              cancel_at_cycle_end=false, cancellation_state=NULL, cancelled_at=NULL, included_users_snapshot=$5, paid_seats=0, pending_paid_seats=NULL,
              price_snapshot=$6::jsonb, modules_snapshot=$7::jsonb, limits_snapshot=$8::jsonb,
              metadata = metadata || jsonb_build_object('custom_contract', $9::jsonb)
        WHERE organization_id=$1`,
      [
        organizationId, price.price_id, start, end, users,
        JSON.stringify({ plan_code: price.code, plan_name: price.name, currency: price.currency, billing_period: "custom", contract_reference: reference }),
        JSON.stringify(modules), JSON.stringify(effectiveLimits),
        JSON.stringify({ reference, users, starts_at: start.toISOString(), ends_at: end.toISOString(), notes: String(notes).slice(0, 500), provisioned_by: actorUserId }),
      ],
    );
    await reconcileSeatOverage(client, organizationId);
    await billingAudit(client, {
      organizationId, actorUserId, eventType: "billing.custom.provisioned", entityId: before.id,
      beforeData: { planCode: before.plan_code, status: before.status, includedUsers: before.included_users_snapshot },
      afterData: { planCode: price.code, users, modules, limits: effectiveLimits, contractReference: reference, endsAt: end.toISOString() },
    });
    return { organizationId, planCode: price.code, users, modules, limits: effectiveLimits, endsAt: end.toISOString() };
  });
}
