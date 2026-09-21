// The only place that talks to Razorpay. Every method takes/returns plain data so the billing service can be
// tested against a fake provider with the same shape, and no secret ever leaves this file.
import { createHmac, timingSafeEqual } from "node:crypto";

import { BillingDomainError } from "./billing.js";

const API = "https://api.razorpay.com/v1";

function safeEqualHex(expected, actual) {
  const a = Buffer.from(String(expected), "utf8");
  const b = Buffer.from(String(actual || ""), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

// Checkout return signature for a subscription: HMAC-SHA256(payment_id + "|" + subscription_id, key_secret).
export function verifyCheckoutSignature({ paymentId, subscriptionId, signature }, keySecret) {
  if (!keySecret || !paymentId || !subscriptionId || !signature) return false;
  const expected = createHmac("sha256", keySecret).update(`${paymentId}|${subscriptionId}`).digest("hex");
  return safeEqualHex(expected, signature);
}

// Webhook signature: HMAC-SHA256(raw body, webhook secret). The previous secret is accepted during rotation.
export function verifyWebhookSignature(rawBody, signature, secrets) {
  if (!signature) return false;
  return secrets.filter(Boolean).some((secret) => safeEqualHex(createHmac("sha256", secret).update(rawBody).digest("hex"), signature));
}

export function razorpayConfig(env = process.env) {
  return {
    keyId: env.RAZORPAY_KEY_ID || "",
    keySecret: env.RAZORPAY_KEY_SECRET || "",
    webhookSecrets: [env.RAZORPAY_WEBHOOK_SECRET || "", env.RAZORPAY_WEBHOOK_SECRET_PREVIOUS || ""].filter(Boolean),
    timeoutMs: Number(env.RAZORPAY_REQUEST_TIMEOUT_MS || 10000),
    checkoutEnabled: String(env.BILLING_CHECKOUT_ENABLED || "").toLowerCase() === "true",
    mode: env.RAZORPAY_MODE === "live" ? "live" : "test",
  };
}

export function createRazorpayProvider(env = process.env, fetchImpl = fetch) {
  const config = razorpayConfig(env);

  async function call(method, path, body) {
    if (!config.keyId || !config.keySecret) {
      throw new BillingDomainError("provider_not_configured", "The payment provider is not configured.");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetchImpl(`${API}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}`,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new BillingDomainError("provider_error", payload?.error?.description || `The payment provider refused the request (${response.status}).`);
      }
      return payload;
    } catch (error) {
      if (error instanceof BillingDomainError) throw error;
      throw new BillingDomainError("provider_unreachable", "The payment provider could not be reached. Nothing was charged; try again.");
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    name: "razorpay",
    config,
    createPlan: (payload) => call("POST", "/plans", payload),
    createSubscription: (payload) => call("POST", "/subscriptions", payload),
    fetchSubscription: (id) => call("GET", `/subscriptions/${encodeURIComponent(id)}`),
    updateSubscription: (id, payload) => call("PATCH", `/subscriptions/${encodeURIComponent(id)}`, payload),
    cancelSubscription: (id, cancelAtCycleEnd) => call("POST", `/subscriptions/${encodeURIComponent(id)}/cancel`, { cancel_at_cycle_end: cancelAtCycleEnd ? 1 : 0 }),
    verifyCheckout: (input) => verifyCheckoutSignature(input, config.keySecret),
    verifyWebhook: (rawBody, signature) => verifyWebhookSignature(rawBody, signature, config.webhookSecrets),
    publicKey: config.keyId,
  });
}
