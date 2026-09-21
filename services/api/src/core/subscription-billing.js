// Seat-based subscription billing for Vercentlabs itself.
//
//   Free       - includes 3 users.
//   Standard   - includes the same 3 users; every additional user (a "paid seat") is billed monthly.
//   Enterprise - coming soon: listed, never purchasable.
//
// The payment provider (Razorpay) is injected, so everything here is exercised against a fake in tests. Money is
// integer paise. Commercial billing never touches tenant accounting.
import { randomUUID } from "node:crypto";

import { buildRazorpayPlanPayload, shouldApplyProviderEvent } from "./billing.js";
import { billingEnforcementMode } from "./entitlements.js";

export class BillingServiceError extends Error {
  constructor(status, message, code = "BILLING_ERROR") {
    super(message);
    this.name = "BillingServiceError";
    this.status = status;
    this.code = code;
  }
}

export const MAX_SEATED_USERS = 500;
export const SEAT_OVERAGE_GRACE_DAYS = 14;
const PAST_DUE_GRACE_DAYS = 7;
const MAX_WEBHOOK_ATTEMPTS = 8;
const inr = (paise) => `Rs ${(Number(paise) / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

async function tx(client, work) {
  await client.query("BEGIN");
  try {
    const result = await work();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function audit(client, organizationId, actorUserId, eventType, entityId, metadata = {}) {
  await client.query(
    `INSERT INTO audit_events (id, organization_id, actor_user_id, event_type, entity_type, entity_id, metadata)
     VALUES ($1, $2, $3, $4, 'billing', $5, $6::jsonb)`,
    [randomUUID(), organizationId, actorUserId || null, eventType, entityId ? String(entityId) : null, JSON.stringify(metadata)],
  );
}

// ------------------------------------------------------------------ pure pricing
export function calculateSeatCharge({ includedUsers, perUserPaise, totalUsers }) {
  const included = Number(includedUsers);
  const total = Number(totalUsers);
  if (!Number.isInteger(total) || total < 1) throw new BillingServiceError(422, "Enter a whole number of users.", "BILLING_USERS_INVALID");
  const billableSeats = Math.max(0, total - included);
  return { totalUsers: total, includedUsers: included, billableSeats, monthlyPaise: billableSeats * Number(perUserPaise) };
}

// ------------------------------------------------------------------ seats
async function subscriptionRow(client, organizationId, { lock = false } = {}) {
  const res = await client.query(
    `SELECT s.*, price.amount_paise AS plan_amount_paise, plan.code AS plan_code, plan.name AS plan_name, plan.pricing_model,
            plan.included_users AS plan_included_users
       FROM organization_subscriptions s
       JOIN billing_plan_prices price ON price.id = s.plan_price_id
       JOIN billing_plans plan ON plan.id = price.plan_id
      WHERE s.organization_id = $1${lock ? " FOR UPDATE OF s" : ""}`,
    [organizationId],
  );
  return res.rows[0] || null;
}

export async function getSeatStatus(client, organizationId, { excludeInvitationId = null } = {}) {
  const sub = await subscriptionRow(client, organizationId);
  const members = Number((await client.query(`SELECT count(*)::int AS n FROM organization_memberships WHERE organization_id=$1 AND status='active'`, [organizationId])).rows[0].n);
  const pending = Number(
    (
      await client.query(
        `SELECT count(*)::int AS n FROM organization_invitations
          WHERE organization_id=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
            AND ($2::uuid IS NULL OR id <> $2::uuid)`,
        [organizationId, excludeInvitationId],
      )
    ).rows[0].n,
  );
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
    overCapacity: capacity !== null && members > capacity,
    perUserPricePaise: sub?.pricing_model === "per_seat" ? Number(sub.plan_amount_paise) : null,
    seatOverageSince: sub?.seat_overage_since ? new Date(sub.seat_overage_since).toISOString() : null,
  };
}

function seatLimitMessage(status) {
  if (status.pricingModel === "per_seat") {
    return `All ${status.capacity} users on your ${status.planName} plan are in use. Add seats in Billing (${inr(status.perUserPricePaise)} per user per month) before adding another user.`;
  }
  return `The ${status.planName} plan includes ${status.capacity} users. Upgrade to Standard in Billing to add more (${inr(100000)} per additional user per month).`;
}

// Callers hold withSeatLock around the check and the write it guards, so two people inviting at once cannot both
// take the last seat. In observe mode
// (local development) it reports instead of blocking, matching the rest of the entitlement contract.
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

// Session-level lock (the callers are not always inside a transaction): serialises seat checks per organisation.
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

// ------------------------------------------------------------------ catalogue and overview
export async function listPlanCatalogue(client, organizationId = null, env = process.env) {
  const rows = await client.query(
    `SELECT price.id AS price_id, price.amount_paise, price.currency, price.billing_period,
            plan.code, plan.name, plan.description, plan.features, plan.availability, plan.pricing_model, plan.included_users
       FROM billing_plans plan
       JOIN billing_plan_prices price ON price.plan_id = plan.id AND price.active AND price.billing_period IN ('monthly', 'custom')
      WHERE plan.status = 'active' AND plan.is_public
      ORDER BY plan.display_order`,
  );
  const current = organizationId ? await subscriptionRow(client, organizationId) : null;
  const checkoutEnabled = String(env.BILLING_CHECKOUT_ENABLED || "").toLowerCase() === "true";
  return rows.rows.map((row) => ({
    priceId: row.price_id,
    code: row.code,
    name: row.name,
    description: row.description,
    features: Array.isArray(row.features) ? row.features : [],
    availability: row.availability,
    pricingModel: row.pricing_model,
    includedUsers: row.included_users,
    perUserPricePaise: row.pricing_model === "per_seat" ? Number(row.amount_paise) : null,
    currency: row.currency,
    current: current?.plan_code === row.code,
    purchasable: row.availability === "available" && row.pricing_model === "per_seat" && checkoutEnabled,
  }));
}

export async function getBillingOverview(client, organizationId, env = process.env) {
  const sub = await subscriptionRow(client, organizationId);
  if (!sub) throw new BillingServiceError(409, "Billing is not initialised for this organisation.", "BILLING_NOT_INITIALISED");
  const seats = await getSeatStatus(client, organizationId);
  const plans = await listPlanCatalogue(client, organizationId, env);
  const profile = (await client.query(`SELECT legal_name, billing_email, phone, gstin, billing_address FROM billing_customers WHERE organization_id=$1`, [organizationId])).rows[0] || null;
  const invoices = (await client.query(`SELECT id, provider_invoice_id, amount_paise, amount_paid_paise, status, invoice_url, issued_at, paid_at FROM billing_invoices WHERE organization_id=$1 ORDER BY COALESCE(issued_at, created_at) DESC LIMIT 24`, [organizationId])).rows;
  const payments = (await client.query(`SELECT id, provider_payment_id, amount_paise, status, method, captured_at, created_at FROM billing_payments WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 24`, [organizationId])).rows;
  const seatChanges = (await client.query(`SELECT id, from_paid_seats, to_paid_seats, effective, status, reason, created_at FROM billing_seat_changes WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 12`, [organizationId])).rows;
  const overageGraceEnds = seats.seatOverageSince ? new Date(new Date(seats.seatOverageSince).getTime() + SEAT_OVERAGE_GRACE_DAYS * 86_400_000).toISOString() : null;
  const monthlyPaise = sub.pricing_model === "per_seat" ? seats.paidSeats * Number(sub.plan_amount_paise) : 0;
  return {
    subscription: {
      status: sub.status,
      planCode: sub.plan_code,
      planName: sub.plan_name,
      pricingModel: sub.pricing_model,
      currentPeriodEndsAt: sub.current_period_ends_at ? new Date(sub.current_period_ends_at).toISOString() : null,
      cancelAtCycleEnd: sub.cancel_at_cycle_end,
      graceEndsAt: sub.grace_ends_at ? new Date(sub.grace_ends_at).toISOString() : null,
      hasProviderSubscription: Boolean(sub.provider_subscription_id),
      monthlyPaise,
    },
    seats,
    overageGraceEndsAt: overageGraceEnds,
    plans,
    profile,
    invoices,
    payments,
    seatChanges,
    checkoutEnabled: String(env.BILLING_CHECKOUT_ENABLED || "").toLowerCase() === "true",
    enforcementMode: billingEnforcementMode(env),
  };
}

// ------------------------------------------------------------------ profile
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export async function saveBillingProfile(client, ctx, input) {
  const legalName = String(input.legalName ?? "").trim().slice(0, 200);
  const email = String(input.billingEmail ?? "").trim().toLowerCase().slice(0, 320);
  const phone = String(input.phone ?? "").trim().slice(0, 30);
  const gstin = String(input.gstin ?? "").trim().toUpperCase();
  if (!legalName) throw new BillingServiceError(422, "The legal name is required.", "BILLING_PROFILE_INVALID");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BillingServiceError(422, "Enter a valid billing email.", "BILLING_PROFILE_INVALID");
  if (gstin && !GSTIN.test(gstin)) throw new BillingServiceError(422, "That GSTIN is not valid.", "BILLING_GSTIN_INVALID");
  const address = {
    line1: String(input.addressLine1 ?? "").trim().slice(0, 200),
    city: String(input.city ?? "").trim().slice(0, 100),
    state: String(input.state ?? "").trim().slice(0, 100),
    postalCode: String(input.postalCode ?? "").trim().slice(0, 20),
    country: String(input.country ?? "IN").trim().slice(0, 2).toUpperCase() || "IN",
  };
  return tx(client, async () => {
    const res = await client.query(
      `INSERT INTO billing_customers (organization_id, legal_name, billing_email, phone, gstin, billing_address)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)
       ON CONFLICT (organization_id) DO UPDATE SET legal_name=EXCLUDED.legal_name, billing_email=EXCLUDED.billing_email,
         phone=EXCLUDED.phone, gstin=EXCLUDED.gstin, billing_address=EXCLUDED.billing_address
       RETURNING legal_name, billing_email, phone, gstin, billing_address`,
      [ctx.organizationId, legalName, email, phone || null, gstin || null, JSON.stringify(address)],
    );
    await audit(client, ctx.organizationId, ctx.userId, "billing.profile.updated", ctx.organizationId, { gstinSet: Boolean(gstin) });
    return res.rows[0];
  });
}

// ------------------------------------------------------------------ checkout
function requireCheckoutEnabled(provider) {
  if (!provider.config?.checkoutEnabled && !provider.simulated) {
    throw new BillingServiceError(503, "Online payment is not enabled yet. Contact support to upgrade.", "BILLING_CHECKOUT_DISABLED");
  }
}

async function ensureProviderPlan(client, provider, price) {
  if (price.provider_plan_id) return price.provider_plan_id;
  const created = await provider.createPlan(
    buildRazorpayPlanPayload({
      id: price.price_id, planCode: price.code, name: `${price.name} - per additional user`,
      description: `${price.name}: one additional user, billed monthly`, amountPaise: Number(price.amount_paise),
      billingPeriod: price.billing_period, currency: price.currency, version: price.version,
    }),
  );
  await client.query(`UPDATE billing_plan_prices SET provider_plan_id = COALESCE(provider_plan_id, $2) WHERE id = $1`, [price.price_id, created.id]);
  return (await client.query(`SELECT provider_plan_id FROM billing_plan_prices WHERE id=$1`, [price.price_id])).rows[0].provider_plan_id;
}

export async function startSeatCheckout(client, ctx, input, provider, env = process.env) {
  requireCheckoutEnabled(provider);
  const users = Number(input.users);
  if (!Number.isInteger(users) || users < 1 || users > MAX_SEATED_USERS) {
    throw new BillingServiceError(422, `Choose between 1 and ${MAX_SEATED_USERS} users.`, "BILLING_USERS_INVALID");
  }
  const priceRow = (
    await client.query(
      `SELECT price.id AS price_id, price.amount_paise, price.currency, price.billing_period, price.version, price.provider_plan_id,
              plan.code, plan.name, plan.availability, plan.pricing_model, plan.included_users, plan.status
         FROM billing_plan_prices price JOIN billing_plans plan ON plan.id = price.plan_id
        WHERE price.id = $1 AND price.active`,
      [input.planPriceId],
    )
  ).rows[0];
  if (!priceRow || priceRow.status !== "active") throw new BillingServiceError(404, "That plan is not available.", "BILLING_PLAN_NOT_FOUND");
  if (priceRow.availability === "coming_soon") throw new BillingServiceError(409, `${priceRow.name} is coming soon and cannot be purchased yet.`, "BILLING_PLAN_COMING_SOON");
  if (priceRow.pricing_model !== "per_seat" || priceRow.billing_period !== "monthly") throw new BillingServiceError(409, "That plan is not purchasable online.", "BILLING_PLAN_NOT_PURCHASABLE");
  const charge = calculateSeatCharge({ includedUsers: priceRow.included_users, perUserPaise: priceRow.amount_paise, totalUsers: users });
  if (charge.billableSeats < 1) throw new BillingServiceError(422, `Standard starts at ${priceRow.included_users + 1} users. Up to ${priceRow.included_users} users is free.`, "BILLING_USERS_INVALID");

  const prepared = await tx(client, async () => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [ctx.organizationId, "billing-checkout"]);
    const sub = await subscriptionRow(client, ctx.organizationId, { lock: true });
    if (!sub) throw new BillingServiceError(409, "Billing is not initialised for this organisation.", "BILLING_NOT_INITIALISED");
    if (sub.provider_subscription_id && ["active", "authenticated", "past_due"].includes(sub.status)) {
      throw new BillingServiceError(409, "You already have a paid subscription. Change the number of users instead.", "BILLING_ALREADY_SUBSCRIBED");
    }
    const seats = await getSeatStatus(client, ctx.organizationId);
    if (users < seats.used) {
      throw new BillingServiceError(409, `You currently have ${seats.activeMembers} users and ${seats.pendingInvitations} pending invitations. Choose at least ${seats.used}.`, "BILLING_USERS_BELOW_USAGE");
    }
    const live = (await client.query(`SELECT * FROM billing_checkout_sessions WHERE organization_id=$1 AND status IN ('created','provider_creating','provider_link_pending','provider_recovery_pending','verifying') FOR UPDATE`, [ctx.organizationId])).rows[0];
    if (live && live.status === "created" && live.plan_price_id === priceRow.price_id && Number(live.metadata?.paid_seats) === charge.billableSeats && new Date(live.expires_at) > new Date() && live.provider_subscription_id) {
      return { reuse: live };
    }
    if (live) await client.query(`UPDATE billing_checkout_sessions SET status='superseded' WHERE id=$1`, [live.id]);
    const session = (
      await client.query(
        `INSERT INTO billing_checkout_sessions (organization_id, plan_price_id, subscription_id, status, initiated_by, metadata)
         VALUES ($1,$2,$3,'provider_creating',$4,$5::jsonb) RETURNING id`,
        [ctx.organizationId, priceRow.price_id, sub.id, ctx.userId, JSON.stringify({ paid_seats: charge.billableSeats, total_users: users, monthly_paise: charge.monthlyPaise })],
      )
    ).rows[0];
    return { session, superseded: live?.provider_subscription_id || null };
  });

  const customer = (await client.query(`SELECT legal_name, billing_email, phone FROM billing_customers WHERE organization_id=$1`, [ctx.organizationId])).rows[0] || {};
  const prefill = { name: customer.legal_name || "", email: customer.billing_email || ctx.email || "", contact: customer.phone || undefined };
  const response = (sessionId, providerSubscriptionId) => ({
    checkoutSessionId: sessionId, keyId: provider.publicKey, providerSubscriptionId,
    name: "Vercentlabs", description: `${priceRow.name}: ${users} users (${charge.billableSeats} additional at ${inr(priceRow.amount_paise)} per month)`,
    prefill, monthlyPaise: charge.monthlyPaise, paidSeats: charge.billableSeats, totalUsers: users,
  });
  if (prepared.reuse) return response(prepared.reuse.id, prepared.reuse.provider_subscription_id);

  if (prepared.superseded) await provider.cancelSubscription(prepared.superseded, false).catch(() => undefined);
  let providerSubscription;
  try {
    const providerPlanId = await ensureProviderPlan(client, provider, priceRow);
    providerSubscription = await provider.createSubscription({
      plan_id: providerPlanId, total_count: 120, quantity: charge.billableSeats, customer_notify: true,
      notes: {
        vercentlabs_organization_id: ctx.organizationId, vercentlabs_plan_code: priceRow.code,
        vercentlabs_plan_price_id: priceRow.price_id, vercentlabs_checkout_session_id: prepared.session.id,
      },
    });
  } catch (error) {
    await client.query(`UPDATE billing_checkout_sessions SET status='failed_before_provider', last_error=$2 WHERE id=$1`, [prepared.session.id, String(error.message).slice(0, 500)]);
    throw error;
  }
  await client.query(`UPDATE billing_checkout_sessions SET status='created', provider_subscription_id=$2, provider_created_at=now(), provider_linked_at=now() WHERE id=$1`, [prepared.session.id, providerSubscription.id]);
  await audit(client, ctx.organizationId, ctx.userId, "billing.checkout.started", prepared.session.id, { paidSeats: charge.billableSeats, monthlyPaise: charge.monthlyPaise });
  return response(prepared.session.id, providerSubscription.id);
}

async function applyPaidPlan(client, organizationId, priceId, providerSubscriptionId, paidSeats, status, metadata = {}) {
  const price = (
    await client.query(
      `SELECT price.amount_paise, price.currency, price.billing_period, price.version, plan.code, plan.name, plan.modules, plan.limits, plan.included_users
         FROM billing_plan_prices price JOIN billing_plans plan ON plan.id = price.plan_id WHERE price.id = $1`,
      [priceId],
    )
  ).rows[0];
  await client.query(
    `UPDATE organization_subscriptions SET plan_price_id=$2, provider_subscription_id=$3, status=$4, provider_status=$4,
            billing_period=$5, trial_started_at=NULL, trial_ends_at=NULL, grace_ends_at=NULL, cancel_at_cycle_end=false, cancelled_at=NULL,
            price_snapshot=$6::jsonb, modules_snapshot=$7::jsonb, limits_snapshot=$8::jsonb, included_users_snapshot=$9,
            paid_seats=$10, pending_paid_seats=NULL, metadata = metadata || $11::jsonb
      WHERE organization_id=$1`,
    [
      organizationId, priceId, providerSubscriptionId, status, price.billing_period,
      JSON.stringify({ plan_code: price.code, plan_name: price.name, amount_paise: Number(price.amount_paise), currency: price.currency, billing_period: price.billing_period, version: price.version }),
      JSON.stringify(price.modules), JSON.stringify(price.limits), price.included_users, paidSeats, JSON.stringify(metadata),
    ],
  );
}

export async function confirmSeatCheckout(client, ctx, input, provider) {
  const session = (await client.query(`SELECT * FROM billing_checkout_sessions WHERE id=$1 AND organization_id=$2`, [input.checkoutSessionId, ctx.organizationId])).rows[0];
  if (!session) throw new BillingServiceError(404, "That checkout was not found.", "BILLING_CHECKOUT_NOT_FOUND");
  if (session.status === "authorised") return { alreadyConfirmed: true };
  if (session.status !== "created") throw new BillingServiceError(409, "That checkout is no longer open. Start a new one.", "BILLING_CHECKOUT_CLOSED");
  const ok = provider.verifyCheckout({ paymentId: input.razorpay_payment_id, subscriptionId: input.razorpay_subscription_id, signature: input.razorpay_signature });
  if (!ok || input.razorpay_subscription_id !== session.provider_subscription_id) {
    throw new BillingServiceError(400, "The payment could not be verified. You have not been charged for a plan change; contact support if money was debited.", "BILLING_SIGNATURE_INVALID");
  }
  return tx(client, async () => {
    const locked = (await client.query(`SELECT status FROM billing_checkout_sessions WHERE id=$1 FOR UPDATE`, [session.id])).rows[0];
    if (locked.status === "authorised") return { alreadyConfirmed: true };
    if (locked.status !== "created") throw new BillingServiceError(409, "That checkout is no longer open. Start a new one.", "BILLING_CHECKOUT_CLOSED");
    await subscriptionRow(client, ctx.organizationId, { lock: true });
    const paidSeats = Number(session.metadata?.paid_seats || 0);
    await applyPaidPlan(client, ctx.organizationId, session.plan_price_id, session.provider_subscription_id, paidSeats, "authenticated", { checkout_session_id: session.id });
    await client.query(`UPDATE billing_checkout_sessions SET status='authorised' WHERE id=$1`, [session.id]);
    await client.query(`INSERT INTO billing_seat_changes (organization_id, subscription_id, from_paid_seats, to_paid_seats, effective, status, reason, requested_by, provider_reference) VALUES ($1,$2,0,$3,'now','applied','Upgrade to Standard',$4,$5)`, [ctx.organizationId, session.subscription_id, paidSeats, ctx.userId, session.provider_subscription_id]);
    await reconcileSeatOverage(client, ctx.organizationId);
    await audit(client, ctx.organizationId, ctx.userId, "billing.checkout.confirmed", session.id, { paidSeats, providerSubscriptionId: session.provider_subscription_id });
    return { alreadyConfirmed: false, paidSeats };
  });
}

// ------------------------------------------------------------------ changing seats, cancelling
export async function changeSubscriptionSeats(client, ctx, input, provider) {
  requireCheckoutEnabled(provider);
  const users = Number(input.users);
  if (!Number.isInteger(users) || users < 1 || users > MAX_SEATED_USERS) throw new BillingServiceError(422, `Choose between 1 and ${MAX_SEATED_USERS} users.`, "BILLING_USERS_INVALID");
  return tx(client, async () => {
    const sub = await subscriptionRow(client, ctx.organizationId, { lock: true });
    if (!sub || !sub.provider_subscription_id || !["active", "authenticated", "past_due"].includes(sub.status) || sub.pricing_model !== "per_seat") {
      throw new BillingServiceError(409, "Upgrade to Standard first; the Free plan has a fixed number of users.", "BILLING_NOT_PAID");
    }
    if (sub.cancel_at_cycle_end) throw new BillingServiceError(409, "This subscription is set to cancel. Seats cannot be changed.", "BILLING_CANCELLING");
    const included = Number(sub.included_users_snapshot);
    const desired = users - included;
    if (desired < 1) throw new BillingServiceError(422, `Standard needs at least ${included + 1} users. To go back to ${included} or fewer users, cancel the subscription.`, "BILLING_USERS_INVALID");
    const current = Number(sub.paid_seats);
    const effectiveTarget = sub.pending_paid_seats === null ? current : Number(sub.pending_paid_seats);
    if (desired === effectiveTarget) throw new BillingServiceError(409, "That is already your number of users.", "BILLING_NO_CHANGE");
    const seats = await getSeatStatus(client, ctx.organizationId);
    if (desired < current && users < seats.used) {
      throw new BillingServiceError(409, `You have ${seats.activeMembers} users and ${seats.pendingInvitations} pending invitations. Remove ${seats.used - users} before reducing to ${users}.`, "BILLING_USERS_BELOW_USAGE");
    }
    if (desired > current) {
      await provider.updateSubscription(sub.provider_subscription_id, { quantity: desired, schedule_change_at: "now" });
      await client.query(`UPDATE organization_subscriptions SET paid_seats=$2, pending_paid_seats=NULL WHERE organization_id=$1`, [ctx.organizationId, desired]);
      await client.query(`INSERT INTO billing_seat_changes (organization_id, subscription_id, from_paid_seats, to_paid_seats, effective, status, reason, requested_by, provider_reference) VALUES ($1,$2,$3,$4,'now','applied','Seats added',$5,$6)`, [ctx.organizationId, sub.id, current, desired, ctx.userId, sub.provider_subscription_id]);
      await reconcileSeatOverage(client, ctx.organizationId);
      await audit(client, ctx.organizationId, ctx.userId, "billing.seats.increased", sub.id, { from: current, to: desired });
      return { effective: "now", paidSeats: desired, totalUsers: users };
    }
    await provider.updateSubscription(sub.provider_subscription_id, { quantity: desired, schedule_change_at: "cycle_end" });
    await client.query(`UPDATE organization_subscriptions SET pending_paid_seats=$2 WHERE organization_id=$1`, [ctx.organizationId, desired]);
    await client.query(`INSERT INTO billing_seat_changes (organization_id, subscription_id, from_paid_seats, to_paid_seats, effective, status, reason, requested_by, provider_reference) VALUES ($1,$2,$3,$4,'cycle_end','pending','Seats reduced at renewal',$5,$6)`, [ctx.organizationId, sub.id, current, desired, ctx.userId, sub.provider_subscription_id]);
    await audit(client, ctx.organizationId, ctx.userId, "billing.seats.reduction_scheduled", sub.id, { from: current, to: desired });
    return { effective: "cycle_end", paidSeats: current, pendingPaidSeats: desired, totalUsers: users };
  });
}

export async function revertToFree(client, organizationId, reason, actorUserId = null) {
  const free = (
    await client.query(
      `SELECT price.id, price.amount_paise, price.currency, plan.code, plan.name, plan.modules, plan.limits, plan.included_users
         FROM billing_plans plan JOIN billing_plan_prices price ON price.plan_id = plan.id AND price.active AND price.billing_period='monthly'
        WHERE plan.code='free'`,
    )
  ).rows[0];
  if (!free) throw new BillingServiceError(500, "The Free plan is not configured.", "BILLING_FREE_PLAN_MISSING");
  const before = await subscriptionRow(client, organizationId, { lock: true });
  await client.query(
    `UPDATE organization_subscriptions SET plan_price_id=$2, status='active', provider_status=NULL, provider_subscription_id=NULL, billing_period='monthly',
            trial_started_at=NULL, trial_ends_at=NULL, grace_ends_at=NULL, current_period_started_at=now(), current_period_ends_at=NULL,
            cancel_at_cycle_end=false, cancelled_at=now(), price_snapshot=$3::jsonb, modules_snapshot=$4::jsonb, limits_snapshot=$5::jsonb,
            included_users_snapshot=$6, paid_seats=0, pending_paid_seats=NULL,
            metadata = metadata || jsonb_build_object('reverted_to_free', $7::text, 'previous_provider_subscription_id', $8::text)
      WHERE organization_id=$1`,
    [
      organizationId, free.id,
      JSON.stringify({ plan_code: free.code, plan_name: free.name, amount_paise: Number(free.amount_paise), currency: free.currency }),
      JSON.stringify(free.modules), JSON.stringify(free.limits), free.included_users, reason, before?.provider_subscription_id ?? null,
    ],
  );
  await reconcileSeatOverage(client, organizationId);
  await audit(client, organizationId, actorUserId, "billing.reverted_to_free", before?.id, { reason });
}

export async function cancelPaidSubscription(client, ctx, input, provider) {
  const atCycleEnd = input.cancelAtCycleEnd !== false;
  return tx(client, async () => {
    const sub = await subscriptionRow(client, ctx.organizationId, { lock: true });
    if (!sub || !sub.provider_subscription_id || sub.pricing_model !== "per_seat") throw new BillingServiceError(409, "There is no paid subscription to cancel.", "BILLING_NOT_PAID");
    const cycleEnd = atCycleEnd && sub.status === "active" && sub.current_period_ends_at;
    await provider.cancelSubscription(sub.provider_subscription_id, Boolean(cycleEnd));
    if (cycleEnd) {
      await client.query(`UPDATE organization_subscriptions SET cancel_at_cycle_end=true WHERE organization_id=$1`, [ctx.organizationId]);
      await audit(client, ctx.organizationId, ctx.userId, "billing.cancel.scheduled", sub.id, { periodEnds: sub.current_period_ends_at });
      return { effective: "cycle_end", endsAt: new Date(sub.current_period_ends_at).toISOString() };
    }
    await revertToFree(client, ctx.organizationId, "cancelled_immediately", ctx.userId);
    return { effective: "now" };
  });
}

// ------------------------------------------------------------------ webhooks
const epoch = (seconds) => (seconds ? new Date(Number(seconds) * 1000) : null);

async function upsertPayment(client, organizationId, subscriptionId, payment) {
  if (!payment?.id) return;
  await client.query(
    `INSERT INTO billing_payments (organization_id, subscription_id, provider_payment_id, provider_invoice_id, amount_paise, fee_paise, tax_paise, currency, status, method, captured_at, provider_snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
     ON CONFLICT (provider, provider_payment_id) DO UPDATE SET status=EXCLUDED.status, amount_paise=EXCLUDED.amount_paise,
       fee_paise=EXCLUDED.fee_paise, tax_paise=EXCLUDED.tax_paise, method=EXCLUDED.method, captured_at=EXCLUDED.captured_at,
       provider_invoice_id=COALESCE(EXCLUDED.provider_invoice_id, billing_payments.provider_invoice_id)`,
    [organizationId, subscriptionId, payment.id, payment.invoice_id || null, Number(payment.amount || 0), Number(payment.fee || 0), Number(payment.tax || 0),
      String(payment.currency || "INR").slice(0, 3), String(payment.status || "created"), payment.method || null, payment.status === "captured" ? epoch(payment.created_at) : null,
      JSON.stringify({ id: payment.id, status: payment.status, order_id: payment.order_id ?? null })],
  );
}

async function upsertInvoice(client, organizationId, subscriptionId, invoice) {
  if (!invoice?.id) return;
  await client.query(
    `INSERT INTO billing_invoices (organization_id, subscription_id, provider_invoice_id, amount_paise, amount_due_paise, amount_paid_paise, tax_paise, currency, status, invoice_url, issued_at, paid_at, provider_snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
     ON CONFLICT (provider, provider_invoice_id) DO UPDATE SET status=EXCLUDED.status, amount_paid_paise=EXCLUDED.amount_paid_paise,
       amount_due_paise=EXCLUDED.amount_due_paise, paid_at=EXCLUDED.paid_at, invoice_url=COALESCE(EXCLUDED.invoice_url, billing_invoices.invoice_url)`,
    [organizationId, subscriptionId, invoice.id, Number(invoice.amount || 0), Number(invoice.amount_due || 0), Number(invoice.amount_paid || 0), Number(invoice.tax_amount || 0),
      String(invoice.currency || "INR").slice(0, 3), String(invoice.status || "issued"), invoice.short_url || null, epoch(invoice.issued_at || invoice.created_at), epoch(invoice.paid_at),
      JSON.stringify({ id: invoice.id, status: invoice.status })],
  );
}

async function locateOrganization(client, event) {
  const subscription = event.payload?.subscription?.entity;
  if (subscription?.id) {
    const row = (await client.query(`SELECT organization_id FROM organization_subscriptions WHERE provider_subscription_id=$1`, [subscription.id])).rows[0];
    if (row) return row.organization_id;
    const session = (await client.query(`SELECT organization_id FROM billing_checkout_sessions WHERE provider_subscription_id=$1`, [subscription.id])).rows[0];
    if (session) return session.organization_id;
    if (subscription.notes?.vercentlabs_organization_id) return subscription.notes.vercentlabs_organization_id;
  }
  const payment = event.payload?.payment?.entity;
  if (payment?.id) {
    const row = (await client.query(`SELECT organization_id FROM billing_payments WHERE provider_payment_id=$1`, [payment.id])).rows[0];
    if (row) return row.organization_id;
  }
  return null;
}

async function applyEvent(client, event) {
  const type = event.event;
  const organizationId = await locateOrganization(client, event);
  if (!organizationId) return { status: "ignored", organizationId: null };
  const sub = await subscriptionRow(client, organizationId, { lock: true });
  const entity = event.payload?.subscription?.entity;
  const eventAt = epoch(event.created_at);
  const fresh = shouldApplyProviderEvent(sub?.last_provider_event_at, eventAt);
  const payment = event.payload?.payment?.entity;
  const invoice = event.payload?.invoice?.entity;
  if (payment) await upsertPayment(client, organizationId, sub?.id ?? null, payment);
  if (invoice) await upsertInvoice(client, organizationId, sub?.id ?? null, invoice);
  const isCurrent = entity && sub && sub.provider_subscription_id === entity.id;
  if (!type.startsWith("subscription.")) return { status: payment || invoice ? "processed" : "ignored", organizationId };
  if (!isCurrent || !fresh) return { status: "ignored", organizationId };

  if (type === "subscription.authenticated") {
    if (!["active", "past_due"].includes(sub.status)) await client.query(`UPDATE organization_subscriptions SET status='authenticated', provider_status='authenticated' WHERE organization_id=$1`, [organizationId]);
  } else if (type === "subscription.activated" || type === "subscription.charged" || type === "subscription.updated") {
    const quantity = entity.quantity === undefined ? null : Number(entity.quantity);
    const start = epoch(entity.current_start);
    const end = epoch(entity.current_end);
    const activating = type !== "subscription.updated";
    const pending = sub.pending_paid_seats === null ? null : Number(sub.pending_paid_seats);
    const reducing = quantity !== null && quantity < Number(sub.paid_seats);
    // A scheduled reduction only lands on a renewal charge, never on a mid-cycle update.
    const defer = reducing && (type === "subscription.updated" || (pending !== null && quantity !== pending));
    const seats = quantity === null || defer ? Number(sub.paid_seats) : quantity;
    const clearPending = !defer && quantity !== null && pending !== null && quantity === pending;
    await client.query(
      `UPDATE organization_subscriptions SET
          status = CASE WHEN $2::boolean THEN 'active' ELSE status END,
          provider_status = COALESCE($3, provider_status),
          current_period_started_at = COALESCE($4, current_period_started_at),
          current_period_ends_at = COALESCE($5, current_period_ends_at),
          grace_ends_at = CASE WHEN $2::boolean THEN NULL ELSE grace_ends_at END,
          paid_seats = $6, pending_paid_seats = CASE WHEN $7::boolean THEN NULL ELSE pending_paid_seats END
        WHERE organization_id=$1`,
      [organizationId, activating, entity.status || null, start, end, seats, clearPending],
    );
    if (clearPending) {
      await client.query(`UPDATE billing_seat_changes SET status='applied' WHERE organization_id=$1 AND status='pending' AND to_paid_seats=$2`, [organizationId, seats]);
      await reconcileSeatOverage(client, organizationId);
    }
  } else if (type === "subscription.pending") {
    await client.query(`UPDATE organization_subscriptions SET status='past_due', provider_status='pending', grace_ends_at = COALESCE(grace_ends_at, now() + make_interval(days => $2)) WHERE organization_id=$1`, [organizationId, PAST_DUE_GRACE_DAYS]);
  } else if (type === "subscription.halted") {
    await client.query(`UPDATE organization_subscriptions SET status='halted', provider_status='halted', grace_ends_at = LEAST(COALESCE(grace_ends_at, now()), now()) WHERE organization_id=$1`, [organizationId]);
  } else if (["subscription.cancelled", "subscription.completed", "subscription.expired"].includes(type)) {
    await revertToFree(client, organizationId, type);
  } else {
    return { status: "ignored", organizationId };
  }
  if (eventAt) await client.query(`UPDATE organization_subscriptions SET last_provider_event_at = GREATEST(COALESCE(last_provider_event_at, $2), $2) WHERE organization_id=$1`, [organizationId, eventAt]);
  return { status: "processed", organizationId };
}

async function processStoredEvent(client, row) {
  const event = row.payload;
  try {
    const result = await tx(client, () => applyEvent(client, event));
    await client.query(`UPDATE billing_webhook_events SET processing_status=$2, organization_id=$3, processed_at=now(), processing_error=NULL, last_attempt_at=now() WHERE id=$1`, [row.id, result.status, result.organizationId]);
    return result.status;
  } catch (error) {
    const attempts = Number(row.processing_attempts) + 1;
    const dead = attempts >= MAX_WEBHOOK_ATTEMPTS;
    await client.query(
      `UPDATE billing_webhook_events SET processing_status=$2, processing_error=$3, processing_attempts=$4, last_attempt_at=now(),
              next_attempt_at = now() + make_interval(mins => $5), dead_lettered_at = CASE WHEN $6::boolean THEN now() ELSE NULL END WHERE id=$1`,
      [row.id, dead ? "dead_lettered" : "failed", String(error.message).slice(0, 500), attempts, Math.min(60, 2 ** attempts), dead],
    );
    throw error;
  }
}

export async function handleBillingWebhook(client, { rawBody, signature, eventId }, provider) {
  if (!provider.verifyWebhook(rawBody, signature)) throw new BillingServiceError(401, "The webhook signature is invalid.", "BILLING_WEBHOOK_SIGNATURE_INVALID");
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw new BillingServiceError(400, "The webhook body is not valid JSON.", "BILLING_WEBHOOK_INVALID");
  }
  const id = String(eventId || event.id || `${event.event}:${event.created_at}:${event.payload?.subscription?.entity?.id || event.payload?.payment?.entity?.id || ""}`).slice(0, 200);
  if (!event.event) throw new BillingServiceError(400, "The webhook has no event type.", "BILLING_WEBHOOK_INVALID");
  const inserted = (
    await client.query(
      `INSERT INTO billing_webhook_events (provider_event_id, event_type, provider_created_at, signature, payload)
       VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING *`,
      [id, event.event, epoch(event.created_at), signature, JSON.stringify(event)],
    )
  ).rows[0];
  const row = inserted || (await client.query(`SELECT * FROM billing_webhook_events WHERE provider='razorpay' AND provider_event_id=$1`, [id])).rows[0];
  if (!inserted && ["processed", "ignored", "dead_lettered"].includes(row.processing_status)) return { duplicate: true, status: row.processing_status };
  const status = await processStoredEvent(client, row);
  return { duplicate: false, status };
}

export async function retryBillingWebhooks(client, { limit = 20 } = {}) {
  const due = (await client.query(`SELECT * FROM billing_webhook_events WHERE processing_status IN ('failed','received') AND COALESCE(next_attempt_at, now()) <= now() ORDER BY created_at LIMIT $1`, [limit])).rows;
  let processed = 0;
  let failed = 0;
  for (const row of due) {
    try {
      await processStoredEvent(client, row);
      processed += 1;
    } catch {
      failed += 1;
    }
  }
  return { processed, failed };
}

