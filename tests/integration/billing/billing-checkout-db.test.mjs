// The Standard checkout saga against real PostgreSQL and the real Razorpay
// adapter (local stand-in): happy path, idempotency, concurrency, every
// provider/DB failure window, webhook-first ordering and cross-organisation abuse.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { confirmSeatCheckout, getBillingOverview, startSeatCheckout, syncSubscriptionFromProvider } from "../../../services/api/src/core/billing/index.js";
import { createBillingKit, expectCode } from "./billing-kit.mjs";

test("Standard checkout saga", async (t) => {
  const kit = await createBillingKit();
  const start = (org, users = 3) => kit.withRuntime((client) => startSeatCheckout(client, org.ctx, { users }, kit.provider));
  const confirm = (org, checkoutSessionId, response) => kit.withRuntime((client) => confirmSeatCheckout(client, org.ctx, { checkoutSessionId, ...response }, kit.provider));
  const session = async (id) => (await kit.owner.query(`SELECT * FROM billing_checkout_sessions WHERE id=$1`, [id])).rows[0];
  const sessionsFor = async (org) => (await kit.owner.query(`SELECT * FROM billing_checkout_sessions WHERE organization_id=$1 ORDER BY created_at`, [org.organizationId])).rows;
  const standinSubsFor = (org) => [...kit.standin.subscriptions.values()].filter((sub) => sub.notes.vercentlabs_organization_id === org.organizationId);
  const forceDue = (id) => kit.owner.query(`UPDATE billing_checkout_sessions SET next_recovery_at = now() - interval '1 second', updated_at = now() - interval '5 minutes' WHERE id=$1`, [id]);

  try {
    await t.test("happy path: signed callback + provider confirmation moves the organisation to Standard", async () => {
      const org = await kit.organization({ members: 2 });
      const checkout = await start(org, 3);
      assert.equal(checkout.monthlyPaise, 200000);
      assert.equal(checkout.keyId, "rzp_test_standin", "only the public key id reaches the browser");
      assert.ok(!JSON.stringify(checkout).includes("standin_key_secret"));
      const response = kit.standin.authenticate(checkout.providerSubscriptionId);
      const result = await confirm(org, checkout.checkoutSessionId, response);
      assert.equal(result.state, "active");
      const sub = await kit.subscription(org.organizationId);
      assert.equal(sub.plan_code, "standard");
      assert.equal(sub.status, "authenticated");
      assert.equal(sub.paid_seats, 2);
      assert.equal(sub.included_users_snapshot, 1);
      assert.equal(sub.provider_subscription_id, checkout.providerSubscriptionId);
      assert.equal((await session(checkout.checkoutSessionId)).status, "authorised");
      const audit = (await kit.owner.query(`SELECT event_type FROM audit_events WHERE organization_id=$1 AND entity_type='billing' ORDER BY created_at`, [org.organizationId])).rows.map((r) => r.event_type);
      assert.deepEqual(audit, ["billing.checkout.started", "billing.checkout.confirmed"]);
    });

    await t.test("double click / parallel starts: one live intent, at most one provider subscription", async () => {
      const org = await kit.organization();
      const results = await Promise.allSettled([start(org, 3), start(org, 3), start(org, 3)]);
      const fulfilled = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
      assert.ok(fulfilled.length >= 1);
      for (const rejected of results.filter((r) => r.status === "rejected")) assert.equal(rejected.reason.code, "BILLING_CHECKOUT_IN_PROGRESS");
      assert.equal(new Set(fulfilled.map((r) => r.providerSubscriptionId)).size, 1, "every successful click got the same provider subscription");
      assert.equal(standinSubsFor(org).length, 1);
      const live = (await sessionsFor(org)).filter((s) => ["created", "provider_creating", "verifying"].includes(s.status));
      assert.equal(live.length, 1);
      // A repeat click with the same users reuses the open checkout.
      const again = await start(org, 3);
      assert.equal(again.providerSubscriptionId, fulfilled[0].providerSubscriptionId);
      assert.equal(standinSubsFor(org).length, 1);
    });

    await t.test("two confirmations of the same checkout: idempotent, one transition and one seat change", async () => {
      const org = await kit.organization();
      const checkout = await start(org, 4);
      const response = kit.standin.authenticate(checkout.providerSubscriptionId);
      const results = await Promise.all([confirm(org, checkout.checkoutSessionId, response), confirm(org, checkout.checkoutSessionId, response)]);
      assert.ok(results.some((r) => r.state === "active"));
      assert.ok(results.every((r) => ["active", "pending"].includes(r.state)));
      const changes = (await kit.owner.query(`SELECT count(*)::int AS n FROM billing_seat_changes WHERE organization_id=$1`, [org.organizationId])).rows[0].n;
      assert.equal(changes, 1);
      const confirmations = (await kit.owner.query(`SELECT count(*)::int AS n FROM audit_events WHERE organization_id=$1 AND event_type='billing.checkout.confirmed'`, [org.organizationId])).rows[0].n;
      assert.equal(confirmations, 1);
      assert.equal((await confirm(org, checkout.checkoutSessionId, response)).alreadyConfirmed, true);
    });

    await t.test("forged or mismatched signatures are refused; the browser's subscription id is never trusted", async () => {
      const org = await kit.organization();
      const checkout = await start(org, 2);
      const response = kit.standin.authenticate(checkout.providerSubscriptionId);
      await assert.rejects(confirm(org, checkout.checkoutSessionId, { ...response, razorpay_signature: "0".repeat(64) }), expectCode("BILLING_SIGNATURE_INVALID"));
      const other = await kit.organization();
      const otherCheckout = await start(other, 2);
      const otherResponse = kit.standin.authenticate(otherCheckout.providerSubscriptionId);
      // A genuinely signed response for ANOTHER subscription cannot confirm this checkout.
      await assert.rejects(confirm(org, checkout.checkoutSessionId, otherResponse), expectCode("BILLING_SIGNATURE_INVALID"));
      // Organisation B cannot confirm (or even see) organisation A's checkout session.
      await assert.rejects(confirm(other, checkout.checkoutSessionId, response), expectCode("BILLING_CHECKOUT_NOT_FOUND"));
      await assert.rejects(confirm(other, randomUUID(), otherResponse), expectCode("BILLING_CHECKOUT_NOT_FOUND"));
      assert.equal((await kit.subscription(org.organizationId)).plan_code, "free");
    });

    await t.test("provider unavailable during verification: pending (never discarded), then the worker finishes it", async () => {
      const org = await kit.organization();
      const checkout = await start(org, 2);
      const response = kit.standin.authenticate(checkout.providerSubscriptionId);
      kit.standin.failNext("GET", /\/subscriptions\/sub_/, { mode: "drop" });
      const result = await confirm(org, checkout.checkoutSessionId, response);
      assert.equal(result.state, "pending");
      assert.equal((await session(checkout.checkoutSessionId)).status, "verifying");
      assert.equal((await kit.subscription(org.organizationId)).plan_code, "free", "no entitlement before the provider confirms");
      const overview = await kit.withRuntime((client) => getBillingOverview(client, org.organizationId, kit.env));
      assert.equal(overview.checkout.phase, "verifying");
      assert.equal(overview.subscription.state, "verification_pending");
      // A second checkout cannot start while this payment is being verified.
      await assert.rejects(start(org, 2), expectCode("BILLING_CHECKOUT_VERIFYING"));
      await forceDue(checkout.checkoutSessionId);
      await kit.maintenance(["checkouts"]);
      assert.equal((await session(checkout.checkoutSessionId)).status, "authorised");
      assert.equal((await kit.subscription(org.organizationId)).plan_code, "standard");
    });

    await t.test("provider did not confirm creation (timeout): intent kept, worker finds the subscription by its note and links it", async () => {
      const org = await kit.organization();
      kit.standin.failNext("POST", /\/subscriptions$/, { mode: "applyThenDrop" });
      await assert.rejects(start(org, 2), expectCode("BILLING_CHECKOUT_RECOVERING"));
      const [pending] = await sessionsFor(org);
      assert.equal(pending.status, "provider_link_pending");
      assert.equal(pending.provider_subscription_id, null);
      assert.equal(standinSubsFor(org).length, 1, "the provider did create it");
      await assert.rejects(start(org, 2), expectCode("BILLING_CHECKOUT_IN_PROGRESS"));
      await forceDue(pending.id);
      await kit.maintenance(["checkouts"]);
      const linked = await session(pending.id);
      assert.equal(linked.status, "created");
      assert.equal(linked.provider_subscription_id, standinSubsFor(org)[0].id);
      // The customer's next click reuses the recovered subscription instead of creating another.
      const resumed = await start(org, 2);
      assert.equal(resumed.providerSubscriptionId, linked.provider_subscription_id);
      assert.equal(standinSubsFor(org).length, 1);
    });

    await t.test("provider rejected creation: failed_before_provider, nothing to recover", async () => {
      const org = await kit.organization();
      kit.standin.failNext("POST", /\/subscriptions$/, { mode: "status", status: 400, payload: { error: { description: "bad request" } } });
      await assert.rejects(start(org, 2), expectCode("BILLING_CHECKOUT_PROVIDER_REJECTED"));
      assert.equal((await sessionsFor(org))[0].status, "failed_before_provider");
      const retry = await start(org, 2);
      assert.ok(retry.providerSubscriptionId);
    });

    await t.test("process crash after provider creation (session stuck in provider_creating): worker links it", async () => {
      const org = await kit.organization();
      const checkout = await start(org, 2);
      // Simulate the crash window: the provider object exists but our link never committed.
      await kit.owner.query(`UPDATE billing_checkout_sessions SET status='provider_creating', provider_subscription_id=NULL, provider_linked_at=NULL WHERE id=$1`, [checkout.checkoutSessionId]);
      await forceDue(checkout.checkoutSessionId);
      await kit.maintenance(["checkouts"]);
      const linked = await session(checkout.checkoutSessionId);
      assert.equal(linked.status, "created");
      assert.equal(linked.provider_subscription_id, checkout.providerSubscriptionId);
    });

    await t.test("webhook before callback: the signed provider event activates the checkout; the late callback is harmless", async () => {
      const org = await kit.organization();
      const checkout = await start(org, 3);
      const response = kit.standin.authenticate(checkout.providerSubscriptionId);
      const signed = kit.standin.webhook("subscription.authenticated", checkout.providerSubscriptionId);
      const { ingestBillingWebhook } = await import("../../../services/api/src/core/billing/index.js");
      await kit.withRuntime((client) => ingestBillingWebhook(client, { rawBody: signed.body, signature: signed.signature, eventIdHeader: signed.eventId }, kit.provider));
      await kit.maintenance(["webhooks"]);
      assert.equal((await session(checkout.checkoutSessionId)).status, "authorised");
      assert.equal((await kit.subscription(org.organizationId)).paid_seats, 2);
      assert.equal((await confirm(org, checkout.checkoutSessionId, response)).alreadyConfirmed, true);
    });

    await t.test("provider object that does not match the intent is never activated", async () => {
      const org = await kit.organization();
      const checkout = await start(org, 3);
      kit.standin.subscriptions.get(checkout.providerSubscriptionId).quantity = 1; // tampered: fewer paid users than ordered
      const response = kit.standin.authenticate(checkout.providerSubscriptionId);
      const result = await confirm(org, checkout.checkoutSessionId, response);
      assert.equal(result.state, "attention");
      assert.equal((await kit.subscription(org.organizationId)).plan_code, "free");
      assert.ok((await session(checkout.checkoutSessionId)).attention_required_at);
      assert.ok((await kit.subscription(org.organizationId)).reconciliation_required_at);
    });

    await t.test("browser closed after paying: expired checkout is completed by the worker from the provider state", async () => {
      const org = await kit.organization();
      const checkout = await start(org, 2);
      kit.standin.authenticate(checkout.providerSubscriptionId, { status: "active" });
      await kit.owner.query(`UPDATE billing_checkout_sessions SET expires_at = now() - interval '1 minute', next_recovery_at = now() - interval '1 second' WHERE id=$1`, [checkout.checkoutSessionId]);
      await kit.maintenance(["checkouts"]);
      assert.equal((await session(checkout.checkoutSessionId)).status, "authorised");
      assert.equal((await kit.subscription(org.organizationId)).status, "active");
    });

    await t.test("unpaid expired checkout just expires; a superseded authenticated subscription is cancelled at the provider", async () => {
      const org = await kit.organization();
      const first = await start(org, 2);
      await kit.owner.query(`UPDATE billing_checkout_sessions SET expires_at = now() - interval '1 minute', next_recovery_at = now() - interval '1 second' WHERE id=$1`, [first.checkoutSessionId]);
      await kit.maintenance(["checkouts"]);
      assert.equal((await session(first.checkoutSessionId)).status, "expired");

      const second = await start(org, 2);
      const third = await start(org, 5); // different users: supersedes `second`
      assert.notEqual(third.providerSubscriptionId, second.providerSubscriptionId);
      assert.equal((await session(second.checkoutSessionId)).status, "cancel_pending");
      kit.standin.authenticate(second.providerSubscriptionId); // the customer paid in an old window
      await kit.owner.query(`UPDATE billing_checkout_sessions SET next_recovery_at = now() - interval '1 second' WHERE id=$1`, [second.checkoutSessionId]);
      await kit.maintenance(["checkouts"]);
      assert.equal((await session(second.checkoutSessionId)).status, "cancelled");
      assert.equal(kit.standin.subscriptions.get(second.providerSubscriptionId).status, "cancelled", "a second paid subscription never stands");
    });

    await t.test("manual refresh finishes a pending verification", async () => {
      const org = await kit.organization();
      const checkout = await start(org, 2);
      const response = kit.standin.authenticate(checkout.providerSubscriptionId);
      kit.standin.failNext("GET", /\/subscriptions\/sub_/, { mode: "status", status: 503 });
      assert.equal((await confirm(org, checkout.checkoutSessionId, response)).state, "pending");
      const refreshed = await kit.withRuntime((client) => syncSubscriptionFromProvider(client, org.ctx, kit.provider));
      assert.equal(refreshed.checkout, "active");
    });

    await t.test("checkout validation: below current usage, already subscribed, Free-sized quantity", async () => {
      const org = await kit.organization({ members: 3 });
      await assert.rejects(start(org, 2), expectCode("BILLING_USERS_BELOW_USAGE"));
      await assert.rejects(start(org, 1), expectCode("BILLING_USERS_INVALID"));
      const checkout = await start(org, 3);
      await confirm(org, checkout.checkoutSessionId, kit.standin.authenticate(checkout.providerSubscriptionId));
      await assert.rejects(start(org, 4), expectCode("BILLING_ALREADY_SUBSCRIBED"));
    });
  } finally {
    await kit.close();
  }
});
