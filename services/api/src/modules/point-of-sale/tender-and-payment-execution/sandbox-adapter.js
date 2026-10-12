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
//
// POS Card Payments (0093): the sandbox "provider" also remembers each attempt by the merchant reference (our payment id), so a status
// query or a cancellation answers the way a real provider would, and captured card payments carry masked metadata only (network, type,
// last four) -- never a card number.
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

// The sandbox provider's own records: attempts by merchant reference, refunds by refund reference.
const SANDBOX_ATTEMPTS = new Map();
const SANDBOX_REFUNDS = new Map();
const SANDBOX_CARD = Object.freeze({ network: "VISA", type: "debit", lastFour: "4242" });

// Test/dev helper: what the provider now says about an attempt (as if the customer paid, the bank declined, ...).
export function sandboxSetPaymentOutcome(merchantReference, status, extra = {}) {
  const current = SANDBOX_ATTEMPTS.get(merchantReference) ?? { providerReference: `sandbox_${randomUUID()}` };
  SANDBOX_ATTEMPTS.set(merchantReference, { ...current, status, ...extra });
  return SANDBOX_ATTEMPTS.get(merchantReference);
}

// Outcomes a test/dev caller may script for `initiate`:
//   'immediate_success' (default) -- synchronous capture, mirrors a real
//     card network's synchronous authorization+capture response.
//   'immediate_decline'           -- synchronous, clean decline.
//   'awaiting_customer'           -- sent to the terminal; the customer has not paid yet.
//   'authorized'                  -- authorised, capture still to come.
//   'timeout'                     -- the provider took the request but the answer never arrived (throws; the attempt is UNKNOWN).
//   'delayed_success' / 'delayed_decline' / 'timeout_then_success' --
//     acknowledged as 'pending'; the real outcome only ever arrives
//     through a signed webhook delivery or a status query, never inferred
//     from the initiate() call itself.
// What this sandbox provider can do (a real adapter declares only what its provider really offers): dynamic QR and payment links, status
// queries, cancellation, refunds and signed webhooks -- no UPI intent.
export const SANDBOX_CAPABILITIES = Object.freeze({ terminal: true, dynamicQr: true, paymentLink: true, upiIntent: false, statusQuery: true, cancel: true, refunds: true, webhooks: true });
const SANDBOX_MERCHANT_VPA = "vercentretail@sandbox";

export async function sandboxInitiate(_context, { amount, currency, method, merchantReference, mode, merchantName, expiresInSeconds = 300, outcome = "immediate_success" } = {}) {
  void method;
  const providerReference = `sandbox_${randomUUID()}`;
  // UPI & Digital Payments (0094): a dynamic, amount-bound QR or a payment link for exactly this attempt. The QR payload names the merchant,
  // the amount, INR and our attempt reference; a real provider also returns the QR image. The customer has not paid yet.
  if (mode === "dynamic_qr" || mode === "payment_link") {
    const expiresAt = new Date(Date.now() + Number(expiresInSeconds) * 1000).toISOString();
    if (merchantReference) SANDBOX_ATTEMPTS.set(merchantReference, { providerReference, status: "awaiting_customer", amount, currency });
    const qrPayload = mode === "dynamic_qr"
      ? `upi://pay?pa=${SANDBOX_MERCHANT_VPA}&pn=${encodeURIComponent(merchantName ?? "Merchant")}&am=${amount}&cu=${currency ?? "INR"}&tr=${merchantReference}&mode=sandbox` : null;
    return { providerReference, status: "pending", providerStatus: "awaiting_customer", requestReference: `${mode === "dynamic_qr" ? "qr" : "plink"}_${randomUUID().slice(0, 12)}`,
      qrPayload, qrImageUrl: null, linkUrl: mode === "payment_link" ? `https://sandbox.pay.invalid/l/${providerReference.slice(-12)}` : null, expiresAt,
      merchantAccount: "SBX-MERCHANT", raw: { mode } };
  }
  void currency;
  const remember = (status) => { if (merchantReference) SANDBOX_ATTEMPTS.set(merchantReference, { providerReference, status, amount }); };
  if (outcome === "immediate_decline") {
    remember("declined");
    return { providerReference, status: "failed", providerStatus: "declined", failureCode: "DECLINED", failureReason: "Sandbox instructed an immediate decline.", raw: { outcome } };
  }
  if (outcome === "immediate_success") {
    remember("captured");
    return { providerReference, status: "captured", providerStatus: "captured", card: SANDBOX_CARD, raw: { outcome } };
  }
  if (outcome === "timeout") {
    remember("processing");
    const error = new Error("Sandbox: the provider did not answer in time.");
    error.code = "PROVIDER_TIMEOUT";
    error.timeout = true;
    throw error;
  }
  if (outcome === "authorized") {
    remember("authorized");
    return { providerReference, status: "authorized", providerStatus: "authorized", raw: { outcome } };
  }
  remember(outcome === "awaiting_customer" ? "awaiting_customer" : "processing");
  return { providerReference, status: "pending", providerStatus: outcome === "awaiting_customer" ? "awaiting_customer" : "processing", raw: { outcome } };
}

// What a real status query returns: the provider's record of the attempt, found by our payment id or its reference.
export async function sandboxQueryStatus(_context, { merchantReference, providerReference } = {}) {
  const found = SANDBOX_ATTEMPTS.get(merchantReference) ?? [...SANDBOX_ATTEMPTS.values()].find((entry) => entry.providerReference === providerReference);
  if (!found) return { status: "unknown" };
  return { providerReference: found.providerReference, status: found.status, amount: found.receivedAmount ?? found.amount ?? null, card: found.status === "captured" && !found.instrument ? SANDBOX_CARD : null,
    failureCode: found.status === "declined" ? "DECLINED" : null, transactionReference: found.utr ?? null, merchantAccount: found.merchantAccount ?? null, instrument: found.instrument ?? null,
    currency: found.currency ?? null };
}

// Cancel an attempt that was not captured. A captured attempt cannot be cancelled (it is refunded); an attempt scripted with
// cancelOutcome "unknown" models a provider that accepted the request without confirming it.
export async function sandboxCancel(_context, { merchantReference } = {}) {
  const found = SANDBOX_ATTEMPTS.get(merchantReference);
  if (!found) return { status: "unknown" };
  if (found.status === "captured") return { status: "captured" };
  if (found.cancelOutcome === "unknown") return { status: "cancel_pending" };
  SANDBOX_ATTEMPTS.set(merchantReference, { ...found, status: "cancelled" });
  return { status: "cancelled" };
}

export async function sandboxRefund(_context, { providerReference, outcome = "immediate_success" } = {}) {
  if (!providerReference) throw new Error("A provider reference is required to refund a sandbox payment.");
  if (outcome === "immediate_decline") {
    const error = new Error("Sandbox instructed the refund to decline.");
    error.code = "POS_SANDBOX_REFUND_DECLINED";
    throw error;
  }
  if (outcome === "timeout") {
    const error = new Error("Sandbox: the refund answer never arrived.");
    error.code = "PROVIDER_TIMEOUT";
    error.timeout = true;
    throw error;
  }
  const providerRefundReference = `sandbox_refund_${randomUUID()}`;
  if (outcome === "pending") {
    SANDBOX_REFUNDS.set(providerRefundReference, "processing");
    return { providerRefundReference, status: "processing" };
  }
  SANDBOX_REFUNDS.set(providerRefundReference, "refunded");
  return { providerRefundReference, status: "refunded" };
}

// Test/dev helper and the status query for a refund still being processed.
export function sandboxSetRefundOutcome(providerRefundReference, status) { SANDBOX_REFUNDS.set(providerRefundReference, status); }
export async function sandboxRefundStatus(_context, { providerRefundReference } = {}) {
  return { status: SANDBOX_REFUNDS.get(providerRefundReference) ?? "unknown" };
}

// Test/dev helper: builds a REAL, HMAC-signed webhook delivery exactly as
// the sandbox "provider" would send it back to our own webhook endpoint.
// Nothing about signature verification is skipped for this being a
// same-process fake -- the returned rawBody/signatureHeader must be fed
// through the actual verify+handle path, not injected directly into a
// trusted state transition.
export function buildSandboxWebhookDelivery({
  organizationId,
  paymentId,
  providerReference,
  status,
  eventType = "payment.updated",
  eventId,
  failureReason = null,
  amount = null,
  currency = null,
  card = null,
  transactionReference = null,
  merchantAccount = null,
  instrument = null,
  env,
} = {}) {
  const payload = {
    eventId: eventId || randomUUID(),
    eventType,
    organizationId,
    paymentId,
    providerReference,
    status,
    failureReason,
    amount,
    currency,
    card,
    transactionReference,
    merchantAccount,
    instrument,
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
    paymentId: payload.paymentId,
    providerReference: payload.providerReference,
    status: payload.status,
    failureReason: payload.failureReason || null,
    amount: payload.amount ?? null,
    currency: payload.currency ?? null,
    card: payload.card ?? null,
    transactionReference: payload.transactionReference ?? null,
    merchantAccount: payload.merchantAccount ?? null,
    instrument: payload.instrument ?? null,
    raw: payload,
  };
}

export const sandboxPaymentAdapter = Object.freeze({
  key: SANDBOX_PROVIDER_KEY,
  initiate: sandboxInitiate,
  refund: sandboxRefund,
  capabilities: SANDBOX_CAPABILITIES,
  queryStatus: sandboxQueryStatus,
  cancel: sandboxCancel,
  refundStatus: sandboxRefundStatus,
  verifyWebhookSignature: (rawBody, signatureHeader, env) => verifySandboxWebhookSignature(rawBody, signatureHeader, env),
  parseWebhookEvent: parseSandboxWebhookEvent,
});
