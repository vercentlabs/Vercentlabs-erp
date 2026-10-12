// POS Card Payments (0093) and UPI & Digital Payments (0094): the one place a provider's word changes a card / UPI / digital attempt —
// whether it arrives as the initiate response, a status query or a verified webhook. Provider vocabulary is normalised without inventing
// certainty: a timeout is UNKNOWN (never failed), an authorisation is not a capture, a captured payment is never downgraded by a late or
// older event. Evidence that does not fit is never applied or waived silently: a different amount (short or excess), the wrong merchant
// or currency, a UTR already applied to another payment, or a capture after the attempt was declined or cancelled (a late credit) becomes
// RECONCILIATION_REQUIRED and a payment exception for an authorised person. A final outcome frees the payment terminal it was using.
import { decimal } from "../../../core/decimal.js";
import { event } from "../shared/audit.js";

export const LIVE_ATTEMPT_STATUSES = Object.freeze(["created", "awaiting_customer", "processing", "authorized", "capture_pending", "unknown", "cancel_pending"]);
export const FINAL_ATTEMPT_STATUSES = Object.freeze(["captured", "declined", "failed", "cancelled"]);

// The coarse status the rest of the module already understands, for each attempt state.
const LEGACY_STATUS = Object.freeze({
  created: "initiated", awaiting_customer: "pending", processing: "pending", authorized: "authorized", capture_pending: "authorized", captured: "captured",
  declined: "failed", failed: "failed", unknown: "pending", cancel_pending: "pending", cancelled: "voided", reconciliation_required: "pending",
});

// Messages a cashier may see — never a raw gateway code, never a guessed reason such as insufficient funds.
export const CARD_MESSAGES = Object.freeze({
  created: "Sending the payment request.",
  awaiting_customer: "Ask the customer to tap or insert their card.",
  processing: "Checking payment status. Do not retry yet.",
  authorized: "Card authorised. Waiting for the payment to be captured.",
  capture_pending: "Checking payment status. Do not retry yet.",
  captured: "Payment confirmed.",
  declined: "Card payment was declined. Please try another card.",
  failed: "The payment could not be completed. Choose another payment method.",
  unknown: "Checking payment status. Do not retry yet.",
  cancel_pending: "Cancelling the payment request. Wait for it to confirm.",
  cancelled: "Payment request cancelled.",
  reconciliation_required: "This payment needs to be checked before the sale can continue.",
  externally_attested: "Recorded from outside the system. It will be checked against the settlement.",
});
// UPI and other digital methods say it in their own words.
export const DIGITAL_MESSAGES = Object.freeze({
  awaiting_customer: "Ask the customer to scan the QR with a UPI app and approve the payment.",
  declined: "The payment was not approved. Ask the customer to try again or choose another method.",
});
export const messageFor = (payment, status) =>
  (payment.payment_method !== "card" ? DIGITAL_MESSAGES[status] : null) ?? CARD_MESSAGES[status] ?? null;

export function normalizeProviderStatus(value) {
  const status = String(value ?? "").trim().toLowerCase();
  if (["captured", "succeeded", "success", "paid", "completed"].includes(status)) return "captured";
  if (["authorized", "authorised"].includes(status)) return "authorized";
  if (["capture_pending", "capturing"].includes(status)) return "capture_pending";
  if (["awaiting_customer", "waiting", "awaiting_card", "created", "active"].includes(status)) return "awaiting_customer";
  if (["pending", "processing", "initiated", "in_progress"].includes(status)) return "processing";
  if (["declined", "rejected", "denied"].includes(status)) return "declined";
  if (["failed", "error"].includes(status)) return "failed";
  if (["cancelled", "canceled", "voided", "closed"].includes(status)) return "cancelled";
  if (["cancel_pending", "cancelling"].includes(status)) return "cancel_pending";
  return "unknown";
}

const CARD_TYPES = ["debit", "credit", "prepaid"];
const INSTRUMENTS = ["upi", "wallet", "netbanking", "card"];
const cardFields = (card) => (card ? {
  network: card.network ? String(card.network).toUpperCase().slice(0, 20) : null,
  type: CARD_TYPES.includes(String(card.type ?? "").toLowerCase()) ? String(card.type).toLowerCase() : card.type ? "unknown" : null,
  lastFour: /^\d{4}$/.test(String(card.lastFour ?? "")) ? String(card.lastFour) : null,
} : { network: null, type: null, lastFour: null });

// A credit that cannot simply be applied, kept for an authorised person (each provider credit once per kind).
export async function recordPaymentException(client, context, payment, type, details = {}) {
  await client.query(
    `INSERT INTO tenant.pos_payment_exceptions (organization_id, payment_id, cart_id, store_id, provider_key, provider_reference, provider_transaction_reference, exception_type,
       amount, expected_amount, currency_code, detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING`,
    [payment.organization_id ?? context.organizationId, payment.id ?? null, payment.cart_id ?? null, payment.store_id ?? null, payment.provider_key ?? "unknown",
      details.providerReference ?? payment.provider_reference ?? null, details.transactionReference ?? null, type,
      details.amount === undefined || details.amount === null ? null : String(details.amount), payment.amount ?? null, details.currency ?? payment.currency_code ?? null,
      details.detail ? String(details.detail).slice(0, 500) : null]);
  await event(client, context, "payment", payment.id, "pos.payment.exception", { type, amount: details.amount ?? null, detail: details.detail ?? null });
}

// Apply what the provider said. evidence: { status, providerReference, amount, currency, card, failureCode, transactionReference,
// merchantAccount, instrument, source }.
export async function applyProviderStatus(client, context, payment, evidence = {}) {
  const organizationId = payment.organization_id ?? context.organizationId;
  const current = payment.attempt_status ?? "processing";
  let next = normalizeProviderStatus(evidence.status);
  let note = null;
  const exceptions = [];
  const reported = evidence.amount !== null && evidence.amount !== undefined && String(evidence.amount) !== "" ? decimal(String(evidence.amount)) : null;
  if (reported !== null && reported !== decimal(payment.amount)) {
    next = "reconciliation_required";
    note = `The provider reported ${evidence.amount}, not ${payment.amount}.`;
    exceptions.push([reported < decimal(payment.amount) ? "short" : "excess", { amount: evidence.amount, detail: note }]);
  }
  if (evidence.currency && payment.currency_code && String(evidence.currency).toUpperCase() !== String(payment.currency_code).toUpperCase()) {
    next = "reconciliation_required";
    note = `The provider reported ${evidence.currency}, not ${payment.currency_code}.`;
    exceptions.push(["wrong_currency", { amount: evidence.amount, currency: evidence.currency, detail: note }]);
  }
  if (evidence.merchantAccount && payment.merchant_account_reference && evidence.merchantAccount !== payment.merchant_account_reference) {
    next = "reconciliation_required";
    note = "The payment went to a different merchant account. The sale cannot be completed with it.";
    exceptions.push(["wrong_merchant", { amount: evidence.amount, detail: note }]);
  }
  if (evidence.transactionReference) {
    const taken = (await client.query(
      `SELECT id FROM tenant.pos_payments WHERE organization_id=$1 AND provider_key=$2 AND provider_transaction_reference=$3 AND id <> $4`,
      [organizationId, payment.provider_key, evidence.transactionReference, payment.id])).rows[0];
    if (taken) {
      next = "reconciliation_required";
      note = `The transaction reference ${evidence.transactionReference} is already applied to another payment.`;
      exceptions.push(["duplicate", { amount: evidence.amount, transactionReference: evidence.transactionReference, detail: note }]);
    }
  }
  if (current === "captured" && next !== "captured" && next !== "reconciliation_required") {
    await event(client, context, "payment", payment.id, "pos.card.stale_status_ignored", { current, reported: next, source: evidence.source ?? null });
    return payment;
  }
  // Money after the attempt was declined, failed or cancelled (a late credit): the attempt stays as it was and the bill stays free to be paid
  // another way; the money is kept as a payment exception for reconciliation and refund, never moved to another bill.
  if (["declined", "failed", "cancelled"].includes(current) && next === "captured") {
    await recordPaymentException(client, context, payment, "late", { amount: evidence.amount ?? payment.amount, providerReference: evidence.providerReference ?? payment.provider_reference,
      transactionReference: evidence.transactionReference ?? null, detail: `A payment arrived after the attempt was ${current}.` });
    return payment;
  }
  if (FINAL_ATTEMPT_STATUSES.includes(current) && next !== "reconciliation_required" && next !== current) return payment;
  if (next === "unknown" && current !== "created") next = current === "processing" || current === "awaiting_customer" ? "unknown" : current;
  if (next === current && !evidence.card && !evidence.providerReference && !evidence.transactionReference) return payment;
  const card = cardFields(evidence.card);
  const final = FINAL_ATTEMPT_STATUSES.includes(next);
  const keepReference = next === "captured" ? evidence.transactionReference ?? null : null;
  const instrument = INSTRUMENTS.includes(String(evidence.instrument ?? "").toLowerCase()) ? String(evidence.instrument).toLowerCase() : null;
  const updated = (await client.query(
    `UPDATE tenant.pos_payments
        SET attempt_status=$3, status=$4, provider_reference=COALESCE(provider_reference, $5),
            verification_status=CASE WHEN $3='captured' THEN 'provider_verified' WHEN $3='reconciliation_required' THEN 'unresolved' ELSE verification_status END,
            captured_at=CASE WHEN $3='captured' THEN COALESCE(captured_at, now()) ELSE captured_at END,
            confirmed_at=CASE WHEN $3='captured' THEN COALESCE(confirmed_at, now()) ELSE confirmed_at END,
            authorized_at=CASE WHEN $3 IN ('authorized','capture_pending','captured') THEN COALESCE(authorized_at, now()) ELSE authorized_at END,
            resolved_at=CASE WHEN $6 THEN now() ELSE resolved_at END,
            card_network=COALESCE($7, card_network), card_type=COALESCE($8, card_type), card_last_four=COALESCE($9, card_last_four),
            failure_code=CASE WHEN $3 IN ('declined','failed') THEN COALESCE($10, failure_code) ELSE failure_code END,
            failure_reason=CASE WHEN $3='reconciliation_required' THEN $11 ELSE failure_reason END,
            display_message=$12, voided_at=CASE WHEN $3='cancelled' THEN now() ELSE voided_at END,
            received_amount=COALESCE($13, received_amount), provider_transaction_reference=COALESCE(provider_transaction_reference, $14),
            instrument=COALESCE($15, instrument),
            request_status=CASE WHEN $3='captured' THEN 'consumed' WHEN $3='cancelled' AND request_status IS NOT NULL THEN 'cancelled' ELSE request_status END,
            version=version+1, updated_at=now()
      WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [organizationId, payment.id, next, LEGACY_STATUS[next] ?? payment.status, evidence.providerReference ?? null, final, card.network, card.type,
      card.lastFour, evidence.failureCode ? String(evidence.failureCode).slice(0, 40) : null, note, messageFor(payment, next),
      reported === null ? null : String(evidence.amount), keepReference, instrument])).rows[0];
  for (const [type, details] of exceptions) await recordPaymentException(client, context, updated, type, details);
  if (final || next === "reconciliation_required") {
    await client.query(`UPDATE tenant.pos_payment_terminals SET active_payment_id=NULL, active_since=NULL, updated_at=now() WHERE organization_id=$1 AND active_payment_id=$2`,
      [organizationId, payment.id]);
  }
  await event(client, context, "payment", payment.id, `pos.card.${next}`, { from: current, source: evidence.source ?? null, note });
  return updated;
}
