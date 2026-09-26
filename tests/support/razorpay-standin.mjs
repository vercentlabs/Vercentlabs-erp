// A deterministic local stand-in for the parts of Razorpay's Subscriptions API
// Vercentlabs uses, driven through the REAL provider adapter over HTTP. It
// models documented behaviour (created -> authenticated -> active, updates only
// for authenticated/active, cycle-end changes, cancel_scheduled_changes, list by
// plan and time) and lets tests inject failures, including "the provider
// performed the request but the response was lost" (applyThenTimeout).
//
// It proves what we send and how we react; only a Razorpay test-mode run
// (scripts/qa/razorpay-smoke.mjs) can prove Razorpay's own behaviour.
//
// CLI (used by the billing Playwright config):
//   RAZORPAY_KEY_ID=rzp_test_x RAZORPAY_KEY_SECRET=s RAZORPAY_WEBHOOK_SECRET=w node tests/support/razorpay-standin.mjs --port 3199
import { createHmac, randomUUID } from "node:crypto";
import http from "node:http";
import { fileURLToPath } from "node:url";

const now = () => Math.floor(Date.now() / 1000);
const MONTH = 30 * 86400;
const shortId = (prefix) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 14)}`;

export async function startRazorpayStandIn({ port = 0, keyId, keySecret, webhookSecret, onWebhook = null } = {}) {
  const plans = new Map();
  const subscriptions = new Map();
  const requests = [];
  const failures = [];

  const publicView = (sub) => {
    const { scheduled, ...rest } = sub;
    return { ...rest, has_scheduled_changes: Boolean(scheduled), change_scheduled_at: scheduled ? sub.current_end : null };
  };

  function route(method, path, body) {
    if (method === "POST" && path === "/v1/plans") {
      const plan = { id: shortId("plan"), entity: "plan", ...body };
      plans.set(plan.id, plan);
      return [200, plan];
    }
    if (method === "POST" && path === "/v1/subscriptions") {
      if (!plans.has(body.plan_id)) return [400, { error: { description: "The plan id provided does not exist" } }];
      const sub = {
        id: shortId("sub"), entity: "subscription", plan_id: body.plan_id, status: "created", quantity: body.quantity ?? 1,
        total_count: body.total_count, notes: body.notes || {}, expire_by: body.expire_by ?? null,
        current_start: null, current_end: null, created_at: now(), scheduled: null,
      };
      subscriptions.set(sub.id, sub);
      return [200, publicView(sub)];
    }
    if (method === "GET" && path.startsWith("/v1/subscriptions?")) {
      const query = new URL(`http://x${path}`).searchParams;
      const from = Number(query.get("from") || 0);
      const to = Number(query.get("to") || Number.MAX_SAFE_INTEGER);
      const all = [...subscriptions.values()].filter((sub) => (!query.get("plan_id") || sub.plan_id === query.get("plan_id")) && sub.created_at >= from && sub.created_at <= to);
      const skip = Number(query.get("skip") || 0);
      const count = Math.min(100, Number(query.get("count") || 10));
      const items = all.slice(skip, skip + count).map(publicView);
      return [200, { entity: "collection", count: items.length, items }];
    }
    const match = path.match(/^\/v1\/subscriptions\/([^/?]+)(\/cancel|\/cancel_scheduled_changes)?$/);
    if (!match) return [404, { error: { description: "not found" } }];
    const sub = subscriptions.get(decodeURIComponent(match[1]));
    if (!sub) return [400, { error: { description: "The id provided does not exist" } }];
    if (method === "GET" && !match[2]) return [200, publicView(sub)];
    if (method === "PATCH" && !match[2]) {
      if (!["authenticated", "active"].includes(sub.status)) return [400, { error: { description: "Subscription can not be updated in the current state" } }];
      if (body.schedule_change_at === "cycle_end") sub.scheduled = { quantity: body.quantity };
      else sub.quantity = body.quantity;
      return [200, publicView(sub)];
    }
    if (method === "POST" && match[2] === "/cancel_scheduled_changes") {
      if (!sub.scheduled) return [400, { error: { description: "No Pending update for this subscription" } }];
      sub.scheduled = null;
      return [200, publicView(sub)];
    }
    if (method === "POST" && match[2] === "/cancel") {
      if (!["authenticated", "active"].includes(sub.status)) return [400, { error: { description: "Subscription is not cancellable in the current state" } }];
      if (body.cancel_at_cycle_end === 1 || body.cancel_at_cycle_end === true) sub.cancelAtCycleEnd = true;
      else {
        sub.status = "cancelled";
        sub.ended_at = now();
      }
      return [200, publicView(sub)];
    }
    return [404, { error: { description: "not found" } }];
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw ? JSON.parse(raw) : {};
      const send = (status, payload) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url.startsWith("/__control/")) return control(req.method, req.url, body, send);
      requests.push({ method: req.method, path: req.url, body });
      const expected = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
      if (req.headers.authorization !== expected) return send(401, { error: { description: "Authentication failed" } });
      const index = failures.findIndex((failure) => failure.method === req.method && failure.pattern.test(req.url));
      if (index >= 0) {
        const [failure] = failures.splice(index, 1);
        if (failure.mode === "drop") return req.socket.destroy();
        if (failure.mode === "applyThenDrop") {
          route(req.method, req.url, body);
          return req.socket.destroy();
        }
        return send(failure.status, failure.payload ?? { error: { description: "injected failure" } });
      }
      const [status, payload] = route(req.method, req.url, body);
      return send(status, payload);
    });
  });

  // Test helpers ------------------------------------------------------------
  function authenticate(subscriptionId, { status = "authenticated" } = {}) {
    const sub = subscriptions.get(subscriptionId);
    sub.status = status;
    sub.current_start = now();
    sub.current_end = now() + MONTH;
    const paymentId = shortId("pay");
    const signature = createHmac("sha256", keySecret).update(`${paymentId}|${subscriptionId}`).digest("hex");
    return { razorpay_payment_id: paymentId, razorpay_subscription_id: subscriptionId, razorpay_signature: signature };
  }
  function setStatus(subscriptionId, status) {
    subscriptions.get(subscriptionId).status = status;
    return publicView(subscriptions.get(subscriptionId));
  }
  // A renewal: new cycle, scheduled quantity applies, cycle-end cancellation completes.
  function renew(subscriptionId) {
    const sub = subscriptions.get(subscriptionId);
    sub.current_start = (sub.current_end ?? now()) + 1;
    sub.current_end = sub.current_start + MONTH;
    if (sub.scheduled) {
      sub.quantity = sub.scheduled.quantity;
      sub.scheduled = null;
    }
    if (sub.cancelAtCycleEnd) {
      sub.status = "cancelled";
      sub.ended_at = sub.current_start;
    } else sub.status = "active";
    return publicView(sub);
  }
  function webhook(event, subscriptionId, extras = {}, createdAt = now()) {
    const payload = { subscription: { entity: publicView(subscriptions.get(subscriptionId)) }, ...extras };
    const body = JSON.stringify({ entity: "event", account_id: "acc_standin", event, contains: Object.keys(payload), payload, created_at: createdAt });
    const signature = createHmac("sha256", webhookSecret).update(body).digest("hex");
    return { body, signature, eventId: shortId("evt") };
  }
  async function deliver(event, subscriptionId, extras = {}, createdAt = now()) {
    const signed = webhook(event, subscriptionId, extras, createdAt);
    if (onWebhook) await onWebhook(signed);
    return signed;
  }
  // Fail the next request whose method matches and whose path matches `pattern`.
  // mode: "status" (respond with status/payload), "drop" (connection lost before the provider acted),
  // "applyThenDrop" (the provider acted, the response was lost).
  function failNext(method, pattern, { mode = "status", status = 500, payload } = {}) {
    failures.push({ method, pattern, mode, status, payload });
  }

  function control(method, url, body, send) {
    if (method === "POST" && url === "/__control/authenticate") return send(200, authenticate(body.subscriptionId, body));
    if (method === "POST" && url === "/__control/status") return send(200, setStatus(body.subscriptionId, body.status));
    if (method === "POST" && url === "/__control/renew") return send(200, renew(body.subscriptionId));
    if (method === "POST" && url === "/__control/webhook") {
      const signed = webhook(body.event, body.subscriptionId, body.extras || {});
      return send(200, signed);
    }
    if (method === "POST" && url === "/__control/plans") {
      for (const id of body.ids || []) plans.set(id, { id, entity: "plan" });
      return send(200, { known: plans.size });
    }
    if (method === "POST" && url === "/__control/fail") {
      failNext(body.method, new RegExp(body.pattern), { mode: body.mode, status: body.status });
      return send(200, { armed: true });
    }
    if (method === "POST" && url === "/__control/quantity") {
      subscriptions.get(body.subscriptionId).quantity = body.quantity;
      return send(200, publicView(subscriptions.get(body.subscriptionId)));
    }
    if (method === "GET" && url === "/__control/subscriptions") return send(200, { items: [...subscriptions.values()].map(publicView) });
    return send(404, { error: "unknown control" });
  }

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    apiBase: `${url}/v1`,
    plans,
    subscriptions,
    requests,
    authenticate,
    setStatus,
    renew,
    webhook,
    deliver,
    failNext,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const portIndex = process.argv.indexOf("--port");
  const port = portIndex > 0 ? Number(process.argv[portIndex + 1]) : 3199;
  const standin = await startRazorpayStandIn({
    port,
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  });
  console.log(`Razorpay stand-in listening on ${standin.url}`);
}
