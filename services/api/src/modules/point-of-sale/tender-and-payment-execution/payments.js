// F283 (card) / F284 (UPI/digital) / F285 (split tender) / F286 (multiple
// payment methods) -- the ONE payment-tender domain module every non-cash
// tender flows through. Cash stays exactly as it already worked in
// index.js's completePosCart/completePointOfSale (immediately final, no
// provider involved); everything here is additive.
//
// Absolute rules enforced throughout this file (see the task brief this
// was built from for the full rationale):
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
import { posError } from "../shared/errors.js";
import { requirePermission } from "../shared/access-control.js";
import { event } from "../shared/audit.js";

// Re-exported so the web app's webhook route (which must resolve+verify an
// adapter BEFORE it knows which organization's tenant client to open) can
// import it from the same public @vercentlabs/api surface as everything
// else in this module, without reaching into services/api's internal
// tender-and-payment-execution/adapter.js path.
export { resolvePaymentAdapter, PaymentAdapterError };

const NON_CASH_METHODS = Object.freeze(["card", "upi", "wallet", "bank_transfer"]);
const TERMINAL_STATUSES = Object.freeze(["captured", "failed", "voided", "refunded", "partially_refunded"]);

async function lockOpenCart(client, context, cartId) {
  const result = await client.query(
    `SELECT cart.*, store.currency_code AS store_currency_code
     FROM tenant.pos_carts cart
     JOIN tenant.pos_stores store ON store.organization_id=cart.organization_id AND store.id=cart.store_id
     WHERE cart.organization_id=$1 AND cart.company_id=$2 AND cart.id=$3
     FOR UPDATE OF cart`,
    [context.organizationId, context.companyId, cartId],
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

  const store = await client.query(
    `SELECT id,allowed_payment_methods,currency_code FROM tenant.pos_stores WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, cart.store_id],
  );
  const storeRow = store.rows[0];
  if (!storeRow || !(storeRow.allowed_payment_methods || []).includes(method)) {
    throw posError(409, `Payment method "${method}" is not enabled for this store.`, "POS_PAYMENT_METHOD_NOT_ALLOWED");
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
      (organization_id,company_id,cart_id,store_id,shift_id,payment_method,amount,currency_code,
       provider_key,idempotency_key,status,initiated_by,initiated_at,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'initiated',$11,now(),$11)
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      cart.id,
      cart.store_id,
      cart.shift_id,
      method,
      asDatabaseDecimal(amount),
      cart.currency_code || storeRow.currency_code,
      providerKey,
      idempotency.key,
      context.userId,
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
    await client.query(
      `UPDATE tenant.pos_payments SET status='failed',failure_reason=$3,updated_at=now() WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, paymentRow.id, String(error.message || "Provider error.")],
    );
    throw posError(502, "The payment provider could not be reached.", "POS_PAYMENT_PROVIDER_UNAVAILABLE");
  }

  const status = ["pending", "authorized", "captured", "failed"].includes(outcome.status) ? outcome.status : "pending";
  const updated = await client.query(
    `UPDATE tenant.pos_payments
     SET status=$3,provider_reference=$4,failure_reason=$5,
         captured_at=CASE WHEN $3='captured' THEN now() ELSE captured_at END,
         updated_at=now()
     WHERE organization_id=$1 AND id=$2
     RETURNING *`,
    [context.organizationId, paymentRow.id, status, outcome.providerReference || null, outcome.failureReason || null],
  );
  await event(client, context, "payment", paymentRow.id, "pos.payment.initiated", { method, amount: asDatabaseDecimal(amount), status });

  const response = { ...updated.rows[0], replayed: false };
  await completeIdempotentOperation(client, context, idempotency, { response, aggregateType: "pos_payment", aggregateId: paymentRow.id });
  return response;
}

export async function getPosPaymentStatus(client, context, paymentId) {
  requirePermission(context, "pos.view");
  const result = await client.query(
    `SELECT * FROM tenant.pos_payments WHERE organization_id=$1 AND company_id=$2 AND id=$3`,
    [context.organizationId, context.companyId, paymentId],
  );
  if (!result.rows[0]) throw posError(404, "POS payment was not found.", "POS_PAYMENT_NOT_FOUND");
  return result.rows[0];
}

// A cashier may abandon a card/UPI tender before it is ever consumed by a
// completed sale (terminal glitch, customer changed their mind). Only a
// leg that never reached a real captured state may be voided this way --
// a captured leg must instead be refunded (refundPosPayment), which is
// the only path that ever moves real captured money.
export async function voidPosPayment(client, context, paymentId) {
  requirePermission(context, "pos.sale.create");
  const locked = await client.query(
    `SELECT * FROM tenant.pos_payments WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`,
    [context.organizationId, context.companyId, paymentId],
  );
  const payment = locked.rows[0];
  if (!payment) throw posError(404, "POS payment was not found.", "POS_PAYMENT_NOT_FOUND");
  if (payment.sale_id) throw posError(409, "A payment already attached to a completed sale cannot be voided.", "POS_PAYMENT_ALREADY_CONSUMED");
  if (!["initiated", "pending", "authorized", "failed"].includes(payment.status)) {
    throw posError(409, `A ${payment.status} payment cannot be voided; refund it instead.`, "POS_PAYMENT_VOID_INVALID_STATE");
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
  if (!parsedEvent.eventId || !parsedEvent.organizationId || !parsedEvent.companyId || !parsedEvent.paymentId) {
    throw posError(400, "The webhook payload is missing required fields.", "POS_PAYMENT_WEBHOOK_PAYLOAD_INVALID");
  }

  const dedupe = await client.query(
    `INSERT INTO tenant.pos_payment_webhook_events (organization_id,company_id,provider_key,event_id,event_type,payment_id,payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
     ON CONFLICT (organization_id,provider_key,event_id) DO NOTHING
     RETURNING id`,
    [
      parsedEvent.organizationId,
      parsedEvent.companyId,
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
     WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND provider_key=$4
     FOR UPDATE`,
    [parsedEvent.organizationId, parsedEvent.companyId, parsedEvent.paymentId, providerKey],
  );
  const payment = locked.rows[0];
  if (!payment) {
    // The event was still recorded above (so a future identical
    // redelivery is still deduped); there is simply no matching payment
    // to transition.
    return { replayed: false, event: parsedEvent, payment: null };
  }
  if (TERMINAL_STATUSES.includes(payment.status)) {
    // Already in a terminal state (e.g. a second, different event id for
    // an already-captured payment) -- a no-op, never a double effect.
    return { replayed: false, event: parsedEvent, payment };
  }

  const nextStatus = ["pending", "authorized", "captured", "failed"].includes(parsedEvent.status) ? parsedEvent.status : payment.status;
  const updated = await client.query(
    `UPDATE tenant.pos_payments
     SET status=$3,
         provider_reference=coalesce(provider_reference,$4),
         failure_reason=$5,
         captured_at=CASE WHEN $3='captured' THEN now() ELSE captured_at END,
         updated_at=now()
     WHERE organization_id=$1 AND id=$2
     RETURNING *`,
    [parsedEvent.organizationId, payment.id, nextStatus, parsedEvent.providerReference || null, parsedEvent.failureReason || null],
  );
  await client.query(
    `UPDATE tenant.pos_payment_webhook_events SET payment_id=$2 WHERE organization_id=$1 AND provider_key=$3 AND event_id=$4`,
    [parsedEvent.organizationId, payment.id, providerKey, parsedEvent.eventId],
  );
  await event(
    client,
    { organizationId: parsedEvent.organizationId, companyId: parsedEvent.companyId, userId: null },
    "payment",
    payment.id,
    "pos.payment.webhook_received",
    { eventId: parsedEvent.eventId, status: nextStatus },
  );
  return { replayed: false, event: parsedEvent, payment: updated.rows[0] };
}

// F283/F284/F285/F286 refund -- routes back to the ORIGINAL captured
// payment's own provider reference and tender method, never an
// alternate/default method. Idempotent on retry; cannot exceed the
// captured (minus already-refunded) amount.
export async function refundPosPayment(client, context, input = {}) {
  requirePermission(context, "pos.payment.refund");
  if (!input.paymentId) throw posError(400, "A payment id is required to refund.", "POS_REFUND_PAYMENT_REQUIRED");
  const amount = decimal(input.amount);
  if (amount <= 0n) throw posError(400, "Refund amount must be greater than zero.", "POS_REFUND_AMOUNT_INVALID");

  const idempotency = await beginIdempotentOperation(client, context, {
    operation: "pos.payment.refund",
    key: input.idempotencyKey,
    payload: { paymentId: input.paymentId, amount: asDatabaseDecimal(amount) },
    required: true,
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };

  const locked = await client.query(
    `SELECT * FROM tenant.pos_payments WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`,
    [context.organizationId, context.companyId, input.paymentId],
  );
  const payment = locked.rows[0];
  if (!payment) throw posError(404, "POS payment was not found.", "POS_PAYMENT_NOT_FOUND");
  if (payment.payment_method === "cash") {
    throw posError(409, "Refund a cash tender through the POS return workflow, not this endpoint.", "POS_REFUND_USE_RETURN_WORKFLOW");
  }
  if (!["captured", "partially_refunded"].includes(payment.status)) {
    throw posError(409, `A ${payment.status} payment cannot be refunded.`, "POS_REFUND_STATE_INVALID");
  }
  const capturedAmount = decimal(payment.amount);
  const alreadyRefunded = decimal(payment.refunded_amount || 0);
  const refundable = sub(capturedAmount, alreadyRefunded);
  if (amount > refundable) {
    throw posError(
      409,
      `Refund of ${asDatabaseDecimal(amount)} exceeds the remaining refundable amount of ${asDatabaseDecimal(refundable)}.`,
      "POS_REFUND_EXCEEDS_CAPTURED",
    );
  }

  const adapter = resolvePaymentAdapter(payment.provider_key);
  const providerResult = await adapter.refund(context, {
    providerReference: payment.provider_reference,
    amount: asDatabaseDecimal(amount),
    currency: payment.currency_code,
    outcome: input.outcome,
  });

  const newRefundedAmount = add(alreadyRefunded, amount);
  const fullyRefunded = newRefundedAmount >= capturedAmount;
  const updated = await client.query(
    `UPDATE tenant.pos_payments
     SET refunded_amount=$3,status=$4,updated_at=now()
     WHERE organization_id=$1 AND id=$2
     RETURNING *`,
    [context.organizationId, payment.id, asDatabaseDecimal(newRefundedAmount), fullyRefunded ? "refunded" : "partially_refunded"],
  );
  await event(client, context, "payment", payment.id, "pos.payment.refunded", {
    amount: asDatabaseDecimal(amount),
    providerRefundReference: providerResult.providerRefundReference,
  });

  const response = { ...updated.rows[0], providerRefundReference: providerResult.providerRefundReference, replayed: false };
  await completeIdempotentOperation(client, context, idempotency, { response, aggregateType: "pos_payment", aggregateId: payment.id });
  return response;
}

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
    `SELECT * FROM tenant.pos_payments WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`,
    [context.organizationId, context.companyId, input.paymentId],
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

// NOTE on context.companyId here: these two functions are invoked from the
// GLOBAL cross-module approval inbox (services/api/src/core/approvals.js),
// whose moduleContext() builds { activeCompanyId, ... } rather than the
// { companyId, ... } shape every other POS domain function expects (POS
// always scopes to exactly one active company, unlike modules with an
// allowAllCompanies fallback). Rather than depend on a field that may not
// be populated the way POS expects, the payment's OWN company_id (read
// back from the locked row, which is unambiguous and already
// organization-scoped) is what every subsequent query and event() call
// uses -- context.organizationId is still the caller's, verified by RLS.
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
  await event(client, { organizationId: context.organizationId, companyId: payment.company_id, userId: context.userId }, "payment", payment.id, "pos.payment.override_approved", {
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
  await event(client, { organizationId: context.organizationId, companyId: payment.company_id, userId: context.userId }, "payment", payment.id, "pos.payment.override_rejected", {});
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
       WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND cart_id=$4 AND payment_method=$5
       FOR UPDATE`,
      [context.organizationId, context.companyId, leg.paymentId, cartId, leg.method],
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
