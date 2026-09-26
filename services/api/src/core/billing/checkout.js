// Standard checkout as a crash-safe saga. Every step is recorded on
// billing_checkout_sessions before the next external action:
//
//   provider_creating  intent committed; provider subscription being created
//   provider_link_pending  create outcome unknown (timeout/5xx); worker searches the
//                      provider (plan id + time window + our session note) and links it
//   created            provider subscription linked; customer can pay in Razorpay Checkout
//   verifying          checkout signature verified against the SERVER-stored subscription id;
//                      waiting for the provider to confirm state (fetch or webhook)
//   authorised         provider-confirmed; organisation moved to Standard
//   cancel_pending     superseded while a provider object may exist; worker makes sure it
//                      cannot be charged (cancel if authenticated/active)
//   failed_before_provider / failed / expired / superseded / cancelled  closed
//
// At most one live session per organisation (unique index), so double clicks
// or parallel requests can never create two paid subscriptions.
import { calculateSeatCharge, currentPrice, ensureProviderPlan, MAX_SEATED_USERS } from "./catalogue.js";
import { BillingServiceError, isDefiniteProviderRejection, redactedErrorText } from "./errors.js";
import { billingEvent } from "./observability.js";
import { getSeatStatus, reconcileSeatOverage } from "./seats.js";
import { mapProviderSubscriptionStatus, TERMINAL_STATUSES } from "./state.js";
import { applyPaidPlanInTx } from "./subscriptions.js";
import { billingAudit, epoch, inr, recoveryBackoffSeconds, subscriptionRow, toEpochSeconds, tx } from "./shared.js";

export const LIVE_CHECKOUT_STATUSES = Object.freeze(["created", "provider_creating", "provider_link_pending", "provider_recovery_pending", "verifying"]);
const CREATING_STALE_SECONDS = 120;
const MAX_VERIFY_ATTEMPTS_BEFORE_ATTENTION = 24;

function requireCheckoutEnabled(provider) {
  if (!provider.config?.checkoutEnabled && !provider.simulated) {
    throw new BillingServiceError(503, "Online payment is not enabled yet. Contact support to upgrade.", "BILLING_CHECKOUT_DISABLED");
  }
}

export async function startSeatCheckout(client, ctx, input, provider) {
  requireCheckoutEnabled(provider);
  const users = Number(input.users);
  if (!Number.isInteger(users) || users < 1 || users > MAX_SEATED_USERS) {
    throw new BillingServiceError(422, `Choose between 1 and ${MAX_SEATED_USERS} users.`, "BILLING_USERS_INVALID");
  }
  // The client never chooses the price: only the single current Standard version can be bought.
  const price = await currentPrice(client, "standard");
  if (!price || price.availability !== "available" || price.pricing_model !== "per_seat") {
    throw new BillingServiceError(409, "Standard is not available for purchase.", "BILLING_PLAN_NOT_PURCHASABLE");
  }
  if (input.planPriceId && input.planPriceId !== price.price_id) {
    throw new BillingServiceError(409, "Prices have changed since this page loaded. Refresh Billing and try again.", "BILLING_PRICE_CHANGED");
  }
  const charge = calculateSeatCharge({ includedUsers: price.included_users, perUserPaise: price.amount_paise, totalUsers: users });
  if (charge.billableSeats < 1) {
    throw new BillingServiceError(422, `Standard starts at ${price.included_users + 1} users. ${price.included_users} user${price.included_users === 1 ? " is" : "s are"} free.`, "BILLING_USERS_INVALID");
  }

  // Cheap pre-check before any provider call.
  const existing = await subscriptionRow(client, ctx.organizationId);
  if (!existing) throw new BillingServiceError(409, "Billing is not initialised for this organisation.", "BILLING_NOT_INITIALISED");
  if (existing.provider_subscription_id && ["active", "authenticated", "past_due", "halted"].includes(existing.status)) {
    throw new BillingServiceError(409, "You already have a paid subscription. Change the number of users instead.", "BILLING_ALREADY_SUBSCRIBED");
  }
  if (existing.pricing_model === "custom") throw new BillingServiceError(409, "This organisation is on a Custom contract. Contact support to change it.", "BILLING_CUSTOM_CONTRACT");

  const providerPlanId = await ensureProviderPlan(client, provider, price);

  const prepared = await tx(client, async () => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [ctx.organizationId, "billing-checkout"]);
    const sub = await subscriptionRow(client, ctx.organizationId, { lock: true });
    if (sub.provider_subscription_id && ["active", "authenticated", "past_due", "halted"].includes(sub.status)) {
      throw new BillingServiceError(409, "You already have a paid subscription. Change the number of users instead.", "BILLING_ALREADY_SUBSCRIBED");
    }
    const seats = await getSeatStatus(client, ctx.organizationId);
    if (users < seats.used) {
      throw new BillingServiceError(409, `You currently have ${seats.activeMembers} users and ${seats.pendingInvitations} pending invitations. Choose at least ${seats.used}.`, "BILLING_USERS_BELOW_USAGE");
    }
    const live = (
      await client.query(`SELECT *, (updated_at < now() - make_interval(secs => $2)) AS stale, (expires_at > now()) AS open FROM billing_checkout_sessions
                           WHERE organization_id = $1 AND status = ANY($3::text[]) FOR UPDATE`, [ctx.organizationId, CREATING_STALE_SECONDS, LIVE_CHECKOUT_STATUSES])
    ).rows[0];
    if (live) {
      if (live.status === "created" && live.open && live.plan_price_id === price.price_id && Number(live.expected_quantity) === charge.billableSeats && live.provider_subscription_id) {
        return { reuse: live };
      }
      if (live.status === "verifying") {
        throw new BillingServiceError(409, "Your payment is being verified. Billing updates automatically; do not pay again.", "BILLING_CHECKOUT_VERIFYING");
      }
      if (["provider_creating", "provider_link_pending", "provider_recovery_pending"].includes(live.status) && !live.stale) {
        throw new BillingServiceError(409, "A checkout is already being prepared. Try again in a moment.", "BILLING_CHECKOUT_IN_PROGRESS");
      }
      // Superseded. If a provider object may exist, the worker makes sure it cannot be charged.
      const mayExist = Boolean(live.provider_subscription_id) || live.status !== "created";
      await client.query(`UPDATE billing_checkout_sessions SET status = $2, next_recovery_at = CASE WHEN $2 = 'cancel_pending' THEN now() ELSE NULL END WHERE id = $1`, [
        live.id, mayExist ? "cancel_pending" : "superseded",
      ]);
    }
    const session = (
      await client.query(
        `INSERT INTO billing_checkout_sessions (organization_id, plan_price_id, subscription_id, status, initiated_by, expected_provider_plan_id, expected_quantity,
                                                next_recovery_at, metadata)
         VALUES ($1,$2,$3,'provider_creating',$4,$5,$6, now() + make_interval(secs => $7), $8::jsonb) RETURNING *`,
        [ctx.organizationId, price.price_id, sub.id, ctx.userId, providerPlanId, charge.billableSeats, CREATING_STALE_SECONDS,
          JSON.stringify({ paid_seats: charge.billableSeats, total_users: users, monthly_paise: charge.monthlyPaise, price_version: price.version })],
      )
    ).rows[0];
    await billingAudit(client, { organizationId: ctx.organizationId, actorUserId: ctx.userId, eventType: "billing.checkout.started", entityId: session.id, metadata: { paidSeats: charge.billableSeats, monthlyPaise: charge.monthlyPaise } });
    return { session };
  });

  const customer = (await client.query(`SELECT legal_name, billing_email, phone FROM billing_customers WHERE organization_id=$1`, [ctx.organizationId])).rows[0] || {};
  const response = (session, providerSubscriptionId) => ({
    state: "awaiting_payment",
    checkoutSessionId: session.id,
    keyId: provider.publicKey,
    providerSubscriptionId,
    name: "Vercentlabs",
    description: `Standard: ${users} users (${charge.billableSeats} additional at ${inr(price.amount_paise)} per month)`,
    prefill: { name: customer.legal_name || "", email: customer.billing_email || ctx.email || "", contact: customer.phone || undefined },
    monthlyPaise: charge.monthlyPaise,
    paidSeats: charge.billableSeats,
    totalUsers: users,
  });
  if (prepared.reuse) return response(prepared.reuse, prepared.reuse.provider_subscription_id);

  const { session } = prepared;
  billingEvent("billing.checkout.created", { organizationId: ctx.organizationId, checkoutSessionId: session.id }, {});
  let providerSubscription;
  try {
    providerSubscription = await provider.createSubscription({
      plan_id: providerPlanId,
      total_count: 120,
      quantity: charge.billableSeats,
      customer_notify: true,
      expire_by: toEpochSeconds(session.expires_at),
      notes: {
        vercentlabs_organization_id: ctx.organizationId,
        vercentlabs_checkout_session_id: session.id,
        vercentlabs_plan_price_id: price.price_id,
        vercentlabs_plan_code: price.code,
      },
    });
  } catch (error) {
    if (isDefiniteProviderRejection(error)) {
      await client.query(`UPDATE billing_checkout_sessions SET status='failed_before_provider', last_error=$2, next_recovery_at=NULL WHERE id=$1`, [session.id, redactedErrorText(error)]);
      throw new BillingServiceError(502, "The payment provider could not start checkout. No payment was requested; try again later.", "BILLING_CHECKOUT_PROVIDER_REJECTED");
    }
    // The subscription may have been created: keep the intent and let the worker find it.
    await client.query(`UPDATE billing_checkout_sessions SET status='provider_link_pending', last_error=$2, next_recovery_at=now() + interval '1 minute' WHERE id=$1 AND status='provider_creating'`, [
      session.id, redactedErrorText(error),
    ]);
    throw new BillingServiceError(503, "We could not confirm that checkout was prepared. We are checking automatically; try again in a minute.", "BILLING_CHECKOUT_RECOVERING");
  }
  billingEvent("billing.checkout.provider_created", { organizationId: ctx.organizationId, checkoutSessionId: session.id, providerSubscriptionId: providerSubscription.id }, {});
  const linked = await linkProviderSubscription(client, session.id, providerSubscription.id, ["provider_creating"]);
  if (!linked) throw new BillingServiceError(409, "This checkout changed while it was being prepared. Try again.", "BILLING_CHECKOUT_IN_PROGRESS");
  return response(session, providerSubscription.id);
}

async function linkProviderSubscription(client, sessionId, providerSubscriptionId, fromStatuses) {
  const updated = await client.query(
    `UPDATE billing_checkout_sessions SET status='created', provider_subscription_id=$2, provider_created_at=COALESCE(provider_created_at, now()),
            provider_linked_at=now(), next_recovery_at=expires_at, last_error=NULL
      WHERE id=$1 AND status = ANY($3::text[]) RETURNING id`,
    [sessionId, providerSubscriptionId, fromStatuses],
  );
  return Boolean(updated.rows[0]);
}

// Browser callback. The signature proves the checkout response is genuine;
// entitlement changes only after the provider confirms the subscription.
export async function confirmSeatCheckout(client, ctx, input, provider) {
  const session = (await client.query(`SELECT * FROM billing_checkout_sessions WHERE id=$1 AND organization_id=$2`, [input.checkoutSessionId, ctx.organizationId])).rows[0];
  if (!session) throw new BillingServiceError(404, "That checkout was not found.", "BILLING_CHECKOUT_NOT_FOUND");
  if (session.status === "authorised") return { state: "active", alreadyConfirmed: true };
  if (session.status === "verifying") return { state: "pending" };
  if (session.status !== "created" || !session.provider_subscription_id) {
    throw new BillingServiceError(409, "This checkout is no longer open. If your bank shows a debit, it will be matched automatically; contact support if Billing does not update within an hour.", "BILLING_CHECKOUT_CLOSED");
  }
  const valid = provider.verifyCheckout({ paymentId: input.razorpay_payment_id, subscriptionId: session.provider_subscription_id, signature: input.razorpay_signature });
  if (!valid || input.razorpay_subscription_id !== session.provider_subscription_id) {
    throw new BillingServiceError(400, "The payment confirmation could not be verified. If your bank shows a debit, it will be matched automatically.", "BILLING_SIGNATURE_INVALID");
  }
  const moved = await tx(client, async () => {
    const locked = (await client.query(`SELECT status FROM billing_checkout_sessions WHERE id=$1 FOR UPDATE`, [session.id])).rows[0];
    if (locked.status !== "created") return locked.status;
    await client.query(
      `UPDATE billing_checkout_sessions SET status='verifying', provider_payment_id=$2, verified_at=now(), recovery_attempts=0, next_recovery_at=now() + interval '1 minute' WHERE id=$1`,
      [session.id, String(input.razorpay_payment_id).slice(0, 100)],
    );
    return "verifying";
  });
  if (moved === "authorised") return { state: "active", alreadyConfirmed: true };
  if (moved !== "verifying") throw new BillingServiceError(409, "This checkout is no longer open.", "BILLING_CHECKOUT_CLOSED");
  return verifyCheckoutWithProvider(client, session.id, provider, { actorUserId: ctx.userId });
}

// Fetches the provider subscription and applies it. A failed fetch leaves the
// session `verifying` for the worker/webhook to finish; it never discards a
// possibly successful payment.
export async function verifyCheckoutWithProvider(client, sessionId, provider, { actorUserId = null } = {}) {
  const session = (await client.query(`SELECT * FROM billing_checkout_sessions WHERE id=$1`, [sessionId])).rows[0];
  if (!session || session.status !== "verifying") return { state: session?.status === "authorised" ? "active" : "closed" };
  let remote;
  try {
    remote = await provider.fetchSubscription(session.provider_subscription_id);
  } catch (error) {
    await scheduleVerificationRetry(client, session, error);
    return { state: "pending" };
  }
  return tx(client, async () => {
    const locked = (await client.query(`SELECT * FROM billing_checkout_sessions WHERE id=$1 FOR UPDATE`, [sessionId])).rows[0];
    // A fetch is not a provider event: it never moves the event-ordering watermark.
    return applyCheckoutEntityInTx(client, locked, remote, { source: "checkout_confirmation", actorUserId, eventAt: null });
  });
}

async function scheduleVerificationRetry(client, session, error) {
  const attempts = Number(session.recovery_attempts) + 1;
  await client.query(
    `UPDATE billing_checkout_sessions SET recovery_attempts=$2::int, last_error=$3, next_recovery_at=now() + make_interval(secs => $4),
            attention_required_at = CASE WHEN $2::int >= $5::int THEN COALESCE(attention_required_at, now()) ELSE attention_required_at END
      WHERE id=$1 AND status='verifying'`,
    [session.id, attempts, redactedErrorText(error), recoveryBackoffSeconds(attempts), MAX_VERIFY_ATTEMPTS_BEFORE_ATTENTION],
  );
  billingEvent("billing.checkout.verification_pending", { organizationId: session.organization_id, checkoutSessionId: session.id, attempts }, {});
}

// Everything the provider object must say before it can grant Standard to
// this organisation.
export function checkoutEntityMismatches(session, entity) {
  const problems = [];
  const notes = entity?.notes && typeof entity.notes === "object" ? entity.notes : {};
  if (entity?.id !== session.provider_subscription_id) problems.push("subscription_id");
  if (session.expected_provider_plan_id && entity?.plan_id !== session.expected_provider_plan_id) problems.push("plan_id");
  if (session.expected_quantity !== null && session.expected_quantity !== undefined && Number(entity?.quantity) !== Number(session.expected_quantity)) problems.push("quantity");
  if (notes.vercentlabs_organization_id !== session.organization_id) problems.push("organization_note");
  if (notes.vercentlabs_checkout_session_id !== session.id) problems.push("checkout_session_note");
  if (notes.vercentlabs_plan_price_id && notes.vercentlabs_plan_price_id !== session.plan_price_id) problems.push("price_note");
  return problems;
}

// Applies an authoritative provider subscription entity (fetch or signed
// webhook) to a LOCKED checkout session. Idempotent.
export async function applyCheckoutEntityInTx(client, session, entity, { source, actorUserId = null, eventAt = null }) {
  const organizationId = session.organization_id;
  if (session.status === "authorised") return { state: "active", alreadyConfirmed: true };
  const problems = checkoutEntityMismatches(session, entity);
  if (problems.length) {
    await client.query(`UPDATE billing_checkout_sessions SET status='failed', attention_required_at=now(), last_error=$2, next_recovery_at=NULL WHERE id=$1`, [
      session.id, `provider_mismatch: ${problems.join(",")}`,
    ]);
    await client.query(
      `UPDATE organization_subscriptions SET reconciliation_required_at = COALESCE(reconciliation_required_at, now()), reconciliation_note=$2 WHERE organization_id=$1`,
      [organizationId, "A checkout did not match the provider subscription and needs billing support review."],
    );
    await billingAudit(client, { organizationId, actorUserId, eventType: "billing.checkout.intervention_required", entityId: session.id, metadata: { problems, source } });
    billingEvent("billing.checkout.intervention_required", { organizationId, checkoutSessionId: session.id, problems }, { source });
    return { state: "attention" };
  }
  const providerStatus = String(entity.status || "").toLowerCase();
  if (providerStatus === "created") return { state: "pending" };
  const mapped = mapProviderSubscriptionStatus(providerStatus);
  if (!mapped || TERMINAL_STATUSES.includes(mapped)) {
    await client.query(`UPDATE billing_checkout_sessions SET status='failed', last_error=$2, next_recovery_at=NULL WHERE id=$1`, [session.id, `provider_status_${providerStatus}`]);
    return { state: "failed" };
  }

  const sub = await subscriptionRow(client, organizationId, { lock: true });
  if (sub.provider_subscription_id && sub.provider_subscription_id !== entity.id && ["active", "authenticated", "past_due", "halted"].includes(sub.status)) {
    // A second paid subscription must never stand: make sure it is cancelled.
    await client.query(`UPDATE billing_checkout_sessions SET status='cancel_pending', attention_required_at=now(), next_recovery_at=now(), last_error='duplicate_paid_subscription' WHERE id=$1`, [session.id]);
    await billingAudit(client, { organizationId, actorUserId, eventType: "billing.checkout.intervention_required", entityId: session.id, metadata: { problems: ["duplicate_paid_subscription"], source } });
    billingEvent("billing.checkout.intervention_required", { organizationId, checkoutSessionId: session.id, problems: ["duplicate_paid_subscription"] }, { source });
    return { state: "attention" };
  }
  const paidSeats = Number(session.expected_quantity ?? session.metadata?.paid_seats ?? 0);
  const status = mapped;
  await applyPaidPlanInTx(client, {
    organizationId, priceId: session.plan_price_id, providerSubscriptionId: entity.id, paidSeats, status, source,
    periodStart: epoch(entity.current_start), periodEnd: epoch(entity.current_end), metadata: { checkout_session_id: session.id },
  });
  if (status === "past_due") {
    await client.query(`UPDATE organization_subscriptions SET grace_ends_at = now() + interval '7 days' WHERE organization_id=$1`, [organizationId]);
  }
  if (eventAt) {
    await client.query(`UPDATE organization_subscriptions SET last_provider_event_at = GREATEST(COALESCE(last_provider_event_at, $2), $2) WHERE organization_id=$1`, [organizationId, eventAt]);
  }
  await client.query(`UPDATE billing_checkout_sessions SET status='authorised', next_recovery_at=NULL, last_error=NULL WHERE id=$1`, [session.id]);
  await client.query(
    `INSERT INTO billing_seat_changes (organization_id, subscription_id, from_paid_seats, to_paid_seats, effective, status, reason, requested_by, provider_reference, provider_confirmed_at, applied_at)
     VALUES ($1,$2,0,$3,'now','applied','Upgrade to Standard',$4,$5, now(), now())`,
    [organizationId, sub.id, paidSeats, session.initiated_by, entity.id],
  );
  await reconcileSeatOverage(client, organizationId);
  await billingAudit(client, {
    organizationId, actorUserId, eventType: "billing.checkout.confirmed", entityId: session.id,
    metadata: { paidSeats, source, providerStatus }, beforeData: { planCode: sub.plan_code, status: sub.status }, afterData: { planCode: "standard", status },
  });
  billingEvent("billing.checkout.activated", { organizationId, checkoutSessionId: session.id }, { source });
  return { state: status === "active" || status === "authenticated" ? "active" : status, paidSeats };
}

// ------------------------------------------------------------------ worker recovery
// Finds a provider subscription created for this session whose id never made it
// into our database, using only documented provider APIs (list by plan id and
// creation time; our session id is in the notes).
async function findOrphanProviderSubscription(provider, session) {
  if (!session.expected_provider_plan_id) return null;
  const from = toEpochSeconds(session.created_at) - 300;
  const to = toEpochSeconds(session.created_at) + 1800;
  for (let skip = 0; skip < 500; skip += 100) {
    const page = await provider.listSubscriptions({ planId: session.expected_provider_plan_id, from, to, count: 100, skip });
    const items = Array.isArray(page?.items) ? page.items : [];
    const match = items.find((item) => item?.notes?.vercentlabs_checkout_session_id === session.id && item?.notes?.vercentlabs_organization_id === session.organization_id);
    if (match) return match;
    if (items.length < 100) return null;
  }
  return null;
}

async function recordRecoveryFailure(client, session, error, { terminalStatus = null, maxAttempts = 12 } = {}) {
  const attempts = Number(session.recovery_attempts) + 1;
  const giveUp = terminalStatus && attempts >= maxAttempts;
  await client.query(
    `UPDATE billing_checkout_sessions SET recovery_attempts=$2::int, last_error=$3,
            status = CASE WHEN $5::boolean THEN $6::text ELSE status END,
            next_recovery_at = CASE WHEN $5::boolean THEN NULL ELSE now() + make_interval(secs => $4) END,
            attention_required_at = CASE WHEN $5::boolean OR $2::int >= $7::int THEN COALESCE(attention_required_at, now()) ELSE attention_required_at END
      WHERE id=$1`,
    [session.id, attempts, redactedErrorText(error), recoveryBackoffSeconds(attempts), Boolean(giveUp), terminalStatus, MAX_VERIFY_ATTEMPTS_BEFORE_ATTENTION],
  );
  billingEvent("billing.checkout.recovery_failed", { organizationId: session.organization_id, checkoutSessionId: session.id, attempts, gaveUp: Boolean(giveUp) }, {});
}

// One recovery step for a due session. Returns a short outcome string.
export async function recoverCheckoutSession(client, sessionId, provider) {
  const session = (await client.query(`SELECT *, (expires_at > now()) AS open FROM billing_checkout_sessions WHERE id=$1`, [sessionId])).rows[0];
  if (!session) return "missing";
  try {
    switch (session.status) {
      case "provider_creating":
      case "provider_link_pending":
      case "provider_recovery_pending": {
        const orphan = await findOrphanProviderSubscription(provider, session);
        if (!orphan) {
          await recordRecoveryFailure(client, session, new Error("provider subscription not found yet"), { terminalStatus: "failed_before_provider", maxAttempts: 6 });
          return "not_found";
        }
        if (session.open) {
          await linkProviderSubscription(client, session.id, orphan.id, ["provider_creating", "provider_link_pending", "provider_recovery_pending"]);
          billingEvent("billing.checkout.recovered", { organizationId: session.organization_id, checkoutSessionId: session.id }, { step: "link" });
          return "linked";
        }
        await client.query(`UPDATE billing_checkout_sessions SET provider_subscription_id=$2, provider_linked_at=now(), status='cancel_pending', next_recovery_at=now() WHERE id=$1`, [session.id, orphan.id]);
        return "linked_for_cancellation";
      }
      case "verifying": {
        const result = await verifyCheckoutWithProvider(client, session.id, provider);
        if (result.state === "active") billingEvent("billing.checkout.recovered", { organizationId: session.organization_id, checkoutSessionId: session.id }, { step: "verify" });
        return result.state;
      }
      case "created": {
        if (session.open) {
          await client.query(`UPDATE billing_checkout_sessions SET next_recovery_at=expires_at WHERE id=$1`, [session.id]);
          return "open";
        }
        // Expired without a callback: the customer may still have paid.
        const remote = await provider.fetchSubscription(session.provider_subscription_id);
        const status = String(remote.status || "").toLowerCase();
        if (["authenticated", "active", "pending", "halted"].includes(status)) {
          return tx(client, async () => {
            const locked = (await client.query(`SELECT * FROM billing_checkout_sessions WHERE id=$1 FOR UPDATE`, [session.id])).rows[0];
            return (await applyCheckoutEntityInTx(client, locked, remote, { source: "reconciliation", eventAt: null })).state;
          });
        }
        await client.query(`UPDATE billing_checkout_sessions SET status='expired', next_recovery_at=NULL WHERE id=$1 AND status='created'`, [session.id]);
        return "expired";
      }
      case "cancel_pending": {
        if (!session.provider_subscription_id) {
          const orphan = await findOrphanProviderSubscription(provider, session);
          if (!orphan) {
            await recordRecoveryFailure(client, session, new Error("no provider subscription to cancel"), { terminalStatus: "cancelled", maxAttempts: 6 });
            return "nothing_to_cancel";
          }
          await client.query(`UPDATE billing_checkout_sessions SET provider_subscription_id=$2, provider_linked_at=now() WHERE id=$1`, [session.id, orphan.id]);
          session.provider_subscription_id = orphan.id;
        }
        const remote = await provider.fetchSubscription(session.provider_subscription_id);
        const status = String(remote.status || "").toLowerCase();
        // Razorpay only cancels authenticated/active subscriptions; an unpaid `created` one expires by expire_by.
        if (["authenticated", "active", "pending", "halted"].includes(status)) {
          const current = await subscriptionRow(client, session.organization_id);
          if (current?.provider_subscription_id === session.provider_subscription_id) {
            await client.query(`UPDATE billing_checkout_sessions SET status='authorised', next_recovery_at=NULL WHERE id=$1`, [session.id]);
            return "is_current_subscription";
          }
          await provider.cancelSubscription(session.provider_subscription_id, false);
        }
        await client.query(`UPDATE billing_checkout_sessions SET status='cancelled', next_recovery_at=NULL, last_error=NULL WHERE id=$1`, [session.id]);
        await billingAudit(client, { organizationId: session.organization_id, eventType: "billing.checkout.superseded_cancelled", entityId: session.id, metadata: { providerStatus: status } });
        return "cancelled";
      }
      default:
        return "noop";
    }
  } catch (error) {
    await recordRecoveryFailure(client, session, error);
    return isDefiniteProviderRejection(error) ? "provider_rejected" : "retry";
  }
}

export async function liveCheckoutForOrganization(client, organizationId) {
  return (
    await client.query(
      `SELECT id, status, expires_at, attention_required_at, (expires_at > now()) AS open, metadata FROM billing_checkout_sessions
        WHERE organization_id=$1 AND (status = ANY($2::text[]) OR (status IN ('failed','cancel_pending') AND attention_required_at IS NOT NULL))
        ORDER BY created_at DESC LIMIT 1`,
      [organizationId, LIVE_CHECKOUT_STATUSES],
    )
  ).rows[0] || null;
}
