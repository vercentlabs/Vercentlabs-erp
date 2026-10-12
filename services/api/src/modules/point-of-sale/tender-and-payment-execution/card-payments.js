// POS Card Payments (migration 0093): debit and credit cards through the outlet's acquiring provider. The cashier picks Card and a payment
// terminal; the server works out the amount (what is still due, never a client total), locks the terminal so no other checkout can drive
// it, and asks the provider to collect. The sale is finalised only when the provider confirms the payment is captured — a terminal display,
// a browser callback or a cashier's word is never proof. A timeout is UNKNOWN: the bill stays locked, the status is asked again, and a
// second charge is never started until the first is resolved. A captured card whose sale cannot be finalised stays captured: the sale is
// retried, or the card is refunded through the provider — never marked failed.
//
// Where the merchant explicitly allows it, a payment taken on a standalone bank card machine can be recorded with the machine's approval
// reference: it is EXTERNALLY ATTESTED (never "bank verified"), counts towards the sale only if provisional acceptance is on, and must be
// confirmed by settlement reconciliation. Card numbers, CVV, PIN and track data never touch this system: only provider references and
// masked metadata (network, type, last four).
import { add, sub, decimal, asDatabaseDecimal, formatDecimal } from "../../../core/decimal.js";
import { createPosRefund, executePosRefund } from "./refunds.js";
import { beginIdempotentOperation, completeIdempotentOperation } from "../../../core/idempotency.js";
import { isTerminalPaymentMethodEnabled } from "../terminals/index.js";
import { assertPosAction } from "../permissions/index.js";
import { ensurePosCheckoutStarted } from "../assortment-pricing-customer-and-cart/cart.js";
import { completePosCart } from "../assortment-pricing-customer-and-cart/sale-completion.js";
import { markPosStockRecovery } from "../inventory-and-offline-continuity/stock-reduction.js";
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess, accessiblePosStoreIds } from "../shared/access-control.js";
import { event } from "../shared/audit.js";
import { resolvePaymentAdapter, PaymentAdapterError } from "./adapter.js";
import { assertSplitAllowed, loadCheckout } from "./cash-payments.js";
import { applyProviderStatus, CARD_MESSAGES, FINAL_ATTEMPT_STATUSES, LIVE_ATTEMPT_STATUSES } from "./card-status.js";

export const POS_CARD_MESSAGES = Object.freeze({
  POS_CARD_PAYMENT_DISABLED: "Card payments are not available at this counter.",
  POS_CARD_PROVIDER_NOT_READY: "Card payments are not set up for this outlet yet.",
  POS_CARD_TERMINAL_REQUIRED: "Choose a card terminal.",
  POS_CARD_TERMINAL_UNAVAILABLE: "This card terminal is not available.",
  POS_CARD_TERMINAL_BUSY: "This card terminal is busy with another payment.",
  POS_CARD_PAYMENT_IN_PROGRESS: "A card payment on this bill is still in progress. Check its status first.",
  POS_CARD_AMOUNT_INVALID: "The card amount is not valid for this bill.",
  POS_CARD_AMOUNT_LIMIT_EXCEEDED: "The card amount is above the allowed limit.",
  POS_CARD_SESSION_CLOSED: "This POS session is closed.",
  POS_CARD_PERMISSION_DENIED: "You cannot take this card payment.",
  POS_CARD_ALREADY_CAPTURED: "This card payment was captured. Refund it instead of cancelling.",
  POS_CARD_CANCEL_NOT_ALLOWED: "This card payment cannot be cancelled now.",
  POS_CARD_STANDALONE_DISABLED: "Recording payments from a standalone card machine is not enabled.",
  POS_CARD_REFERENCE_REQUIRED: "Enter the card machine's approval reference.",
  POS_CARD_DUPLICATE_REFERENCE: "This card machine reference was already recorded.",
  POS_CARD_ATTESTATION_REQUIRED: "Confirm that the card machine showed the payment as approved.",
  POS_CARD_APPROVAL_REQUIRED: "A supervisor must approve recording this card payment.",
  POS_CARD_NOT_FINALIZABLE: "The card payment is not confirmed yet.",
  POS_CARD_REFUND_NOT_ALLOWED: "This card payment cannot be refunded here.",
  POS_CARD_ATTEMPT_NOT_FOUND: "Card payment attempt not found.",
  POS_CARD_IDEMPOTENCY_CONFLICT: "This payment request conflicts with an earlier request.",
  POS_CARD_VERSION_CONFLICT: "This checkout changed. Refresh its status.",
});

const cardError = (status, code, message = POS_CARD_MESSAGES[code], details = undefined) => {
  const error = posError(status, message, code);
  if (details) error.details = details;
  return error;
};
const money = (value) => formatDecimal(decimal(value ?? 0), 2);

async function cardConfig(client, context, storeId) {
  return (await client.query(
    `SELECT * FROM tenant.pos_payment_provider_configs WHERE organization_id=$1 AND store_id=$2 AND payment_method='card' AND active=true`,
    [context.organizationId, storeId])).rows[0] ?? null;
}

const terminalView = (terminal) => (terminal ? {
  id: terminal.id, name: terminal.name, storeId: terminal.store_id, providerKey: terminal.provider_key, merchantAccountReference: terminal.merchant_account_reference,
  providerTerminalReference: terminal.provider_terminal_reference, integrationMode: terminal.integration_mode, status: terminal.status,
  connectionStatus: terminal.connection_status, busy: Boolean(terminal.active_payment_id), activePaymentId: terminal.active_payment_id ?? null, version: terminal.version,
} : null);

export const attemptView = (payment, terminal = null) => (payment ? {
  attemptId: payment.id, paymentId: payment.id, method: payment.payment_method,
  // An expired request whose outcome the provider has not settled shows EXPIRED: not failed, and still blocking a second request.
  status: payment.request_status === "expired" && LIVE_ATTEMPT_STATUSES.includes(payment.attempt_status) ? "EXPIRED" : String(payment.attempt_status ?? payment.status).toUpperCase(),
  verificationStatus: payment.verification_status ? String(payment.verification_status).toUpperCase() : null,
  amount: money(payment.amount), currency: payment.currency_code, providerReference: payment.provider_reference ?? null, externalReference: payment.external_reference ?? null,
  terminalId: payment.payment_terminal_id ?? null, terminalLabel: terminal?.name ?? null,
  card: payment.card_last_four || payment.card_network ? { network: payment.card_network, type: payment.card_type, masked: payment.card_last_four ? `**** ${payment.card_last_four}` : null } : null,
  message: payment.display_message ?? CARD_MESSAGES[payment.attempt_status] ?? null, saleId: payment.sale_id ?? null,
  recoveryStatus: payment.recovery_status ?? null, refundedAmount: money(payment.refunded_amount),
  mode: payment.payment_mode ?? null, instrument: payment.instrument ?? null, transactionReference: payment.provider_transaction_reference ?? null,
  receivedAmount: payment.received_amount === null || payment.received_amount === undefined ? null : money(payment.received_amount),
  qr: payment.qr_payload || payment.qr_image_url ? { payload: payment.qr_payload ?? null, imageUrl: payment.qr_image_url ?? null } : null, paymentLinkUrl: payment.payment_link_url ?? null,
  requestReference: payment.payment_request_reference ?? null, expiresAt: payment.expires_at ?? null, requestStatus: payment.request_status ?? null,
  createdAt: payment.initiated_at, resolvedAt: payment.resolved_at ?? null,
} : null);

// The card devices of an outlet and whether each is free.
export async function listPosPaymentTerminals(client, context, input = {}) {
  requirePermission(context, "pos.view");
  const values = [context.organizationId];
  let filter = "";
  if (input.storeId) { await assertPosStoreAccess(client, context, input.storeId); values.push(input.storeId); filter = ` AND store_id=$${values.length}`; }
  else {
    const stores = await accessiblePosStoreIds(client, context);
    if (stores) { values.push(stores); filter = ` AND store_id = ANY($${values.length}::uuid[])`; }
  }
  const rows = (await client.query(`SELECT * FROM tenant.pos_payment_terminals WHERE organization_id=$1${filter} ORDER BY name`, values)).rows;
  return rows.map(terminalView);
}

// Register or change a card device (administrators only — never a cashier). input: storeId, name, providerKey, providerTerminalReference,
// merchantAccountReference, integrationMode, status, expectedVersion.
export async function savePosPaymentTerminal(client, context, input = {}) {
  requirePermission(context, "pos.settings.manage");
  const name = String(input.name ?? "").trim();
  const reference = String(input.providerTerminalReference ?? "").trim();
  if (!name || !reference) throw posError(400, "A terminal needs a name and the provider's device reference.", "POS_CARD_TERMINAL_INVALID");
  const mode = input.integrationMode === "standalone" ? "standalone" : "integrated";
  if (input.id) {
    const updated = (await client.query(
      `UPDATE tenant.pos_payment_terminals SET name=$3, provider_terminal_reference=$4, merchant_account_reference=$5, integration_mode=$6, status=$7, version=version+1,
              updated_by=$8, updated_at=now() WHERE organization_id=$1 AND id=$2 AND ($9::int IS NULL OR version=$9) RETURNING *`,
      [context.organizationId, input.id, name, reference, input.merchantAccountReference ?? null, mode, input.status === "disabled" ? "disabled" : "active", context.userId,
        input.expectedVersion ?? null])).rows[0];
    if (!updated) throw posError(409, "This terminal changed. Refresh and try again.", "POS_CARD_TERMINAL_VERSION_CONFLICT");
    await event(client, context, "payment_terminal", updated.id, "pos.payment_terminal.updated", { name, mode, status: updated.status });
    return terminalView(updated);
  }
  await assertPosStoreAccess(client, context, input.storeId);
  const created = (await client.query(
    `INSERT INTO tenant.pos_payment_terminals (organization_id, store_id, provider_key, merchant_account_reference, provider_terminal_reference, name, integration_mode, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`,
    [context.organizationId, input.storeId, String(input.providerKey ?? "sandbox").trim().toLowerCase(), input.merchantAccountReference ?? null, reference, name, mode, context.userId])).rows[0];
  await event(client, context, "payment_terminal", created.id, "pos.payment_terminal.created", { name, mode });
  return terminalView(created);
}

// Finalise the bill with everything confirmed on it — cash in hand and captured card / UPI payments — through the one checkout path, inside a
// savepoint: if it fails, the payments stay as they are (a captured card is marked for recovery, never failed).
export async function finalizeCheckout(client, context, cartId, key) {
  const state = await loadCheckout(client, context, cartId, { lock: true });
  if (state.cart.status === "completed") return { sale: { id: state.cart.completed_sale_id }, error: null, already: true };
  if (state.due > 0n || state.pendingNonCash.length) return { sale: null, error: null, waiting: true };
  const legs = [
    ...(state.pendingCash && state.pendingCash.custody_status === "pending" ? [{ method: "cash", paymentId: state.pendingCash.id }] : []),
    ...state.captured.map((payment) => ({ method: payment.payment_method, paymentId: payment.id })),
  ];
  if (!legs.length) return { sale: null, error: null, waiting: true };
  await client.query("SAVEPOINT pos_card_finalize");
  try {
    const sale = await completePosCart(client, context, cartId, { payments: legs, idempotencyKey: `${key}:finalize` });
    await client.query("RELEASE SAVEPOINT pos_card_finalize");
    await client.query(`UPDATE tenant.pos_payments SET recovery_status=CASE WHEN recovery_status='finalization_failed' THEN 'resolved' ELSE recovery_status END
                         WHERE organization_id=$1 AND sale_id=$2`, [context.organizationId, sale.id]);
    return { sale, error: null };
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT pos_card_finalize");
    await client.query("RELEASE SAVEPOINT pos_card_finalize");
    const failure = { code: error.code ?? "POS_SALE_FINALIZATION_FAILED", message: error.message };
    // Stock Reduction: a paid bill whose sale could not take its stock is marked for stock recovery (payments kept).
    await markPosStockRecovery(client, context, cartId, failure);
    for (const payment of state.captured.filter((row) => row.payment_method === "card")) {
      await client.query(`UPDATE tenant.pos_payments SET recovery_status='finalization_failed', failure_reason=$3, updated_at=now() WHERE organization_id=$1 AND id=$2`,
        [context.organizationId, payment.id, `${failure.code}: ${failure.message}`.slice(0, 500)]);
      await event(client, context, "payment", payment.id, "pos.card.finalization_failed", failure);
    }
    return { sale: null, error: failure };
  }
}

export async function outcomeFor(client, context, paymentId, finalized = null) {
  const payment = (await client.query(`SELECT * FROM tenant.pos_payments WHERE organization_id=$1 AND id=$2`, [context.organizationId, paymentId])).rows[0];
  const terminal = payment.payment_terminal_id
    ? (await client.query(`SELECT * FROM tenant.pos_payment_terminals WHERE organization_id=$1 AND id=$2`, [context.organizationId, payment.payment_terminal_id])).rows[0] : null;
  const state = payment.cart_id ? await loadCheckout(client, context, payment.cart_id) : null;
  const completed = state?.cart.status === "completed";
  return {
    ...attemptView(payment, terminal),
    checkoutStatus: completed ? "COMPLETED" : state?.cart.checkout_started_at ? "CHECKOUT_PENDING" : "OPEN",
    saleId: state?.cart.completed_sale_id ?? payment.sale_id ?? null, receiptAvailable: Boolean(completed),
    remainingAmount: state ? money(state.due) : null,
    finalizationError: finalized?.error ? { code: "POS_SALE_FINALIZATION_FAILED", cause: finalized.error.code, message: finalized.error.message } : null,
    recovery: payment.recovery_status === "finalization_failed" ? ["Try completing the sale again", "Or refund the card payment"] : null,
  };
}

// Start a card payment on a terminal. input: terminalId, amount (optional: defaults to what is still due), expectedVersion, idempotencyKey,
// outcome (sandbox scripting only).
export async function startPosCardPayment(client, context, cartId, input = {}) {
  requirePermission(context, "pos.sale.create");
  let idempotency;
  try {
    idempotency = await beginIdempotentOperation(client, context, {
      operation: "pos.card.start", key: input.idempotencyKey, required: true, payload: { cartId, terminalId: input.terminalId ?? null, amount: input.amount ?? null },
    });
  } catch (error) {
    if (/IDEMPOTENCY/.test(error.code ?? "")) throw cardError(409, "POS_CARD_IDEMPOTENCY_CONFLICT");
    throw error;
  }
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };

  let state = await loadCheckout(client, context, cartId, { lock: true });
  const { cart } = state;
  if (cart.status === "completed") throw cardError(409, "POS_CARD_NOT_FINALIZABLE", "This bill is already completed.");
  if (input.expectedVersion !== undefined && input.expectedVersion !== null && Number(input.expectedVersion) !== Number(cart.version)) throw cardError(409, "POS_CARD_VERSION_CONFLICT");
  if (cart.shift_status !== "open") throw cardError(409, "POS_CARD_SESSION_CLOSED");
  const config = await cardConfig(client, context, cart.store_id);
  if (!(await isTerminalPaymentMethodEnabled(client, context.organizationId, cart.terminal_id, "card"))) throw cardError(409, "POS_CARD_PAYMENT_DISABLED");
  if (!config || config.configuration_status !== "ready" || config.integration_mode === "standalone") throw cardError(409, "POS_CARD_PROVIDER_NOT_READY");
  try { await assertPosAction(client, context, { permission: "SALE_COMPLETE", outletId: cart.store_id }); }
  catch (error) { throw cardError(403, "POS_CARD_PERMISSION_DENIED", `${POS_CARD_MESSAGES.POS_CARD_PERMISSION_DENIED} ${error.message}`); }
  if (state.pendingNonCash.length) throw cardError(409, "POS_CARD_PAYMENT_IN_PROGRESS", undefined, { attempt: attemptView(state.pendingNonCash[0]) });
  if (!input.terminalId) throw cardError(400, "POS_CARD_TERMINAL_REQUIRED");

  if (!cart.checkout_started_at) {
    try { await ensurePosCheckoutStarted(client, context, cartId); }
    catch (error) { throw cardError(409, "POS_CARD_VERSION_CONFLICT", error.message, { issues: error.details?.issues ?? [] }); }
    state = await loadCheckout(client, context, cartId, { lock: true });
  }
  const amount = input.amount === undefined || input.amount === null || String(input.amount).trim() === "" ? state.due : decimal(String(input.amount));
  if (amount <= 0n || amount > state.due || String(input.amount ?? "").split(".")[1]?.length > state.decimalPlaces)
    throw cardError(400, "POS_CARD_AMOUNT_INVALID", `${POS_CARD_MESSAGES.POS_CARD_AMOUNT_INVALID} At most ${money(state.due)} is due.`, { amountDue: money(state.due) });
  if (config.max_amount !== null && amount > decimal(config.max_amount)) throw cardError(400, "POS_CARD_AMOUNT_LIMIT_EXCEEDED");
  await assertSplitAllowed(client, context, state, "card", amount);

  const terminal = (await client.query(`SELECT * FROM tenant.pos_payment_terminals WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, input.terminalId])).rows[0];
  if (!terminal || terminal.store_id !== cart.store_id || terminal.status !== "active" || terminal.integration_mode !== "integrated" || terminal.provider_key !== config.provider_key)
    throw cardError(409, "POS_CARD_TERMINAL_UNAVAILABLE");
  if (terminal.active_payment_id) throw cardError(409, "POS_CARD_TERMINAL_BUSY", undefined, { activePaymentId: terminal.active_payment_id });
  const adapter = resolvePaymentAdapter(config.provider_key);

  const payment = (await client.query(
    `INSERT INTO tenant.pos_payments (organization_id, cart_id, store_id, shift_id, terminal_id, payment_terminal_id, payment_method, amount, currency_code, provider_key,
       merchant_account_reference, idempotency_key, status, attempt_status, verification_status, initiated_by, created_by, cart_version, display_message)
     VALUES ($1,$2,$3,$4,$5,$6,'card',$7,$8,$9,$10,$11,'initiated','created','unresolved',$12,$12,$13,$14) RETURNING *`,
    [context.organizationId, cartId, cart.store_id, cart.shift_id, cart.terminal_id, terminal.id, asDatabaseDecimal(amount), cart.store_currency ?? cart.currency_code, config.provider_key,
      terminal.merchant_account_reference ?? config.merchant_account_reference ?? null, input.idempotencyKey, context.userId, state.cart.version, CARD_MESSAGES.created])).rows[0];
  await client.query(`UPDATE tenant.pos_payment_terminals SET active_payment_id=$3, active_since=now(), updated_at=now() WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, terminal.id, payment.id]);
  await event(client, context, "payment", payment.id, "pos.card.started", { cartId, terminalId: terminal.id, amount: money(amount) });

  let updated = payment;
  try {
    const result = await adapter.initiate(context, {
      amount: asDatabaseDecimal(amount), currency: payment.currency_code, method: "card", merchantReference: payment.id,
      terminalReference: terminal.provider_terminal_reference, merchantAccount: payment.merchant_account_reference, outcome: input.outcome,
    });
    updated = await applyProviderStatus(client, context, payment, { status: result.providerStatus ?? result.status, providerReference: result.providerReference,
      card: result.card, failureCode: result.failureCode, source: "initiate" });
  } catch (error) {
    if (error instanceof PaymentAdapterError) throw error;
    // No answer is not a "no": the attempt is UNKNOWN, the bill stays locked, the status is asked again.
    updated = await applyProviderStatus(client, context, payment, { status: "unknown", source: "initiate_timeout" });
    await event(client, context, "payment", payment.id, "pos.card.unknown", { reason: String(error.message ?? "No answer from the provider").slice(0, 200) });
  }
  const finalized = updated.attempt_status === "captured" ? await finalizeCheckout(client, context, cartId, input.idempotencyKey) : null;
  const response = await outcomeFor(client, context, payment.id, finalized);
  await completeIdempotentOperation(client, context, idempotency, { response, aggregateType: "pos_payment", aggregateId: payment.id });
  return response;
}

// The authoritative state of an attempt: a live one is asked of the provider again (never assumed); a captured one finalises the sale when
// everything else on the bill is confirmed.
export async function getPosCardAttempt(client, context, attemptId, { refresh = true } = {}) {
  requirePermission(context, "pos.view");
  let payment = (await client.query(`SELECT * FROM tenant.pos_payments WHERE organization_id=$1 AND id=$2 AND payment_method <> 'cash' FOR UPDATE`, [context.organizationId, attemptId])).rows[0];
  if (!payment) throw cardError(404, "POS_CARD_ATTEMPT_NOT_FOUND");
  if (payment.store_id) await assertPosStoreAccess(client, context, payment.store_id);
  if (refresh && LIVE_ATTEMPT_STATUSES.includes(payment.attempt_status) && !["standalone", "static_qr"].includes(payment.provider_key)) {
    const adapter = resolvePaymentAdapter(payment.provider_key);
    if (adapter.queryStatus) {
      try {
        const answer = await adapter.queryStatus(context, { merchantReference: payment.id, providerReference: payment.provider_reference });
        await client.query(`UPDATE tenant.pos_payments SET last_status_check_at=now(), status_check_count=status_check_count+1 WHERE organization_id=$1 AND id=$2`,
          [context.organizationId, payment.id]);
        payment = await applyProviderStatus(client, context, payment, { status: answer.status, providerReference: answer.providerReference, amount: answer.amount, card: answer.card,
          failureCode: answer.failureCode, transactionReference: answer.transactionReference, merchantAccount: answer.merchantAccount, instrument: answer.instrument,
          currency: answer.currency, source: "status_query" });
      } catch (error) {
        await event(client, context, "payment", payment.id, "pos.card.status_query_failed", { message: String(error.message ?? "").slice(0, 200) });
      }
    }
  }
  // A QR or link past its expiry, with the provider still not reporting an outcome: the request is expired (not the payment failed).
  if (payment.expires_at && new Date(payment.expires_at) <= new Date() && payment.request_status === "active" && LIVE_ATTEMPT_STATUSES.includes(payment.attempt_status)) {
    payment = (await client.query(`UPDATE tenant.pos_payments SET request_status='expired', display_message=$3, updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,
      [context.organizationId, payment.id, "The QR expired. Checking whether a payment was made before a new one can be created."])).rows[0];
    await event(client, context, "payment", payment.id, "pos.digital.request_expired", {});
  }
  const finalized = payment.attempt_status === "captured" && !payment.sale_id && payment.cart_id && payment.recovery_status !== "refund_requested"
    ? await finalizeCheckout(client, context, payment.cart_id, `${payment.id}:auto`) : null;
  return outcomeFor(client, context, payment.id, finalized);
}

// Ask the provider to cancel an attempt that was not captured. Cancelling is a request: until the provider confirms, the bill stays locked.
export async function cancelPosCardAttempt(client, context, attemptId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const payment = (await client.query(`SELECT * FROM tenant.pos_payments WHERE organization_id=$1 AND id=$2 AND payment_method <> 'cash' FOR UPDATE`, [context.organizationId, attemptId])).rows[0];
  if (!payment) throw cardError(404, "POS_CARD_ATTEMPT_NOT_FOUND");
  try { await assertPosAction(client, context, { permission: "PAYMENT_VOID_PENDING", outletId: payment.store_id, reason: input.reason }); }
  catch (error) { throw cardError(403, "POS_CARD_PERMISSION_DENIED", `${POS_CARD_MESSAGES.POS_CARD_PERMISSION_DENIED} ${error.message}`); }
  if (payment.attempt_status === "captured" || payment.sale_id) throw cardError(409, "POS_CARD_ALREADY_CAPTURED");
  if (FINAL_ATTEMPT_STATUSES.includes(payment.attempt_status)) return outcomeFor(client, context, payment.id);
  if (!LIVE_ATTEMPT_STATUSES.includes(payment.attempt_status)) throw cardError(409, "POS_CARD_CANCEL_NOT_ALLOWED");
  const adapter = resolvePaymentAdapter(payment.provider_key);
  let answer = { status: "cancel_pending" };
  if (adapter.cancel) {
    try { answer = await adapter.cancel(context, { merchantReference: payment.id, providerReference: payment.provider_reference }); }
    catch { answer = { status: "cancel_pending" }; }
  }
  // The provider says it was captured after all: that is the truth, and it finalises like any capture.
  await applyProviderStatus(client, context, payment, { status: answer.status === "cancel_pending" ? "cancel_pending" : answer.status, source: "cancel" });
  await event(client, context, "payment", payment.id, "pos.card.cancel_requested", { reason: input.reason ?? null, answer: answer.status });
  return getPosCardAttempt(client, context, payment.id, { refresh: false });
}

// Record a payment taken on a standalone bank card machine. input: terminalId, amount (defaults to what is due), reference, attested (true),
// cardLastFour, cardNetwork, approvalId (above the outlet's threshold), idempotencyKey.
export async function recordStandaloneCardPayment(client, context, cartId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const idempotency = await beginIdempotentOperation(client, context, {
    operation: "pos.card.standalone", key: input.idempotencyKey, required: true,
    payload: { cartId, terminalId: input.terminalId ?? null, amount: input.amount ?? null, reference: String(input.reference ?? "").trim() },
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };
  let state = await loadCheckout(client, context, cartId, { lock: true });
  const { cart } = state;
  if (cart.shift_status !== "open") throw cardError(409, "POS_CARD_SESSION_CLOSED");
  const config = await cardConfig(client, context, cart.store_id);
  if (!config || !config.standalone_enabled || config.configuration_status === "disabled") throw cardError(409, "POS_CARD_STANDALONE_DISABLED");
  if (!(await isTerminalPaymentMethodEnabled(client, context.organizationId, cart.terminal_id, "card"))) throw cardError(409, "POS_CARD_PAYMENT_DISABLED");
  try { await assertPosAction(client, context, { permission: "SALE_COMPLETE", outletId: cart.store_id }); }
  catch (error) { throw cardError(403, "POS_CARD_PERMISSION_DENIED", `${POS_CARD_MESSAGES.POS_CARD_PERMISSION_DENIED} ${error.message}`); }
  if (state.pendingNonCash.length) throw cardError(409, "POS_CARD_PAYMENT_IN_PROGRESS");
  const reference = String(input.reference ?? "").trim();
  if (!/^[A-Za-z0-9-]{4,40}$/.test(reference)) throw cardError(400, "POS_CARD_REFERENCE_REQUIRED");
  if (input.attested !== true) throw cardError(400, "POS_CARD_ATTESTATION_REQUIRED");
  const terminal = (await client.query(`SELECT * FROM tenant.pos_payment_terminals WHERE organization_id=$1 AND id=$2`, [context.organizationId, input.terminalId ?? null])).rows[0];
  if (!terminal || terminal.store_id !== cart.store_id || terminal.status !== "active" || terminal.integration_mode !== "standalone") throw cardError(409, "POS_CARD_TERMINAL_UNAVAILABLE");
  if (!cart.checkout_started_at) {
    try { await ensurePosCheckoutStarted(client, context, cartId); }
    catch (error) { throw cardError(409, "POS_CARD_VERSION_CONFLICT", error.message, { issues: error.details?.issues ?? [] }); }
    state = await loadCheckout(client, context, cartId, { lock: true });
  }
  const amount = input.amount === undefined || input.amount === null || String(input.amount).trim() === "" ? state.due : decimal(String(input.amount));
  if (amount <= 0n || amount > state.due) throw cardError(400, "POS_CARD_AMOUNT_INVALID", `${POS_CARD_MESSAGES.POS_CARD_AMOUNT_INVALID} At most ${money(state.due)} is due.`);
  await assertSplitAllowed(client, context, state, "card", amount);
  let approvalId = null;
  if (config.standalone_approval_above !== null && amount > decimal(config.standalone_approval_above)) {
    if (!input.approvalId) throw cardError(409, "POS_CARD_APPROVAL_REQUIRED", `${POS_CARD_MESSAGES.POS_CARD_APPROVAL_REQUIRED} (above ${money(config.standalone_approval_above)}).`);
    const approval = (await client.query(
      `SELECT * FROM tenant.pos_permission_approvals WHERE organization_id=$1 AND id=$2 AND status='approved' AND requested_by=$3 AND resource_type='pos_cart' AND resource_id=$4`,
      [context.organizationId, input.approvalId, context.userId, cartId])).rows[0];
    if (!approval) throw cardError(409, "POS_CARD_APPROVAL_REQUIRED", "The approval is not valid for this bill.");
    await client.query(`UPDATE tenant.pos_permission_approvals SET status='consumed', consumed_at=now() WHERE organization_id=$1 AND id=$2`, [context.organizationId, approval.id]);
    approvalId = approval.id;
  }
  const today = (await client.query(`SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS d`)).rows[0].d;
  const duplicate = (await client.query(
    `SELECT id FROM tenant.pos_payments WHERE organization_id=$1 AND payment_terminal_id=$2 AND external_reference=$3 AND external_reference_date=$4`,
    [context.organizationId, terminal.id, reference, today])).rows[0];
  if (duplicate) throw cardError(409, "POS_CARD_DUPLICATE_REFERENCE");
  const provisional = Boolean(config.provisional_acceptance);
  const lastFour = /^\d{4}$/.test(String(input.cardLastFour ?? "")) ? String(input.cardLastFour) : null;
  const payment = (await client.query(
    `INSERT INTO tenant.pos_payments (organization_id, cart_id, store_id, shift_id, terminal_id, payment_terminal_id, payment_method, amount, currency_code, provider_key,
       merchant_account_reference, idempotency_key, status, attempt_status, verification_status, initiated_by, created_by, cart_version, external_reference, external_reference_date,
       attested_by, attested_at, card_last_four, card_network, captured_at, display_message, failure_reason)
     VALUES ($1,$2,$3,$4,$5,$6,'card',$7,$8,'standalone',$9,$10,$11,'externally_attested','externally_attested',$12,$12,$13,$14,$15,$12,now(),$16,$17,
       CASE WHEN $11='captured' THEN now() END,$18,$19) RETURNING *`,
    [context.organizationId, cartId, cart.store_id, cart.shift_id, cart.terminal_id, terminal.id, asDatabaseDecimal(amount), cart.store_currency ?? cart.currency_code,
      terminal.merchant_account_reference ?? config.merchant_account_reference ?? null, input.idempotencyKey, provisional ? "captured" : "pending", context.userId, state.cart.version,
      reference, today, lastFour, input.cardNetwork ? String(input.cardNetwork).toUpperCase().slice(0, 20) : null, CARD_MESSAGES.externally_attested,
      approvalId ? `Approved above the standalone threshold (approval ${approvalId}).` : null])).rows[0];
  await event(client, context, "payment", payment.id, "pos.card.standalone_recorded", { cartId, terminalId: terminal.id, amount: money(amount), reference, provisional, approvalId });
  const finalized = provisional ? await finalizeCheckout(client, context, cartId, input.idempotencyKey) : null;
  const response = { ...(await outcomeFor(client, context, payment.id, finalized)), provisional,
    note: provisional ? "Recorded from the card machine and accepted provisionally. Settlement reconciliation will confirm it."
      : "Recorded from the card machine. The sale waits until the payment is confirmed by settlement." };
  await completeIdempotentOperation(client, context, idempotency, { response, aggregateType: "pos_payment", aggregateId: payment.id });
  return response;
}

// Retry finalising a bill whose card payment is captured (after a stock or tax problem).
export async function finalizePosCardCheckout(client, context, cartId) {
  requirePermission(context, "pos.sale.create");
  const finalized = await finalizeCheckout(client, context, cartId, `${cartId}:retry:${Date.now()}`);
  if (finalized.waiting) throw cardError(409, "POS_CARD_NOT_FINALIZABLE", "A payment on this bill is not confirmed yet, or something is still due.");
  const card = (await client.query(`SELECT id FROM tenant.pos_payments WHERE organization_id=$1 AND cart_id=$2 AND payment_method <> 'cash' ORDER BY initiated_at DESC LIMIT 1`,
    [context.organizationId, cartId])).rows[0];
  return card ? outcomeFor(client, context, card.id, finalized) : { checkoutStatus: finalized.sale ? "COMPLETED" : "CHECKOUT_PENDING", saleId: finalized.sale?.id ?? null };
}

// Refund a card payment through the provider, against the original payment only, never above what is left, never twice for one request.
// Used by returns, and to give back a captured card whose sale could not be finalised. input: amount, reason, returnId, approvalId,
// idempotencyKey, outcome (sandbox scripting only).
export async function refundPosCardPayment(client, context, paymentId, input = {}) {
  requirePermission(context, "pos.view");
  const key = String(input.idempotencyKey ?? "").trim();
  if (key.length < 8) throw posError(400, "An idempotency key is required.", "IDEMPOTENCY_KEY_REQUIRED");
  const existing = (await client.query(`SELECT * FROM tenant.pos_card_refunds WHERE organization_id=$1 AND idempotency_key=$2`, [context.organizationId, key])).rows[0];
  if (existing) {
    if (existing.original_payment_id !== paymentId || decimal(existing.refund_amount) !== decimal(String(input.amount ?? existing.refund_amount))) throw cardError(409, "POS_CARD_IDEMPOTENCY_CONFLICT");
    return { refund: refundView(existing), replayed: true };
  }
  const payment = (await client.query(`SELECT * FROM tenant.pos_payments WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, paymentId])).rows[0];
  if (!payment || payment.payment_method === "cash") throw cardError(404, "POS_CARD_REFUND_NOT_ALLOWED", "Refund cash through the return workflow.");
  await assertPosStoreAccess(client, context, payment.store_id);
  if (!["captured", "partially_refunded"].includes(payment.status) || ["standalone", "static_qr"].includes(payment.provider_key))
    throw cardError(409, "POS_CARD_REFUND_NOT_ALLOWED", payment.provider_key === "standalone" ? "Refund a standalone card machine payment on that machine, then record it with the return."
      : payment.provider_key === "static_qr" ? "A static QR payment cannot be refunded automatically. Finance refunds it from the merchant account and records it." : POS_CARD_MESSAGES.POS_CARD_REFUND_NOT_ALLOWED);
  const config = (await client.query(`SELECT refund_enabled FROM tenant.pos_payment_provider_configs WHERE organization_id=$1 AND store_id=$2 AND payment_method=$3 AND active=true`,
    [context.organizationId, payment.store_id, payment.payment_method])).rows[0];
  if (config && !config.refund_enabled) throw cardError(409, "POS_CARD_REFUND_NOT_ALLOWED", "Refunds through the provider are not enabled for this payment method at this outlet.");
  const amount = decimal(String(input.amount ?? ""));
  const committed = decimal((await client.query(
    `SELECT COALESCE(sum(refund_amount), 0)::text AS s FROM tenant.pos_card_refunds WHERE organization_id=$1 AND original_payment_id=$2 AND status IN ('requested','processing','succeeded','unknown','reconciliation_required')`,
    [context.organizationId, paymentId])).rows[0].s);
  const remaining = sub(decimal(payment.amount), committed);
  if (amount <= 0n || amount > remaining) throw posError(409, `Refund of ${money(amount)} is more than the ${money(remaining)} left to refund.`, "POS_REFUND_EXCEEDS_CAPTURED");
  // A posted return authorizes its whole refund once (Returns, 0099): its legs are not checked again one by one. Never set from a route.
  if (!input.authorizedByReturn) await assertPosAction(client, context, { permission: "REFUND_INITIATE", outletId: payment.store_id, amount: asDatabaseDecimal(amount), approvalId: input.approvalId, reason: input.reason,
    resource: payment.sale_id ? { type: "pos_sale", id: payment.sale_id } : payment.cart_id ? { type: "pos_cart", id: payment.cart_id } : undefined });
  const refund = (await client.query(
    `INSERT INTO tenant.pos_card_refunds (organization_id, original_payment_id, return_id, provider_key, refund_amount, currency_code, status, reason, idempotency_key, requested_by, approval_id)
     VALUES ($1,$2,$3,$4,$5,$6,'requested',$7,$8,$9,$10) RETURNING *`,
    [context.organizationId, paymentId, input.returnId ?? null, payment.provider_key, asDatabaseDecimal(amount), payment.currency_code, input.reason ?? null, key, context.userId,
      input.approvalId ?? null])).rows[0];
  let status = "unknown";
  let providerRefundReference = null;
  let failure = null;
  try {
    const result = await resolvePaymentAdapter(payment.provider_key).refund(context, { providerReference: payment.provider_reference, amount: asDatabaseDecimal(amount),
      currency: payment.currency_code, outcome: input.outcome });
    providerRefundReference = result.providerRefundReference ?? null;
    status = result.status === "refunded" || result.status === "succeeded" ? "succeeded" : result.status === "failed" ? "failed" : "processing";
  } catch (error) {
    if (error.timeout) status = "unknown";
    else { status = "failed"; failure = String(error.message ?? "The provider refused the refund.").slice(0, 300); }
  }
  const saved = await settleRefund(client, context, refund, payment, status, providerRefundReference, failure);
  return { refund: refundView(saved), replayed: false };
}

async function settleRefund(client, context, refund, payment, status, providerRefundReference, failure) {
  const saved = (await client.query(
    `UPDATE tenant.pos_card_refunds SET status=$3, provider_refund_reference=COALESCE(provider_refund_reference, $4), failure_message=$5, version=version+1, updated_at=now(),
            resolved_at=CASE WHEN $3 IN ('succeeded','failed') THEN now() ELSE resolved_at END WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [context.organizationId, refund.id, status, providerRefundReference, failure])).rows[0];
  if (status === "succeeded" && refund.status !== "succeeded") {
    const refunded = add(decimal(payment.refunded_amount ?? 0), decimal(refund.refund_amount));
    await client.query(`UPDATE tenant.pos_payments SET refunded_amount=$3, status=$4, updated_at=now() WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, payment.id, asDatabaseDecimal(refunded), refunded >= decimal(payment.amount) ? "refunded" : "partially_refunded"]);
  }
  await event(client, context, "payment", payment.id, `pos.card.refund_${status}`, { refundId: refund.id, amount: money(refund.refund_amount) });
  return saved;
}

const refundView = (refund) => ({
  id: refund.id, paymentId: refund.original_payment_id, returnId: refund.return_id, status: `REFUND_${String(refund.status).toUpperCase()}`, amount: money(refund.refund_amount),
  currency: refund.currency_code, providerRefundReference: refund.provider_refund_reference, failureMessage: refund.failure_message, createdAt: refund.created_at, resolvedAt: refund.resolved_at,
});

// A refund's state, asked of the provider again while it is still being processed or unknown.
export async function getPosCardRefund(client, context, refundId) {
  requirePermission(context, "pos.view");
  const refund = (await client.query(`SELECT * FROM tenant.pos_card_refunds WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, refundId])).rows[0];
  if (!refund) throw posError(404, "Refund not found.", "POS_REFUND_NOT_FOUND");
  const payment = (await client.query(`SELECT * FROM tenant.pos_payments WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, refund.original_payment_id])).rows[0];
  await assertPosStoreAccess(client, context, payment.store_id);
  if (["processing", "unknown", "requested"].includes(refund.status) && refund.provider_refund_reference) {
    const adapter = resolvePaymentAdapter(refund.provider_key);
    if (adapter.refundStatus) {
      const answer = await adapter.refundStatus(context, { providerRefundReference: refund.provider_refund_reference }).catch(() => ({ status: "unknown" }));
      const status = ["refunded", "succeeded"].includes(answer.status) ? "succeeded" : answer.status === "failed" ? "failed" : refund.status;
      if (status !== refund.status) return refundView(await settleRefund(client, context, refund, payment, status, null, status === "failed" ? "The provider reported the refund failed." : null));
    }
  }
  return refundView(refund);
}

// Give back a captured card whose sale could not be finalised (the customer leaves without the goods): the whole payment is refunded
// through the provider and the bill can then be released.
// Refunds (0100): a refund of its own (source: the failed checkout), within the cashier's refund limit or approved by a supervisor.
export async function refundUnfinalizedCardPayment(client, context, attemptId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const payment = (await client.query(`SELECT * FROM tenant.pos_payments WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, attemptId])).rows[0];
  if (!payment || payment.sale_id || payment.attempt_status !== "captured") throw cardError(409, "POS_CARD_REFUND_NOT_ALLOWED", "Only a captured card payment whose sale was not finalised is refunded here.");
  let refund = await createPosRefund(client, context, "checkout_failure", attemptId, { amount: payment.amount, reasonCode: "checkout_failure", reasonNote: input.reason ?? "Sale could not be finalised",
    idempotencyKey: input.idempotencyKey });
  if (refund.status === "AUTHORIZED") refund = await executePosRefund(client, context, refund.id, { outcome: input.outcome });
  const component = refund.components[0];
  const status = component ? { SUCCEEDED: "REFUND_SUCCEEDED", FAILED: "REFUND_FAILED", UNKNOWN: "REFUND_UNKNOWN" }[component.status] ?? (refund.status === "AWAITING_APPROVAL" ? "REFUND_AWAITING_APPROVAL" : "REFUND_PROCESSING") : "REFUND_PROCESSING";
  return { ...(await outcomeFor(client, context, attemptId)), refund: { id: refund.id, refundNumber: refund.refundNumber, status, amount: refund.authorizedAmount, refundStatus: refund.status } };
}

// Card payments for a period: captured (provider verified vs externally attested), declined, failed, unknown, cancelled, refunds, settled
// with fees and fee tax, unsettled, mismatches, by outlet, terminal and cashier. input: from, to, storeId.
export async function getPosCardPaymentSummary(client, context, input = {}) {
  requirePermission(context, "pos.view");
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const now = new Date();
  const from = DATE.test(String(input.from ?? "")) ? input.from : `${now.toISOString().slice(0, 8)}01`;
  const to = DATE.test(String(input.to ?? "")) ? input.to : now.toISOString().slice(0, 10);
  const values = [context.organizationId, from, to];
  const filters = [];
  const stores = await accessiblePosStoreIds(client, context);
  if (stores) { values.push(stores); filters.push(`payment.store_id = ANY($${values.length}::uuid[])`); }
  if (/^[0-9a-f-]{36}$/i.test(String(input.storeId ?? ""))) { values.push(input.storeId); filters.push(`payment.store_id = $${values.length}::uuid`); }
  const scope = `payment.organization_id = $1 AND payment.payment_method = 'card' AND payment.initiated_at >= $2::date AND payment.initiated_at < $3::date + 1${filters.length ? ` AND ${filters.join(" AND ")}` : ""}`;
  const [totals] = (await client.query(
    `SELECT count(*) FILTER (WHERE payment.sale_id IS NOT NULL)::int AS card_sales,
            COALESCE(sum(payment.amount) FILTER (WHERE payment.sale_id IS NOT NULL), 0)::text AS card_amount,
            COALESCE(sum(payment.amount) FILTER (WHERE payment.sale_id IS NOT NULL AND payment.verification_status = 'provider_verified'), 0)::text AS provider_verified,
            COALESCE(sum(payment.amount) FILTER (WHERE payment.verification_status = 'externally_attested'), 0)::text AS externally_attested,
            count(*) FILTER (WHERE payment.attempt_status = 'declined')::int AS declined, count(*) FILTER (WHERE payment.attempt_status = 'failed')::int AS failed,
            count(*) FILTER (WHERE payment.attempt_status IN ('unknown', 'cancel_pending', 'reconciliation_required'))::int AS unresolved,
            count(*) FILTER (WHERE payment.attempt_status = 'cancelled')::int AS cancelled,
            count(*) FILTER (WHERE payment.recovery_status = 'finalization_failed')::int AS captured_not_finalized,
            COALESCE(sum(payment.refunded_amount), 0)::text AS refunded,
            COALESCE(sum(payment.settled_amount) FILTER (WHERE payment.settlement_status = 'settled'), 0)::text AS settled_gross,
            COALESCE(sum(payment.settlement_fee_amount) FILTER (WHERE payment.settlement_status = 'settled'), 0)::text AS fees,
            COALESCE(sum(payment.amount) FILTER (WHERE payment.sale_id IS NOT NULL AND payment.settlement_status <> 'settled'), 0)::text AS unsettled
       FROM tenant.pos_payments payment WHERE ${scope}`, values)).rows;
  const group = async (column, join, label) => (await client.query(
    `SELECT ${label} AS name, count(*) FILTER (WHERE payment.sale_id IS NOT NULL)::int AS sales, COALESCE(sum(payment.amount) FILTER (WHERE payment.sale_id IS NOT NULL), 0)::text AS amount,
            count(*) FILTER (WHERE payment.attempt_status = 'declined')::int AS declined
       FROM tenant.pos_payments payment ${join} WHERE ${scope} GROUP BY ${column} ORDER BY 3 DESC`, values)).rows;
  const byOutlet = await group("store.name", "JOIN tenant.pos_stores store ON store.organization_id = payment.organization_id AND store.id = payment.store_id", "store.name");
  const byTerminal = await group("device.id", "LEFT JOIN tenant.pos_payment_terminals device ON device.organization_id = payment.organization_id AND device.id = payment.payment_terminal_id",
    "COALESCE(max(device.name), 'No terminal')");
  const byCashier = await group("person.full_name", "JOIN public.users person ON person.id = payment.created_by", "person.full_name");
  const [settlement] = (await client.query(
    // Payment Reconciliation (0108): settlement lines of card merchant accounts, and the exceptions their matching raised.
    `SELECT COALESCE(sum(line.fee_tax_amount), 0)::text AS fee_tax, COALESCE(sum(line.net_amount), 0)::text AS net,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM tenant.payment_reconciliation_exceptions exception WHERE exception.organization_id = line.organization_id AND exception.source_type = 'payment_settlement_line'
              AND exception.source_id = line.id AND exception.exception_code = 'PAYMENT_MISSING_INTERNAL'))::int AS unmatched,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM tenant.payment_reconciliation_exceptions exception WHERE exception.organization_id = line.organization_id AND exception.source_type = 'payment_settlement_line'
              AND exception.source_id = line.id AND exception.exception_code IN ('PAYMENT_AMOUNT_MISMATCH', 'PAYMENT_CURRENCY_MISMATCH', 'MERCHANT_ACCOUNT_MISMATCH')))::int AS mismatched,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM tenant.payment_reconciliation_exceptions exception WHERE exception.organization_id = line.organization_id AND exception.source_type = 'payment_settlement_line'
              AND exception.source_id = line.id AND exception.exception_code = 'PAYMENT_DUPLICATE'))::int AS duplicates
       FROM tenant.payment_settlement_lines line JOIN tenant.payment_settlement_batches batch ON batch.organization_id = line.organization_id AND batch.id = line.batch_id
       JOIN tenant.payment_merchant_accounts merchant ON merchant.id = line.merchant_account_id
      WHERE line.organization_id = $1 AND line.line_type = 'PAYMENT' AND 'card' = ANY(merchant.payment_methods) AND batch.settlement_date >= $2::date AND batch.settlement_date <= $3::date`,
    [context.organizationId, from, to])).rows;
  return { from, to, totals: { ...totals, ...settlement }, byOutlet, byTerminal, byCashier };
}

// What the checkout can do with cards: terminals at this outlet (integrated and standalone), whether standalone recording is allowed, and
// any card attempt still in progress on the bill.
export async function getPosCheckoutCardOptions(client, context, cartId) {
  requirePermission(context, "pos.view");
  const state = await loadCheckout(client, context, cartId);
  const config = await cardConfig(client, context, state.cart.store_id);
  const enabled = await isTerminalPaymentMethodEnabled(client, context.organizationId, state.cart.terminal_id, "card");
  const terminals = await listPosPaymentTerminals(client, context, { storeId: state.cart.store_id });
  const live = state.payments.find((payment) => payment.payment_method === "card" && !payment.sale_id && (LIVE_ATTEMPT_STATUSES.includes(payment.attempt_status)
    || payment.attempt_status === "reconciliation_required" || payment.recovery_status === "finalization_failed" || (payment.attempt_status === "externally_attested" && payment.status === "pending")));
  return {
    enabled: enabled && Boolean(config) && config.configuration_status !== "disabled", integratedReady: Boolean(config && config.configuration_status === "ready" && config.integration_mode !== "standalone"),
    standaloneEnabled: Boolean(config?.standalone_enabled), provisionalAcceptance: Boolean(config?.provisional_acceptance),
    standaloneApprovalAbove: config?.standalone_approval_above ? money(config.standalone_approval_above) : null, amountDue: money(state.due), currency: state.cart.store_currency ?? state.cart.currency_code,
    terminals: terminals.filter((terminal) => terminal.status === "active"), attempt: attemptView(live ?? null),
  };
}

// Card set-up per outlet (administrators): the provider and merchant account, integrated / standalone, whether standalone machine payments
// may be recorded and accepted provisionally, the approval threshold for them, refunds, settlement source, readiness and limits. Provider
// credentials are never stored here: only the name of the secret that holds them (credentialReference).
const configView = (row, store) => ({
  storeId: store.id, storeName: store.name, configured: Boolean(row), providerKey: row?.provider_key ?? null, active: Boolean(row?.active),
  merchantAccountReference: row?.merchant_account_reference ?? null, integrationMode: row?.integration_mode ?? "integrated", standaloneEnabled: Boolean(row?.standalone_enabled),
  provisionalAcceptance: Boolean(row?.provisional_acceptance), standaloneApprovalAbove: row?.standalone_approval_above ? money(row.standalone_approval_above) : null,
  refundEnabled: row ? Boolean(row.refund_enabled) : true, settlementSource: row?.settlement_source ?? "provider_api", configurationStatus: row?.configuration_status ?? "incomplete",
  supportedCurrency: row?.supported_currency ?? "INR", maxAmount: row?.max_amount ? money(row.max_amount) : null, credentialReference: row?.credential_env_var ?? null,
});

export async function listPosCardConfigs(client, context) {
  requirePermission(context, "pos.settings.manage");
  const stores = await accessiblePosStoreIds(client, context);
  const storeRows = (await client.query(`SELECT id, name FROM tenant.pos_stores WHERE organization_id=$1 ${stores ? "AND id = ANY($2::uuid[])" : ""} ORDER BY name`,
    stores ? [context.organizationId, stores] : [context.organizationId])).rows;
  const result = [];
  for (const store of storeRows) {
    const row = (await client.query(`SELECT * FROM tenant.pos_payment_provider_configs WHERE organization_id=$1 AND store_id=$2 AND payment_method='card'`, [context.organizationId, store.id])).rows[0];
    result.push({ ...configView(row, store), terminals: await listPosPaymentTerminals(client, context, { storeId: store.id }) });
  }
  return result;
}

export async function updatePosCardConfig(client, context, storeId, input = {}) {
  requirePermission(context, "pos.settings.manage");
  await assertPosStoreAccess(client, context, storeId);
  const store = (await client.query(`SELECT id, name FROM tenant.pos_stores WHERE organization_id=$1 AND id=$2`, [context.organizationId, storeId])).rows[0];
  if (!store) throw posError(404, "Outlet not found.", "POS_STORE_NOT_FOUND");
  if (input.credentialReference && !/^[A-Z][A-Z0-9_]{2,79}$/.test(String(input.credentialReference)))
    throw posError(400, "The credential reference is the NAME of a secret (for example POS_CARD_PROVIDER_KEY), never the secret itself.", "POS_CARD_CONFIG_INVALID");
  const amountOrNull = (value) => (value === undefined ? undefined : value === null || value === "" ? null : Number(value) > 0 ? String(value) : (() => { throw posError(400, "Amounts must be more than zero.", "POS_CARD_CONFIG_INVALID"); })());
  const existing = (await client.query(`SELECT * FROM tenant.pos_payment_provider_configs WHERE organization_id=$1 AND store_id=$2 AND payment_method='card'`, [context.organizationId, storeId])).rows[0];
  const merged = {
    provider_key: String(input.providerKey ?? existing?.provider_key ?? "sandbox").trim().toLowerCase(), active: input.active ?? existing?.active ?? true,
    merchant_account_reference: input.merchantAccountReference !== undefined ? input.merchantAccountReference || null : existing?.merchant_account_reference ?? null,
    integration_mode: ["integrated", "standalone", "both"].includes(input.integrationMode) ? input.integrationMode : existing?.integration_mode ?? "integrated",
    standalone_enabled: input.standaloneEnabled ?? existing?.standalone_enabled ?? false, provisional_acceptance: input.provisionalAcceptance ?? existing?.provisional_acceptance ?? false,
    standalone_approval_above: input.standaloneApprovalAbove === undefined ? existing?.standalone_approval_above ?? null : amountOrNull(input.standaloneApprovalAbove),
    refund_enabled: input.refundEnabled ?? existing?.refund_enabled ?? true,
    settlement_source: ["provider_api", "import"].includes(input.settlementSource) ? input.settlementSource : existing?.settlement_source ?? "provider_api",
    configuration_status: ["ready", "incomplete", "disabled"].includes(input.configurationStatus) ? input.configurationStatus : existing?.configuration_status ?? "incomplete",
    max_amount: input.maxAmount === undefined ? existing?.max_amount ?? null : amountOrNull(input.maxAmount),
    credential_env_var: input.credentialReference !== undefined ? input.credentialReference || null : existing?.credential_env_var ?? null,
  };
  if (merged.configuration_status === "ready" && merged.integration_mode !== "standalone") resolvePaymentAdapter(merged.provider_key);
  await client.query(
    `INSERT INTO tenant.pos_payment_provider_configs (organization_id, store_id, payment_method, provider_key, active, merchant_account_reference, integration_mode, standalone_enabled,
       provisional_acceptance, standalone_approval_above, refund_enabled, settlement_source, configuration_status, max_amount, credential_env_var, created_by)
     VALUES ($1,$2,'card',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (organization_id, store_id, payment_method) DO UPDATE SET provider_key=EXCLUDED.provider_key, active=EXCLUDED.active,
       merchant_account_reference=EXCLUDED.merchant_account_reference, integration_mode=EXCLUDED.integration_mode, standalone_enabled=EXCLUDED.standalone_enabled,
       provisional_acceptance=EXCLUDED.provisional_acceptance, standalone_approval_above=EXCLUDED.standalone_approval_above, refund_enabled=EXCLUDED.refund_enabled,
       settlement_source=EXCLUDED.settlement_source, configuration_status=EXCLUDED.configuration_status, max_amount=EXCLUDED.max_amount, credential_env_var=EXCLUDED.credential_env_var, updated_at=now()`,
    [context.organizationId, storeId, merged.provider_key, merged.active, merged.merchant_account_reference, merged.integration_mode, merged.standalone_enabled, merged.provisional_acceptance,
      merged.standalone_approval_above, merged.refund_enabled, merged.settlement_source, merged.configuration_status, merged.max_amount, merged.credential_env_var, context.userId]);
  await event(client, context, "store", storeId, "pos.card_config.updated", { ...merged, credential_env_var: merged.credential_env_var ? "(reference set)" : null });
  const row = (await client.query(`SELECT * FROM tenant.pos_payment_provider_configs WHERE organization_id=$1 AND store_id=$2 AND payment_method='card'`, [context.organizationId, storeId])).rows[0];
  return { ...configView(row, store), terminals: await listPosPaymentTerminals(client, context, { storeId }) };
}

// Refunds (0100): the shared refund service settles a provider refund outcome through the same path.
export { settleRefund as settlePosCardRefund };
