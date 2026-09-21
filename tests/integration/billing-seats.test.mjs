// Real PostgreSQL integration test: the Free / Standard / coming-soon plan model with per-user pricing.
// The payment provider is a fake with the real signature maths, so checkout verification and webhook
// authentication are exercised for real.
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";

import { Client } from "pg";

import { createOrganizationInvitation } from "../../services/api/src/core/auth-lifecycle.js";
import { requireBillingWriteAccess, getBillingSummary } from "../../services/api/src/core/entitlements.js";
import { setMemberStatus } from "../../services/api/src/core/organization-administration.js";
import {
  BillingServiceError, assertSeatAvailable, calculateSeatCharge, cancelPaidSubscription, changeSubscriptionSeats, confirmSeatCheckout,
  getBillingOverview, getSeatStatus, handleBillingWebhook, listPlanCatalogue, reconcileSeatOverage, saveBillingProfile, startSeatCheckout,
} from "../../services/api/src/core/subscription-billing.js";
import { verifyCheckoutSignature, verifyWebhookSignature } from "../../services/api/src/core/razorpay.js";

const url = process.env.MIGRATION_DATABASE_URL || "";
const KEY_SECRET = "test_key_secret";
const WEBHOOK_SECRET = "test_webhook_secret";
const ENFORCE = { BILLING_ENFORCEMENT_MODE: "enforce", BILLING_CHECKOUT_ENABLED: "true", APP_URL: "http://localhost:3001" };
const OBSERVE = { BILLING_ENFORCEMENT_MODE: "observe" };

function fakeProvider() {
  const calls = [];
  let n = 0;
  return {
    simulated: true, publicKey: "rzp_test_fake", config: { checkoutEnabled: true }, calls,
    createPlan: async (payload) => { calls.push(["plan", payload]); return { id: `plan_${randomUUID()}` }; },
    createSubscription: async (payload) => { calls.push(["subscription", payload]); return { id: `sub_${randomUUID()}` }; },
    updateSubscription: async (id, payload) => { calls.push(["update", id, payload]); return {}; },
    cancelSubscription: async (id, atEnd) => { calls.push(["cancel", id, atEnd]); return {}; },
    verifyCheckout: (input) => verifyCheckoutSignature(input, KEY_SECRET),
    verifyWebhook: (raw, signature) => verifyWebhookSignature(raw, signature, [WEBHOOK_SECRET]),
  };
}
const sign = (paymentId, subscriptionId) => createHmac("sha256", KEY_SECRET).update(`${paymentId}|${subscriptionId}`).digest("hex");
const webhookBody = (event, entity, extra = {}, createdAt = Math.floor(Date.now() / 1000)) => JSON.stringify({ event, created_at: createdAt, payload: { subscription: { entity }, ...extra } });
const deliver = (client, provider, body, eventId = randomUUID()) =>
  handleBillingWebhook(client, { rawBody: body, signature: createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex"), eventId }, provider);
const refuses = async (work, code) => assert.rejects(work, (e) => { assert.equal(e.code, code, e.message); return true; });

test("Free, Standard and coming-soon plans with per-user pricing, against real PostgreSQL", async (t) => {
  if (!url) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const db = new Client({ connectionString: url });
  await db.connect();
  const orgs = [];
  const users = [];
  const newUser = async (label) => {
    const id = randomUUID();
    await db.query(`INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at) VALUES($1,$2,$3,'x','active',now())`, [id, `seat-${label}-${id}@test.invalid`, label]);
    users.push(id);
    return id;
  };
  async function world(memberCount) {
    const owner = await newUser("owner");
    const orgId = randomUUID();
    await db.query(`INSERT INTO organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES($1,'Seat Org',$2,'IN','Asia/Kolkata','INR',$3)`, [orgId, `seat-org-${orgId}`, owner]);
    orgs.push(orgId);
    const roleId = randomUUID();
    await db.query(`INSERT INTO roles(id,organization_id,slug,name,status) VALUES($1,$2,'seat_role','Seat Role','active')`, [roleId, orgId]);
    const members = [owner];
    await db.query(`INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES($1,$2,'owner','active')`, [orgId, owner]);
    for (let i = 1; i < memberCount; i += 1) {
      const id = await newUser(`m${i}`);
      members.push(id);
      await db.query(`INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES($1,$2,'member','active')`, [orgId, id]);
    }
    return { orgId, owner, roleId, members, ctx: { organizationId: orgId, userId: owner, email: "owner@test.invalid" } };
  }
  const invite = (w, email, env) => createOrganizationInvitation(db, { organizationId: w.orgId, invitedByUserId: w.owner, email, roleId: w.roleId, inviter: { roleSlugs: ["organization_owner"], permissions: [] } }, { ...env, AUTH_EMAIL_WEBHOOK_URL: "" });
  const admin = (w) => ({ organizationId: w.orgId, userId: w.owner, permissions: ["users.manage"], roleSlugs: ["organization_owner"] });

  try {
    await t.test("a new organisation starts on Free, active, with 3 users and no charge", async () => {
      const w = await world(1);
      const summary = await getBillingSummary(db, w.orgId, OBSERVE);
      assert.equal(summary.planCode, "free");
      assert.equal(summary.status, "active");
      assert.deepEqual(summary.seats, { includedUsers: 3, paidSeats: 0, capacity: 3 });
      assert.equal(summary.writeAccess, true);
      const overview = await getBillingOverview(db, w.orgId, ENFORCE);
      assert.equal(overview.subscription.monthlyPaise, 0);
    });

    await t.test("the catalogue is Free, Standard at Rs 1,000 per additional user, and a coming-soon third plan that cannot be bought", async () => {
      const w = await world(1);
      const plans = await listPlanCatalogue(db, w.orgId, ENFORCE);
      assert.deepEqual(plans.map((p) => p.code), ["free", "standard", "enterprise"]);
      const [free, standard, third] = plans;
      assert.equal(free.current, true);
      assert.equal(free.includedUsers, 3);
      assert.equal(standard.includedUsers, 3);
      assert.equal(standard.perUserPricePaise, 100000);
      assert.equal(standard.purchasable, true);
      assert.equal(third.availability, "coming_soon");
      assert.equal(third.purchasable, false);
      assert.equal((await listPlanCatalogue(db, w.orgId, {})).find((p) => p.code === "standard").purchasable, false, "no online payment until it is switched on");
    });

    await t.test("pricing: 3 users free, each additional user Rs 1,000 a month", () => {
      assert.equal(calculateSeatCharge({ includedUsers: 3, perUserPaise: 100000, totalUsers: 3 }).monthlyPaise, 0);
      assert.equal(calculateSeatCharge({ includedUsers: 3, perUserPaise: 100000, totalUsers: 4 }).monthlyPaise, 100000);
      const ten = calculateSeatCharge({ includedUsers: 3, perUserPaise: 100000, totalUsers: 10 });
      assert.equal(ten.billableSeats, 7);
      assert.equal(ten.monthlyPaise, 700000);
    });

    await t.test("Free refuses a 4th user, counting pending invitations, and only when enforcement is on", async () => {
      const w = await world(2);
      await invite(w, `a-${randomUUID()}@test.invalid`, ENFORCE);
      const seats = await getSeatStatus(db, w.orgId);
      assert.equal(seats.used, 3);
      assert.equal(seats.available, 0);
      await refuses(() => invite(w, `b-${randomUUID()}@test.invalid`, ENFORCE), "BILLING_SEAT_LIMIT");
      const reported = await assertSeatAvailable(db, w.orgId, { env: OBSERVE });
      assert.equal(reported.wouldBlock, true, "observe mode reports instead of blocking");
      await assert.doesNotReject(() => invite(w, `c-${randomUUID()}@test.invalid`, OBSERVE));
      try {
        await invite(w, `d-${randomUUID()}@test.invalid`, ENFORCE);
      } catch (error) {
        assert.match(error.message, /Standard/, "the message tells the owner what to do");
      }
    });

    await t.test("re-sending an existing invitation does not take a second seat", async () => {
      const w = await world(2);
      const email = `resend-${randomUUID()}@test.invalid`;
      await invite(w, email, ENFORCE);
      await assert.doesNotReject(() => invite(w, email, ENFORCE));
      assert.equal((await getSeatStatus(db, w.orgId)).used, 3);
    });

    await t.test("disabling a member frees a seat; re-activating into a full organisation is refused", async () => {
      const w = await world(3);
      const target = w.members[1];
      await setMemberStatus(db, admin(w), target, "disabled");
      assert.equal((await getSeatStatus(db, w.orgId)).activeMembers, 2);
      const email = `fill-${randomUUID()}@test.invalid`;
      await invite(w, email, ENFORCE);
      const prev = process.env.BILLING_ENFORCEMENT_MODE;
      process.env.BILLING_ENFORCEMENT_MODE = "enforce";
      try {
        await refuses(() => setMemberStatus(db, admin(w), target, "active"), "BILLING_SEAT_LIMIT");
      } finally {
        if (prev === undefined) delete process.env.BILLING_ENFORCEMENT_MODE;
        else process.env.BILLING_ENFORCEMENT_MODE = prev;
      }
    });

    await t.test("checkout: refused when off, refused for the coming-soon plan, validated, and reused when repeated", async () => {
      const w = await world(3);
      const plans = await listPlanCatalogue(db, w.orgId, ENFORCE);
      const standard = plans.find((p) => p.code === "standard");
      const third = plans.find((p) => p.code === "enterprise");
      const provider = fakeProvider();
      await refuses(() => startSeatCheckout(db, w.ctx, { planPriceId: standard.priceId, users: 6 }, { ...provider, simulated: false, config: { checkoutEnabled: false } }, ENFORCE), "BILLING_CHECKOUT_DISABLED");
      await refuses(() => startSeatCheckout(db, w.ctx, { planPriceId: third.priceId, users: 6 }, provider, ENFORCE), "BILLING_PLAN_COMING_SOON");
      await refuses(() => startSeatCheckout(db, w.ctx, { planPriceId: standard.priceId, users: 3 }, provider, ENFORCE), "BILLING_USERS_INVALID");
      await refuses(() => startSeatCheckout(db, w.ctx, { planPriceId: standard.priceId, users: 1000 }, provider, ENFORCE), "BILLING_USERS_INVALID");
      const first = await startSeatCheckout(db, w.ctx, { planPriceId: standard.priceId, users: 6 }, provider, ENFORCE);
      assert.equal(first.paidSeats, 3);
      assert.equal(first.monthlyPaise, 300000);
      const subscriptionCall = provider.calls.find((c) => c[0] === "subscription")[1];
      assert.equal(subscriptionCall.quantity, 3, "the provider bills quantity = users beyond the 3 included");
      const again = await startSeatCheckout(db, w.ctx, { planPriceId: standard.priceId, users: 6 }, provider, ENFORCE);
      assert.equal(again.checkoutSessionId, first.checkoutSessionId);
      assert.equal(provider.calls.filter((c) => c[0] === "subscription").length, 1, "no second provider subscription");
      const changed = await startSeatCheckout(db, w.ctx, { planPriceId: standard.priceId, users: 8 }, provider, ENFORCE);
      assert.notEqual(changed.checkoutSessionId, first.checkoutSessionId);
      assert.ok(provider.calls.some((c) => c[0] === "cancel" && c[1] === first.providerSubscriptionId), "the abandoned provider subscription is cancelled");
    });

    await t.test("a checkout cannot go below the users already in the organisation", async () => {
      const w = await world(3);
      await invite(w, `q-${randomUUID()}@test.invalid`, OBSERVE);
      await invite(w, `r-${randomUUID()}@test.invalid`, OBSERVE);
      const standard = (await listPlanCatalogue(db, w.orgId, ENFORCE)).find((p) => p.code === "standard");
      await refuses(() => startSeatCheckout(db, w.ctx, { planPriceId: standard.priceId, users: 4 }, fakeProvider(), ENFORCE), "BILLING_USERS_BELOW_USAGE");
    });

    await t.test("verifying a checkout: forged signature refused; a real one moves the organisation to Standard with the paid seats; replay is harmless", async () => {
      const w = await world(3);
      const standard = (await listPlanCatalogue(db, w.orgId, ENFORCE)).find((p) => p.code === "standard");
      const provider = fakeProvider();
      const checkout = await startSeatCheckout(db, w.ctx, { planPriceId: standard.priceId, users: 5 }, provider, ENFORCE);
      const good = { checkoutSessionId: checkout.checkoutSessionId, razorpay_payment_id: "pay_1", razorpay_subscription_id: checkout.providerSubscriptionId, razorpay_signature: sign("pay_1", checkout.providerSubscriptionId) };
      await refuses(() => confirmSeatCheckout(db, w.ctx, { ...good, razorpay_signature: "0".repeat(64) }, provider), "BILLING_SIGNATURE_INVALID");
      await refuses(() => confirmSeatCheckout(db, w.ctx, { ...good, razorpay_subscription_id: "sub_other", razorpay_signature: sign("pay_1", "sub_other") }, provider), "BILLING_SIGNATURE_INVALID");
      assert.equal((await getBillingSummary(db, w.orgId, ENFORCE)).planCode, "free", "nothing changed on a failed verification");
      const confirmed = await confirmSeatCheckout(db, w.ctx, good, provider);
      assert.equal(confirmed.paidSeats, 2);
      const summary = await getBillingSummary(db, w.orgId, ENFORCE);
      assert.equal(summary.planCode, "standard");
      assert.equal(summary.status, "authenticated");
      assert.equal(summary.seats.capacity, 5);
      assert.equal(summary.writeAccess, true);
      assert.equal((await confirmSeatCheckout(db, w.ctx, good, provider)).alreadyConfirmed, true);
      await refuses(() => startSeatCheckout(db, w.ctx, { planPriceId: standard.priceId, users: 9 }, provider, ENFORCE), "BILLING_ALREADY_SUBSCRIBED");
      const seats = await getSeatStatus(db, w.orgId);
      assert.equal(seats.capacity, 5);
      await assert.doesNotReject(() => invite(w, `ok1-${randomUUID()}@test.invalid`, ENFORCE));
      await assert.doesNotReject(() => invite(w, `ok2-${randomUUID()}@test.invalid`, ENFORCE));
      await refuses(() => invite(w, `no-${randomUUID()}@test.invalid`, ENFORCE), "BILLING_SEAT_LIMIT");
    });

    async function paidWorld(members, users) {
      const w = await world(members);
      const standard = (await listPlanCatalogue(db, w.orgId, ENFORCE)).find((p) => p.code === "standard");
      const provider = fakeProvider();
      const checkout = await startSeatCheckout(db, w.ctx, { planPriceId: standard.priceId, users }, provider, ENFORCE);
      await confirmSeatCheckout(db, w.ctx, { checkoutSessionId: checkout.checkoutSessionId, razorpay_payment_id: "pay_x", razorpay_subscription_id: checkout.providerSubscriptionId, razorpay_signature: sign("pay_x", checkout.providerSubscriptionId) }, provider);
      return { ...w, provider, providerSubscriptionId: checkout.providerSubscriptionId };
    }

    await t.test("seats: adding takes effect at once; reducing waits for renewal and never goes below users in use", async () => {
      const w = await paidWorld(5, 6);
      const grown = await changeSubscriptionSeats(db, w.ctx, { users: 9 }, w.provider);
      assert.equal(grown.effective, "now");
      assert.deepEqual(w.provider.calls.at(-1), ["update", w.providerSubscriptionId, { quantity: 6, schedule_change_at: "now" }]);
      assert.equal((await getSeatStatus(db, w.orgId)).capacity, 9);
      await refuses(() => changeSubscriptionSeats(db, w.ctx, { users: 9 }, w.provider), "BILLING_NO_CHANGE");
      await refuses(() => changeSubscriptionSeats(db, w.ctx, { users: 3 }, w.provider), "BILLING_USERS_INVALID");
      const smaller = await changeSubscriptionSeats(db, w.ctx, { users: 6 }, w.provider);
      assert.equal(smaller.effective, "cycle_end");
      assert.deepEqual(w.provider.calls.at(-1), ["update", w.providerSubscriptionId, { quantity: 3, schedule_change_at: "cycle_end" }]);
      const seats = await getSeatStatus(db, w.orgId);
      assert.equal(seats.capacity, 9, "the seats already paid for stay usable until renewal");
      assert.equal(seats.pendingPaidSeats, 3);
      await refuses(() => changeSubscriptionSeats(db, w.ctx, { users: 4 }, w.provider), "BILLING_USERS_BELOW_USAGE");
      const renewal = webhookBody("subscription.charged", { id: w.providerSubscriptionId, status: "active", quantity: 3, current_start: 1_800_000_000, current_end: 1_802_592_000 });
      await deliver(db, w.provider, renewal);
      const after = await getSeatStatus(db, w.orgId);
      assert.equal(after.capacity, 6);
      assert.equal(after.pendingPaidSeats, null);
    });

    await t.test("webhooks: forged signature refused, charge activates and records the payment, duplicates and stale events change nothing", async () => {
      const w = await paidWorld(3, 5);
      const provider = w.provider;
      await refuses(() => handleBillingWebhook(db, { rawBody: "{}", signature: "bad", eventId: "x" }, provider), "BILLING_WEBHOOK_SIGNATURE_INVALID");
      const now = Math.floor(Date.now() / 1000);
      const invoiceId = `inv_${randomUUID()}`;
      const charged = webhookBody("subscription.charged", { id: w.providerSubscriptionId, status: "active", quantity: 2, current_start: now, current_end: now + 2_592_000 }, { payment: { entity: { id: `pay_${randomUUID()}`, amount: 200000, currency: "INR", status: "captured", method: "card", created_at: now, invoice_id: invoiceId } }, invoice: { entity: { id: invoiceId, amount: 200000, amount_paid: 200000, status: "paid", paid_at: now, issued_at: now, short_url: "https://rzp.io/i/x" } } }, now);
      const eventId = randomUUID();
      assert.equal((await deliver(db, provider, charged, eventId)).duplicate, false);
      assert.equal((await deliver(db, provider, charged, eventId)).duplicate, true);
      const summary = await getBillingSummary(db, w.orgId, ENFORCE);
      assert.equal(summary.status, "active");
      assert.ok(summary.currentPeriodEndsAt);
      const overview = await getBillingOverview(db, w.orgId, ENFORCE);
      assert.equal(overview.payments.length, 1);
      assert.equal(overview.invoices.length, 1);
      assert.equal(overview.invoices[0].status, "paid");
      assert.equal(overview.subscription.monthlyPaise, 200000);
      const stale = webhookBody("subscription.halted", { id: w.providerSubscriptionId, status: "halted" }, {}, now - 3600);
      await deliver(db, provider, stale);
      assert.equal((await getBillingSummary(db, w.orgId, ENFORCE)).status, "active", "an older event cannot undo newer state");
      const otherSub = webhookBody("subscription.cancelled", { id: "sub_someone_else", status: "cancelled" });
      assert.equal((await deliver(db, provider, otherSub)).status, "ignored");
      assert.equal((await getBillingSummary(db, w.orgId, ENFORCE)).planCode, "standard", "another subscription's event cannot touch this organisation");
    });

    await t.test("a failed payment gives a grace period, then read-only; cancellation returns to Free", async () => {
      const w = await paidWorld(3, 5);
      const now = Math.floor(Date.now() / 1000);
      await deliver(db, w.provider, webhookBody("subscription.charged", { id: w.providerSubscriptionId, status: "active", quantity: 2, current_start: now, current_end: now + 2_592_000 }, {}, now));
      await deliver(db, w.provider, webhookBody("subscription.pending", { id: w.providerSubscriptionId, status: "pending" }, {}, now + 10));
      let summary = await getBillingSummary(db, w.orgId, ENFORCE);
      assert.equal(summary.status, "past_due");
      assert.equal(summary.writeAccess, true, "still writable inside the grace period");
      await db.query(`UPDATE organization_subscriptions SET grace_ends_at = now() - interval '1 minute' WHERE organization_id = $1`, [w.orgId]);
      await refuses(() => requireBillingWriteAccess(db, w.orgId, ENFORCE), "ENTITLEMENT_SUBSCRIPTION_INACTIVE");
      await deliver(db, w.provider, webhookBody("subscription.charged", { id: w.providerSubscriptionId, status: "active", quantity: 2, current_start: now + 100, current_end: now + 2_600_000 }, {}, now + 100));
      assert.equal((await getBillingSummary(db, w.orgId, ENFORCE)).writeAccess, true, "paying again restores writes");
      await deliver(db, w.provider, webhookBody("subscription.cancelled", { id: w.providerSubscriptionId, status: "cancelled" }, {}, now + 200));
      summary = await getBillingSummary(db, w.orgId, ENFORCE);
      assert.equal(summary.planCode, "free");
      assert.equal(summary.seats.capacity, 3);
    });

    await t.test("after cancelling with more users than Free allows: a 14 day window, then read-only until users are removed or seats bought", async () => {
      const w = await paidWorld(5, 6);
      const result = await cancelPaidSubscription(db, w.ctx, { cancelAtCycleEnd: false }, w.provider);
      assert.equal(result.effective, "now");
      assert.deepEqual(w.provider.calls.at(-1), ["cancel", w.providerSubscriptionId, false]);
      let summary = await getBillingSummary(db, w.orgId, ENFORCE);
      assert.equal(summary.planCode, "free");
      const seats = await getSeatStatus(db, w.orgId);
      assert.equal(seats.overCapacity, true);
      assert.ok(seats.seatOverageSince);
      assert.equal(summary.writeAccess, true, "the window is open");
      await db.query(`UPDATE organization_subscriptions SET seat_overage_since = now() - interval '15 days' WHERE organization_id = $1`, [w.orgId]);
      summary = await getBillingSummary(db, w.orgId, ENFORCE);
      assert.equal(summary.writeAccess, false);
      await refuses(() => requireBillingWriteAccess(db, w.orgId, ENFORCE), "ENTITLEMENT_SEAT_OVERAGE");
      await setMemberStatus(db, admin(w), w.members[4], "disabled");
      await setMemberStatus(db, admin(w), w.members[3], "disabled");
      assert.equal((await getBillingSummary(db, w.orgId, ENFORCE)).writeAccess, true, "back within the allowance");
      assert.equal((await getSeatStatus(db, w.orgId)).seatOverageSince, null);
    });

    await t.test("cancelling at the end of the cycle keeps the plan until then", async () => {
      const w = await paidWorld(3, 5);
      const now = Math.floor(Date.now() / 1000);
      await deliver(db, w.provider, webhookBody("subscription.charged", { id: w.providerSubscriptionId, status: "active", quantity: 2, current_start: now, current_end: now + 2_592_000 }, {}, now));
      const result = await cancelPaidSubscription(db, w.ctx, { cancelAtCycleEnd: true }, w.provider);
      assert.equal(result.effective, "cycle_end");
      assert.deepEqual(w.provider.calls.at(-1), ["cancel", w.providerSubscriptionId, true]);
      const summary = await getBillingSummary(db, w.orgId, ENFORCE);
      assert.equal(summary.planCode, "standard");
      assert.equal(summary.cancelAtCycleEnd, true);
      await refuses(() => changeSubscriptionSeats(db, w.ctx, { users: 9 }, w.provider), "BILLING_CANCELLING");
    });

    await t.test("Free cannot buy seats through the seat endpoint, and the billing profile validates GSTIN", async () => {
      const w = await world(2);
      await refuses(() => changeSubscriptionSeats(db, w.ctx, { users: 9 }, fakeProvider()), "BILLING_NOT_PAID");
      await refuses(() => saveBillingProfile(db, w.ctx, { legalName: "Acme", billingEmail: "a@b.co", gstin: "BAD" }), "BILLING_GSTIN_INVALID");
      await refuses(() => saveBillingProfile(db, w.ctx, { legalName: "", billingEmail: "a@b.co" }), "BILLING_PROFILE_INVALID");
      const saved = await saveBillingProfile(db, w.ctx, { legalName: "Acme Pvt Ltd", billingEmail: "Billing@Acme.co", gstin: "27AAPFU0939F1ZV", city: "Pune" });
      assert.equal(saved.billing_email, "billing@acme.co");
      assert.equal(saved.billing_address.city, "Pune");
      const audit = await db.query(`SELECT 1 FROM audit_events WHERE organization_id=$1 AND event_type='billing.profile.updated'`, [w.orgId]);
      assert.equal(audit.rows.length, 1);
    });

    await t.test("reconcileSeatOverage sets and clears the marker", async () => {
      const w = await world(4);
      assert.equal((await reconcileSeatOverage(db, w.orgId)).overCapacity, true);
      assert.ok((await getSeatStatus(db, w.orgId)).seatOverageSince);
      await db.query(`UPDATE organization_memberships SET status='disabled' WHERE organization_id=$1 AND user_id=$2`, [w.orgId, w.members[3]]);
      assert.equal((await reconcileSeatOverage(db, w.orgId)).seatOverageSince, null);
    });

    await t.test("an internal (founder preview) organisation has no user limit", async () => {
      const w = await world(6);
      await db.query(
        `UPDATE organization_subscriptions SET status='internal', included_users_snapshot=NULL, plan_price_id=(SELECT price.id FROM billing_plan_prices price JOIN billing_plans plan ON plan.id=price.plan_id WHERE plan.code='founder-preview' LIMIT 1) WHERE organization_id=$1`,
        [w.orgId],
      );
      const seats = await getSeatStatus(db, w.orgId);
      assert.equal(seats.capacity, null);
      assert.equal((await assertSeatAvailable(db, w.orgId, { env: ENFORCE })).capacity, null);
    });
  } finally {
    for (const orgId of orgs) await db.query(`DELETE FROM organizations WHERE id=$1`, [orgId]).catch(() => undefined);
    for (const id of users) await db.query(`DELETE FROM users WHERE id=$1`, [id]).catch(() => undefined);
    await db.end();
  }
});
