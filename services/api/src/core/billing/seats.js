// Seats: the one billable-user formula, reservation, overage, and the
// seat-change saga (prepare -> commit -> provider -> finalize).
//
//   billable usage = active members + valid pending invitations
//                    (not accepted, not revoked, not expired, one per email,
//                     and not for someone who is already an active member)
//   capacity       = included users + paid seats
import { COMMERCIAL_MODEL, MAX_SEATED_USERS } from "./catalogue.js";
import { billingEnforcementMode } from "./enforcement.js";
import { BillingServiceError, isDefiniteProviderRejection, redactedErrorText } from "./errors.js";
import { billingEvent } from "./observability.js";
import { billingAudit, inr, recoveryBackoffSeconds, subscriptionRow, tx } from "./shared.js";

export const SEAT_OVERAGE_GRACE_DAYS = 14;

export async function countBillableUsers(client, organizationId, { excludeInvitationId = null } = {}) {
  const row = (
    await client.query(
      `SELECT
         (SELECT count(*) FROM organization_memberships m WHERE m.organization_id = $1 AND m.status = 'active')::int AS members,
         (SELECT count(DISTINCT lower(i.email)) FROM organization_invitations i
           WHERE i.organization_id = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
             AND ($2::uuid IS NULL OR i.id <> $2::uuid)
             AND NOT EXISTS (SELECT 1 FROM organization_memberships m JOIN users u ON u.id = m.user_id
                              WHERE m.organization_id = i.organization_id AND m.status = 'active' AND lower(u.email) = lower(i.email)))::int AS pending`,
      [organizationId, excludeInvitationId],
    )
  ).rows[0];
  return { members: Number(row.members), pending: Number(row.pending) };
}

export async function getSeatStatus(client, organizationId, { excludeInvitationId = null } = {}) {
  const sub = await subscriptionRow(client, organizationId);
  const { members, pending } = await countBillableUsers(client, organizationId, { excludeInvitationId });
  const included = sub?.included_users_snapshot ?? null;
  const paid = sub ? Number(sub.paid_seats) : 0;
  const capacity = included === null ? null : Number(included) + paid;
  const used = members + pending;
  return {
    planCode: sub?.plan_code ?? null,
    planName: sub?.plan_name ?? null,
    pricingModel: sub?.pricing_model ?? null,
    includedUsers: included === null ? null : Number(included),
    paidSeats: paid,
    pendingPaidSeats: sub?.pending_paid_seats === null || sub?.pending_paid_seats === undefined ? null : Number(sub.pending_paid_seats),
    capacity,
    activeMembers: members,
    pendingInvitations: pending,
    used,
    available: capacity === null ? null : Math.max(0, capacity - used),
    overCapacity: capacity !== null && used > capacity,
    perUserPricePaise: sub?.pricing_model === "per_seat" ? Number(sub.plan_amount_paise) : null,
    seatOverageSince: sub?.seat_overage_since ? new Date(sub.seat_overage_since).toISOString() : null,
  };
}

function seatLimitMessage(status) {
  if (status.pricingModel === "per_seat") {
    return `All ${status.capacity} users on your ${status.planName} plan are in use. Add users in Billing (${inr(status.perUserPricePaise)} per user per month) first.`;
  }
  const included = status.includedUsers ?? COMMERCIAL_MODEL.free.includedUsers;
  return `The ${status.planName} plan includes ${included} user${included === 1 ? "" : "s"}. Upgrade to Standard in Billing to add more (${inr(COMMERCIAL_MODEL.standard.perAdditionalUserPaise)} per additional user per month).`;
}

// Callers hold withSeatLock around the check and the write it guards, so two
// people inviting at once cannot both take the last seat. Observe mode reports
// instead of blocking.
export async function assertSeatAvailable(client, organizationId, { additional = 1, excludeInvitationId = null, env = process.env } = {}) {
  if (additional <= 0) return null;
  const status = await getSeatStatus(client, organizationId, { excludeInvitationId });
  if (status.capacity === null) return status;
  if (status.used + additional > status.capacity) {
    if (billingEnforcementMode(env) === "enforce") throw new BillingServiceError(402, seatLimitMessage(status), "BILLING_SEAT_LIMIT");
    return { ...status, wouldBlock: true };
  }
  return status;
}

// Session-level lock (callers are not always inside a transaction). Never held across provider HTTP.
export async function withSeatLock(client, organizationId, work) {
  await client.query("SELECT pg_advisory_lock(hashtext($1), hashtext($2))", [organizationId, "billing-seats"]);
  try {
    return await work();
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1), hashtext($2))", [organizationId, "billing-seats"]).catch(() => undefined);
  }
}

export async function reconcileSeatOverage(client, organizationId) {
  const status = await getSeatStatus(client, organizationId);
  if (status.capacity === null) return status;
  if (status.overCapacity && !status.seatOverageSince) {
    await client.query(`UPDATE organization_subscriptions SET seat_overage_since = now() WHERE organization_id = $1 AND seat_overage_since IS NULL`, [organizationId]);
  } else if (!status.overCapacity && status.seatOverageSince) {
    await client.query(`UPDATE organization_subscriptions SET seat_overage_since = NULL WHERE organization_id = $1`, [organizationId]);
  }
  return getSeatStatus(client, organizationId);
}

// ------------------------------------------------------------------ seat-change saga
const MAX_SEAT_CHANGE_ATTEMPTS = 8;

function requireCheckoutEnabled(provider) {
  if (!provider.config?.checkoutEnabled && !provider.simulated) {
    throw new BillingServiceError(503, "Online payment is not enabled yet. Contact support to change users.", "BILLING_CHECKOUT_DISABLED");
  }
}

// Changing the number of users on a paid Standard subscription.
// - increase: provider update now (Razorpay prorates); local capacity rises only once the provider confirms;
// - reduction: provider update at cycle end; applied when the renewal shows the new quantity;
// - keeping current users while a reduction is scheduled cancels the scheduled change.
export async function changeSubscriptionSeats(client, ctx, input, provider) {
  requireCheckoutEnabled(provider);
  const users = Number(input.users);
  if (!Number.isInteger(users) || users < 1 || users > MAX_SEATED_USERS) {
    throw new BillingServiceError(422, `Choose between 1 and ${MAX_SEATED_USERS} users.`, "BILLING_USERS_INVALID");
  }
  const prepared = await tx(client, async () => {
    const sub = await subscriptionRow(client, ctx.organizationId, { lock: true });
    if (!sub || !sub.provider_subscription_id || sub.pricing_model !== "per_seat" || !["active", "authenticated", "past_due", "halted"].includes(sub.status)) {
      throw new BillingServiceError(409, "Upgrade to Standard first; the Free plan has a fixed number of users.", "BILLING_NOT_PAID");
    }
    if (!["active", "authenticated"].includes(sub.status)) {
      throw new BillingServiceError(409, "Resolve the outstanding payment before changing users.", "BILLING_PAYMENT_ISSUE");
    }
    if (sub.cancel_at_cycle_end || sub.cancellation_state === "provider_pending") {
      throw new BillingServiceError(409, "This subscription is set to cancel at renewal. Users cannot be changed.", "BILLING_CANCELLING");
    }
    const inFlight = (await client.query(`SELECT 1 FROM billing_seat_changes WHERE organization_id = $1 AND status = 'provider_pending'`, [ctx.organizationId])).rows[0];
    if (inFlight) throw new BillingServiceError(409, "Another change to your users is still being confirmed. Try again shortly.", "BILLING_CHANGE_IN_PROGRESS");

    const included = Number(sub.included_users_snapshot);
    const desired = users - included;
    if (desired < 1) {
      throw new BillingServiceError(422, `Standard needs at least ${included + 1} users. To go back to ${included}, cancel the subscription.`, "BILLING_USERS_INVALID");
    }
    const current = Number(sub.paid_seats);
    const scheduled = (await client.query(`SELECT id, to_paid_seats FROM billing_seat_changes WHERE organization_id = $1 AND status = 'pending'`, [ctx.organizationId])).rows[0];
    let operation = "change";
    let effective;
    if (scheduled) {
      if (desired === current) {
        operation = "cancel_reduction";
        effective = "cycle_end";
      } else if (desired === Number(scheduled.to_paid_seats)) {
        throw new BillingServiceError(409, "That reduction is already scheduled for your next renewal.", "BILLING_NO_CHANGE");
      } else {
        throw new BillingServiceError(409, `A reduction to ${Number(scheduled.to_paid_seats) + included} users is scheduled. Keep your current ${current + included} users first, then choose a new number.`, "BILLING_REDUCTION_SCHEDULED");
      }
    } else if (desired === current) {
      throw new BillingServiceError(409, "That is already your number of users.", "BILLING_NO_CHANGE");
    } else {
      effective = desired > current ? "now" : "cycle_end";
    }
    if (desired < current) {
      const seats = await getSeatStatus(client, ctx.organizationId);
      if (users < seats.used) {
        throw new BillingServiceError(409, `You have ${seats.activeMembers} users and ${seats.pendingInvitations} pending invitations. Remove ${seats.used - users} before reducing to ${users}.`, "BILLING_USERS_BELOW_USAGE");
      }
    }
    const reason = operation === "cancel_reduction" ? "Scheduled reduction cancelled" : effective === "now" ? "Users added" : "Users reduced at renewal";
    const change = (
      await client.query(
        `INSERT INTO billing_seat_changes (organization_id, subscription_id, from_paid_seats, to_paid_seats, effective, status, operation, reason,
                                           requested_by, provider_reference, next_attempt_at)
         VALUES ($1,$2,$3,$4,$5,'provider_pending',$6,$7,$8,$9, now() + interval '2 minutes') RETURNING *`,
        [ctx.organizationId, sub.id, current, desired, effective, operation, reason, ctx.userId, sub.provider_subscription_id],
      )
    ).rows[0];
    return { change, included };
  });

  const { change, included } = prepared;
  let remote;
  try {
    remote = await sendSeatChange(provider, change);
  } catch (error) {
    if (isDefiniteProviderRejection(error)) {
      await failSeatChange(client, change, error, ctx.userId);
      throw new BillingServiceError(502, "The payment provider did not accept the change. Your users were not changed.", "BILLING_SEAT_CHANGE_REJECTED");
    }
    await client.query(`UPDATE billing_seat_changes SET last_error = $2 WHERE id = $1`, [change.id, redactedErrorText(error)]);
    return { state: "pending", totalUsers: users, message: "We are confirming this change with the payment provider. It will update automatically." };
  }
  const result = await finalizeSeatChange(client, change.id, remote, { actorUserId: ctx.userId });
  return { ...result, totalUsers: users, includedUsers: included };
}

async function sendSeatChange(provider, change) {
  if (change.operation === "cancel_reduction") return provider.cancelScheduledChanges(change.provider_reference);
  return provider.updateSubscription(change.provider_reference, {
    quantity: Number(change.to_paid_seats),
    schedule_change_at: change.effective === "now" ? "now" : "cycle_end",
  });
}

async function failSeatChange(client, change, error, actorUserId = null) {
  await tx(client, async () => {
    const updated = await client.query(
      `UPDATE billing_seat_changes SET status = 'failed', last_error = $2 WHERE id = $1 AND status = 'provider_pending' RETURNING id`,
      [change.id, redactedErrorText(error)],
    );
    if (updated.rows[0]) {
      await billingAudit(client, {
        organizationId: change.organization_id, actorUserId, eventType: "billing.seats.change_failed", entityId: change.id,
        metadata: { from: change.from_paid_seats, to: change.to_paid_seats, effective: change.effective, operation: change.operation },
      });
    }
  });
  billingEvent("billing.seats.change_failed", { organizationId: change.organization_id, seatChangeId: change.id }, { operation: change.operation });
}

// Local finalisation after the provider accepted the change. Idempotent; safe
// to call from the request, the worker, or reconciliation.
export async function finalizeSeatChange(client, changeId, remote, { actorUserId = null } = {}) {
  return tx(client, async () => {
    const change = (await client.query(`SELECT * FROM billing_seat_changes WHERE id = $1 FOR UPDATE`, [changeId])).rows[0];
    if (!change || change.status !== "provider_pending") return { state: change?.status ?? "missing" };
    const organizationId = change.organization_id;
    const sub = await subscriptionRow(client, organizationId, { lock: true });
    const to = Number(change.to_paid_seats);
    const confirm = `UPDATE billing_seat_changes SET status = $2, provider_confirmed_at = now(), applied_at = CASE WHEN $2 = 'applied' THEN now() ELSE applied_at END, last_error = NULL WHERE id = $1`;

    if (change.operation === "cancel_reduction") {
      await client.query(`UPDATE billing_seat_changes SET status = 'cancelled' WHERE organization_id = $1 AND status = 'pending'`, [organizationId]);
      await client.query(confirm, [change.id, "applied"]);
      await client.query(`UPDATE organization_subscriptions SET pending_paid_seats = NULL WHERE organization_id = $1`, [organizationId]);
      await billingAudit(client, { organizationId, actorUserId, eventType: "billing.seats.reduction_cancelled", entityId: sub.id, metadata: { keptPaidSeats: Number(sub.paid_seats) } });
      billingEvent("billing.seats.changed", { organizationId, seatChangeId: change.id }, { operation: "cancel_reduction" });
      return { state: "applied", effective: "now", paidSeats: Number(sub.paid_seats), pendingPaidSeats: null };
    }
    if (change.effective === "now") {
      // Capacity rises only when the provider shows the new quantity.
      if (!remote || Number(remote.quantity) !== to) return { state: "pending" };
      await client.query(confirm, [change.id, "applied"]);
      await client.query(`UPDATE organization_subscriptions SET paid_seats = $2, pending_paid_seats = NULL WHERE organization_id = $1`, [organizationId, to]);
      await reconcileSeatOverage(client, organizationId);
      await billingAudit(client, {
        organizationId, actorUserId, eventType: "billing.seats.increased", entityId: sub.id,
        beforeData: { paidSeats: Number(change.from_paid_seats) }, afterData: { paidSeats: to },
      });
      billingEvent("billing.seats.changed", { organizationId, seatChangeId: change.id }, { operation: "increase" });
      return { state: "applied", effective: "now", paidSeats: to, pendingPaidSeats: null };
    }
    await client.query(confirm, [change.id, "pending"]);
    await client.query(`UPDATE organization_subscriptions SET pending_paid_seats = $2 WHERE organization_id = $1`, [organizationId, to]);
    await billingAudit(client, {
      organizationId, actorUserId, eventType: "billing.seats.reduction_scheduled", entityId: sub.id,
      beforeData: { paidSeats: Number(change.from_paid_seats) }, afterData: { pendingPaidSeats: to },
    });
    billingEvent("billing.seats.changed", { organizationId, seatChangeId: change.id }, { operation: "reduction_scheduled" });
    return { state: "scheduled", effective: "cycle_end", paidSeats: Number(sub.paid_seats), pendingPaidSeats: to };
  });
}

// Worker recovery for a seat change whose provider outcome is unknown. Every
// provider operation used here is absolute (a quantity, or "no scheduled
// change"), so re-issuing it converges instead of double-applying.
export async function recoverSeatChange(client, change, provider) {
  const attempts = Number(change.attempts) + 1;
  await client.query(`UPDATE billing_seat_changes SET attempts = $2 WHERE id = $1`, [change.id, attempts]);
  try {
    let remote;
    if (change.operation === "change" && change.effective === "now") {
      const current = await provider.fetchSubscription(change.provider_reference);
      remote = Number(current.quantity) === Number(change.to_paid_seats) ? current : await sendSeatChange(provider, change);
    } else if (change.operation === "change") {
      await provider.cancelScheduledChanges(change.provider_reference).catch((error) => {
        if (!isDefiniteProviderRejection(error)) throw error; // "no pending update" is fine
      });
      remote = await sendSeatChange(provider, change);
    } else {
      remote = await provider.cancelScheduledChanges(change.provider_reference).catch((error) => {
        if (isDefiniteProviderRejection(error)) return {}; // nothing scheduled any more: the cancellation already took effect
        throw error;
      });
    }
    const result = await finalizeSeatChange(client, change.id, remote);
    if (result.state === "pending") throw new Error("provider did not show the requested quantity yet");
    return result;
  } catch (error) {
    if (isDefiniteProviderRejection(error) || attempts >= MAX_SEAT_CHANGE_ATTEMPTS) {
      await failSeatChange(client, change, error);
      await client.query(
        `UPDATE organization_subscriptions SET reconciliation_required_at = COALESCE(reconciliation_required_at, now()), reconciliation_note = $2 WHERE organization_id = $1`,
        [change.organization_id, "A change to the number of users could not be confirmed with the payment provider."],
      );
      return { state: "failed" };
    }
    await client.query(`UPDATE billing_seat_changes SET last_error = $2, next_attempt_at = now() + make_interval(secs => $3) WHERE id = $1`, [
      change.id, redactedErrorText(error), recoveryBackoffSeconds(attempts),
    ]);
    return { state: "retry" };
  }
}
