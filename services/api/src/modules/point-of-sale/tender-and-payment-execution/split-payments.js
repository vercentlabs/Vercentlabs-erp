// POS Split Payments (migration 0095): one bill, up to three tenders (cash, card, UPI — one of each), one sale and one invoice. The cashier
// plans the split; each part is collected through its own handler — cash custody (cash-payments.js), the card terminal (card-payments.js),
// the UPI QR (upi-payments.js) — never re-implemented here, and one external attempt at a time. A part that has started cannot be edited;
// a confirmed part never changes. The sale is finalised by the one checkout path only when the confirmed parts add up to the bill exactly
// (finalizeCheckout). Cancelling compensates every part already collected — card / UPI refunded through the provider, cash handed back and
// recorded — and the bill stays locked until each compensation is resolved; then it returns to an editable bill.
//
// Three figures, never mixed: payable (the locked bill total), confirmed (parts accepted as settling it: cash in hand, captured card / UPI,
// provisionally accepted attested payments) and remaining (payable − confirmed). Unallocated is what is remaining and not yet assigned to a
// part that is planned or in progress.
import { add, sub, max, decimal, formatDecimal } from "../../../core/decimal.js";
import { beginIdempotentOperation, completeIdempotentOperation } from "../../../core/idempotency.js";
import { isTerminalPaymentMethodEnabled } from "../terminals/index.js";
import { assertPosAction } from "../permissions/index.js";
import { releasePosCheckout } from "../assortment-pricing-customer-and-cart/cart.js";
import { posError } from "../shared/errors.js";
import { requirePermission, accessiblePosStoreIds } from "../shared/access-control.js";
import { event } from "../shared/audit.js";
import { confirmPosCashPayment, loadCheckout, returnPosCashTender } from "./cash-payments.js";
import { cancelPosCardAttempt, finalizeCheckout, refundUnfinalizedCardPayment, startPosCardPayment } from "./card-payments.js";
import { startPosUpiPayment } from "./upi-payments.js";
import { LIVE_ATTEMPT_STATUSES } from "./card-status.js";

export const POS_SPLIT_MESSAGES = Object.freeze({
  POS_SPLIT_PAYMENT_DISABLED: "Split Payments are not enabled.",
  POS_SPLIT_PAYMENT_PERMISSION_DENIED: "You cannot complete this payment.",
  POS_SPLIT_PAYMENT_METHOD_DISABLED: "This payment method is unavailable.",
  POS_SPLIT_PAYMENT_AMOUNT_INVALID: "Enter a valid payment amount.",
  POS_SPLIT_PAYMENT_TOTAL_EXCEEDED: "Payment amounts exceed the bill total.",
  POS_SPLIT_PAYMENT_BALANCE_REMAINING: "More payment is needed to complete this bill.",
  POS_SPLIT_PAYMENT_DUPLICATE_METHOD: "This payment method is already included.",
  POS_SPLIT_PAYMENT_COMPONENT_LOCKED: "This payment has already started and cannot be edited.",
  POS_SPLIT_PAYMENT_EXTERNAL_ATTEMPT_ACTIVE: "Another digital payment is being processed.",
  POS_SPLIT_PAYMENT_UNKNOWN_OUTCOME: "Payment status is being checked. Do not charge again.",
  POS_SPLIT_PAYMENT_REFUND_REQUIRED: "Collected payment must be refunded before cancellation completes.",
  POS_SPLIT_PAYMENT_PARTIAL_REVERSAL: "Some payments still need reversal.",
  POS_SPLIT_PAYMENT_CASH_RETURN_REQUIRED: "Return the received cash to cancel this bill.",
  POS_SPLIT_PAYMENT_CHECKOUT_CHANGED: "This bill changed. Review the payment split.",
  POS_SPLIT_PAYMENT_VERSION_CONFLICT: "This checkout changed. Refresh and try again.",
  POS_SPLIT_PAYMENT_IDEMPOTENCY_CONFLICT: "This request conflicts with an earlier payment action.",
  POS_SPLIT_PAYMENT_RECONCILIATION_REQUIRED: "Some payments need verification before continuing.",
  POS_SPLIT_PAYMENT_COMPONENT_MISSING: "Add this payment method to the split first.",
});
const splitError = (status, code, message = POS_SPLIT_MESSAGES[code], details = undefined) => {
  const error = posError(status, message, code);
  if (details) error.details = details;
  return error;
};
const money = (value) => formatDecimal(decimal(value ?? 0), 2);
const METHODS = ["card", "upi", "cash"]; // the recommended collection order: electronic first, cash last
const LIVE_PAYMENT_STATUSES = ["initiated", "pending", "authorized"];

async function splitEnabled(client, context) {
  return (await client.query(`SELECT split_payments_enabled FROM tenant.pos_settings WHERE organization_id=$1`, [context.organizationId])).rows[0]?.split_payments_enabled ?? true;
}
async function methodAvailable(client, context, cart, method) {
  if (!(await isTerminalPaymentMethodEnabled(client, context.organizationId, cart.terminal_id, method))) return false;
  if (method === "cash") return (await client.query(`SELECT cash_payments_enabled FROM tenant.pos_settings WHERE organization_id=$1`, [context.organizationId])).rows[0]?.cash_payments_enabled ?? true;
  const config = (await client.query(
    `SELECT configuration_status, standalone_enabled, static_qr_enabled FROM tenant.pos_payment_provider_configs WHERE organization_id=$1 AND store_id=$2 AND payment_method=$3 AND active=true`,
    [context.organizationId, cart.store_id, method])).rows[0];
  return Boolean(config && (config.configuration_status === "ready" || config.standalone_enabled || config.static_qr_enabled));
}

// One part's state from its payments on the bill: confirmed (applied), in progress, failed, cancelled, reversed or only planned.
function componentFor(method, plan, payments) {
  const mine = payments.filter((payment) => (method === "upi" ? ["upi", "wallet", "bank_transfer"] : [method]).includes(payment.payment_method) && !payment.sale_id);
  const latest = mine[mine.length - 1] ?? null;
  const applied = method === "cash"
    ? mine.find((payment) => ["pending", "reconciliation_required"].includes(payment.custody_status))
    : mine.find((payment) => payment.status === "captured" && payment.recovery_status !== "refunded");
  const live = method === "cash" ? null : mine.find((payment) => LIVE_PAYMENT_STATUSES.includes(payment.status));
  const plannedAmount = plan ? decimal(plan.amount) : applied ? decimal(applied.amount) : live ? decimal(live.amount) : decimal(0);
  let status = "PROPOSED";
  if (applied) status = applied.recovery_status === "refund_requested" ? "REVERSAL_REQUIRED" : applied.custody_status === "reconciliation_required" ? "RECONCILIATION_REQUIRED" : "CONFIRMED";
  else if (live) status = live.attempt_status === "unknown" ? "UNKNOWN" : live.attempt_status === "cancel_pending" ? "CANCEL_PENDING"
    : live.attempt_status === "reconciliation_required" ? "RECONCILIATION_REQUIRED" : live.attempt_status === "awaiting_customer" ? "AWAITING_PAYMENT" : "PROCESSING";
  else if (latest && latest.recovery_status === "refunded") status = "REVERSED";
  else if (latest && latest.custody_status === "returned") status = "REVERSED";
  else if (latest && ["failed", "voided"].includes(latest.status) && plan) status = latest.attempt_status === "cancelled" ? "CANCELLED" : "FAILED";
  return {
    method, plannedAmount: money(plannedAmount), appliedAmount: money(applied ? applied.amount : 0), status,
    paymentId: (applied ?? live ?? latest)?.id ?? null, attemptStatus: (applied ?? live ?? latest)?.attempt_status ?? null,
    cash: method === "cash" && applied ? { received: money(applied.cash_received_amount), change: money(applied.change_given_amount) } : null,
    locked: Boolean(applied || live), sequence: plan?.sequence ?? METHODS.indexOf(method) + 1,
  };
}

// The authoritative state of a split checkout: the plan, each part's status, payable / confirmed / remaining / unallocated, and what to do next.
export async function getPosSplitPaymentStatus(client, context, cartId) {
  requirePermission(context, "pos.view");
  const state = await loadCheckout(client, context, cartId);
  const { cart } = state;
  const plan = Array.isArray(cart.split_plan) ? cart.split_plan : [];
  const methods = [...new Set([...plan.map((entry) => entry.method), ...state.payments.filter((payment) => !payment.sale_id && payment.status !== "voided" || payment.custody_status === "pending")
    .map((payment) => (["wallet", "bank_transfer"].includes(payment.payment_method) ? "upi" : payment.payment_method))])].filter((method) => METHODS.includes(method));
  const components = methods.map((method) => componentFor(method, plan.find((entry) => entry.method === method), state.payments))
    .sort((a, b) => a.sequence - b.sequence);
  const confirmed = add(state.nonCash, state.cashHeld);
  const remaining = max(sub(state.total, confirmed), decimal(0));
  const assigned = components.filter((component) => component.status !== "CONFIRMED" && !["FAILED", "CANCELLED", "REVERSED"].includes(component.status))
    .reduce((sum, component) => add(sum, decimal(component.plannedAmount)), decimal(0));
  const unallocated = max(sub(remaining, assigned), decimal(0));
  const busy = components.find((component) => ["AWAITING_PAYMENT", "PROCESSING", "UNKNOWN", "CANCEL_PENDING"].includes(component.status));
  const next = busy ? null : components.find((component) => ["PROPOSED", "FAILED", "CANCELLED"].includes(component.status));
  const available = {};
  for (const method of METHODS) available[method] = await methodAvailable(client, context, cart, method);
  return {
    cartId, checkoutStatus: cart.status === "completed" ? "COMPLETED" : cart.checkout_started_at ? "CHECKOUT_PENDING" : "DRAFT", currency: cart.store_currency ?? cart.currency_code,
    payableAmount: money(state.total), confirmedAppliedAmount: money(confirmed), remainingPayableAmount: money(remaining), unallocatedAmount: money(unallocated),
    planVersion: Number(cart.split_plan_version ?? 0), paymentMode: cart.payment_mode ?? (components.length > 1 ? "split" : "single"), splitEnabled: await splitEnabled(client, context),
    components, availableMethods: available, nextMethod: next?.method ?? null, activeMethod: busy?.method ?? null, saleId: cart.completed_sale_id ?? null,
    canFinalize: remaining === 0n && !busy && cart.status !== "completed",
  };
}

// Plan or change the split. Parts that have started keep their amount; the total can never exceed the bill. input: components [{ method,
// amount }], expectedPlanVersion, idempotencyKey.
export async function saveSplitPaymentPlan(client, context, cartId, input = {}) {
  requirePermission(context, "pos.sale.create");
  let idempotency;
  try {
    idempotency = await beginIdempotentOperation(client, context, { operation: "pos.split.plan", key: input.idempotencyKey, required: true,
      payload: { cartId, components: input.components ?? [], expectedPlanVersion: input.expectedPlanVersion ?? null } });
  } catch (error) {
    if (/IDEMPOTENCY/.test(error.code ?? "")) throw splitError(409, "POS_SPLIT_PAYMENT_IDEMPOTENCY_CONFLICT");
    throw error;
  }
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };
  const state = await loadCheckout(client, context, cartId, { lock: true });
  const { cart } = state;
  if (!(await splitEnabled(client, context))) throw splitError(409, "POS_SPLIT_PAYMENT_DISABLED");
  if (cart.status === "completed" || !["draft", "priced"].includes(cart.status)) throw splitError(409, "POS_SPLIT_PAYMENT_CHECKOUT_CHANGED");
  if (input.expectedPlanVersion !== undefined && input.expectedPlanVersion !== null && Number(input.expectedPlanVersion) !== Number(cart.split_plan_version ?? 0))
    throw splitError(409, "POS_SPLIT_PAYMENT_VERSION_CONFLICT");
  try { await assertPosAction(client, context, { permission: "SALE_COMPLETE", outletId: cart.store_id }); }
  catch (error) { throw splitError(403, "POS_SPLIT_PAYMENT_PERMISSION_DENIED", `${POS_SPLIT_MESSAGES.POS_SPLIT_PAYMENT_PERMISSION_DENIED} ${error.message}`); }
  const entries = Array.isArray(input.components) ? input.components : [];
  if (!entries.length || entries.length > 3) throw splitError(400, "POS_SPLIT_PAYMENT_AMOUNT_INVALID", "Plan one to three payment methods.");
  const seen = new Set();
  const plan = [];
  let total = decimal(0);
  for (const [index, entry] of entries.entries()) {
    const method = String(entry.method ?? "").trim().toLowerCase();
    if (!METHODS.includes(method)) throw splitError(400, "POS_SPLIT_PAYMENT_METHOD_DISABLED");
    if (seen.has(method)) throw splitError(409, "POS_SPLIT_PAYMENT_DUPLICATE_METHOD");
    seen.add(method);
    const text = String(entry.amount ?? "").trim();
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(text) || decimal(text) <= 0n) throw splitError(400, "POS_SPLIT_PAYMENT_AMOUNT_INVALID", `${POS_SPLIT_MESSAGES.POS_SPLIT_PAYMENT_AMOUNT_INVALID} (${method})`);
    if (!(await methodAvailable(client, context, cart, method))) throw splitError(409, "POS_SPLIT_PAYMENT_METHOD_DISABLED", `${method.toUpperCase()}: ${POS_SPLIT_MESSAGES.POS_SPLIT_PAYMENT_METHOD_DISABLED}`);
    const component = componentFor(method, null, state.payments);
    if (component.locked && decimal(component.plannedAmount) !== decimal(text))
      throw splitError(409, "POS_SPLIT_PAYMENT_COMPONENT_LOCKED", `${method.toUpperCase()}: ${POS_SPLIT_MESSAGES.POS_SPLIT_PAYMENT_COMPONENT_LOCKED}`);
    total = add(total, decimal(text));
    plan.push({ method, amount: money(text), sequence: index + 1 });
  }
  for (const method of METHODS) {
    if (!seen.has(method) && componentFor(method, null, state.payments).locked)
      throw splitError(409, "POS_SPLIT_PAYMENT_COMPONENT_LOCKED", `${method.toUpperCase()} has been collected or is in progress and cannot be removed.`);
  }
  if (total > state.total) throw splitError(409, "POS_SPLIT_PAYMENT_TOTAL_EXCEEDED", `${POS_SPLIT_MESSAGES.POS_SPLIT_PAYMENT_TOTAL_EXCEEDED} (${money(total)} of ${money(state.total)})`);
  await client.query(`UPDATE tenant.pos_carts SET split_plan=$3::jsonb, split_plan_version=split_plan_version+1, payment_mode=$4 WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, cartId, JSON.stringify(plan), plan.length > 1 ? "split" : "single"]);
  await event(client, context, "cart", cartId, "pos.split.plan_saved", { plan });
  const response = await getPosSplitPaymentStatus(client, context, cartId);
  await completeIdempotentOperation(client, context, idempotency, { response, aggregateType: "pos_cart", aggregateId: cartId });
  return response;
}

// Collect one planned part through its own handler: card (terminalId), UPI (dynamic QR) or cash (cashReceived). The amount is the planned
// part, never a client total. One external attempt at a time; a confirmed method is never collected twice. input: method, terminalId,
// cashReceived, changeGiven, idempotencyKey, outcome (sandbox only).
export async function initiateSplitComponent(client, context, cartId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const status = await getPosSplitPaymentStatus(client, context, cartId);
  const method = String(input.method ?? "").toLowerCase();
  const component = status.components.find((entry) => entry.method === method);
  if (!component) throw splitError(409, "POS_SPLIT_PAYMENT_COMPONENT_MISSING");
  if (component.status === "CONFIRMED") throw splitError(409, "POS_SPLIT_PAYMENT_DUPLICATE_METHOD");
  if (status.activeMethod) throw splitError(409, status.components.find((entry) => entry.method === status.activeMethod)?.status === "UNKNOWN"
    ? "POS_SPLIT_PAYMENT_UNKNOWN_OUTCOME" : "POS_SPLIT_PAYMENT_EXTERNAL_ATTEMPT_ACTIVE");
  if (["REVERSAL_REQUIRED", "RECONCILIATION_REQUIRED"].includes(component.status)) throw splitError(409, "POS_SPLIT_PAYMENT_RECONCILIATION_REQUIRED");
  const amount = component.plannedAmount;
  if (decimal(amount) > decimal(status.remainingPayableAmount)) throw splitError(409, "POS_SPLIT_PAYMENT_TOTAL_EXCEEDED", `Only ${status.remainingPayableAmount} is left to pay.`);
  let result;
  if (method === "card") result = await startPosCardPayment(client, context, cartId, { terminalId: input.terminalId, amount, idempotencyKey: input.idempotencyKey, outcome: input.outcome });
  else if (method === "upi") result = await startPosUpiPayment(client, context, cartId, { mode: "dynamic_qr", amount, idempotencyKey: input.idempotencyKey, outcome: input.outcome });
  else result = await confirmPosCashPayment(client, context, cartId, { cashReceived: input.cashReceived, changeGiven: input.changeGiven, applyAmount: amount, idempotencyKey: input.idempotencyKey });
  return { result, split: await getPosSplitPaymentStatus(client, context, cartId) };
}

// Finalise the split bill once every part is confirmed and they add up exactly; otherwise say what is missing.
export async function finalizeSplitCheckout(client, context, cartId) {
  requirePermission(context, "pos.sale.create");
  const status = await getPosSplitPaymentStatus(client, context, cartId);
  if (status.checkoutStatus === "COMPLETED") return status;
  if (status.activeMethod) throw splitError(409, status.components.find((entry) => entry.method === status.activeMethod)?.status === "UNKNOWN"
    ? "POS_SPLIT_PAYMENT_UNKNOWN_OUTCOME" : "POS_SPLIT_PAYMENT_EXTERNAL_ATTEMPT_ACTIVE");
  if (decimal(status.remainingPayableAmount) > 0n) throw splitError(409, "POS_SPLIT_PAYMENT_BALANCE_REMAINING", `${POS_SPLIT_MESSAGES.POS_SPLIT_PAYMENT_BALANCE_REMAINING} ${status.remainingPayableAmount} is still due.`,
    { remainingPayableAmount: status.remainingPayableAmount });
  const finalized = await finalizeCheckout(client, context, cartId, `${cartId}:split:${status.planVersion}:${Date.now()}`);
  if (finalized.error) throw splitError(409, "POS_SPLIT_PAYMENT_STOCK_RECOVERY_REQUIRED", `Payment was received, but the sale needs recovery: ${finalized.error.message}`);
  return getPosSplitPaymentStatus(client, context, cartId);
}

// Cancel a split bill: every collected part is compensated — card / UPI refunded through the provider, cash handed back (the cashier
// confirms it: cashReturned) — and open attempts are cancelled through the provider. The bill returns to an editable bill only when every
// part is resolved; otherwise it stays locked and says what is still outstanding. input: reason, cashReturned, idempotencyKey.
export async function cancelSplitCheckout(client, context, cartId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const before = await getPosSplitPaymentStatus(client, context, cartId);
  if (before.checkoutStatus === "COMPLETED") throw splitError(409, "POS_SPLIT_PAYMENT_CHECKOUT_CHANGED", "This bill is a completed sale: use a return.");
  const state = await loadCheckout(client, context, cartId, { lock: true });
  try { await assertPosAction(client, context, { permission: "PAYMENT_VOID_PENDING", outletId: state.cart.store_id, reason: input.reason }); }
  catch (error) { throw splitError(403, "POS_SPLIT_PAYMENT_PERMISSION_DENIED", `${POS_SPLIT_MESSAGES.POS_SPLIT_PAYMENT_PERMISSION_DENIED} ${error.message}`); }
  const key = String(input.idempotencyKey ?? `${cartId}:cancel:${Date.now()}`);
  const actions = [];
  for (const payment of state.payments.filter((row) => !row.sale_id)) {
    if (payment.payment_method !== "cash" && LIVE_ATTEMPT_STATUSES.includes(payment.attempt_status)) {
      const answer = await cancelPosCardAttempt(client, context, payment.id, { reason: input.reason ?? "Split bill cancelled" });
      actions.push({ method: payment.payment_method, action: "cancel", status: answer.status });
    } else if (payment.payment_method !== "cash" && payment.status === "captured" && !["refunded", "refund_requested"].includes(payment.recovery_status ?? "")) {
      if (["standalone", "static_qr"].includes(payment.provider_key)) {
        actions.push({ method: payment.payment_method, action: "refund", status: "MANUAL_REFUND_REQUIRED" });
        continue;
      }
      const refunded = await refundUnfinalizedCardPayment(client, context, payment.id, { reason: input.reason ?? "Split bill cancelled", idempotencyKey: `${key}:refund:${payment.id}`,
        approvalId: input.approvalId });
      actions.push({ method: payment.payment_method, action: "refund", status: refunded.refund.status });
    } else if (payment.payment_method === "cash" && payment.custody_status === "pending") {
      if (input.cashReturned !== true) { actions.push({ method: "cash", action: "return", status: "CASH_RETURN_REQUIRED" }); continue; }
      const returned = await returnPosCashTender(client, context, cartId, { cashReturned: true, reason: input.reason ?? "Split bill cancelled", idempotencyKey: `${key}:cash:${payment.id}` });
      actions.push({ method: "cash", action: "return", status: returned.payment.status });
    }
  }
  const after = await getPosSplitPaymentStatus(client, context, cartId);
  const outstanding = after.components.filter((component) => ["CONFIRMED", "AWAITING_PAYMENT", "PROCESSING", "UNKNOWN", "CANCEL_PENDING", "REVERSAL_REQUIRED", "RECONCILIATION_REQUIRED"]
    .includes(component.status));
  await event(client, context, "cart", cartId, "pos.split.cancel_requested", { actions, outstanding: outstanding.map((component) => component.method) });
  if (!outstanding.length) {
    await client.query(`UPDATE tenant.pos_carts SET split_plan='[]'::jsonb, split_plan_version=split_plan_version+1, payment_mode=NULL WHERE organization_id=$1 AND id=$2`, [context.organizationId, cartId]);
    await releasePosCheckout(client, context, cartId, { reason: input.reason ?? "Split payment cancelled; every part was reversed" });
    return { status: "CANCELLED", actions, split: await getPosSplitPaymentStatus(client, context, cartId) };
  }
  const code = outstanding.some((component) => component.method === "cash" && component.status === "CONFIRMED") ? "POS_SPLIT_PAYMENT_CASH_RETURN_REQUIRED"
    : outstanding.some((component) => ["UNKNOWN", "CANCEL_PENDING", "REVERSAL_REQUIRED", "RECONCILIATION_REQUIRED"].includes(component.status)) ? "POS_SPLIT_PAYMENT_PARTIAL_REVERSAL"
      : "POS_SPLIT_PAYMENT_REFUND_REQUIRED";
  return { status: "CANCELLATION_PENDING", code, message: POS_SPLIT_MESSAGES[code], actions, split: after };
}

// Share an amount across weights in whole paise: proportional, the remaining paise to the largest remainders (ties by position), never
// above each part's cap. Shared by refund allocation.
export function allocateInPaise(total, parts) {
  const unit = 10000n; // 6-digit scale → paise
  let leftUnits = decimal(total) / unit;
  const result = parts.map(() => 0n);
  let open = parts.map((part, index) => ({ index, weight: decimal(part.weight), capUnits: decimal(part.cap) / unit })).filter((part) => part.weight > 0n && part.capUnits > 0n);
  while (open.length && leftUnits > 0n) {
    const weight = open.reduce((sum, part) => sum + part.weight, 0n);
    const capped = open.filter((part) => leftUnits * part.weight >= part.capUnits * weight);
    if (capped.length) {
      for (const part of capped) { result[part.index] = part.capUnits; leftUnits -= part.capUnits; }
      open = open.filter((part) => !capped.includes(part));
      continue;
    }
    const exact = open.map((part) => ({ part, floor: (leftUnits * part.weight) / weight, remainder: (leftUnits * part.weight) % weight }));
    let rest = leftUnits - exact.reduce((sum, share) => sum + share.floor, 0n);
    exact.sort((a, b) => (a.remainder === b.remainder ? a.part.index - b.part.index : a.remainder > b.remainder ? -1 : 1));
    for (const share of exact) { const extra = rest > 0n ? 1n : 0n; rest -= extra; result[share.part.index] = share.floor + extra; }
    leftUnits = 0n;
  }
  return result.map((units) => units * unit);
}

// How a return's refund is shared across the sale's original tenders, by the company's policy: in proportion to each tender (default), or
// electronic tenders (card, UPI) first and cash last. Each share stays within what that tender has left to refund.
export async function allocateReturnRefund(client, context, payments, refundTotal) {
  const policy = (await client.query(`SELECT refund_allocation_policy FROM tenant.pos_settings WHERE organization_id=$1`, [context.organizationId])).rows[0]?.refund_allocation_policy ?? "proportional";
  const legs = payments.map((payment) => ({ payment, cap: max(sub(decimal(payment.amount), decimal(payment.refunded_amount ?? 0)), decimal(0)) }));
  if (policy === "electronic_first") {
    let left = decimal(refundTotal);
    const shares = legs.map(() => 0n);
    const order = legs.map((leg, index) => ({ leg, index })).sort((a, b) => Number(a.leg.payment.payment_method === "cash") - Number(b.leg.payment.payment_method === "cash"));
    for (const { leg, index } of order) { const take = left < leg.cap ? left : leg.cap; shares[index] = take; left = sub(left, take); }
    return { policy, shares };
  }
  return { policy, shares: allocateInPaise(refundTotal, legs.map((leg) => ({ weight: leg.payment.amount, cap: leg.cap }))) };
}

// Preview of how a return's refund would be shared across the sale's tenders (nothing is refunded).
export async function previewPosReturnRefundAllocation(client, context, returnId) {
  requirePermission(context, "pos.view");
  const ret = (await client.query(`SELECT * FROM tenant.pos_returns WHERE organization_id=$1 AND id=$2`, [context.organizationId, returnId])).rows[0];
  if (!ret) throw posError(404, "Return not found.", "POS_RETURN_NOT_FOUND");
  const payments = (await client.query(
    `SELECT * FROM tenant.pos_payments WHERE organization_id=$1 AND sale_id=$2 AND status IN ('captured','partially_refunded') ORDER BY captured_at NULLS LAST, initiated_at`,
    [context.organizationId, ret.sale_id])).rows;
  const { policy, shares } = await allocateReturnRefund(client, context, payments, ret.refund_total);
  return {
    returnId, refundTotal: money(ret.refund_total), policy,
    allocations: payments.map((payment, index) => ({ paymentId: payment.id, method: payment.payment_method, applied: money(payment.amount), alreadyRefunded: money(payment.refunded_amount),
      refund: money(shares[index]), reference: payment.provider_transaction_reference ?? payment.provider_reference ?? null })),
  };
}

// Split payments for a period: sales paid with more than one tender, by combination, each method's part, cancellations compensated.
export async function getPosSplitPaymentSummary(client, context, input = {}) {
  requirePermission(context, "pos.view");
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const now = new Date();
  const from = DATE.test(String(input.from ?? "")) ? input.from : `${now.toISOString().slice(0, 8)}01`;
  const to = DATE.test(String(input.to ?? "")) ? input.to : now.toISOString().slice(0, 10);
  const values = [context.organizationId, from, to];
  const stores = await accessiblePosStoreIds(client, context);
  const storeFilter = stores ? (values.push(stores), ` AND sale.store_id = ANY($${values.length}::uuid[])`) : "";
  const tenders = `SELECT sale.id, sale.grand_total, array_agg(DISTINCT payment.payment_method ORDER BY payment.payment_method) AS methods, count(payment.id) AS parts
                     FROM tenant.pos_sales sale JOIN tenant.pos_payments payment ON payment.organization_id = sale.organization_id AND payment.sale_id = sale.id
                    WHERE sale.organization_id = $1 AND sale.sale_date >= $2::date AND sale.sale_date < $3::date + 1${storeFilter} GROUP BY sale.id, sale.grand_total`;
  const [totals] = (await client.query(
    `SELECT count(*) FILTER (WHERE array_length(methods, 1) > 1)::int AS split_sales, count(*)::int AS all_sales,
            COALESCE(sum(grand_total) FILTER (WHERE array_length(methods, 1) > 1), 0)::text AS split_value FROM (${tenders}) t`, values)).rows;
  const byCombination = (await client.query(
    `SELECT array_to_string(methods, ' + ') AS combination, count(*)::int AS sales, COALESCE(sum(grand_total), 0)::text AS value
       FROM (${tenders}) t WHERE array_length(methods, 1) > 1 GROUP BY 1 ORDER BY 2 DESC`, values)).rows;
  const byMethod = (await client.query(
    `SELECT payment.payment_method AS method, COALESCE(sum(payment.amount), 0)::text AS amount FROM tenant.pos_payments payment
      WHERE payment.organization_id = $1 AND payment.sale_id IN (SELECT id FROM (${tenders}) t WHERE array_length(methods, 1) > 1) GROUP BY 1 ORDER BY 2 DESC`, values)).rows;
  const [compensated] = (await client.query(
    `SELECT count(*) FILTER (WHERE event_type = 'pos.split.cancel_requested')::int AS cancellations FROM tenant.pos_events
      WHERE organization_id = $1 AND occurred_at >= $2::date AND occurred_at < $3::date + 1`, [context.organizationId, from, to])).rows;
  return { from, to, totals: { ...totals, ...compensated }, byCombination, byMethod };
}

