// POS Cash Payments (migration 0092): physical cash taken at checkout. The cashier enters what the customer handed over; the server works
// out what it settles and the change (never trusting a client total), and — once the cashier confirms having received it — records the
// tender against the exact cash session that handled it: the cash received into the drawer and the change taken out, so the session's
// expected cash moves by what the drawer really gains. The sale is then finalised through the one checkout path (completePosCart). If
// finalising fails (stock, tax, a lapsed allocation), the cash is NOT lost: the tender stays "received, pending" on the bill and the
// session, the cashier can retry, or hand the cash back (a recorded movement); the session cannot close while cash is pending.
//
// States of a cash tender (pos_payments, method cash): pending custody (status 'pending') → completed with the sale (status 'captured',
// sale_id set), or returned (status 'voided', the retained cash handed back), or flagged reconciliation_required for a supervisor. A
// retried request returns the original outcome; the same key with a different amount is refused.
import { add, sub, min, decimal, asDatabaseDecimal, formatDecimal } from "../../../core/decimal.js";
import { beginIdempotentOperation, completeIdempotentOperation } from "../../../core/idempotency.js";
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { isTerminalPaymentMethodEnabled } from "../terminals/index.js";
import { assertPosAction, authorizePosAction } from "../permissions/index.js";
import { ensurePosCheckoutStarted } from "../assortment-pricing-customer-and-cart/cart.js";
import { completePosCart } from "../assortment-pricing-customer-and-cart/sale-completion.js";
import { POS_SHIFT_MESSAGES } from "../cash-shift-day-end-and-reconciliation/shift-opening.js";
import { markPosStockRecovery } from "../inventory-and-offline-continuity/stock-reduction.js";
import { resolveCurrencyDecimalPlaces } from "../assortment-pricing-customer-and-cart/cart-pricing.js";
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess, accessiblePosStoreIds } from "../shared/access-control.js";
import { event } from "../shared/audit.js";

export const POS_CASH_MESSAGES = Object.freeze({
  POS_CASH_PAYMENT_DISABLED: "Cash payments are not available at this counter.",
  POS_CASH_SESSION_REQUIRED: "Open a Cash Session before accepting cash.",
  POS_CASH_SESSION_CLOSED: "This Cash Session is closed.",
  POS_CASH_TERMINAL_MISMATCH: "This payment belongs to another terminal.",
  POS_CASH_PERMISSION_DENIED: "You cannot complete this cash payment.",
  POS_CASH_AMOUNT_REQUIRED: "Enter the cash received.",
  POS_CASH_AMOUNT_INVALID: "Enter a valid cash amount.",
  POS_CASH_AMOUNT_INSUFFICIENT: "More payment is needed to complete this bill.",
  POS_CASH_AMOUNT_LIMIT_EXCEEDED: "Cash amount exceeds the allowed limit.",
  POS_CASH_CURRENCY_MISMATCH: "Cash currency does not match the bill.",
  POS_CASH_CHANGE_INVALID: "Change amount could not be verified.",
  POS_CASH_CHANGE_NOT_CONFIRMED: "Confirm the change given to the customer.",
  POS_CASH_CHECKOUT_CHANGED: "Bill amount changed. Review the payment.",
  POS_CASH_PAYMENT_ALREADY_COMPLETED: "This payment has already been completed.",
  POS_CASH_PAYMENT_PENDING: "Payment is still being processed. Check its status.",
  POS_CASH_PAYMENT_RECONCILIATION_REQUIRED: "Cash needs to be reconciled before continuing.",
  POS_CASH_RETURN_REQUIRED: "Return the retained cash to cancel this payment.",
  POS_CASH_RETURN_NOT_CONFIRMED: "Confirm that cash was returned.",
  POS_CASH_SPLIT_BALANCE_PENDING: "Another payment is still required.",
  POS_CASH_STOCK_FINALIZATION_FAILED: "Sale could not be finalized. Follow the recovery instructions.",
  POS_CASH_SESSION_CLOSE_BLOCKED: "Resolve pending cash transactions before closing.",
  POS_CASH_VERSION_CONFLICT: "This checkout changed. Refresh its status.",
  POS_CASH_IDEMPOTENCY_CONFLICT: "This payment request conflicts with an earlier request.",
});

// Split Payments (0095): whether a bill may be paid in parts, and the one-confirmed-part-per-method rule shared by every tender.
export async function assertSplitAllowed(client, context, state, method, amount) {
  const enabled = (await client.query(`SELECT split_payments_enabled FROM tenant.pos_settings WHERE organization_id=$1`, [context.organizationId])).rows[0]?.split_payments_enabled ?? true;
  const partial = amount < state.due || state.captured.length > 0 || Boolean(state.pendingCash);
  if (partial && !enabled) {
    const error = posError(409, "Split Payments are not enabled.", "POS_SPLIT_PAYMENT_DISABLED");
    throw error;
  }
  if (method !== "cash" && state.captured.some((payment) => payment.payment_method === method)) {
    const error = posError(409, "This payment method is already included.", "POS_SPLIT_PAYMENT_DUPLICATE_METHOD");
    throw error;
  }
}

const cashError = (status, code, message = POS_CASH_MESSAGES[code], details = undefined) => {
  const error = posError(status, message, code);
  if (details) error.details = details;
  return error;
};

const DEFAULT_POLICY = { cash_payments_enabled: true, cash_quick_amounts_enabled: true, cash_denominations: [10, 20, 50, 100, 200, 500], max_cash_tender_amount: null,
  large_cash_warning_amount: null };
async function cashPolicy(client, context) {
  const row = (await client.query(
    `SELECT cash_payments_enabled, cash_quick_amounts_enabled, cash_denominations, max_cash_tender_amount, large_cash_warning_amount
       FROM tenant.pos_settings WHERE organization_id=$1`, [context.organizationId])).rows[0];
  return { ...DEFAULT_POLICY, ...(row ?? {}) };
}

// Quick tender amounts from the amount due and the company's notes: exact, then the next amounts a customer typically hands over (the next
// round figure of each note at least a tenth of the bill), at most three besides exact.
export function suggestCashTenderAmounts(due, denominations = DEFAULT_POLICY.cash_denominations) {
  const amount = decimal(due);
  if (amount <= 0n) return [];
  const notes = [...new Set((Array.isArray(denominations) ? denominations : []).map(Number).filter((value) => value > 0))].sort((a, b) => a - b);
  if (!notes.length) return [formatDecimal(amount, 2)];
  const largest = notes[notes.length - 1];
  const steps = [...new Set([...notes, largest * 2, largest * 4])].map((value) => decimal(value));
  const floor = amount / 10n;
  const candidates = [...new Set(steps.filter((step) => step >= floor || step === steps[steps.length - 1])
    .map((step) => ((amount + step - 1n) / step) * step).filter((value) => value > amount).map(String))].map(BigInt).sort((a, b) => (a < b ? -1 : 1));
  return [amount, ...candidates.slice(0, 3)].map((value) => formatDecimal(value, 2));
}

// What a cash amount typed or tapped at the counter is: digits with at most the currency's decimals, more than zero, within the safety limit.
function readCashAmount(raw, decimalPlaces, policy) {
  const text = String(raw ?? "").trim();
  if (!text) throw cashError(400, "POS_CASH_AMOUNT_REQUIRED");
  if (!/^\d{1,12}(\.\d+)?$/.test(text)) throw cashError(400, "POS_CASH_AMOUNT_INVALID", text.startsWith("-") ? "Cash received cannot be negative." : POS_CASH_MESSAGES.POS_CASH_AMOUNT_INVALID);
  if ((text.split(".")[1] ?? "").length > decimalPlaces) throw cashError(400, "POS_CASH_AMOUNT_INVALID", `Use at most ${decimalPlaces} decimal places.`);
  const amount = decimal(text);
  if (amount <= 0n) throw cashError(400, "POS_CASH_AMOUNT_INVALID", "Cash received must be more than zero.");
  if (policy.max_cash_tender_amount !== null && policy.max_cash_tender_amount !== undefined && amount > decimal(policy.max_cash_tender_amount))
    throw cashError(400, "POS_CASH_AMOUNT_LIMIT_EXCEEDED", `${POS_CASH_MESSAGES.POS_CASH_AMOUNT_LIMIT_EXCEEDED} (${formatDecimal(decimal(policy.max_cash_tender_amount))}).`);
  return amount;
}

// The bill at checkout and its payments so far: what is due now is the total less captured card / UPI payments and any cash in hand.
export async function loadCheckout(client, context, cartId, { lock = false } = {}) {
  const cart = (await client.query(
    `SELECT cart.*, store.currency_code AS store_currency, store.active AS store_active, shift.status AS shift_status, shift.cashier_user_id AS shift_cashier,
            shift.lifecycle_status AS shift_lifecycle, cash_session.status AS cash_session_status,
            terminal.status AS terminal_status, terminal.cash_management_enabled, terminal.cash_drawer, terminal.code AS terminal_code
       FROM tenant.pos_carts cart
       JOIN tenant.pos_stores store ON store.organization_id = cart.organization_id AND store.id = cart.store_id
       JOIN tenant.pos_shifts shift ON shift.organization_id = cart.organization_id AND shift.id = cart.shift_id
       LEFT JOIN tenant.pos_cash_sessions cash_session ON cash_session.organization_id = shift.organization_id AND cash_session.id = shift.cash_session_id
       JOIN tenant.pos_terminals terminal ON terminal.organization_id = cart.organization_id AND terminal.id = cart.terminal_id
      WHERE cart.organization_id = $1 AND cart.id = $2 ${lock ? "FOR UPDATE OF cart" : ""}`, [context.organizationId, cartId])).rows[0];
  if (!cart) throw posError(404, "POS cart was not found.", "POS_CART_NOT_FOUND");
  await assertPosStoreAccess(client, context, cart.store_id, cart.terminal_id);
  const payments = (await client.query(
    `SELECT * FROM tenant.pos_payments WHERE organization_id = $1 AND cart_id = $2 ORDER BY initiated_at`, [context.organizationId, cartId])).rows;
  const open = payments.filter((payment) => !payment.sale_id);
  const captured = open.filter((payment) => payment.payment_method !== "cash" && payment.status === "captured");
  const pendingNonCash = open.filter((payment) => payment.payment_method !== "cash" && ["initiated", "pending", "authorized"].includes(payment.status));
  const pendingCash = open.find((payment) => payment.payment_method === "cash" && ["pending", "reconciliation_required"].includes(payment.custody_status)) ?? null;
  const total = decimal(cart.grand_total ?? 0);
  const nonCash = captured.reduce((sum, payment) => add(sum, decimal(payment.amount)), decimal(0));
  const cashHeld = pendingCash ? decimal(pendingCash.amount) : decimal(0);
  const due = sub(sub(total, nonCash), cashHeld);
  const decimalPlaces = await resolveCurrencyDecimalPlaces(client, context, cart.store_currency ?? cart.currency_code);
  return { cart, payments, captured, pendingNonCash, pendingCash, total, nonCash, cashHeld, due: due > 0n ? due : decimal(0), decimalPlaces };
}

const tenderView = (payment) => (payment ? {
  id: payment.id, status: payment.sale_id ? "COMPLETED" : payment.custody_status === "pending" ? "CASH_RECEIVED_PENDING_FINALIZATION"
    : payment.custody_status === "returned" ? "CANCELLED_RETURNED" : payment.custody_status === "reconciliation_required" ? "RECONCILIATION_REQUIRED" : String(payment.status).toUpperCase(),
  cashReceivedAmount: payment.cash_received_amount === null ? null : formatDecimal(decimal(payment.cash_received_amount), 2),
  amountApplied: formatDecimal(decimal(payment.amount), 2),
  changeGivenAmount: payment.change_given_amount === null ? null : formatDecimal(decimal(payment.change_given_amount), 2),
  retainedAmount: payment.cash_received_amount === null ? null : formatDecimal(sub(decimal(payment.cash_received_amount), decimal(payment.change_given_amount ?? 0)), 2),
  shiftId: payment.shift_id, terminalId: payment.terminal_id, saleId: payment.sale_id, confirmedAt: payment.cash_receipt_confirmed_at, completedAt: payment.completed_at,
  finalizationError: payment.finalization_error ?? null, note: payment.custody_note ?? null,
} : null);

const money = (value) => formatDecimal(decimal(value), 2);

// Which methods this checkout can take, the amount due, and the cash options (quick amounts, limits, drawer).
export async function getPosCheckoutPaymentMethods(client, context, cartId) {
  requirePermission(context, "pos.view");
  const policy = await cashPolicy(client, context);
  const state = await loadCheckout(client, context, cartId);
  const methods = [];
  for (const method of ["cash", "upi", "card"]) {
    const enabled = await isTerminalPaymentMethodEnabled(client, context.organizationId, state.cart.terminal_id, method);
    const cashBlock = method === "cash" ? (!policy.cash_payments_enabled || !enabled ? "POS_CASH_PAYMENT_DISABLED" : state.cart.shift_status !== "open" ? "POS_CASH_SESSION_CLOSED"
      : state.cart.cash_session_status !== "open" ? "POS_SHIFT_CASH_SESSION_REQUIRED" : null) : null;
    methods.push({ method, enabled: method === "cash" ? !cashBlock : enabled,
      reason: cashBlock ? (POS_CASH_MESSAGES[cashBlock] ?? POS_SHIFT_MESSAGES[cashBlock]) : enabled ? null : "Not available on this terminal." });
  }
  return {
    cartId, cartVersion: Number(state.cart.version), currency: state.cart.store_currency ?? state.cart.currency_code, grandTotal: money(state.total), amountDue: money(state.due),
    paidNonCash: money(state.nonCash), methods,
    cash: { enabled: methods[0].enabled, quickAmounts: policy.cash_quick_amounts_enabled ? suggestCashTenderAmounts(state.due, policy.cash_denominations) : [],
      maxTender: policy.max_cash_tender_amount === null ? null : money(policy.max_cash_tender_amount),
      warnAbove: policy.large_cash_warning_amount === null ? null : money(policy.large_cash_warning_amount), drawerConfigured: Boolean(state.cart.cash_drawer),
      pending: tenderView(state.pendingCash) },
  };
}

// What a cash amount would do — settle, change, or what is still due — without recording anything.
export async function previewPosCashPayment(client, context, cartId, input = {}) {
  requirePermission(context, "pos.view");
  const policy = await cashPolicy(client, context);
  const state = await loadCheckout(client, context, cartId);
  const currency = state.cart.store_currency ?? state.cart.currency_code;
  let received;
  try {
    if (input.currency && String(input.currency).toUpperCase() !== String(currency).toUpperCase()) throw cashError(400, "POS_CASH_CURRENCY_MISMATCH");
    received = readCashAmount(input.cashReceived, state.decimalPlaces, policy);
  } catch (error) {
    return { status: "INVALID", issues: [{ code: error.code, message: error.message }], amountDue: money(state.due), currency };
  }
  const applied = min(received, state.due);
  const change = sub(received, applied);
  const remaining = sub(state.due, applied);
  const warnings = [];
  if (policy.large_cash_warning_amount !== null && received >= decimal(policy.large_cash_warning_amount))
    warnings.push({ code: "POS_CASH_LARGE_AMOUNT", message: `This is a large cash amount (${money(received)}). Check the notes and any limits that apply to cash receipts.` });
  return {
    status: remaining > 0n ? "INSUFFICIENT" : "SUFFICIENT", issues: [], warnings, currency, amountDue: money(state.due), cashReceivedAmount: money(received),
    amountApplied: money(applied), changeDueAmount: money(change), remainingAmount: money(remaining), netCashRetained: money(applied),
    splitAvailable: remaining > 0n && (await isTerminalPaymentMethodEnabled(client, context.organizationId, state.cart.terminal_id, "upi")
      || await isTerminalPaymentMethodEnabled(client, context.organizationId, state.cart.terminal_id, "card")),
  };
}

async function cashMovement(client, context, payment, eventType, signedAmount, key, reason) {
  const number = await nextDocumentNumber(client, context, { documentType: "pos_cash_movement", prefix: "CASH" });
  await client.query(
    `INSERT INTO tenant.pos_cash_movements (organization_id, shift_id, movement_number, movement_type, amount, reason, reference_type, reference_id, created_by,
       cash_event, payment_id, terminal_id, store_id, currency_code, idempotency_key)
     VALUES ($1,$2,$3,'sale',$4,$5,'pos_cart',$6,$7,$8,$9,$10,$11,$12,$13)`,
    [context.organizationId, payment.shift_id, number, asDatabaseDecimal(signedAmount), reason, payment.cart_id, context.userId, eventType, payment.id, payment.terminal_id,
      payment.store_id, payment.currency_code, key]);
}

// Finalise the sale with the cash in hand (and any captured card / UPI payments) through the one checkout path. Inside a savepoint: if it
// fails, the cash tender and its movements stay; the failure is kept on the tender for the cashier to act on.
async function finalizeWithin(client, context, cartId, tender, key) {
  const captured = (await client.query(
    `SELECT id, payment_method FROM tenant.pos_payments WHERE organization_id=$1 AND cart_id=$2 AND sale_id IS NULL AND status='captured' AND payment_method <> 'cash'`,
    [context.organizationId, cartId])).rows;
  await client.query("SAVEPOINT pos_cash_finalize");
  try {
    const sale = await completePosCart(client, context, cartId, {
      payments: [{ method: "cash", paymentId: tender.id }, ...captured.map((payment) => ({ method: payment.payment_method, paymentId: payment.id }))],
      idempotencyKey: `${key}:finalize`,
    });
    await client.query("RELEASE SAVEPOINT pos_cash_finalize");
    await event(client, context, "payment", tender.id, "pos.cash.completed", { saleId: sale.id, amount: tender.amount });
    return { sale, error: null };
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT pos_cash_finalize");
    await client.query("RELEASE SAVEPOINT pos_cash_finalize");
    const failure = { code: error.code ?? "POS_CASH_STOCK_FINALIZATION_FAILED", message: error.message };
    await client.query(`UPDATE tenant.pos_payments SET finalization_error=$3, updated_at=now() WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, tender.id, `${failure.code}: ${failure.message}`.slice(0, 500)]);
    await event(client, context, "payment", tender.id, "pos.cash.finalization_failed", failure);
    // Stock Reduction: a paid bill whose sale could not take its stock is marked for stock recovery (payments kept).
    await markPosStockRecovery(client, context, cartId, failure);
    return { sale: null, error: failure };
  }
}

async function outcome(client, context, cartId, tender, result, drawer) {
  const payment = (await client.query(`SELECT * FROM tenant.pos_payments WHERE organization_id=$1 AND id=$2`, [context.organizationId, tender.id])).rows[0];
  const view = tenderView(payment);
  const state = await loadCheckout(client, context, cartId);
  return {
    status: result?.sale ? "COMPLETED" : view.status, paymentMethod: "CASH", currency: payment.currency_code, payment: view,
    cashReceivedAmount: view.cashReceivedAmount, amountApplied: view.amountApplied, changeGivenAmount: view.changeGivenAmount, remainingAmount: money(state.due),
    saleStatus: result?.sale ? "COMPLETED" : "NOT_FINALIZED", sale: result?.sale ?? null, saleId: payment.sale_id ?? null, receiptAvailable: Boolean(payment.sale_id),
    error: result?.error ? { ...result.error, code: "POS_CASH_STOCK_FINALIZATION_FAILED", cause: result.error.code,
      message: `${POS_CASH_MESSAGES.POS_CASH_STOCK_FINALIZATION_FAILED} ${result.error.message}` } : null,
    recovery: payment.sale_id ? null : ["Try completing the sale again", "Or hand the cash back and record it (Return cash)"],
    drawer,
  };
}

// The cashier confirms having physically received the cash. input: cashReceived, changeGiven (optional — must equal the change the server
// works out), currency, split (true: cash pays only part, the rest by card / UPI), expectedVersion, idempotencyKey.
export async function confirmPosCashPayment(client, context, cartId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const policy = await cashPolicy(client, context);
  let idempotency;
  try {
    idempotency = await beginIdempotentOperation(client, context, {
      operation: "pos.cash.confirm", key: input.idempotencyKey, required: true,
      payload: { cartId, cashReceived: String(input.cashReceived ?? "").trim(), changeGiven: input.changeGiven ?? null, split: Boolean(input.split), applyAmount: input.applyAmount ?? null },
    });
  } catch (error) {
    if (/IDEMPOTENCY/.test(error.code ?? "")) throw cashError(409, "POS_CASH_IDEMPOTENCY_CONFLICT");
    throw error;
  }
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };

  let state = await loadCheckout(client, context, cartId, { lock: true });
  const { cart } = state;
  if (cart.status === "completed") throw cashError(409, "POS_CASH_PAYMENT_ALREADY_COMPLETED", undefined, { saleId: cart.completed_sale_id });
  if (!["draft", "priced"].includes(cart.status)) throw cashError(409, "POS_CASH_CHECKOUT_CHANGED", `This bill is ${cart.status}.`);
  if (input.expectedVersion !== undefined && input.expectedVersion !== null && Number(input.expectedVersion) !== Number(cart.version))
    throw cashError(409, "POS_CASH_VERSION_CONFLICT");
  if (cart.shift_status !== "open" || cart.shift_lifecycle !== "OPEN") throw cashError(409, "POS_CASH_SESSION_CLOSED");
  if (!policy.cash_payments_enabled || !(await isTerminalPaymentMethodEnabled(client, context.organizationId, cart.terminal_id, "cash")))
    throw cashError(409, "POS_CASH_PAYMENT_DISABLED");
  // Shift Opening (0103): a card / UPI shift takes no cash until its drawer is counted into a cash session.
  if (cart.cash_session_status !== "open") throw posError(409, POS_SHIFT_MESSAGES.POS_SHIFT_CASH_SESSION_REQUIRED, "POS_SHIFT_CASH_SESSION_REQUIRED");
  const currency = cart.store_currency ?? cart.currency_code;
  if (input.currency && String(input.currency).toUpperCase() !== String(currency).toUpperCase()) throw cashError(400, "POS_CASH_CURRENCY_MISMATCH");
  try { await assertPosAction(client, context, { permission: "SALE_COMPLETE", outletId: cart.store_id }); }
  catch (error) { throw cashError(403, "POS_CASH_PERMISSION_DENIED", `${POS_CASH_MESSAGES.POS_CASH_PERMISSION_DENIED} ${error.message}`); }
  if (state.pendingCash) throw cashError(409, state.pendingCash.custody_status === "reconciliation_required" ? "POS_CASH_PAYMENT_RECONCILIATION_REQUIRED" : "POS_CASH_PAYMENT_PENDING",
    undefined, { payment: tenderView(state.pendingCash) });
  if (state.pendingNonCash.length) throw cashError(409, "POS_CASH_SPLIT_BALANCE_PENDING", "A card or UPI payment on this bill is still processing. Wait for it first.");
  const received = readCashAmount(input.cashReceived, state.decimalPlaces, policy);

  // The bill is checked (stock, tax, discounts, limits) and locked for payment before cash is accepted.
  if (!cart.checkout_started_at) {
    try { await ensurePosCheckoutStarted(client, context, cartId); }
    catch (error) {
      // An invoice that could not be issued (GST Invoice, 0098) keeps its own code, so the screen can say exactly what to fix.
      const issues = error.details?.issues ?? [];
      const invoiceIssue = issues.find((issue) => String(issue.code ?? "").startsWith("POS_INVOICE_"));
      if (invoiceIssue) { const failure = posError(409, invoiceIssue.message, invoiceIssue.code); failure.details = { issues }; throw failure; }
      throw cashError(409, "POS_CASH_CHECKOUT_CHANGED", error.message, { issues });
    }
    state = await loadCheckout(client, context, cartId, { lock: true });
  }
  if (state.due <= 0n) throw cashError(409, "POS_CASH_PAYMENT_ALREADY_COMPLETED", "Nothing is left to pay on this bill.");
  // Split Payments: cash may settle only its planned part (applyAmount); anything handed over above that part is change.
  let target = state.due;
  if (input.applyAmount !== undefined && input.applyAmount !== null && String(input.applyAmount).trim() !== "") {
    const part = String(input.applyAmount).trim();
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(part) || decimal(part) <= 0n) throw cashError(400, "POS_CASH_AMOUNT_INVALID", "Enter a valid cash part.");
    target = min(decimal(part), state.due);
  }
  const applied = min(received, target);
  const change = sub(received, applied);
  if (applied < target && !input.split) throw cashError(409, "POS_CASH_AMOUNT_INSUFFICIENT", `${POS_CASH_MESSAGES.POS_CASH_AMOUNT_INSUFFICIENT} ${money(sub(state.due, applied))} is still due.`,
    { remainingAmount: money(sub(state.due, applied)), amountDue: money(state.due) });
  await assertSplitAllowed(client, context, state, "cash", applied);
  if (input.changeGiven !== undefined && input.changeGiven !== null && String(input.changeGiven).trim() !== "") {
    if (!/^\d+(\.\d+)?$/.test(String(input.changeGiven).trim()) || decimal(String(input.changeGiven).trim()) !== change)
      throw cashError(409, "POS_CASH_CHANGE_INVALID", `${POS_CASH_MESSAGES.POS_CASH_CHANGE_INVALID} The change for ${money(received)} is ${money(change)}.`, { changeDueAmount: money(change) });
  }

  const tender = (await client.query(
    `INSERT INTO tenant.pos_payments (organization_id, cart_id, shift_id, store_id, terminal_id, payment_method, amount, status, currency_code, provider_key, idempotency_key,
       created_by, initiated_by, cart_version, cash_received_amount, change_due_amount, change_given_amount, cash_receipt_confirmed_at, change_confirmed_at, custody_status)
     VALUES ($1,$2,$3,$4,$5,'cash',$6,'pending',$7,'cash',$8,$9,$9,$10,$11,$12,$12,now(),CASE WHEN $12::numeric > 0 THEN now() END,'pending') RETURNING *`,
    [context.organizationId, cartId, cart.shift_id, cart.store_id, cart.terminal_id, asDatabaseDecimal(applied), currency, input.idempotencyKey, context.userId, state.cart.version,
      asDatabaseDecimal(received), asDatabaseDecimal(change)])).rows[0];
  await cashMovement(client, context, tender, "sale_cash_received", received, `${input.idempotencyKey}:received`, "Cash received");
  if (change > 0n) await cashMovement(client, context, tender, "sale_change_given", sub(decimal(0), change), `${input.idempotencyKey}:change`, "Change given");
  await event(client, context, "payment", tender.id, "pos.cash.received", { cartId, shiftId: cart.shift_id, received: money(received), change: money(change), applied: money(applied) });
  const drawer = { configured: Boolean(cart.cash_drawer), command: cart.cash_drawer ? "open" : null,
    message: cart.cash_drawer ? "Open the cash drawer. If it does not open, use the key and carry on." : "Put the cash in the drawer." };
  if (cart.cash_drawer) await event(client, context, "payment", tender.id, "pos.cash.drawer_open_requested", { terminalId: cart.terminal_id });

  const result = applied === state.due && input.complete !== false ? await finalizeWithin(client, context, cartId, tender, input.idempotencyKey) : null;
  const response = await outcome(client, context, cartId, tender, result, drawer);
  await completeIdempotentOperation(client, context, idempotency, { response, aggregateType: "pos_payment", aggregateId: tender.id });
  return response;
}

// Try again to finalise a bill whose cash is in hand (after a stock, tax or network problem). input: idempotencyKey.
export async function finalizePosCashPayment(client, context, cartId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const state = await loadCheckout(client, context, cartId, { lock: true });
  if (state.cart.status === "completed") {
    const done = state.payments.find((payment) => payment.payment_method === "cash" && payment.sale_id);
    if (done) return outcome(client, context, cartId, done, null, null);
    throw cashError(409, "POS_CASH_PAYMENT_ALREADY_COMPLETED");
  }
  if (!state.pendingCash) throw cashError(409, "POS_CASH_PAYMENT_PENDING", "There is no cash in hand on this bill to finalise.");
  if (state.pendingCash.custody_status === "reconciliation_required") throw cashError(409, "POS_CASH_PAYMENT_RECONCILIATION_REQUIRED");
  if (state.due > 0n) throw cashError(409, "POS_CASH_SPLIT_BALANCE_PENDING", `${POS_CASH_MESSAGES.POS_CASH_SPLIT_BALANCE_PENDING} ${money(state.due)} is still due.`);
  const key = input.idempotencyKey ?? `${state.pendingCash.id}:retry:${Date.now()}`;
  const result = await finalizeWithin(client, context, cartId, state.pendingCash, key);
  return outcome(client, context, cartId, state.pendingCash, result, null);
}

// Hand back cash taken for a bill that will not be finalised. The cashier confirms the cash went back to the customer; a movement takes the
// retained amount (received less change) out of the session. input: reason, cashReturned (true), returnedAmount (optional, must match),
// idempotencyKey.
export async function returnPosCashTender(client, context, cartId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const idempotency = await beginIdempotentOperation(client, context, {
    operation: "pos.cash.return", key: input.idempotencyKey, required: true, payload: { cartId, returnedAmount: input.returnedAmount ?? null, cashReturned: Boolean(input.cashReturned) },
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };
  const state = await loadCheckout(client, context, cartId, { lock: true });
  const tender = state.pendingCash;
  if (!tender) {
    const completed = state.payments.find((payment) => payment.payment_method === "cash" && payment.sale_id);
    if (completed) throw cashError(409, "POS_CASH_PAYMENT_ALREADY_COMPLETED", "This cash is part of a completed sale: use a return and refund.");
    throw cashError(404, "POS_CASH_PAYMENT_PENDING", "There is no cash in hand on this bill.");
  }
  try { await assertPosAction(client, context, { permission: "PAYMENT_VOID_PENDING", outletId: state.cart.store_id, reason: input.reason }); }
  catch (error) { throw cashError(403, "POS_CASH_PERMISSION_DENIED", `${POS_CASH_MESSAGES.POS_CASH_PERMISSION_DENIED} ${error.message}`); }
  if (input.cashReturned !== true) throw cashError(409, "POS_CASH_RETURN_NOT_CONFIRMED", undefined, { retainedAmount: tenderView(tender).retainedAmount });
  const retained = sub(decimal(tender.cash_received_amount), decimal(tender.change_given_amount ?? 0));
  if (input.returnedAmount !== undefined && input.returnedAmount !== null && String(input.returnedAmount).trim() !== ""
      && (!/^\d+(\.\d+)?$/.test(String(input.returnedAmount).trim()) || decimal(String(input.returnedAmount).trim()) !== retained))
    throw cashError(409, "POS_CASH_RETURN_NOT_CONFIRMED", `Return exactly ${money(retained)} (the cash received less the change already given).`, { retainedAmount: money(retained) });
  await cashMovement(client, context, tender, "uncompleted_tender_cash_returned", sub(decimal(0), retained), `${input.idempotencyKey}:returned`,
    String(input.reason ?? "Cash handed back").trim().slice(0, 200) || "Cash handed back");
  await client.query(
    `UPDATE tenant.pos_payments SET status='voided', voided_at=now(), custody_status='returned', custody_resolved_at=now(), custody_resolved_by=$3, custody_note=$4,
            version=version+1, updated_at=now() WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, tender.id, context.userId, String(input.reason ?? "").trim().slice(0, 500) || null]);
  await event(client, context, "payment", tender.id, "pos.cash.returned", { cartId, returned: money(retained), reason: input.reason ?? null });
  const response = await outcome(client, context, cartId, tender, null, null);
  await completeIdempotentOperation(client, context, idempotency, { response, aggregateType: "pos_payment", aggregateId: tender.id });
  return response;
}

// Mark cash in hand for a supervisor to resolve (the cashier cannot settle what happened). It stays in custody — the session still cannot
// close — until it is finalised or handed back.
export async function flagPosCashTenderForReconciliation(client, context, cartId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const state = await loadCheckout(client, context, cartId, { lock: true });
  if (!state.pendingCash) throw cashError(404, "POS_CASH_PAYMENT_PENDING", "There is no cash in hand on this bill.");
  const note = String(input.note ?? "").trim();
  if (!note) throw cashError(400, "POS_CASH_PAYMENT_RECONCILIATION_REQUIRED", "Say what needs to be reconciled.");
  await client.query(`UPDATE tenant.pos_payments SET custody_status='reconciliation_required', custody_note=$3, version=version+1, updated_at=now() WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, state.pendingCash.id, note.slice(0, 500)]);
  await event(client, context, "payment", state.pendingCash.id, "pos.cash.reconciliation_required", { cartId, note });
  return outcome(client, context, cartId, state.pendingCash, null, null);
}

// A supervisor settles a flagged tender: complete the sale with it, or record that the cash went back to the customer.
export async function resolvePosCashReconciliation(client, context, cartId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const state = await loadCheckout(client, context, cartId, { lock: true });
  const tender = state.pendingCash;
  if (!tender || tender.custody_status !== "reconciliation_required") throw cashError(409, "POS_CASH_PAYMENT_RECONCILIATION_REQUIRED", "There is nothing flagged to reconcile on this bill.");
  const reason = String(input.note ?? input.reason ?? "").trim();
  if (!reason) throw cashError(400, "POS_CASH_PAYMENT_RECONCILIATION_REQUIRED", "Say how the flagged cash was resolved.");
  const decision = await authorizePosAction(client, context, { permission: "SESSION_CLOSE_OTHER", outletId: state.cart.store_id, reason });
  if (decision.decision !== "ALLOW") throw cashError(403, "POS_CASH_PERMISSION_DENIED", `A supervisor resolves flagged cash. ${decision.message ?? ""}`.trim());
  await client.query(`UPDATE tenant.pos_payments SET custody_status='pending', custody_note=COALESCE(custody_note,'') || $3, version=version+1, updated_at=now()
                       WHERE organization_id=$1 AND id=$2`, [context.organizationId, tender.id, ` — reviewed: ${String(input.note ?? "").slice(0, 200)}`]);
  await event(client, context, "payment", tender.id, "pos.cash.reconciled", { cartId, resolution: input.resolution, note: input.note ?? null });
  if (input.resolution === "return") return returnPosCashTender(client, context, cartId, { ...input, cashReturned: true });
  return finalizePosCashPayment(client, context, cartId, input);
}

// The checkout's payments and balance: total, paid, due, every tender with its state.
export async function getPosCheckoutPayments(client, context, cartId) {
  requirePermission(context, "pos.view");
  const state = await loadCheckout(client, context, cartId);
  return {
    cartId, status: state.cart.status === "completed" ? "COMPLETED" : state.pendingCash ? tenderView(state.pendingCash).status : state.cart.checkout_started_at ? "CHECKOUT_PENDING" : "OPEN",
    cartVersion: Number(state.cart.version), currency: state.cart.store_currency ?? state.cart.currency_code, grandTotal: money(state.total), paidNonCash: money(state.nonCash),
    cashHeld: money(state.cashHeld), amountDue: money(state.due), saleId: state.cart.completed_sale_id ?? null,
    payments: state.payments.map((payment) => ({ id: payment.id, method: payment.payment_method, status: payment.status, amount: money(payment.amount), saleId: payment.sale_id,
      cash: payment.payment_method === "cash" ? tenderView(payment) : null })),
    pendingCash: tenderView(state.pendingCash),
  };
}

// One payment, with its cash movements.
export async function getPosPaymentDetail(client, context, paymentId) {
  requirePermission(context, "pos.view");
  const payment = (await client.query(`SELECT * FROM tenant.pos_payments WHERE organization_id=$1 AND id=$2`, [context.organizationId, paymentId])).rows[0];
  if (!payment) throw posError(404, "POS payment was not found.", "POS_PAYMENT_NOT_FOUND");
  if (payment.store_id) await assertPosStoreAccess(client, context, payment.store_id);
  const movements = (await client.query(
    `SELECT id, movement_number, cash_event, amount::text, reason, created_at, shift_id FROM tenant.pos_cash_movements WHERE organization_id=$1 AND payment_id=$2 ORDER BY created_at`,
    [context.organizationId, paymentId])).rows;
  return { id: payment.id, method: payment.payment_method, status: payment.status, amount: money(payment.amount), currency: payment.currency_code, saleId: payment.sale_id,
    cartId: payment.cart_id, shiftId: payment.shift_id, cash: payment.payment_method === "cash" ? tenderView(payment) : null, movements };
}

// A cash session's cash: every cash tender and movement, received / change / net, handed back, refunds, cash in hand still pending, and
// (for those who may see it) the expected cash.
export async function listPosSessionCashPayments(client, context, shiftId) {
  requirePermission(context, "pos.view");
  const shift = (await client.query(`SELECT * FROM tenant.pos_shifts WHERE organization_id=$1 AND id=$2`, [context.organizationId, shiftId])).rows[0];
  if (!shift) throw posError(404, "Shift was not found.", "POS_SHIFT_NOT_FOUND");
  await assertPosStoreAccess(client, context, shift.store_id);
  const payments = (await client.query(
    `SELECT payment.*, sale.receipt_number FROM tenant.pos_payments payment LEFT JOIN tenant.pos_sales sale ON sale.organization_id = payment.organization_id AND sale.id = payment.sale_id
      WHERE payment.organization_id=$1 AND payment.shift_id=$2 AND payment.payment_method='cash' ORDER BY payment.initiated_at`, [context.organizationId, shiftId])).rows;
  const movements = (await client.query(
    `SELECT id, movement_number, movement_type, cash_event, amount::text, reason, payment_id, created_at FROM tenant.pos_cash_movements WHERE organization_id=$1 AND shift_id=$2 ORDER BY created_at`,
    [context.organizationId, shiftId])).rows;
  const sum = (filter) => money(movements.filter(filter).reduce((total, movement) => add(total, decimal(movement.amount)), decimal(0)));
  const canSeeExpected = shift.cashier_user_id !== context.userId || (await authorizePosAction(client, context, { permission: "SESSION_VIEW_EXPECTED_CASH", outletId: shift.store_id })).decision === "ALLOW";
  return {
    shiftId, status: shift.status,
    summary: {
      received: sum((movement) => movement.cash_event === "sale_cash_received"), change: sum((movement) => movement.cash_event === "sale_change_given"),
      salesNet: sum((movement) => ["sale_cash_received", "sale_change_given", "sale_net"].includes(movement.cash_event) && !payments.some((payment) => payment.id === movement.payment_id && !payment.sale_id)),
      returned: sum((movement) => movement.cash_event === "uncompleted_tender_cash_returned"), refunds: sum((movement) => movement.cash_event === "cash_refund_paid"),
      pendingCustody: money(payments.filter((payment) => ["pending", "reconciliation_required"].includes(payment.custody_status))
        .reduce((total, payment) => add(total, sub(decimal(payment.cash_received_amount), decimal(payment.change_given_amount ?? 0))), decimal(0))),
      pendingCount: payments.filter((payment) => ["pending", "reconciliation_required"].includes(payment.custody_status)).length,
      expected: canSeeExpected ? sum(() => true) : null,
    },
    payments: payments.map((payment) => ({ ...tenderView(payment), receiptNumber: payment.receipt_number ?? null, cartId: payment.cart_id })),
    movements,
  };
}

// Cash payments report: completed cash sales (the cash portion only, so mixed tenders reconcile), received, change, net, refunds, by outlet,
// terminal, cashier and session, cash's share of all payments, cash in mixed tenders, cash in hand still pending, tenders handed back, and
// session variances. input: from, to, storeId.
export async function getPosCashPaymentSummary(client, context, input = {}) {
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
  const scope = `payment.organization_id = $1 AND payment.initiated_at >= $2::date AND payment.initiated_at < $3::date + 1${filters.length ? ` AND ${filters.join(" AND ")}` : ""}`;
  const query = async (sql) => (await client.query(sql, values)).rows;
  const done = `payment.sale_id IS NOT NULL AND payment.status IN ('captured', 'partially_refunded', 'refunded')`;
  const [totals] = await query(
    `SELECT COALESCE(sum(payment.amount) FILTER (WHERE payment.payment_method = 'cash' AND ${done}), 0)::text AS cash_sales,
            count(DISTINCT payment.sale_id) FILTER (WHERE payment.payment_method = 'cash' AND ${done})::int AS cash_sale_count,
            COALESCE(sum(COALESCE(payment.cash_received_amount, payment.amount)) FILTER (WHERE payment.payment_method = 'cash' AND ${done}), 0)::text AS received,
            COALESCE(sum(COALESCE(payment.change_given_amount, 0)) FILTER (WHERE payment.payment_method = 'cash' AND ${done}), 0)::text AS change,
            COALESCE(sum(payment.amount) FILTER (WHERE ${done}), 0)::text AS all_payments,
            COALESCE(sum(payment.amount) FILTER (WHERE payment.payment_method = 'cash' AND ${done}
              AND EXISTS (SELECT 1 FROM tenant.pos_payments other WHERE other.organization_id = payment.organization_id AND other.sale_id = payment.sale_id AND other.payment_method <> 'cash')), 0)::text AS split_cash,
            COALESCE(sum(payment.cash_received_amount - COALESCE(payment.change_given_amount, 0)) FILTER (WHERE payment.payment_method = 'cash' AND payment.custody_status IN ('pending', 'reconciliation_required')), 0)::text AS pending_custody,
            count(*) FILTER (WHERE payment.payment_method = 'cash' AND payment.custody_status = 'returned')::int AS returned_count,
            COALESCE(sum(payment.cash_received_amount - COALESCE(payment.change_given_amount, 0)) FILTER (WHERE payment.payment_method = 'cash' AND payment.custody_status = 'returned'), 0)::text AS returned
       FROM tenant.pos_payments payment WHERE ${scope}`);
  const group = (column, join, label) => query(
    `SELECT ${label} AS name, count(DISTINCT payment.sale_id)::int AS sales, COALESCE(sum(payment.amount), 0)::text AS cash,
            COALESCE(sum(COALESCE(payment.cash_received_amount, payment.amount)), 0)::text AS received, COALESCE(sum(COALESCE(payment.change_given_amount, 0)), 0)::text AS change
       FROM tenant.pos_payments payment ${join} WHERE ${scope} AND payment.payment_method = 'cash' AND ${done} GROUP BY ${column} ORDER BY sum(payment.amount) DESC`);
  const byOutlet = await group("store.name", "JOIN tenant.pos_stores store ON store.organization_id = payment.organization_id AND store.id = payment.store_id", "store.name");
  const byTerminal = await group("terminal.code", "LEFT JOIN tenant.pos_terminals terminal ON terminal.organization_id = payment.organization_id AND terminal.id = payment.terminal_id", "COALESCE(terminal.code, '—')");
  const byCashier = await group("person.full_name", "JOIN public.users person ON person.id = payment.created_by", "person.full_name");
  // By session id (shift numbers can repeat across terminals), labelled with its number and opening time.
  const bySession = await group("shift.id", "JOIN tenant.pos_shifts shift ON shift.organization_id = payment.organization_id AND shift.id = payment.shift_id",
    "max(shift.shift_number) || ' · ' || to_char(max(shift.opened_at), 'DD Mon HH24:MI')");
  const refundValues = [context.organizationId, from, to];
  const [refunds] = (await client.query(
    `SELECT COALESCE(-sum(amount), 0)::text AS refunds FROM tenant.pos_cash_movements WHERE organization_id=$1 AND cash_event='cash_refund_paid' AND created_at >= $2::date AND created_at < $3::date + 1`,
    refundValues)).rows;
  const [variance] = (await client.query(
    `SELECT COALESCE(sum(cash_variance) FILTER (WHERE cash_variance < 0), 0)::text AS shortages, COALESCE(sum(cash_variance) FILTER (WHERE cash_variance > 0), 0)::text AS excesses,
            count(*) FILTER (WHERE cash_variance <> 0)::int AS sessions_with_variance
       FROM tenant.pos_shifts WHERE organization_id=$1 AND closed_at >= $2::date AND closed_at < $3::date + 1`, refundValues)).rows;
  const share = Number(totals.all_payments) > 0 ? ((Number(totals.cash_sales) / Number(totals.all_payments)) * 100).toFixed(1) : "0.0";
  return { from, to, totals: { ...totals, net: totals.cash_sales, refunds: refunds.refunds, cash_share_percent: share, ...variance }, byOutlet, byTerminal, byCashier, bySession };
}
