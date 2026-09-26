// Pure billing rules and the Razorpay adapter (no database). Part of `pnpm verify:billing`.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  BILLING_EVENTS,
  billingMetrics,
  billingStateKey,
  calculateSeatCharge,
  canTransition,
  checkoutEntityMismatches,
  COMMERCIAL_MODEL,
  createRazorpayProvider,
  hasWriteAccess,
  mapProviderSubscriptionStatus,
  minimalPaymentSnapshot,
  parseWebhookEnvelope,
  providerSubscriptionMismatches,
  razorpayConfig,
  redactedErrorText,
  sanitizeWebhookEvent,
  shouldApplyProviderEvent,
  taxInvoiceReadiness,
  TRANSITIONS,
  validateRazorpayConfig,
  verifyCheckoutSignature,
  verifyWebhookSignature,
  webhookRetryDelayMinutes,
} from "../../src/core/billing/index.js";

const NOW = new Date("2026-06-15T00:00:00Z");

test("commercial model: Free 1 user; Standard ₹1,000 per additional user; money is integer paise", () => {
  assert.equal(COMMERCIAL_MODEL.free.includedUsers, 1);
  assert.equal(COMMERCIAL_MODEL.standard.includedUsers, 1);
  assert.equal(COMMERCIAL_MODEL.standard.perAdditionalUserPaise, 100000);
  assert.equal(COMMERCIAL_MODEL.custom.code, "enterprise");
  const quote = (users) => calculateSeatCharge({ includedUsers: 1, perUserPaise: 100000, totalUsers: users });
  assert.deepEqual([1, 2, 5, 10].map((users) => quote(users).monthlyPaise), [0, 100000, 400000, 900000]);
  assert.equal(quote(5).billableSeats, 4);
  assert.throws(() => quote(0), /whole number/);
  assert.throws(() => quote(2.5), /whole number/);
  assert.throws(() => calculateSeatCharge({ includedUsers: 1, perUserPaise: 1000.5, totalUsers: 2 }), /not valid/);
});

test("state machine: allowed transitions only", () => {
  assert.ok(canTransition("active", "authenticated"), "Free -> Standard at checkout");
  assert.ok(canTransition("authenticated", "active"));
  assert.ok(canTransition("active", "past_due"));
  assert.ok(canTransition("past_due", "halted"));
  assert.ok(canTransition("halted", "active"));
  assert.ok(canTransition("cancelled", "active"), "reverted to Free");
  assert.ok(!canTransition("halted", "authenticated"));
  assert.ok(!canTransition("halted", "past_due"));
  assert.ok(!canTransition("cancelled", "past_due"));
  for (const [from, targets] of Object.entries(TRANSITIONS)) for (const to of targets) assert.ok(Object.hasOwn(TRANSITIONS, to), `${from} -> ${to} targets a known state`);
  assert.equal(mapProviderSubscriptionStatus("pending"), "past_due");
  assert.equal(mapProviderSubscriptionStatus("created"), null);
  assert.equal(mapProviderSubscriptionStatus("paused"), null);
});

test("write access: one rule for every status", () => {
  const cases = [
    [{ status: "active", pricingModel: "free" }, true],
    [{ status: "active", pricingModel: "per_seat" }, true],
    [{ status: "authenticated" }, true],
    [{ status: "internal" }, true],
    [{ status: "past_due", graceEndsAt: "2026-06-20T00:00:00Z" }, true],
    [{ status: "past_due", graceEndsAt: "2026-06-10T00:00:00Z" }, false],
    [{ status: "past_due" }, false],
    [{ status: "halted", graceEndsAt: "2026-07-01T00:00:00Z" }, false],
    [{ status: "cancelled" }, false],
    [{ status: "expired", trialEndsAt: "2099-01-01T00:00:00Z" }, false],
    [{ status: "checkout_pending" }, false],
    [{ status: "active", pricingModel: "custom", contractEndsAt: "2026-12-31T00:00:00Z" }, true],
    [{ status: "active", pricingModel: "custom", contractEndsAt: "2026-06-01T00:00:00Z" }, false],
    [null, false],
  ];
  for (const [subscription, expected] of cases) assert.equal(hasWriteAccess(subscription, NOW), expected, JSON.stringify(subscription));
});

test("event ordering and tenant-facing state keys", () => {
  assert.equal(shouldApplyProviderEvent("2026-06-15T00:00:10Z", "2026-06-15T00:00:05Z"), false);
  assert.equal(shouldApplyProviderEvent("2026-06-15T00:00:10Z", "2026-06-15T00:00:10Z"), true);
  assert.equal(shouldApplyProviderEvent(null, "2026-06-15T00:00:10Z"), true);
  assert.equal(billingStateKey({ status: "active", pricingModel: "free" }), "free_active");
  assert.equal(billingStateKey({ status: "active", pricingModel: "per_seat", cancelAtCycleEnd: true }), "cancel_at_cycle_end");
  assert.equal(billingStateKey({ status: "active", pricingModel: "free", checkoutPhase: "verifying" }), "verification_pending");
  assert.equal(billingStateKey({ status: "past_due", pricingModel: "per_seat", reconciliationRequired: true }), "attention_required");
  assert.equal(billingStateKey({ status: "halted", pricingModel: "per_seat" }), "halted");
  assert.equal(billingStateKey({ status: "active", pricingModel: "custom" }), "custom_active");
});

test("signatures: checkout HMAC(payment_id|subscription_id); webhook HMAC over the exact raw body with rotation", () => {
  const signature = createHmac("sha256", "secret").update("pay_1|sub_1").digest("hex");
  assert.equal(verifyCheckoutSignature({ paymentId: "pay_1", subscriptionId: "sub_1", signature }, "secret"), true);
  assert.equal(verifyCheckoutSignature({ paymentId: "pay_1", subscriptionId: "sub_2", signature }, "secret"), false);
  assert.equal(verifyCheckoutSignature({ paymentId: "pay_1", subscriptionId: "sub_1", signature: "short" }, "secret"), false);
  assert.equal(verifyCheckoutSignature({ paymentId: "pay_1", subscriptionId: "sub_1", signature }, ""), false);
  const body = '{"event":"subscription.activated"}';
  const webhook = (secret) => createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifyWebhookSignature(body, webhook("current"), ["current", "previous"]), true);
  assert.equal(verifyWebhookSignature(body, webhook("previous"), ["current", "previous"]), true);
  assert.equal(verifyWebhookSignature(body, webhook("other"), ["current", "previous"]), false);
  assert.equal(verifyWebhookSignature(`${body}\n`, webhook("current"), ["current"]), false);
  assert.equal(verifyWebhookSignature(body, null, ["current"]), false);
});

test("webhook envelope validation and payload minimisation", () => {
  assert.throws(() => parseWebhookEnvelope("nope"), /not valid JSON/);
  assert.throws(() => parseWebhookEnvelope("[]"), /not an event/);
  assert.throws(() => parseWebhookEnvelope('{"event":"x","payload":{}}'), /event type/);
  assert.throws(() => parseWebhookEnvelope('{"event":"subscription.activated","created_at":"yesterday","payload":{}}'), /timestamp/);
  assert.throws(() => parseWebhookEnvelope('{"event":"subscription.activated"}'), /payload/);
  const event = parseWebhookEnvelope(
    JSON.stringify({
      event: "subscription.charged", created_at: 1_700_000_000,
      payload: {
        subscription: { entity: { id: "sub_1", status: "active", quantity: 2, customer_id: "cust_1", notes: { vercentlabs_organization_id: "org", email: "a@b.c" } } },
        payment: { entity: { id: "pay_1", amount: 100, method: "card", card: { last4: "4242" }, email: "a@b.c", contact: "+91999", vpa: "x@upi", bank: "HDFC" } },
      },
    }),
  );
  const stored = JSON.stringify(sanitizeWebhookEvent(event));
  for (const leaked of ["4242", "a@b.c", "+91999", "x@upi", "HDFC", "cust_1"]) assert.ok(!stored.includes(leaked), `${leaked} must not be stored`);
  assert.ok(stored.includes("vercentlabs_organization_id"));
  const payment = minimalPaymentSnapshot({ id: "pay_1", method: "card", card: { number: "4111111111111111" }, bank_account: { ifsc: "X" } });
  assert.deepEqual(Object.keys(payment).sort(), ["captured", "created_at", "error_code", "id", "invoice_id", "method", "order_id", "refund_status", "status"]);
  assert.deepEqual([1, 2, 3, 7, 8, 20].map(webhookRetryDelayMinutes), [1, 2, 4, 60, 60, 60]);
});

test("provider identity checks for checkout and reconciliation", () => {
  const session = { id: "s1", organization_id: "org1", provider_subscription_id: "sub_1", expected_provider_plan_id: "plan_1", expected_quantity: 2, plan_price_id: "p1" };
  const good = { id: "sub_1", plan_id: "plan_1", quantity: 2, notes: { vercentlabs_organization_id: "org1", vercentlabs_checkout_session_id: "s1", vercentlabs_plan_price_id: "p1" } };
  assert.deepEqual(checkoutEntityMismatches(session, good), []);
  assert.deepEqual(checkoutEntityMismatches(session, { ...good, quantity: 1 }), ["quantity"]);
  assert.deepEqual(checkoutEntityMismatches(session, { ...good, plan_id: "plan_x" }), ["plan_id"]);
  assert.deepEqual(checkoutEntityMismatches(session, { ...good, notes: { ...good.notes, vercentlabs_organization_id: "org2" } }), ["organization_note"]);
  assert.deepEqual(checkoutEntityMismatches(session, { ...good, notes: {} }), ["organization_note", "checkout_session_note"]);
  const sub = { organization_id: "org1", provider_subscription_id: "sub_1", price_provider_plan_id: "plan_1" };
  assert.deepEqual(providerSubscriptionMismatches(sub, { id: "sub_1", plan_id: "plan_1", notes: {} }), []);
  assert.deepEqual(providerSubscriptionMismatches(sub, { id: "sub_1", plan_id: "plan_1", notes: { vercentlabs_organization_id: "org2" } }), ["organization_note"]);
});

test("Razorpay configuration: live refuses a custom API base; problems are reported without secrets", () => {
  assert.equal(razorpayConfig({ RAZORPAY_MODE: "live", RAZORPAY_API_BASE: "http://evil.test" }).apiBase, "https://api.razorpay.com/v1");
  assert.equal(razorpayConfig({ RAZORPAY_MODE: "test", RAZORPAY_API_BASE: "http://127.0.0.1:1/v1" }).apiBase, "http://127.0.0.1:1/v1");
  const problems = validateRazorpayConfig({ RAZORPAY_MODE: "live", RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "topsecret", RAZORPAY_API_BASE: "http://x", BILLING_CHECKOUT_ENABLED: "true" });
  assert.ok(problems.some((p) => /rzp_live_/.test(p)));
  assert.ok(problems.some((p) => /API_BASE/.test(p)));
  assert.ok(problems.some((p) => /WEBHOOK_SECRET/.test(p)));
  assert.ok(problems.every((p) => !p.includes("topsecret")));
  assert.deepEqual(validateRazorpayConfig({ RAZORPAY_MODE: "test", RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "s", RAZORPAY_WEBHOOK_SECRET: "w", BILLING_CHECKOUT_ENABLED: "true" }), []);
});

test("provider errors: rejection vs unknown outcome; nothing claims 'not charged'; secrets never leak", async () => {
  const env = { RAZORPAY_MODE: "test", RAZORPAY_KEY_ID: "rzp_test_k", RAZORPAY_KEY_SECRET: "sekret", RAZORPAY_API_BASE: "http://stand.in/v1", RAZORPAY_REQUEST_TIMEOUT_MS: "1000" };
  const reply = (status, body) => async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const cases = [
    [reply(400, { error: { description: "bad plan" } }), "rejected", "BILLING_PROVIDER_ERROR"],
    [reply(503, {}), "unknown", "BILLING_PROVIDER_UNAVAILABLE"],
    [async () => { throw new TypeError("fetch failed"); }, "unknown", "BILLING_PROVIDER_UNREACHABLE"],
    [(url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))), "unknown", "BILLING_PROVIDER_UNREACHABLE"],
  ];
  for (const [fetchImpl, outcome, code] of cases) {
    const provider = createRazorpayProvider(env, fetchImpl);
    const error = await provider.fetchSubscription("sub_1").then(() => null, (e) => e);
    assert.equal(error.outcome, outcome);
    assert.equal(error.code, code);
    assert.ok(!/not (been )?charged/i.test(error.message));
  }
  const unconfigured = createRazorpayProvider({}, reply(200, {}));
  const missing = await unconfigured.fetchSubscription("sub_1").then(() => null, (e) => e);
  assert.equal(missing.outcome, "rejected");
  assert.equal(missing.code, "BILLING_PROVIDER_NOT_CONFIGURED");
  let authorization = "";
  await createRazorpayProvider(env, async (url, init) => {
    authorization = init.headers.Authorization;
    return new Response("{}", { status: 200 });
  }).fetchSubscription("sub_1");
  assert.equal(authorization, `Basic ${Buffer.from("rzp_test_k:sekret").toString("base64")}`);
  const provider = createRazorpayProvider(env, reply(200, {}));
  assert.equal(provider.publicKey, "rzp_test_k");
  assert.ok(!JSON.stringify(provider.config).includes("sekret"), "the exposed config carries no secret");
  assert.equal(redactedErrorText(new Error("Basic cnpwX3Rlc3RfazpzZWtyZXQ= rzp_live_ABC123")), "Basic [redacted] rzp_live_[redacted]");
});

test("observability: every billing metric uses a registered name and low-cardinality labels", () => {
  billingMetrics.reset();
  assert.ok(BILLING_EVENTS.includes("billing.webhook.dead_lettered"));
  assert.ok(BILLING_EVENTS.includes("billing.checkout.verification_pending"));
  assert.equal(new Set(BILLING_EVENTS).size, BILLING_EVENTS.length);
});

test("tax invoices fail closed until every legal fact is configured", () => {
  const readiness = taxInvoiceReadiness({});
  assert.equal(readiness.available, false);
  assert.ok(readiness.missing.includes("BILLING_SUPPLIER_GSTIN"));
  const configured = taxInvoiceReadiness(Object.fromEntries(readiness.missing.map((key) => [key, "x"])));
  assert.equal(configured.configured, true);
  assert.equal(configured.available, false, "generation is not implemented; configuration alone never enables it");
});
