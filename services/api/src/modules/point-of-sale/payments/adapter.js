// F283 (card) / F284 (UPI) / F285 (split tender) / F286 (multiple payment
// methods): the ONE generic payment-provider adapter contract every tender
// method flows through, so card/UPI/wallet/split are just different tender
// configurations of the same engine rather than four ad-hoc integrations.
//
// A concrete adapter must implement:
//
//   key: string
//
//   initiate(context, { amount, currency, method, merchantReference, outcome, metadata })
//     -> Promise<{ providerReference: string, status: 'pending'|'authorized'|'captured'|'failed', failureReason?: string, raw?: unknown }>
//     Called to START a payment. `amount`/`currency` are the authoritative
//     server-computed figures (never a client-asserted total). The RETURN
//     VALUE's status is the only thing the caller may trust as an
//     immediate outcome -- for any provider where capture can complete
//     asynchronously, the adapter must return 'pending' here and let the
//     real state arrive later through handleWebhook/parseWebhookEvent.
//
//   verifyWebhookSignature(rawBody, signatureHeader, env) -> boolean
//     Real, server-side cryptographic verification of an inbound
//     provider callback. This is never stubbed out, even for the sandbox
//     adapter -- see sandbox-adapter.js's HMAC implementation.
//
//   parseWebhookEvent(rawBody) -> { eventId, eventType, organizationId, companyId, paymentId, providerReference, status, failureReason, raw }
//     Only called AFTER verifyWebhookSignature has already returned true.
//     `eventId` is the provider's own delivery/event id, used for the
//     webhook-delivery dedupe table -- a redelivery of the same eventId
//     must be treated as a no-op, never reprocessed.
//
//   refund(context, { providerReference, amount, currency }) -> Promise<{ providerRefundReference: string, status: 'refunded' }>
//     Refunds always route back to the ORIGINAL provider reference/tender
//     method -- callers never pick an alternate method here.
import { sandboxPaymentAdapter } from "./sandbox-adapter.js";

export class PaymentAdapterError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = "PaymentAdapterError";
    this.status = status;
    this.code = code;
  }
}

// Registry of adapters this codebase actually, genuinely implements.
// There is no real merchant/gateway credential available in this
// environment, and none is fabricated: only 'sandbox' -- a deterministic,
// fully-scriptable fake gateway used for development and testing -- is
// registered. A provider_config row may name any other provider_key (see
// migration 119, tenant.pos_payment_provider_configs) to record real
// configuration intent, but resolving it here fails closed with a clear,
// disclosed error rather than ever faking a live-payment success path.
const ADAPTERS = Object.freeze({
  [sandboxPaymentAdapter.key]: sandboxPaymentAdapter,
});

export function resolvePaymentAdapter(providerKey) {
  const key = String(providerKey || "").trim().toLowerCase();
  const adapter = ADAPTERS[key];
  if (!adapter) {
    throw new PaymentAdapterError(
      503,
      `EXTERNAL ACTIVATION BLOCKED: payment provider "${providerKey}" has a configuration row but no real gateway adapter is implemented in this environment (no live merchant credentials exist here). Only the sandbox adapter is available until a real adapter for this provider is built and activated.`,
      "POS_PAYMENT_PROVIDER_NOT_ACTIVATED",
    );
  }
  return adapter;
}

export function registeredPaymentProviderKeys() {
  return Object.keys(ADAPTERS);
}
