// The REAL Razorpay provider adapter (HTTP, Basic auth, request bodies, error mapping) driven against a local
// stand-in for Razorpay's API, through the whole subscription lifecycle on real PostgreSQL. It proves what we send
// and how we react; it cannot prove Razorpay's own behaviour, which needs test-mode keys (scripts/qa/razorpay-smoke.mjs).
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import http from "node:http";
import test from "node:test";

import { Client } from "pg";

import { createRazorpayProvider } from "../../services/api/src/core/razorpay.js";
import { getBillingSummary } from "../../services/api/src/core/entitlements.js";
import {
  cancelPaidSubscription, changeSubscriptionSeats, confirmSeatCheckout, getSeatStatus, handleBillingWebhook, listPlanCatalogue,
  startSeatCheckout, syncSubscriptionFromProvider,
} from "../../services/api/src/core/subscription-billing.js";

const url = process.env.MIGRATION_DATABASE_URL || "";
const KEY_ID = "rzp_test_standin";
const KEY_SECRET = "standin_secret";
const WEBHOOK_SECRET = "standin_webhook";

test("Razorpay adapter over HTTP: plan, subscription, sync, seat change, cancel, webhook, error mapping", async (t) => {
  if (!url) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const seen = [];
  const remote = { status: "authenticated", quantity: 0, current_start: null, current_end: null };
  let failNext = null;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
      seen.push({ method: req.method, path: req.url, auth: req.headers.authorization, body });
      const send = (status, payload) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(payload)); };
      if (failNext) { const f = failNext; failNext = null; return send(f.status, f.payload); }
      if (req.method === "POST" && req.url === "/v1/plans") return send(200, { id: `plan_${randomUUID().slice(0, 8)}` });
      if (req.method === "POST" && req.url === "/v1/subscriptions") { remote.quantity = body.quantity; return send(200, { id: `sub_${randomUUID().slice(0, 8)}`, status: "created", quantity: body.quantity }); }
      const m = req.url.match(/^\/v1\/subscriptions\/([^/]+)(\/cancel)?$/);
      if (m && req.method === "GET") return send(200, { id: m[1], ...remote });
      if (m && req.method === "PATCH") { remote.quantity = body.quantity; return send(200, { id: m[1], ...remote }); }
      if (m && m[2]) return send(200, { id: m[1], status: "cancelled" });
      return send(404, { error: { description: "not found" } });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  const env = { RAZORPAY_MODE: "test", RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET, RAZORPAY_API_BASE: base, BILLING_CHECKOUT_ENABLED: "true", BILLING_ENFORCEMENT_MODE: "enforce" };
  const provider = createRazorpayProvider(env);

  const db = new Client({ connectionString: url });
  await db.connect();
  let providerSubscriptionId = null;
  const ownerId = randomUUID();
  const orgId = randomUUID();
  try {
    await db.query(`INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at) VALUES($1,$2,'Owner','x','active',now())`, [ownerId, `rzp-${ownerId}@test.invalid`]);
    await db.query(`INSERT INTO organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES($1,'Rzp Org',$2,'IN','Asia/Kolkata','INR',$3)`, [orgId, `rzp-${orgId}`, ownerId]);
    await db.query(`INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES($1,$2,'owner','active')`, [orgId, ownerId]);
    await db.query(`UPDATE billing_plan_prices SET provider_plan_id = NULL WHERE plan_id = (SELECT id FROM billing_plans WHERE code='standard')`);
    const ctx = { organizationId: orgId, userId: ownerId, email: "owner@test.invalid" };
    const standard = (await listPlanCatalogue(db, orgId, env)).find((p) => p.code === "standard");

    await t.test("checkout creates the provider plan once and a subscription whose quantity is the users beyond 3", async () => {
      const checkout = await startSeatCheckout(db, ctx, { planPriceId: standard.priceId, users: 8 }, provider, env);
      const plan = seen.find((r) => r.path === "/v1/plans");
      assert.equal(plan.auth, `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")}`, "authenticated with the key id and secret");
      assert.equal(plan.body.period, "monthly");
      assert.equal(plan.body.interval, 1);
      assert.equal(plan.body.item.amount, 100000, "Rs 1,000 in paise");
      assert.equal(plan.body.item.currency, "INR");
      const sub = seen.find((r) => r.path === "/v1/subscriptions");
      assert.equal(sub.body.quantity, 5);
      assert.equal(sub.body.plan_id, (await db.query(`SELECT provider_plan_id FROM billing_plan_prices WHERE id=$1`, [standard.priceId])).rows[0].provider_plan_id);
      assert.equal(sub.body.notes.vercentlabs_organization_id, orgId);
      assert.equal(checkout.keyId, KEY_ID);
      assert.equal(checkout.paidSeats, 5);

      const signature = createHmac("sha256", KEY_SECRET).update(`pay_1|${checkout.providerSubscriptionId}`).digest("hex");
      await confirmSeatCheckout(db, ctx, { checkoutSessionId: checkout.checkoutSessionId, razorpay_payment_id: "pay_1", razorpay_subscription_id: checkout.providerSubscriptionId, razorpay_signature: signature }, provider);
      assert.equal((await getBillingSummary(db, orgId, env)).status, "authenticated");
      providerSubscriptionId = checkout.providerSubscriptionId;
    });

    await t.test("the provider plan was created exactly once for this price", async () => {
      assert.equal(seen.filter((r) => r.path === "/v1/plans").length, 1);
    });

    await t.test("sync pulls the provider state (active, quantity, period) exactly like the webhook would", async () => {
      remote.status = "active";
      remote.quantity = 5;
      remote.current_start = Math.floor(Date.now() / 1000);
      remote.current_end = remote.current_start + 2_592_000;
      const result = await syncSubscriptionFromProvider(db, ctx, provider);
      assert.equal(result.synced, true);
      const summary = await getBillingSummary(db, orgId, env);
      assert.equal(summary.status, "active");
      assert.ok(summary.currentPeriodEndsAt);
      assert.equal((await getSeatStatus(db, orgId)).capacity, 8);
    });

    await t.test("adding users PATCHes the subscription now; reducing schedules it for the cycle end", async () => {
      await changeSubscriptionSeats(db, ctx, { users: 10 }, provider);
      const up = seen.filter((r) => r.method === "PATCH").at(-1);
      assert.deepEqual(up.body, { quantity: 7, schedule_change_at: "now" });
      await changeSubscriptionSeats(db, ctx, { users: 6 }, provider);
      const down = seen.filter((r) => r.method === "PATCH").at(-1);
      assert.deepEqual(down.body, { quantity: 3, schedule_change_at: "cycle_end" });
    });

    await t.test("a signed webhook from the provider is accepted; the same body with a wrong secret is refused", async () => {
      const body = JSON.stringify({ event: "subscription.charged", created_at: Math.floor(Date.now() / 1000) + 5, payload: { subscription: { entity: { id: providerSubscriptionId, status: "active", quantity: 3, current_start: remote.current_start, current_end: remote.current_end } } } });
      const good = createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
      const bad = createHmac("sha256", "wrong").update(body).digest("hex");
      await assert.rejects(() => handleBillingWebhook(db, { rawBody: body, signature: bad, eventId: randomUUID() }, provider), (e) => e.status === 401);
      assert.equal((await handleBillingWebhook(db, { rawBody: body, signature: good, eventId: randomUUID() }, provider)).status, "processed");
      assert.equal((await getSeatStatus(db, orgId)).capacity, 6, "the renewal applied the scheduled reduction");
    });

    await t.test("cancel calls the provider's cancel endpoint with cancel_at_cycle_end", async () => {
      await cancelPaidSubscription(db, ctx, { cancelAtCycleEnd: true }, provider);
      const cancel = seen.filter((r) => r.path.endsWith("/cancel")).at(-1);
      assert.equal(cancel.method, "POST");
      assert.deepEqual(cancel.body, { cancel_at_cycle_end: 1 });
    });

    await t.test("provider failures become clear 502s, and a missing key becomes a 503, never a 500", async () => {
      failNext = { status: 400, payload: { error: { description: "The plan id is invalid." } } };
      await assert.rejects(() => provider.createPlan({ period: "monthly", interval: 1, item: { name: "x", amount: 100, currency: "INR" } }), (e) => e.status === 502 && /plan id is invalid/.test(e.message));
      const dead = createRazorpayProvider({ ...env, RAZORPAY_API_BASE: "http://127.0.0.1:1/v1", RAZORPAY_REQUEST_TIMEOUT_MS: "1500" });
      await assert.rejects(() => dead.fetchSubscription("sub_x"), (e) => e.status === 502 && e.code === "BILLING_PROVIDER_UNREACHABLE");
      const unconfigured = createRazorpayProvider({ RAZORPAY_MODE: "test", RAZORPAY_API_BASE: base });
      await assert.rejects(() => unconfigured.fetchSubscription("sub_x"), (e) => e.status === 503 && e.code === "BILLING_PROVIDER_NOT_CONFIGURED");
    });

    await t.test("live mode ignores a custom API base", () => {
      assert.equal(createRazorpayProvider({ RAZORPAY_MODE: "live", RAZORPAY_API_BASE: "http://evil.example/v1" }).config.apiBase, "https://api.razorpay.com/v1");
    });
  } finally {
    await db.query(`UPDATE billing_plan_prices SET provider_plan_id = NULL WHERE plan_id = (SELECT id FROM billing_plans WHERE code='standard')`).catch(() => undefined);
    await db.query(`DELETE FROM organizations WHERE id=$1`, [orgId]).catch(() => undefined);
    await db.query(`DELETE FROM users WHERE id=$1`, [ownerId]).catch(() => undefined);
    await db.end();
    server.close();
  }
});
