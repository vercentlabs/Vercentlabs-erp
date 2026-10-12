// F283 (card) / F284 (UPI/digital) / F285 (split tender) / F286 (multiple
// payment methods) -- the ONE payment-tender domain module every non-cash
// tender flows through. Cash stays exactly as it already worked in
// index.js's completePosCart/completePointOfSale (immediately final, no
// provider involved); everything here is additive.
//
// Absolute rules enforced throughout this file:
//   - Raw PAN/CVV are never accepted or stored anywhere -- only a
//     provider reference/token ever touches this schema.
//   - A client can never assert "it succeeded." The only things trusted
//     as proof of payment are (a) an adapter's own synchronous initiate()
//     response, or (b) a server-verified webhook. A client-supplied
//     `outcome` on initiate is a SANDBOX TEST-SCRIPTING INSTRUCTION only
//     (interpreted by the sandbox adapter itself to decide what it
//     returns) -- it is never read as a truth claim about payment state,
//     and a real adapter would ignore it entirely.
//   - Idempotent on initiate, on refund, and (via a separate axis --
//     provider event id, not the command idempotency key) on webhook
//     delivery.
//   - A refund can never exceed the captured amount and always routes
//     back to the original provider reference/tender -- there is no
//     "refund to an alternate method" path.
import { createApprovalRequest, finalizeApprovalRequest } from "../../../core/platform/approvals/index.js";
import { beginIdempotentOperation, completeIdempotentOperation } from "../../../core/idempotency.js";
import { add, decimal, asDatabaseDecimal, sub } from "../../../core/decimal.js";
import { resolvePaymentAdapter, PaymentAdapterError } from "./adapter.js";
import { isTerminalPaymentMethodEnabled } from "../terminals/index.js";
import { assertPosAction } from "../permissions/index.js";
import { assertPosCartProductsSellable } from "../product-search/index.js";
import { ensurePosCheckoutStarted } from "../assortment-pricing-customer-and-cart/cart.js";
import { posError } from "../shared/errors.js";
import { requirePermission } from "../shared/access-control.js";
import { event } from "../shared/audit.js";
import { applyProviderStatus, recordPaymentException } from "./card-status.js";

// Re-exported so the web app's webhook route (which must resolve+verify an
// adapter BEFORE it knows which organization's tenant client to open) can
// import it from the same public @vercentlabs/api surface as everything
// else in this module, without reaching into services/api's internal
// tender-and-payment-execution/adapter.js path.
export { resolvePaymentAdapter, PaymentAdapterError };

const NON_CASH_METHODS = Object.freeze(["card", "upi", "wallet", "bank_transfer"]);

async function lockOpenCart(client, context, cartId) {
  const result = await client.query(
    `SELECT cart.*, store.currency_code AS store_currency_code
     FROM tenant.pos_carts cart
     JOIN tenant.pos_stores store ON store.organization_id=cart.organization_id AND store.id=cart.store_id
     WHERE cart.organization_id=$1 AND cart.id=$2
     FOR UPDATE OF cart`,
    [context.organizationId, cartId],
  );
  const cart = result.rows[0];
  if (!cart) throw posError(404, "POS cart was not found.", "POS_CART_NOT_FOUND");
  if (!["draft", "priced"].includes(cart.status)) {
    throw posError(409, `This cart is ${cart.status} and cannot accept a payment.`, "POS_CART_NOT_PRICED");
  }
  return cart;
}

// F283/F284/F286 -- starts a non-cash tender leg. Creates the
// payment-attempt row (tenant.pos_payments, extended by migration 120 to
// support a pre-sale cart_id-scoped row), calls the resolved provider
// adapter, and returns a client-facing status. This function NEVER
// completes the sale itself -- completePosCart in index.js is the only
// path that turns a captured leg into part of a finished sale.
export async function initiatePosPayment(client, context, input = {}) {
  requirePermission(context, "pos.sale.create");
  const method = String(input.method || "").trim().toLowerCase();
  // No credit at the counter: a walk-in bill has nobody to give credit to, and a named customer is identified, not credit-approved (credit
  // terms and limits belong to Finance and are not part of POS).
  if (method === "store_credit" || method === "credit" || method === "account") {
    const mode = input.cartId
      ? (await client.query(`SELECT customer_mode FROM tenant.pos_carts WHERE organization_id=$1 AND id=$2`, [context.organizationId, input.cartId])).rows[0]?.customer_mode
      : null;
    if (mode === "registered")
      throw posError(409, "Credit is not available at the counter: a customer account is not credit approval. Take cash, UPI or card.", "POS_CREDIT_NOT_AVAILABLE");
    throw posError(409, "Select an eligible registered customer for credit sales.", "POS_WALK_IN_CREDIT_NOT_ALLOWED");
  }
  if (!NON_CASH_METHODS.includes(method)) {
    throw posError(400, `Unsupported POS payment method: ${input.method}.`, "POS_PAYMENT_METHOD_INVALID");
  }
  const amount = decimal(input.amount);
  if (amount <= 0n) throw posError(400, "POS payment amount must be greater than zero.", "POS_PAYMENT_AMOUNT_INVALID");
  if (!input.cartId) throw posError(400, "A cart id is required to initiate a payment.", "POS_PAYMENT_CART_REQUIRED");

  const idempotency = await beginIdempotentOperation(client, context, {
    operation: "pos.payment.initiate",
    key: input.idempotencyKey,
    payload: { cartId: input.cartId, method, amount: asDatabaseDecimal(amount) },
    required: true,
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };

  const cart = await lockOpenCart(client, context, input.cartId);
  // Money only moves on a bill locked for checkout: nothing on it can change while the payment's outcome is unknown.
  await ensurePosCheckoutStarted(client, context, cart.id);
  // Products and stock are checked again before money moves (Product Search); the sale's stock issue checks once more, atomically.
  await assertPosCartProductsSellable(client, context, cart.id);

  const store = await client.query(
    `SELECT id,currency_code FROM tenant.pos_stores WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, cart.store_id],
  );
  const storeRow = store.rows[0];
  // The methods this terminal takes: its outlet's, narrowed by the terminal's own list (Stores & Outlets, POS Terminals).
  if (!storeRow || !(await isTerminalPaymentMethodEnabled(client, context.organizationId, cart.terminal_id, method))) {
    throw posError(409, `Payment method "${method}" is not available on this terminal.`, "PAYMENT_METHOD_NOT_AVAILABLE");
  }

  const config = await client.query(
    `SELECT provider_key FROM tenant.pos_payment_provider_configs
     WHERE organization_id=$1 AND store_id=$2 AND payment_method=$3 AND active=true`,
    [context.organizationId, cart.store_id, method],
  );
  if (!config.rows[0]) {
    throw posError(
      409,
      `No active payment provider is configured for "${method}" at this store.`,
      "POS_PAYMENT_PROVIDER_NOT_CONFIGURED",
    );
  }
  const providerKey = config.rows[0].provider_key;
  const adapter = resolvePaymentAdapter(providerKey);

  const inserted = await client.query(
    `INSERT INTO tenant.pos_payments
      (organization_id,cart_id,store_id,shift_id,payment_method,amount,currency_code,
       provider_key,idempotency_key,status,initiated_by,initiated_at,created_by,attempt_status,verification_status,terminal_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'initiated',$10,now(),$10,'created','unresolved',$11)
     RETURNING *`,
    [
      context.organizationId,
      cart.id,
      cart.store_id,
      cart.shift_id,
      method,
      asDatabaseDecimal(amount),
      cart.currency_code || storeRow.currency_code,
      providerKey,
      idempotency.key,
      context.userId,
      cart.terminal_id,
    ],
  );
  const paymentRow = inserted.rows[0];

  let outcome;
  try {
    outcome = await adapter.initiate(context, {
      amount: asDatabaseDecimal(amount),
      currency: paymentRow.currency_code,
      method,
      merchantReference: paymentRow.id,
      // Test/dev-only scripting instruction -- see the file header comment.
      outcome: input.outcome,
    });
  } catch (error) {
    if (error instanceof PaymentAdapterError) throw error;
    // Card Payments (0093): no answer is not a "no" -- the attempt is UNKNOWN until the provider is asked again (never failed, never retried).
    const unknown = await applyProviderStatus(client, context, { ...paymentRow, attempt_status: "created" }, { status: "unknown", source: "initiate_timeout" });
    await event(client, context, "payment", paymentRow.id, "pos.payment.initiated", { method, amount: asDatabaseDecimal(amount), status: "unknown" });
    const response = { ...unknown, replayed: false };
    await completeIdempotentOperation(client, context, idempotency, { response, aggregateType: "pos_payment", aggregateId: paymentRow.id });
    return response;
  }

  const applied = await applyProviderStatus(client, context, { ...paymentRow, attempt_status: "created" }, {
    status: outcome.providerStatus ?? outcome.status, providerReference: outcome.providerReference, card: outcome.card, failureCode: outcome.failureCode, source: "initiate" });
  const updated = { rows: [(await client.query(
    `UPDATE tenant.pos_payments SET failure_reason=COALESCE($3, failure_reason) WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [context.organizationId, applied.id, outcome.failureReason || null])).rows[0]] };
  await event(client, context, "payment", paymentRow.id, "pos.payment.initiated", { method, amount: asDatabaseDecimal(amount), status: updated.rows[0].status });

  const response = { ...updated.rows[0], replayed: false };
  await completeIdempotentOperation(client, context, idempotency, { response, aggregateType: "pos_payment", aggregateId: paymentRow.id });
  return response;
}

export async function getPosPaymentStatus(client, context, paymentId) {
  requirePermission(context, "pos.view");
  const result = await client.query(
    `SELECT * FROM tenant.pos_payments WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, paymentId],
  );
  if (!result.rows[0]) throw posError(404, "POS payment was not found.", "POS_PAYMENT_NOT_FOUND");
  return result.rows[0];
}

// A cashier may abandon a card/UPI tender before it is ever consumed by a
// completed sale (terminal glitch, customer changed their mind). Only a
// leg that never reached a real captured state may be voided this way --
// a captured leg must instead be refunded (through the refund service), which is
// the only path that ever moves real captured money.
export async function voidPosPayment(client, context, paymentId) {
  requirePermission(context, "pos.sale.create");
  const locked = await client.query(
    `SELECT * FROM tenant.pos_payments WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
    [context.organizationId, paymentId],
  );
  const payment = locked.rows[0];
  if (!payment) throw posError(404, "POS payment was not found.", "POS_PAYMENT_NOT_FOUND");
  await assertPosAction(client, context, { permission: "PAYMENT_VOID_PENDING", outletId: payment.store_id });
  if (payment.sale_id) throw posError(409, "A payment already attached to a completed sale cannot be voided.", "POS_PAYMENT_ALREADY_CONSUMED");
  // Cash in hand is handed back (and recorded), never just voided: returnPosCashTender.
  if (payment.payment_method === "cash") throw posError(409, "Return the retained cash to cancel this payment.", "POS_CASH_RETURN_REQUIRED");
  if (!["initiated", "pending", "authorized", "failed"].includes(payment.status)) {
    throw posError(409, `A ${payment.status} payment cannot be voided; refund it instead.`, "POS_PAYMENT_VOID_INVALID_STATE");
  }
  // Card Payments (0093): a provider attempt still in progress is cancelled through the provider -- a request, not proof. Until the
  // provider confirms it, the attempt is cancel_pending and the bill stays locked; if the provider says it was captured, it was.
  if (payment.provider_key !== "standalone" && ["created", "awaiting_customer", "processing", "authorized", "capture_pending", "unknown", "cancel_pending"].includes(payment.attempt_status)) {
    const adapter = resolvePaymentAdapter(payment.provider_key);
    let answer = { status: "cancel_pending" };
    if (adapter.cancel) answer = await adapter.cancel(context, { merchantReference: payment.id, providerReference: payment.provider_reference }).catch(() => ({ status: "cancel_pending" }));
    const applied = await applyProviderStatus(client, context, payment, { status: answer.status, source: "void" });
    await event(client, context, "payment", paymentId, "pos.payment.void_requested", { answer: answer.status });
    return applied;
  }
  const updated = await client.query(
    `UPDATE tenant.pos_payments SET status='voided',voided_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [context.organizationId, paymentId],
  );
  await event(client, context, "payment", paymentId, "pos.payment.voided", {});
  return updated.rows[0];
}

// F283/F284/F285/F286 webhook receiver -- the ONLY path (besides an
// adapter's own synchronous initiate() response) that may ever move a
// payment out of 'pending'/'authorized' into 'captured'/'failed'. Verifies
// the provider's signature itself, dedupes by the provider's OWN event id
// (a different idempotency axis than any command idempotency key -- a
// redelivered event is a detectable no-op, not reprocessed), and only
// transitions a payment that is still in a non-terminal state.
export async function handlePosPaymentWebhook(client, { providerKey, rawBody, signatureHeader } = {}) {
  const adapter = resolvePaymentAdapter(providerKey);
  if (!adapter.verifyWebhookSignature(rawBody, signatureHeader)) {
    throw posError(401, "The webhook signature could not be verified.", "POS_PAYMENT_WEBHOOK_SIGNATURE_INVALID");
  }
  let parsedEvent;
  try {
    parsedEvent = adapter.parseWebhookEvent(rawBody);
  } catch {
    throw posError(400, "The webhook payload could not be parsed.", "POS_PAYMENT_WEBHOOK_PAYLOAD_INVALID");
  }
  if (!parsedEvent.eventId || !parsedEvent.organizationId || !parsedEvent.paymentId) {
    throw posError(400, "The webhook payload is missing required fields.", "POS_PAYMENT_WEBHOOK_PAYLOAD_INVALID");
  }

  const dedupe = await client.query(
    `INSERT INTO tenant.pos_payment_webhook_events (organization_id,provider_key,event_id,event_type,payment_id,payload)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)
     ON CONFLICT (organization_id,provider_key,event_id) DO NOTHING
     RETURNING id`,
    [
      parsedEvent.organizationId,
      providerKey,
      parsedEvent.eventId,
      parsedEvent.eventType || "payment.updated",
      parsedEvent.paymentId,
      JSON.stringify(parsedEvent.raw || {}),
    ],
  );
  if (!dedupe.rows[0]) {
    // A redelivery of an event id we have already recorded -- a no-op,
    // never an error and never reprocessed.
    return { replayed: true, event: parsedEvent };
  }

  const locked = await client.query(
    `SELECT * FROM tenant.pos_payments
     WHERE organization_id=$1 AND id=$2 AND provider_key=$3
     FOR UPDATE`,
    [parsedEvent.organizationId, parsedEvent.paymentId, providerKey],
  );
  const payment = locked.rows[0];
  if (!payment) {
    // The event was still recorded above (so a future identical
    // redelivery is still deduped); there is simply no matching payment
    // to transition.
    return { replayed: false, event: parsedEvent, payment: null };
  }
  if (payment.payment_method === "cash") return { replayed: false, event: parsedEvent, payment: null };
  if (parsedEvent.providerReference && payment.provider_reference && parsedEvent.providerReference !== payment.provider_reference) {
    // A notification for another provider transaction never completes this one. If it is money received (the customer paid twice, or a
    // second payment against the same request), it is kept as an exception for reconciliation and refund -- never ignored, never applied.
    if (["captured", "succeeded", "paid", "success"].includes(String(parsedEvent.status ?? "").toLowerCase())) {
      await recordPaymentException(client, { organizationId: parsedEvent.organizationId, userId: null }, payment, payment.attempt_status === "captured" ? "duplicate" : "conflicting", {
        providerReference: parsedEvent.providerReference, transactionReference: parsedEvent.transactionReference ?? null, amount: parsedEvent.amount ?? null,
        detail: "A second provider payment arrived for this request." });
    }
    return { replayed: false, event: parsedEvent, payment: null };
  }
  // Card Payments (0093): the shared rules -- a capture is never downgraded by a late or older event, an amount or currency that does not
  // match becomes reconciliation, a capture after a decline is flagged, never guessed.
  const applied = await applyProviderStatus(client, { organizationId: parsedEvent.organizationId, userId: null }, payment, {
    status: parsedEvent.status, providerReference: parsedEvent.providerReference, amount: parsedEvent.amount, currency: parsedEvent.currency, card: parsedEvent.card,
    transactionReference: parsedEvent.transactionReference ?? null, merchantAccount: parsedEvent.merchantAccount ?? null, instrument: parsedEvent.instrument ?? null, source: "webhook" });
  const nextStatus = applied.status;
  const updated = { rows: [applied] };
  await client.query(
    `UPDATE tenant.pos_payment_webhook_events SET payment_id=$2 WHERE organization_id=$1 AND provider_key=$3 AND event_id=$4`,
    [parsedEvent.organizationId, payment.id, providerKey, parsedEvent.eventId],
  );
  await event(
    client,
    { organizationId: parsedEvent.organizationId, userId: null },
    "payment",
    payment.id,
    "pos.payment.webhook_received",
    { eventId: parsedEvent.eventId, status: nextStatus },
  );
  return { replayed: false, event: parsedEvent, payment: updated.rows[0] };
}

// Refunds are made only through the refund service (refunds.js, migration 0100): always for an authorized source — never an amount on a payment.
// Manual force-capture override (SEM-04 segregation of duties): used only
// when a provider is genuinely unreachable and a supervisor/manager
// chooses to accept the tender manually pending later reconciliation. This
// NEVER bypasses approval -- it creates a real row in the platform's
// existing maker-checker inbox (public.approval_requests) via the SAME
// engine every other module's approval flows use
// (services/api/src/core/approvals.js), which blocks the requester from
// also being the approver.
export async function requestPosPaymentOverride(client, context, input = {}) {
  requirePermission(context, "pos.payment.override");
  if (!input.paymentId) throw posError(400, "A payment id is required to request an override.", "POS_OVERRIDE_PAYMENT_REQUIRED");
  if (!input.reason || !String(input.reason).trim()) {
    throw posError(400, "An override reason is required.", "POS_OVERRIDE_REASON_REQUIRED");
  }
  const locked = await client.query(
    `SELECT * FROM tenant.pos_payments WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
    [context.organizationId, input.paymentId],
  );
  const payment = locked.rows[0];
  if (!payment) throw posError(404, "POS payment was not found.", "POS_PAYMENT_NOT_FOUND");
  if (payment.sale_id) throw posError(409, "A payment already attached to a completed sale cannot be overridden.", "POS_PAYMENT_ALREADY_CONSUMED");
  if (!["initiated", "pending", "failed"].includes(payment.status)) {
    throw posError(409, `A ${payment.status} payment is not eligible for a manual override.`, "POS_OVERRIDE_STATE_INVALID");
  }

  const approval = await createApprovalRequest(client, {
    organizationId: context.organizationId,
    commandKey: "pos.payment.override.approve",
    entityId: payment.id,
    title: `Manually accept ${payment.payment_method} payment of ${asDatabaseDecimal(decimal(payment.amount))}`,
    requestedBy: context.userId,
    payload: { paymentId: payment.id, reason: String(input.reason).trim() },
  });
  await event(client, context, "payment", payment.id, "pos.payment.override_requested", { reason: String(input.reason).trim() });
  return { paymentId: payment.id, approvalRequest: { id: approval.id, status: approval.status, version: approval.version } };
}

// These two functions are invoked from the GLOBAL cross-module approval
// inbox (services/api/src/core/approvals.js); the payment row is re-read
// and locked here, never trusted from the approval payload alone --
// context.organizationId is still the caller's, verified by RLS.
export async function approvePosPaymentOverride(client, context, payload = {}) {
  requirePermission(context, "pos.payment.override");
  const locked = await client.query(
    `SELECT * FROM tenant.pos_payments WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
    [context.organizationId, payload.paymentId],
  );
  const payment = locked.rows[0];
  if (!payment) throw posError(404, "POS payment was not found.", "POS_PAYMENT_NOT_FOUND");
  if (!["initiated", "pending", "failed"].includes(payment.status)) {
    throw posError(409, `A ${payment.status} payment is not eligible for a manual override.`, "POS_OVERRIDE_STATE_INVALID");
  }
  const updated = await client.query(
    `UPDATE tenant.pos_payments
     SET status='captured',provider_reference=coalesce(provider_reference,'manual-override'),
         failure_reason=NULL,captured_at=now(),updated_at=now()
     WHERE organization_id=$1 AND id=$2
     RETURNING *`,
    [context.organizationId, payment.id],
  );
  await finalizeApprovalRequest(client, {
    organizationId: context.organizationId, commandKey: "pos.payment.override.approve", entityId: payment.id, decision: "approved", actorUserId: context.userId,
  });
  await event(client, context, "payment", payment.id, "pos.payment.override_approved", {
    reason: payload.reason || null,
  });
  return updated.rows[0];
}

export async function rejectPosPaymentOverrideApproval(client, context, payload = {}) {
  const locked = await client.query(
    `SELECT * FROM tenant.pos_payments WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
    [context.organizationId, payload.paymentId],
  );
  const payment = locked.rows[0];
  if (!payment) throw posError(404, "POS payment was not found.", "POS_PAYMENT_NOT_FOUND");
  const updated = await client.query(
    `UPDATE tenant.pos_payments
     SET status='failed',failure_reason='Manual override request was rejected.',updated_at=now()
     WHERE organization_id=$1 AND id=$2
     RETURNING *`,
    [context.organizationId, payment.id],
  );
  await finalizeApprovalRequest(client, {
    organizationId: context.organizationId, commandKey: "pos.payment.override.approve", entityId: payment.id, decision: "rejected", actorUserId: context.userId, note: payload.note ?? null,
  });
  await event(client, context, "payment", payment.id, "pos.payment.override_rejected", {});
  return updated.rows[0];
}

// Locks and validates every non-cash leg a completePosCart caller
// referenced by paymentId: each must belong to THIS cart, match the
// claimed method, be genuinely captured, and not already be consumed by a
// different sale. Returns the locked rows so index.js can attach
// sale_id=<the new sale> to each of them inside the same transaction.
export async function lockCapturedCartPaymentLegs(client, context, cartId, legs) {
  const locked = [];
  for (const leg of legs) {
    const result = await client.query(
      `SELECT * FROM tenant.pos_payments
       WHERE organization_id=$1 AND id=$2 AND cart_id=$3 AND payment_method=$4
       FOR UPDATE`,
      [context.organizationId, leg.paymentId, cartId, leg.method],
    );
    const payment = result.rows[0];
    if (!payment) {
      throw posError(404, `No ${leg.method} payment attempt ${leg.paymentId} was found on this cart.`, "POS_PAYMENT_NOT_FOUND");
    }
    if (payment.sale_id) {
      throw posError(409, "This payment has already been used to complete a different sale.", "POS_PAYMENT_ALREADY_CONSUMED");
    }
    if (payment.status !== "captured") {
      throw posError(
        409,
        `The ${leg.method} payment has not completed successfully yet (status: ${payment.status}). Wait for it to capture before completing the sale.`,
        "POS_PAYMENT_NOT_CAPTURED",
      );
    }
    locked.push(payment);
  }
  return locked;
}
