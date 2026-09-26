// The only code that talks to Razorpay. Plain data in and out, so the billing
// domain runs unchanged against a local stand-in in tests. No secret leaves
// this module; only the public key id is ever handed to the browser.
//
// Protocol notes (verified against Razorpay's official Subscriptions docs):
// - checkout signature: HMAC-SHA256(payment_id + "|" + subscription_id, key_secret),
//   where subscription_id is the id WE stored, never the browser's copy;
// - webhook signature: HMAC-SHA256(exact raw body, webhook secret) in
//   X-Razorpay-Signature; X-Razorpay-Event-Id is unique per event;
// - PATCH /subscriptions/:id (quantity, schedule_change_at now|cycle_end) is only
//   allowed for authenticated/active subscriptions; POST
//   /subscriptions/:id/cancel_scheduled_changes removes a pending cycle-end update;
// - POST /subscriptions/:id/cancel { cancel_at_cycle_end } for authenticated/active;
// - GET /subscriptions supports plan_id/from/to/count(<=100)/skip, not note filters.
import { createHmac, timingSafeEqual } from "node:crypto";

import { BillingServiceError, PROVIDER_OUTCOME } from "../errors.js";
import { billingEvent } from "../observability.js";

const DEFAULT_API = "https://api.razorpay.com/v1";

function safeEqualHex(expected, actual) {
  const a = Buffer.from(String(expected), "utf8");
  const b = Buffer.from(String(actual || ""), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyCheckoutSignature({ paymentId, subscriptionId, signature }, keySecret) {
  if (!keySecret || !paymentId || !subscriptionId || !signature) return false;
  const expected = createHmac("sha256", keySecret).update(`${paymentId}|${subscriptionId}`).digest("hex");
  return safeEqualHex(expected, signature);
}

// The current and the previous secret are both accepted while a secret is rotated.
export function verifyWebhookSignature(rawBody, signature, secrets) {
  if (!signature) return false;
  return secrets.filter(Boolean).some((secret) => safeEqualHex(createHmac("sha256", secret).update(rawBody).digest("hex"), signature));
}

export function razorpayConfig(env = process.env) {
  const mode = env.RAZORPAY_MODE === "live" ? "live" : "test";
  return {
    keyId: env.RAZORPAY_KEY_ID || "",
    keySecret: env.RAZORPAY_KEY_SECRET || "",
    webhookSecrets: [env.RAZORPAY_WEBHOOK_SECRET || "", env.RAZORPAY_WEBHOOK_SECRET_PREVIOUS || ""].filter(Boolean),
    timeoutMs: Math.min(60_000, Math.max(1_000, Number(env.RAZORPAY_REQUEST_TIMEOUT_MS || 10_000) || 10_000)),
    checkoutEnabled: String(env.BILLING_CHECKOUT_ENABLED || "").toLowerCase() === "true",
    mode,
    // Test mode may point at a local stand-in; live mode always uses Razorpay.
    apiBase: mode === "live" ? DEFAULT_API : env.RAZORPAY_API_BASE || DEFAULT_API,
  };
}

// Configuration problems, worded for operators (never includes secret values).
export function validateRazorpayConfig(env = process.env) {
  const config = razorpayConfig(env);
  const problems = [];
  if (env.RAZORPAY_MODE && !["live", "test"].includes(env.RAZORPAY_MODE)) problems.push("RAZORPAY_MODE must be live or test.");
  if (config.keyId && config.mode === "live" && !config.keyId.startsWith("rzp_live_")) problems.push("Live mode requires a rzp_live_ key id.");
  if (config.keyId && config.mode === "test" && !config.keyId.startsWith("rzp_test_")) problems.push("Test mode requires a rzp_test_ key id.");
  if (config.mode === "live" && env.RAZORPAY_API_BASE) problems.push("RAZORPAY_API_BASE is ignored in live mode; remove it.");
  if (config.checkoutEnabled) {
    if (!config.keyId || !config.keySecret) problems.push("BILLING_CHECKOUT_ENABLED requires RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.");
    if (!config.webhookSecrets.length) problems.push("BILLING_CHECKOUT_ENABLED requires RAZORPAY_WEBHOOK_SECRET.");
  }
  return problems;
}

function providerFailure(status, message, code, outcome) {
  billingEvent("billing.provider.error", { code, status }, { code, outcome });
  return new BillingServiceError(status, message, code, { outcome });
}

export function createRazorpayProvider(env = process.env, fetchImpl = fetch) {
  const config = razorpayConfig(env);

  async function call(method, path, body) {
    if (!config.keyId || !config.keySecret) {
      throw providerFailure(503, "The payment provider is not configured.", "BILLING_PROVIDER_NOT_CONFIGURED", PROVIDER_OUTCOME.REJECTED);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    let response;
    try {
      response = await fetchImpl(`${config.apiBase}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}`,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch {
      // Timeout or network failure: the request may or may not have been performed.
      throw providerFailure(502, "The payment provider did not respond in time.", "BILLING_PROVIDER_UNREACHABLE", PROVIDER_OUTCOME.UNKNOWN);
    } finally {
      clearTimeout(timer);
    }
    const payload = await response.json().catch(() => ({}));
    if (response.ok) return payload;
    if (response.status >= 500) {
      throw providerFailure(502, `The payment provider had an error (${response.status}).`, "BILLING_PROVIDER_UNAVAILABLE", PROVIDER_OUTCOME.UNKNOWN);
    }
    const description = typeof payload?.error?.description === "string" ? payload.error.description.slice(0, 200) : "";
    throw providerFailure(502, description || `The payment provider refused the request (${response.status}).`, "BILLING_PROVIDER_ERROR", PROVIDER_OUTCOME.REJECTED);
  }

  const id = (value) => encodeURIComponent(String(value));
  return Object.freeze({
    name: "razorpay",
    config: Object.freeze({ checkoutEnabled: config.checkoutEnabled, mode: config.mode, timeoutMs: config.timeoutMs }),
    publicKey: config.keyId,
    createPlan: (payload) => call("POST", "/plans", payload),
    createSubscription: (payload) => call("POST", "/subscriptions", payload),
    fetchSubscription: (subscriptionId) => call("GET", `/subscriptions/${id(subscriptionId)}`),
    listSubscriptions: ({ planId, from, to, count = 100, skip = 0 }) => {
      const query = new URLSearchParams({ count: String(Math.min(100, count)), skip: String(skip) });
      if (planId) query.set("plan_id", planId);
      if (from) query.set("from", String(from));
      if (to) query.set("to", String(to));
      return call("GET", `/subscriptions?${query.toString()}`);
    },
    updateSubscription: (subscriptionId, payload) => call("PATCH", `/subscriptions/${id(subscriptionId)}`, payload),
    cancelScheduledChanges: (subscriptionId) => call("POST", `/subscriptions/${id(subscriptionId)}/cancel_scheduled_changes`, {}),
    cancelSubscription: (subscriptionId, cancelAtCycleEnd) =>
      call("POST", `/subscriptions/${id(subscriptionId)}/cancel`, { cancel_at_cycle_end: cancelAtCycleEnd ? 1 : 0 }),
    verifyCheckout: (input) => verifyCheckoutSignature(input, config.keySecret),
    verifyWebhook: (rawBody, signature) => verifyWebhookSignature(rawBody, signature, config.webhookSecrets),
  });
}
