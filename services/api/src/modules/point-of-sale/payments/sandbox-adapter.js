// F283/F284/F285/F286 sandbox payment adapter: a deterministic, fully
// scriptable fake gateway for development and testing. Every immediate or
// deferred outcome (immediate success, immediate decline, delayed-webhook
// success, timeout-then-webhook-arrives-late) is an EXPLICIT instruction
// the caller supplies (`outcome`), never randomness -- so tests can
// exercise every state-machine branch deterministically. The one piece of
// "real gateway plumbing" here is genuinely real: HMAC-SHA256 webhook
// signature signing/verification with a timing-safe compare, the exact
// discipline a real provider integration would need, mirroring
// services/api/src/core/inbound-mail.js's verifyInboundMailSignature.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const SANDBOX_PROVIDER_KEY = "sandbox";
const DEFAULT_DEV_SECRET = "pos-sandbox-payment-webhook-secret-dev-only-not-for-production";

function sandboxSecret(env = process.env) {
  const secret = String(env.POS_SANDBOX_PAYMENT_WEBHOOK_SECRET || DEFAULT_DEV_SECRET).trim();
  if (secret.length < 16) {
    throw new Error("POS sandbox payment webhook secret is too short.");
  }
  return secret;
}

function sign(rawBody, env) {
  return createHmac("sha256", sandboxSecret(env)).update(rawBody).digest("hex");
}

export function verifySandboxWebhookSignature(rawBody, signatureHeader, env = process.env) {
  const supplied = String(signatureHeader || "").trim().replace(/^sha256=/i, "");
  if (!/^[0-9a-f]{64}$/i.test(supplied)) return false;
  const expected = sign(rawBody, env);
  const suppliedBuffer = Buffer.from(supplied, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

// Outcomes a test/dev caller may script for `initiate`:
//   'immediate_success' (default) -- synchronous capture, mirrors a real
//     card network's synchronous authorization+capture response.
//   'immediate_decline'           -- synchronous, clean failure.
//   'delayed_success' / 'delayed_decline' / 'timeout_then_success' --
//     acknowledged as 'pending'; the real outcome only ever arrives
//     through a signed webhook delivery (deliverSandboxWebhook below),
//     never inferred from the initiate() call itself.
export async function sandboxInitiate(_context, { amount, currency, method, outcome = "immediate_success" } = {}) {
  void amount;
  void currency;
  void method;
  const providerReference = `sandbox_${randomUUID()}`;
  if (outcome === "immediate_decline") {
    return { providerReference, status: "failed", failureReason: "Sandbox instructed an immediate decline.", raw: { outcome } };
  }
  if (outcome === "immediate_success") {
    return { providerReference, status: "captured", raw: { outcome } };
  }
  // delayed_success / delayed_decline / timeout_then_success / anything
  // else not explicitly a synchronous outcome: acknowledge only.
  return { providerReference, status: "pending", raw: { outcome } };
}

export async function sandboxRefund(_context, { providerReference, outcome = "immediate_success" } = {}) {
  if (!providerReference) throw new Error("A provider reference is required to refund a sandbox payment.");
  if (outcome === "immediate_decline") {
    const error = new Error("Sandbox instructed the refund to decline.");
    error.code = "POS_SANDBOX_REFUND_DECLINED";
    throw error;
  }
  return { providerRefundReference: `sandbox_refund_${randomUUID()}`, status: "refunded" };
}

// Test/dev helper: builds a REAL, HMAC-signed webhook delivery exactly as
// the sandbox "provider" would send it back to our own webhook endpoint.
// Nothing about signature verification is skipped for this being a
// same-process fake -- the returned rawBody/signatureHeader must be fed
// through the actual verify+handle path, not injected directly into a
// trusted state transition.
export function buildSandboxWebhookDelivery({
  organizationId,
  companyId,
  paymentId,
  providerReference,
  status,
  eventType = "payment.updated",
  eventId,
  failureReason = null,
  env,
} = {}) {
  const payload = {
    eventId: eventId || randomUUID(),
    eventType,
    organizationId,
    companyId,
    paymentId,
    providerReference,
    status,
    failureReason,
  };
  const rawBody = JSON.stringify(payload);
  return { rawBody, signatureHeader: `sha256=${sign(rawBody, env)}`, payload };
}

export function parseSandboxWebhookEvent(rawBody) {
  const payload = JSON.parse(rawBody);
  return {
    eventId: String(payload.eventId || ""),
    eventType: String(payload.eventType || ""),
    organizationId: payload.organizationId,
    companyId: payload.companyId,
    paymentId: payload.paymentId,
    providerReference: payload.providerReference,
    status: payload.status,
    failureReason: payload.failureReason || null,
    raw: payload,
  };
}

export const sandboxPaymentAdapter = Object.freeze({
  key: SANDBOX_PROVIDER_KEY,
  initiate: sandboxInitiate,
  refund: sandboxRefund,
  verifyWebhookSignature: (rawBody, signatureHeader, env) => verifySandboxWebhookSignature(rawBody, signatureHeader, env),
  parseWebhookEvent: parseSandboxWebhookEvent,
});
