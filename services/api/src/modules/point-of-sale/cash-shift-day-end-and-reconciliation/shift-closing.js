// POS Shift Closing (0105). Closing ends a POS operating session (tenant.pos_shifts) and its cash session (tenant.pos_cash_sessions) — the
// same lifecycle Shift Opening (0103) and Opening Cash Float (0104) began; there is no separate closing ledger. Four steps:
//
//   1. check     what is unfinished on the shift: an active checkout, a card / UPI payment whose outcome is unknown, money collected for a sale
//                that never completed, cash held or paid out without confirmation, a pending return. Beginning to close moves the session to
//                CLOSING: no new checkout or payment can start (recovering an existing one still works). Held bills are kept.
//   2. count     a blind count: the cashier enters the cash in the drawer (an amount or notes and coins) before seeing what it should be. Each
//                count is kept; a recount supersedes the earlier one.
//   3. review    expected cash (the cash session's physical events, each once) and the difference (counted − expected, never typed). Any
//                difference needs a reason; above the company's threshold a supervisor approves exactly this count; above its hard limit only
//                an authorized supervisor can close (a reconciliation, not an approval click).
//   4. close     where the cash goes — left in the drawer for the next shift, the store safe, an authorized manager, or the secured drawer pending a
//                handover; the amounts add up to the count and each stays pending until someone other than the closer accepts it — then the
//                session and its cash session close together, with an immutable closing record and snapshot the report reproduces.
//
// Closing never edits a sale, payment, refund, stock movement or the opening float. A card / UPI shift closes without a count (no cash
// figures, not ₹0). What a close leaves open — a payment under recovery, a refund with the provider, the cash difference — is an exception
// with an accountable owner. Closing is idempotent (one closing per shift and per key) and serialized on the shift row.
import { createHash, randomUUID } from "node:crypto";

import { decimal, add, sub, asDatabaseDecimal, formatDecimal } from "../../../core/decimal.js";
import { publishDomainEvent } from "../../../core/platform/events/index.js";
import { notifyPermissionHolders } from "../../../core/platform/notifications/index.js";
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess, accessiblePosStoreIds } from "../shared/access-control.js";
import { event } from "../shared/audit.js";
import { assertPosAction, authorizePosAction, consumeApprovalAtomically, getEffectivePosPermissions, requestSupervisorApproval, validateApproval } from "../permissions/index.js";
import { computeExpectedCash } from "./cash-sessions.js";
import {
  CASH_DIFFERENCE_REASONS, cashLedgerVersion, closingVariancePolicy, differenceType, evaluateCashVariance, readDifferenceReason, recordCashDifference, closingDifferenceOf,
} from "./cash-differences.js";

export const POS_SHIFT_CLOSE_MESSAGES = Object.freeze({
  POS_SHIFT_CLOSE_PERMISSION_DENIED: "You cannot close this shift.",
  POS_SHIFT_CLOSE_NOT_OPEN: "This shift is not open.",
  POS_SHIFT_CLOSE_NOT_STARTED: "Start closing the shift first.",
  POS_SHIFT_CLOSE_IN_PROGRESS: "Someone else is closing this shift.",
  POS_SHIFT_CLOSE_ALREADY_CLOSED: "This shift is already closed.",
  POS_SHIFT_CLOSE_ACTIVE_CHECKOUT: "Finish or safely resolve the active checkout.",
  POS_SHIFT_CLOSE_PAYMENT_UNKNOWN: "A payment needs verification before closing.",
  POS_SHIFT_CLOSE_CASH_CUSTODY_UNRESOLVED: "Cash received or paid still needs confirmation.",
  POS_SHIFT_CLOSE_CASH_COUNT_REQUIRED: "Count the money in the drawer.",
  POS_SHIFT_CLOSE_COUNT_INVALID: "Enter a valid closing cash amount.",
  POS_SHIFT_CLOSE_VARIANCE_REASON_REQUIRED: "Explain the cash difference.",
  POS_SHIFT_CLOSE_APPROVAL_REQUIRED: "Supervisor approval is required.",
  POS_SHIFT_CLOSE_APPROVAL_INVALID: "Closing details changed. Request approval again.",
  POS_SHIFT_CLOSE_HANDOVER_REQUIRED: "Choose where the closing cash will be kept.",
  POS_SHIFT_CLOSE_HANDOVER_INVALID: "Cash handover details do not match the closing count.",
  POS_SHIFT_CLOSE_VERSION_CONFLICT: "The shift changed. Refresh and try again.",
  POS_SHIFT_CLOSE_RECONCILIATION_REQUIRED: "Closing needs reconciliation.",
  POS_SHIFT_CLOSE_OUTCOME_UNKNOWN: "Checking whether the shift closed. Do not close it again.",
  POS_SHIFT_CLOSE_REPORT_UNAVAILABLE: "Shift closed, but the report is temporarily unavailable.",
  POS_SHIFT_CLOSE_IDEMPOTENCY_CONFLICT: "This close request was already used for another shift.",
  POS_CASH_TRANSFER_NOT_FOUND: "Cash transfer not found.",
  POS_CASH_TRANSFER_SETTLED: "This cash transfer has already been accepted.",
  POS_CASH_TRANSFER_BY_OPENING: "Cash left in the drawer is accepted by the next shift's opening count.",
  POS_CASH_TRANSFER_SELF_ACCEPT: "The person who closed the shift cannot accept its cash.",
  POS_CASH_TRANSFER_NOT_RECIPIENT: "This cash was handed to someone else.",
  POS_SHIFT_EXCEPTION_NOT_FOUND: "Closing exception not found.",
});
const closeError = (status, code, message = POS_SHIFT_CLOSE_MESSAGES[code], details = undefined) => {
  const error = posError(status, message, code);
  if (details) error.details = details;
  return error;
};

export const CASH_DESTINATIONS = Object.freeze(["NEXT_SHIFT_HANDOVER", "STORE_SAFE", "AUTHORIZED_MANAGER", "SECURED_DRAWER_PENDING_HANDOVER"]);
const IN_DRAWER = ["NEXT_SHIFT_HANDOVER", "SECURED_DRAWER_PENDING_HANDOVER"];
// Cash Difference (0106): the reasons are the shared cash difference reasons.
export const CLOSING_VARIANCE_REASONS = CASH_DIFFERENCE_REASONS;
const BLOCKER_ERROR = {
  ACTIVE_CHECKOUT: "POS_SHIFT_CLOSE_ACTIVE_CHECKOUT", SPLIT_PAYMENT: "POS_SHIFT_CLOSE_PAYMENT_UNKNOWN", PAYMENT_UNKNOWN: "POS_SHIFT_CLOSE_PAYMENT_UNKNOWN",
  CASH_CUSTODY: "POS_SHIFT_CLOSE_CASH_CUSTODY_UNRESOLVED", CASH_REFUND: "POS_SHIFT_CLOSE_CASH_CUSTODY_UNRESOLVED", RETURN_PENDING: "POS_SHIFT_CLOSE_RECONCILIATION_REQUIRED",
};

const privileged = (c) => Boolean(c.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug)));
const can = (c, permission) => privileged(c) || Boolean(c.permissions?.includes(permission));
const text = (value, max = 500) => { const out = String(value ?? "").trim(); return out ? out.slice(0, max) : null; };
const money = (value) => {
  if (value === null || value === undefined) return null;
  const [whole, fraction = ""] = formatDecimal(decimal(String(value))).split(".");
  return `${whole}.${(fraction + "00").slice(0, 2)}`;
};
const out = (value) => (value === null || value === undefined ? null : money(asDatabaseDecimal(value)));
const MONEY = /^\d{1,14}(\.\d{1,2})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The snapshot hash is over canonical JSON (keys sorted), so the stored jsonb (which reorders keys) still verifies.
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object" && !(value instanceof Date)) return `{${Object.keys(value).sort().filter((name) => value[name] !== undefined).map((name) => `${JSON.stringify(name)}:${canonical(value[name])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
};
const hash = (value) => createHash("sha256").update(typeof value === "string" ? value : canonical(JSON.parse(JSON.stringify(value)))).digest("hex");

async function policyOf(client, context) {
  const row = (await client.query(
    `SELECT closing_variance_approval_above, closing_variance_block_above, closing_blind_count, closing_reveal_expected_after_count, closing_variance_reasons,
            closing_shortage_approval_above, closing_overage_approval_above, closing_shortage_block_above, closing_overage_block_above, cash_difference_unknown_note_required,
            opening_count_denominations, receipt_reprint_reason_required
       FROM tenant.pos_settings WHERE organization_id = $1`, [context.organizationId])).rows[0];
  // Cash Difference (0106): tolerance, approval and hard limit (optionally per shortage / overage), the reasons, and the policy version.
  const variance = closingVariancePolicy(row);
  return {
    variance,
    blind: row?.closing_blind_count !== false,
    reveal: row?.closing_reveal_expected_after_count !== false,
    reasons: variance.reasons,
    denominations: Array.isArray(row?.opening_count_denominations) ? row.opening_count_denominations.map(Number) : [500, 200, 100, 50, 20, 10, 5, 2, 1],
    reprintReasonRequired: row?.receipt_reprint_reason_required === true,
  };
}

async function seesExpectedCash(client, context, storeId) {
  if (can(context, "pos.store.manage")) return true;
  try { return (await authorizePosAction(client, context, { permission: "SESSION_VIEW_EXPECTED_CASH", outletId: storeId })).decision === "ALLOW"; } catch { return false; }
}

const SHIFT_SELECT = `
  SELECT shift.*, store.name AS store_name, store.code AS store_code, COALESCE(NULLIF(btrim(store.currency_code), ''), 'INR') AS currency,
         terminal.code AS terminal_code, terminal.name AS terminal_name, cashier.full_name AS cashier_name, starter.full_name AS closing_started_by_name,
         cash.status AS cash_status, cash.opening_float_amount, cash.cash_drawer_id, cash.source_type AS cash_source, drawer.code AS drawer_code, drawer.name AS drawer_name
    FROM tenant.pos_shifts shift
    JOIN tenant.pos_stores store ON store.organization_id = shift.organization_id AND store.id = shift.store_id
    JOIN tenant.pos_terminals terminal ON terminal.organization_id = shift.organization_id AND terminal.id = shift.terminal_id
    LEFT JOIN public.users cashier ON cashier.id = shift.cashier_user_id
    LEFT JOIN public.users starter ON starter.id = shift.closing_started_by
    LEFT JOIN tenant.pos_cash_sessions cash ON cash.organization_id = shift.organization_id AND cash.id = shift.cash_session_id
    LEFT JOIN tenant.pos_cash_drawers drawer ON drawer.organization_id = cash.organization_id AND drawer.id = cash.cash_drawer_id`;

// The shift, locked when about to change it. The cashier always reaches their own shift; anyone else needs the outlet.
async function loadShift(client, context, shiftId, { lock = false } = {}) {
  requirePermission(context, "pos.view");
  if (!UUID.test(String(shiftId ?? ""))) throw closeError(404, "POS_SHIFT_CLOSE_NOT_OPEN", "Shift not found.");
  if (lock) await client.query(`SELECT id FROM tenant.pos_shifts WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, shiftId]);
  const row = (await client.query(`${SHIFT_SELECT} WHERE shift.organization_id = $1 AND shift.id = $2`, [context.organizationId, shiftId])).rows[0];
  if (!row) throw closeError(404, "POS_SHIFT_CLOSE_NOT_OPEN", "Shift not found.");
  if (row.cashier_user_id !== context.userId) {
    try { await assertPosStoreAccess(client, context, row.store_id); } catch { throw closeError(404, "POS_SHIFT_CLOSE_NOT_OPEN", "Shift not found."); }
  }
  return row;
}

// Who may close: the cashier their own session (SESSION_CLOSE_OWN), anyone else only as a supervisor closing another's (SESSION_CLOSE_OTHER,
// with a reason). Returns { own, supervisor } where supervisor = the closer may themselves accept a difference of this amount.
async function closingAuthority(client, context, shift, input = {}, varianceAmount = null) {
  const own = shift.cashier_user_id === context.userId;
  try {
    if (own) await assertPosAction(client, context, { permission: "SESSION_CLOSE_OWN", outletId: shift.store_id });
    else await assertPosAction(client, context, { permission: "SESSION_CLOSE_OTHER", outletId: shift.store_id, reason: input.reason ?? input.closeReason ?? input.notes });
  } catch (error) {
    if (error?.code === "POS_REASON_REQUIRED") throw closeError(400, "POS_SHIFT_CLOSE_PERMISSION_DENIED", "Say why you are closing another cashier's shift.");
    throw closeError(403, "POS_SHIFT_CLOSE_PERMISSION_DENIED", `${POS_SHIFT_CLOSE_MESSAGES.POS_SHIFT_CLOSE_PERMISSION_DENIED} ${error?.message ?? ""}`.trim());
  }
  let supervisor = false;
  if (!own && varianceAmount !== null) {
    try { supervisor = (await authorizePosAction(client, context, { permission: "APPROVE_CASH_MOVEMENT_EXCEPTION", outletId: shift.store_id, amount: asDatabaseDecimal(varianceAmount) })).decision === "ALLOW"; }
    catch { supervisor = false; }
  }
  return { own, supervisor };
}

// ------------------------------------------------------------------ step 1: what is unfinished

// Everything on the shift that a close must not forget. blocking = an ordinary close is refused until it is resolved (or, for an unknown
// card / UPI outcome, a supervisor has handed it to an accountable owner — managed). Held and parked bills are kept and never block.
export async function getShiftBlockingTransactions(client, context, shiftId) {
  const shift = await loadShift(client, context, shiftId);
  return blockersOf(client, context, shift);
}

async function blockersOf(client, context, shift) {
  const org = context.organizationId;
  const items = [];
  const managed = new Map((await client.query(
    `SELECT reference_id, exception_type, status, assigned_to, assigned_queue FROM tenant.pos_shift_closing_exceptions WHERE organization_id = $1 AND shift_id = $2 AND status <> 'RESOLVED'`,
    [org, shift.id])).rows.map((row) => [`${row.exception_type}:${row.reference_id}`, row]));
  const push = (type, row, label, blocking = true) => {
    const owner = managed.get(`${type}:${row.id}`) ?? null;
    items.push({ type, referenceType: row.reference_type, referenceId: row.id, label, amount: row.amount === null || row.amount === undefined ? null : money(row.amount),
      blocking: blocking && !owner, managed: Boolean(owner), createdAt: row.created_at ?? null });
  };
  for (const row of (await client.query(
    `SELECT cart.id, 'pos_cart' AS reference_type, cart.grand_total AS amount, cart.checkout_started_at AS created_at, cart.checkout_reference
       FROM tenant.pos_carts cart WHERE cart.organization_id = $1 AND cart.shift_id = $2 AND cart.status IN ('draft', 'priced') AND cart.checkout_started_at IS NOT NULL`, [org, shift.id])).rows)
    push("ACTIVE_CHECKOUT", row, `Checkout ${row.checkout_reference ?? ""} in progress`.replace(/\s+/g, " "));
  for (const row of (await client.query(
    `SELECT payment.id, 'pos_payment' AS reference_type, payment.amount, payment.initiated_at AS created_at, payment.payment_method, payment.status, payment.attempt_status
       FROM tenant.pos_payments payment
      WHERE payment.organization_id = $1 AND payment.shift_id = $2 AND payment.payment_method <> 'cash'
        AND (payment.status IN ('initiated', 'pending', 'authorized') OR payment.attempt_status IN ('unknown', 'reconciliation_required', 'cancel_pending'))
        AND COALESCE(payment.recovery_status, '') NOT IN ('refunded', 'resolved')`, [org, shift.id])).rows)
    push("PAYMENT_UNKNOWN", row, `${String(row.payment_method).toUpperCase()} payment ${row.attempt_status ?? row.status}: outcome to verify`);
  for (const row of (await client.query(
    `SELECT payment.id, 'pos_payment' AS reference_type, payment.amount, payment.initiated_at AS created_at, payment.payment_method
       FROM tenant.pos_payments payment
      WHERE payment.organization_id = $1 AND payment.shift_id = $2 AND payment.payment_method <> 'cash' AND payment.sale_id IS NULL AND payment.status = 'captured'
        AND COALESCE(payment.recovery_status, '') NOT IN ('refunded', 'resolved')
        AND NOT EXISTS (SELECT 1 FROM tenant.pos_carts cart WHERE cart.organization_id = payment.organization_id AND cart.id = payment.cart_id AND cart.checkout_started_at IS NOT NULL
                          AND cart.status IN ('draft', 'priced'))`, [org, shift.id])).rows)
    push("SPLIT_PAYMENT", row, `${String(row.payment_method).toUpperCase()} collected for a sale that did not complete`);
  for (const row of (await client.query(
    `SELECT payment.id, 'pos_payment' AS reference_type, payment.amount, payment.initiated_at AS created_at, payment.custody_status
       FROM tenant.pos_payments payment
      WHERE payment.organization_id = $1 AND payment.shift_id = $2 AND payment.payment_method = 'cash' AND payment.custody_status IN ('pending', 'reconciliation_required')`,
    [org, shift.id])).rows)
    push("CASH_CUSTODY", row, row.custody_status === "pending" ? "Cash taken for a bill that is not finalized" : "Cash tender waiting for a supervisor");
  for (const row of (await client.query(
    `SELECT component.id, 'payment_refund_component' AS reference_type, component.allocated_amount AS amount, component.created_at, refund.refund_number
       FROM tenant.payment_refund_components component
       JOIN tenant.payment_refunds refund ON refund.organization_id = component.organization_id AND refund.id = component.refund_id
      WHERE component.organization_id = $1 AND component.cash_session_id = $2 AND component.refund_method = 'cash'
        AND component.status IN ('pending', 'submitted', 'processing', 'unknown', 'cancel_pending')`, [org, shift.id])).rows)
    push("CASH_REFUND", row, `Cash refund ${row.refund_number}: payout not confirmed`);
  for (const row of (await client.query(
    `SELECT ret.id, 'pos_return' AS reference_type, ret.refund_total AS amount, ret.created_at, ret.return_number, ret.lifecycle_status
       FROM tenant.pos_returns ret WHERE ret.organization_id = $1 AND ret.shift_id = $2 AND ret.lifecycle_status IN ('awaiting_approval', 'awaiting_inspection', 'approved')`,
    [org, shift.id])).rows)
    push("RETURN_PENDING", row, `Return ${row.return_number} ${String(row.lifecycle_status).replace(/_/g, " ")}`);
  // Electronic refunds still with the provider continue after the close under refund reconciliation: listed, never blocking.
  for (const row of (await client.query(
    `SELECT component.id, 'payment_refund_component' AS reference_type, component.allocated_amount AS amount, component.created_at, refund.refund_number, component.refund_method
       FROM tenant.payment_refund_components component
       JOIN tenant.payment_refunds refund ON refund.organization_id = component.organization_id AND refund.id = component.refund_id
      WHERE component.organization_id = $1 AND component.refund_method <> 'cash' AND component.status IN ('pending', 'submitted', 'processing', 'unknown', 'cancel_pending')
        AND (EXISTS (SELECT 1 FROM tenant.pos_returns ret WHERE ret.organization_id = refund.organization_id AND refund.source_type = 'pos_return' AND ret.id = refund.source_id
                       AND (ret.shift_id = $2 OR ret.posting_shift_id = $2))
             OR (refund.source_type <> 'pos_return' AND EXISTS (SELECT 1 FROM tenant.pos_payments payment WHERE payment.organization_id = refund.organization_id
                       AND payment.id = refund.original_payment_id AND payment.shift_id = $2)))`, [org, shift.id])).rows)
    push("DIGITAL_REFUND", row, `${String(row.refund_method).toUpperCase()} refund ${row.refund_number} with the provider`, false);
  const carts = (await client.query(
    `SELECT count(*) FILTER (WHERE status = 'held')::int AS held,
            count(*) FILTER (WHERE status IN ('draft', 'priced') AND checkout_started_at IS NULL)::int AS open_bills
       FROM tenant.pos_carts WHERE organization_id = $1 AND shift_id = $2`, [org, shift.id])).rows[0];
  const blocking = items.filter((item) => item.blocking);
  return { items, blocking: blocking.length, ready: blocking.length === 0, heldCarts: carts.held, openBills: carts.open_bills,
    counts: Object.fromEntries(["ACTIVE_CHECKOUT", "PAYMENT_UNKNOWN", "SPLIT_PAYMENT", "CASH_CUSTODY", "CASH_REFUND", "RETURN_PENDING", "DIGITAL_REFUND"]
      .map((type) => [type, items.filter((item) => item.type === type).length])) };
}

// Card, UPI and split totals and the shift's sales — payment confirmation, not bank settlement (settlement comes later and never blocks a close).
export async function getShiftPaymentSummary(client, context, shiftId) {
  const shift = await loadShift(client, context, shiftId);
  return paymentSummaryOf(client, context, shift);
}

async function paymentSummaryOf(client, context, shift) {
  const org = context.organizationId;
  const sales = (await client.query(
    `SELECT count(*)::int AS count, COALESCE(sum(grand_total), 0)::text AS total FROM tenant.pos_sales
      WHERE organization_id = $1 AND shift_id = $2 AND status IN ('completed', 'partially_returned', 'returned')`, [org, shift.id])).rows[0];
  const methods = (await client.query(
    `SELECT payment.payment_method AS method, count(*)::int AS count, COALESCE(sum(payment.amount), 0)::text AS amount,
            COALESCE(sum(payment.cash_received_amount), 0)::text AS received, COALESCE(sum(payment.change_given_amount), 0)::text AS change
       FROM tenant.pos_payments payment
      WHERE payment.organization_id = $1 AND payment.shift_id = $2 AND payment.sale_id IS NOT NULL AND payment.status IN ('captured', 'partially_refunded', 'refunded')
      GROUP BY 1 ORDER BY 1`, [org, shift.id])).rows;
  const split = (await client.query(
    `WITH split AS (
       SELECT payment.sale_id FROM tenant.pos_payments payment
        WHERE payment.organization_id = $1 AND payment.shift_id = $2 AND payment.sale_id IS NOT NULL AND payment.status IN ('captured', 'partially_refunded', 'refunded')
        GROUP BY 1 HAVING count(*) > 1)
     SELECT payment.payment_method AS method, count(*)::int AS count, COALESCE(sum(payment.amount), 0)::text AS amount, (SELECT count(*)::int FROM split) AS sales
       FROM tenant.pos_payments payment JOIN split ON split.sale_id = payment.sale_id
      WHERE payment.organization_id = $1 AND payment.status IN ('captured', 'partially_refunded', 'refunded') GROUP BY 1 ORDER BY 1`, [org, shift.id])).rows;
  const refunds = (await client.query(
    `SELECT component.refund_method AS method, component.status, count(*)::int AS count, COALESCE(sum(component.allocated_amount), 0)::text AS amount,
            COALESCE(sum(component.successful_amount), 0)::text AS succeeded
       FROM tenant.payment_refund_components component
       JOIN tenant.payment_refunds refund ON refund.organization_id = component.organization_id AND refund.id = component.refund_id
      WHERE component.organization_id = $1
        AND (component.cash_session_id = $2
             OR EXISTS (SELECT 1 FROM tenant.pos_returns ret WHERE ret.organization_id = refund.organization_id AND refund.source_type = 'pos_return' AND ret.id = refund.source_id
                          AND (ret.shift_id = $2 OR ret.posting_shift_id = $2)))
      GROUP BY 1, 2 ORDER BY 1, 2`, [org, shift.id])).rows;
  return {
    currency: shift.currency.trim(), sales: { count: sales.count, total: money(sales.total) },
    methods: methods.map((row) => ({ method: row.method, count: row.count, amount: money(row.amount),
      ...(row.method === "cash" ? { cashReceived: money(row.received), changeGiven: money(row.change) } : {}) })),
    split: { sales: split[0]?.sales ?? 0, components: split.map((row) => ({ method: row.method, count: row.count, amount: money(row.amount) })) },
    refunds: refunds.map((row) => ({ method: row.method, status: row.status, count: row.count, amount: money(row.amount), succeeded: money(row.succeeded) })),
  };
}

// ------------------------------------------------------------------ closing context (what the closing screen shows, resumable)

function shiftOf(shift) {
  return {
    id: shift.id, shiftNumber: shift.shift_number, status: shift.lifecycle_status, version: shift.version, cashierUserId: shift.cashier_user_id, cashier: shift.cashier_name,
    storeId: shift.store_id, storeName: shift.store_name, terminalId: shift.terminal_id, terminalCode: shift.terminal_code, terminalName: shift.terminal_name,
    openedAt: shift.opened_at, closingStartedAt: shift.closing_started_at, closingStartedBy: shift.closing_started_by_name ?? null, closedAt: shift.closed_at,
    cashEnabled: Boolean(shift.cash_session_id), cashSessionId: shift.cash_session_id,
    cashDrawer: shift.cash_drawer_id ? { id: shift.cash_drawer_id, code: shift.drawer_code, name: shift.drawer_name } : null, currency: shift.currency.trim(),
  };
}

async function latestCountOf(client, context, shift) {
  if (!shift.cash_session_id) return null;
  return (await client.query(
    `SELECT closing_count.*, users.full_name AS counted_by_name,
            (SELECT count(*)::int FROM tenant.pos_cash_closing_counts other WHERE other.organization_id = closing_count.organization_id AND other.cash_session_id = closing_count.cash_session_id) AS counts
       FROM tenant.pos_cash_closing_counts closing_count LEFT JOIN public.users ON users.id = closing_count.counted_by
      WHERE closing_count.organization_id = $1 AND closing_count.cash_session_id = $2 AND closing_count.status IN ('SUBMITTED', 'FINALIZED')
      ORDER BY closing_count.count_sequence DESC LIMIT 1`, [context.organizationId, shift.cash_session_id])).rows[0] ?? null;
}

const evaluate = (policy, variance) => evaluateCashVariance(policy.variance, variance);

// An approval is for exactly this shift, count, expected cash, cash ledger version and policy: any of them changing needs a new one.
const fingerprintOf = (shift, count, expected, policy) =>
  hash(`${shift.id}|${count.id}|${count.counted_amount}|${asDatabaseDecimal(expected)}|${count.cash_ledger_version ?? ""}|${policy.variance.version}`).slice(0, 32);

// Cash Difference (0106): a count compared with an older cash ledger version than the session has now is stale — count again.
async function staleCount(client, context, shift, count) {
  if (count.cash_ledger_version === null || count.cash_ledger_version === undefined) return false;
  return (await cashLedgerVersion(client, context.organizationId, shift.id)) !== Number(count.cash_ledger_version);
}

// The count as the counter (or anyone allowed) sees it after submitting it: with the comparison when the policy shows it, otherwise only
// whether it differs. Before any count nobody sees the expected cash in the closing flow (blind count).
async function countView(client, context, shift, count, policy, sensitive) {
  if (!count) return null;
  const { expected } = await computeExpectedCash(client, context.organizationId, shift.id, shift.opening_float_amount);
  const variance = sub(decimal(String(count.counted_amount)), expected);
  const verdict = evaluate(policy, variance);
  const visible = sensitive || policy.reveal;
  const stale = count.status === "SUBMITTED" && await staleCount(client, context, shift, count);
  return {
    id: count.id, sequence: count.count_sequence, status: count.status, countedAmount: money(count.counted_amount), denominations: count.denominations ?? null,
    countedBy: count.counted_by_name ?? null, submittedAt: count.submitted_at, recounts: Math.max(0, (count.counts ?? 1) - 1),
    expectedAmount: visible ? out(expected) : null, varianceAmount: visible ? out(variance) : null,
    direction: variance === 0n ? "EXACT" : variance < 0n ? "SHORT" : "OVER", differenceType: differenceType(variance),
    // COUNT_PENDING never reaches here; MATCHED, VARIANCE_DETECTED (a reason is enough), AWAITING_APPROVAL, INVESTIGATION_REQUIRED, or STALE.
    reconciliationStatus: stale ? "STALE" : verdict.status, stale, cashLedgerVersion: count.cash_ledger_version ?? null, policyVersion: policy.variance.version,
    reasonRequired: verdict.reasonRequired, approvalRequired: verdict.approvalRequired, blocked: verdict.blocked,
    approvalAmount: verdict.approvalRequired && visible ? out(verdict.amount) : null, fingerprint: verdict.approvalRequired ? fingerprintOf(shift, count, expected, policy) : null,
  };
}

// The caller's current shift (open, paused or closing) or a named one, with everything the four closing steps need — so a refreshed browser
// picks up exactly where it was.
export async function getShiftClosingContext(client, context, { shiftId = null } = {}) {
  requirePermission(context, "pos.view");
  let id = shiftId;
  if (!id) {
    id = (await client.query(
      `SELECT id FROM tenant.pos_shifts WHERE organization_id = $1 AND cashier_user_id = $2 AND lifecycle_status IN ('OPEN', 'SUSPENDED', 'CLOSING', 'RECOVERY_REQUIRED')
        ORDER BY opened_at DESC NULLS LAST LIMIT 1`, [context.organizationId, context.userId])).rows[0]?.id;
    if (!id) throw closeError(404, "POS_SHIFT_CLOSE_NOT_OPEN", "You have no open shift.");
  }
  const shift = await loadShift(client, context, id);
  const policy = await policyOf(client, context);
  const sensitive = await seesExpectedCash(client, context, shift.store_id);
  const closed = ["CLOSED", "FORCE_CLOSED"].includes(shift.lifecycle_status);
  const blockers = closed ? null : await blockersOf(client, context, shift);
  const count = await latestCountOf(client, context, shift);
  const step = closed ? "CLOSED" : shift.lifecycle_status !== "CLOSING" ? "CHECK" : shift.cash_session_id && !count ? "COUNT" : "REVIEW";
  return {
    shift: shiftOf(shift), step, blockers, summary: await paymentSummaryOf(client, context, shift),
    count: await countView(client, context, shift, count && count.status !== "SUPERSEDED" ? count : null, policy, sensitive),
    closing: closed && shift.closing_id ? await closingResultOf(client, context, shift.closing_id, sensitive || policy.reveal) : null,
    policy: { blindCount: policy.blind, revealAfterCount: policy.reveal, denominations: policy.denominations, destinations: CASH_DESTINATIONS,
      varianceReasons: policy.reasons.map((code) => ({ code, label: CLOSING_VARIANCE_REASONS[code] ?? code.replace(/_/g, " ").toLowerCase(),
        requiresNote: code === "OTHER" || (code === "UNKNOWN" && policy.variance.unknownNoteRequired) })) },
    canSeeExpected: sensitive, mine: shift.cashier_user_id === context.userId,
    receivers: closed ? [] : await cashReceiversOf(client, context, shift),
  };
}

// Who may receive cash taken out of this drawer: active cashiers at the outlet whose active profile lets them supervise cash (never the closer
// or the shift's cashier). The close checks this again.
async function cashReceiversOf(client, context, shift) {
  return (await client.query(
    `SELECT DISTINCT cashier.user_id, users.full_name FROM tenant.pos_cashiers cashier
       JOIN public.users ON users.id = cashier.user_id AND users.status = 'active'
       JOIN tenant.pos_cashier_outlets outlet ON outlet.organization_id = cashier.organization_id AND outlet.cashier_id = cashier.id AND outlet.store_id = $2
       JOIN tenant.pos_permission_profiles profile ON profile.organization_id = cashier.organization_id AND profile.id = cashier.permission_profile_id AND profile.status = 'active'
       JOIN tenant.pos_permission_profile_grants grant_row ON grant_row.organization_id = profile.organization_id AND grant_row.profile_id = profile.id AND grant_row.enabled
            AND grant_row.permission_code IN ('SESSION_CLOSE_OTHER', 'APPROVE_CASH_MOVEMENT_EXCEPTION')
      WHERE cashier.organization_id = $1 AND cashier.status = 'active' AND cashier.user_id <> ALL($3::uuid[]) ORDER BY users.full_name`,
    [context.organizationId, shift.store_id, [context.userId, shift.cashier_user_id]])).rows.map((row) => ({ userId: row.user_id, name: row.full_name }));
}

// ------------------------------------------------------------------ begin / cancel closing

// Enter CLOSING: from now on no checkout or payment can start on this shift (recovery of existing ones continues). Refused while a checkout is
// in progress — finish or release it first. The same person beginning again gets the same closing back; a supervisor taking over someone's
// closing does so openly (SESSION_CLOSE_OTHER, a reason, an audit event). input: expectedVersion?, reason?.
export async function beginShiftClosing(client, context, shiftId, input = {}) {
  const shift = await loadShift(client, context, shiftId, { lock: true });
  if (["CLOSED", "FORCE_CLOSED"].includes(shift.lifecycle_status)) throw closeError(409, "POS_SHIFT_CLOSE_ALREADY_CLOSED", undefined, { closingId: shift.closing_id });
  if (shift.lifecycle_status === "RECOVERY_REQUIRED") throw closeError(409, "POS_SHIFT_CLOSE_RECONCILIATION_REQUIRED", "The shift needs a supervisor's review before it can be closed.");
  const authority = await closingAuthority(client, context, shift, input);
  if (shift.lifecycle_status === "CLOSING") {
    if (shift.closing_started_by === context.userId || authority.own) return getShiftClosingContext(client, context, { shiftId: shift.id });
    if (shift.closing_started_by && shift.closing_started_by !== shift.cashier_user_id && !input.takeOver) throw closeError(409, "POS_SHIFT_CLOSE_IN_PROGRESS");
    await client.query(`UPDATE tenant.pos_shifts SET closing_started_by = $3 WHERE organization_id = $1 AND id = $2`, [context.organizationId, shift.id, context.userId]);
    await event(client, context, "shift", shift.id, "pos.shift.closing_taken_over", { from: shift.closing_started_by, reason: text(input.reason) });
    return getShiftClosingContext(client, context, { shiftId: shift.id });
  }
  if (!["OPEN", "SUSPENDED"].includes(shift.lifecycle_status)) throw closeError(409, "POS_SHIFT_CLOSE_NOT_OPEN");
  if (input.expectedVersion !== undefined && input.expectedVersion !== null && Number(input.expectedVersion) !== Number(shift.version)) throw closeError(409, "POS_SHIFT_CLOSE_VERSION_CONFLICT");
  const checkouts = (await blockersOf(client, context, shift)).items.filter((item) => item.type === "ACTIVE_CHECKOUT" && item.blocking);
  // An outlet manager about to force-close (another cashier's shift, with a reason) may begin over a stuck checkout; it becomes their exception.
  const forcing = input.force === true && !authority.own && can(context, "pos.store.manage") && Boolean(text(input.reason));
  if (checkouts.length && !forcing) throw closeError(409, "POS_SHIFT_CLOSE_ACTIVE_CHECKOUT", undefined, { blockers: checkouts });
  await client.query(
    `UPDATE tenant.pos_shifts SET lifecycle_status = 'CLOSING', closing_started_at = now(), closing_started_by = $3 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, shift.id, context.userId]);
  if (shift.cash_session_id) await client.query(`UPDATE tenant.pos_cash_sessions SET status = 'closing' WHERE organization_id = $1 AND id = $2 AND status = 'open'`, [context.organizationId, shift.cash_session_id]);
  await event(client, context, "shift", shift.id, "pos.shift.closing_started", { own: authority.own, reason: authority.own ? null : text(input.reason) });
  return getShiftClosingContext(client, context, { shiftId: shift.id });
}

// Back to selling (something must be finished first): the counts so far are kept, superseded. Never after the close.
export async function cancelShiftClosing(client, context, shiftId, input = {}) {
  const shift = await loadShift(client, context, shiftId, { lock: true });
  if (["CLOSED", "FORCE_CLOSED"].includes(shift.lifecycle_status)) throw closeError(409, "POS_SHIFT_CLOSE_ALREADY_CLOSED");
  if (shift.lifecycle_status !== "CLOSING") throw closeError(409, "POS_SHIFT_CLOSE_NOT_STARTED");
  await closingAuthority(client, context, shift, input);
  await client.query(`UPDATE tenant.pos_cash_closing_counts SET status = 'SUPERSEDED', status_changed_at = now() WHERE organization_id = $1 AND shift_id = $2 AND status = 'SUBMITTED'`,
    [context.organizationId, shift.id]);
  await client.query(`UPDATE tenant.pos_shifts SET lifecycle_status = 'OPEN', closing_started_at = NULL, closing_started_by = NULL WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, shift.id]);
  if (shift.cash_session_id) await client.query(`UPDATE tenant.pos_cash_sessions SET status = 'open' WHERE organization_id = $1 AND id = $2 AND status = 'closing'`, [context.organizationId, shift.cash_session_id]);
  await event(client, context, "shift", shift.id, "pos.shift.closing_cancelled", { reason: text(input.reason) });
  return getShiftClosingContext(client, context, { shiftId: shift.id });
}

// ------------------------------------------------------------------ step 2: blind count

function readClosingCount(input, policy) {
  let total = null;
  let details = null;
  if (Array.isArray(input.denominations) && input.denominations.length) {
    details = [];
    let sum = decimal("0");
    for (const entry of input.denominations) {
      const denomination = Number(entry?.denomination);
      const count = Number(entry?.count ?? 0);
      if (!policy.denominations.includes(denomination)) throw closeError(400, "POS_SHIFT_CLOSE_COUNT_INVALID", `₹${entry?.denomination} is not a counted denomination here.`);
      if (!Number.isInteger(count) || count < 0) throw closeError(400, "POS_SHIFT_CLOSE_COUNT_INVALID", "Counts are whole numbers, zero or more.");
      if (count) details.push({ denomination, count, amount: money(denomination * count) });
      sum = add(sum, decimal(String(denomination * count)));
    }
    total = sum;
  }
  const raw = input.countedAmount ?? input.countedCash;
  if (raw === undefined || raw === null || raw === "") {
    if (total === null) throw closeError(400, "POS_SHIFT_CLOSE_CASH_COUNT_REQUIRED");
    return { amount: total, details };
  }
  const value = String(raw).trim();
  if (!MONEY.test(value)) throw closeError(400, "POS_SHIFT_CLOSE_COUNT_INVALID");
  const amount = decimal(value);
  if (total !== null && total !== amount) throw closeError(400, "POS_SHIFT_CLOSE_COUNT_INVALID", `The notes and coins add up to ₹${out(total)}, not ₹${money(value)}.`);
  return { amount, details };
}

// The cash physically in the drawer, confirmed by the person closing (input.countedConfirmed: "I physically counted this cash"). A recount
// supersedes the previous count; every count is kept with the expected cash and difference at that moment. Any approval given for an earlier
// count no longer fits. input: countedAmount | denominations, countedConfirmed, idempotencyKey?.
export async function submitBlindCashCount(client, context, shiftId, input = {}) {
  const shift = await loadShift(client, context, shiftId, { lock: true });
  if (["CLOSED", "FORCE_CLOSED"].includes(shift.lifecycle_status)) throw closeError(409, "POS_SHIFT_CLOSE_ALREADY_CLOSED");
  if (shift.lifecycle_status !== "CLOSING") throw closeError(409, "POS_SHIFT_CLOSE_NOT_STARTED");
  if (shift.cashier_user_id !== context.userId && shift.closing_started_by !== context.userId) throw closeError(403, "POS_SHIFT_CLOSE_PERMISSION_DENIED", "Only the person closing this shift counts its drawer.");
  if (!shift.cash_session_id) throw closeError(409, "POS_SHIFT_CLOSE_COUNT_INVALID", "A card / UPI shift has no cash to count.");
  const policy = await policyOf(client, context);
  const key = text(input.idempotencyKey, 120);
  if (key) {
    const replay = (await client.query(`SELECT closing_count.*, users.full_name AS counted_by_name FROM tenant.pos_cash_closing_counts closing_count LEFT JOIN public.users ON users.id = closing_count.counted_by
      WHERE closing_count.organization_id = $1 AND closing_count.idempotency_key = $2`, [context.organizationId, key])).rows[0];
    if (replay) {
      if (replay.shift_id !== shift.id) throw closeError(409, "POS_SHIFT_CLOSE_IDEMPOTENCY_CONFLICT");
      return countView(client, context, shift, replay, policy, await seesExpectedCash(client, context, shift.store_id));
    }
  }
  if (input.countedConfirmed !== true) throw closeError(400, "POS_SHIFT_CLOSE_CASH_COUNT_REQUIRED", "Confirm that you physically counted the cash in the drawer.");
  const count = readClosingCount(input, policy);
  const { expected } = await computeExpectedCash(client, context.organizationId, shift.id, shift.opening_float_amount);
  const ledgerVersion = await cashLedgerVersion(client, context.organizationId, shift.id);
  const sequence = (await client.query(`SELECT COALESCE(max(count_sequence), 0)::int + 1 AS next FROM tenant.pos_cash_closing_counts WHERE organization_id = $1 AND cash_session_id = $2`,
    [context.organizationId, shift.cash_session_id])).rows[0].next;
  await client.query(`UPDATE tenant.pos_cash_closing_counts SET status = 'SUPERSEDED', status_changed_at = now() WHERE organization_id = $1 AND cash_session_id = $2 AND status = 'SUBMITTED'`,
    [context.organizationId, shift.cash_session_id]);
  const row = (await client.query(
    `INSERT INTO tenant.pos_cash_closing_counts (organization_id, shift_id, cash_session_id, count_sequence, counted_amount, denominations, expected_amount, variance_amount, counted_by, idempotency_key,
       cash_ledger_version, policy_version)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $5::numeric - $7::numeric, $8, $9, $10, $11) RETURNING *`,
    [context.organizationId, shift.id, shift.cash_session_id, sequence, asDatabaseDecimal(count.amount), count.details ? JSON.stringify(count.details) : null,
      asDatabaseDecimal(expected), context.userId, key, ledgerVersion, policy.variance.version])).rows[0];
  await event(client, context, "shift", shift.id, "pos.shift.closing_counted", { countId: row.id, sequence, counted: out(count.amount), expected: out(expected),
    variance: out(sub(count.amount, expected)), denominations: Boolean(count.details) });
  const names = (await client.query(`SELECT full_name FROM public.users WHERE id = $1`, [context.userId])).rows[0];
  return countView(client, context, shift, { ...row, counted_by_name: names?.full_name, counts: sequence }, policy, await seesExpectedCash(client, context, shift.store_id));
}

// ------------------------------------------------------------------ step 3: reconciliation and approval

// Expected against counted for the current count: for the person who counted (when the policy shows it) and for those who may see expected
// cash. The detailed breakdown is only for the latter.
export async function getShiftCashReconciliation(client, context, shiftId) {
  const shift = await loadShift(client, context, shiftId);
  if (!shift.cash_session_id) return { shiftId: shift.id, cashEnabled: false };
  const policy = await policyOf(client, context);
  const sensitive = await seesExpectedCash(client, context, shift.store_id);
  const count = await latestCountOf(client, context, shift);
  const own = shift.cashier_user_id === context.userId || shift.closing_started_by === context.userId;
  if (!count && (own || !sensitive)) throw closeError(409, "POS_SHIFT_CLOSE_CASH_COUNT_REQUIRED", "Count the drawer first: the expected cash is shown after your count.");
  if (!sensitive && !(own && policy.reveal)) throw closeError(403, "POS_SHIFT_CLOSE_PERMISSION_DENIED", "You cannot see the expected cash in this drawer.");
  const { breakdown, expected } = await computeExpectedCash(client, context.organizationId, shift.id, shift.opening_float_amount);
  return { shiftId: shift.id, cashEnabled: true, currency: shift.currency.trim(), expectedAmount: out(expected), breakdown: sensitive ? breakdown : null,
    count: await countView(client, context, shift, count, { ...policy, reveal: true }, true) };
}

// Ask a supervisor to accept this count's difference: exactly this shift, count, expected cash and amount (a recount needs a new approval);
// never approvable by the cashier themselves. input: reason.
export async function requestShiftClosingApproval(client, context, shiftId, input = {}) {
  const shift = await loadShift(client, context, shiftId);
  if (shift.lifecycle_status !== "CLOSING") throw closeError(409, "POS_SHIFT_CLOSE_NOT_STARTED");
  const count = await latestCountOf(client, context, shift);
  if (!count || count.status !== "SUBMITTED") throw closeError(409, "POS_SHIFT_CLOSE_CASH_COUNT_REQUIRED");
  const policy = await policyOf(client, context);
  const { expected } = await computeExpectedCash(client, context.organizationId, shift.id, shift.opening_float_amount);
  const variance = sub(decimal(String(count.counted_amount)), expected);
  const verdict = evaluate(policy, variance);
  if (await staleCount(client, context, shift, count)) throw closeError(409, "POS_CASH_DIFFERENCE_STALE", "Cash in the drawer changed after your count. Count the drawer again.");
  if (!verdict.approvalRequired) throw closeError(409, "POS_SHIFT_CLOSE_APPROVAL_INVALID", "This count does not need an approval.");
  if (verdict.blocked) throw closeError(409, "POS_SHIFT_CLOSE_RECONCILIATION_REQUIRED", "The difference is above the company's hard limit: a supervisor must reconcile and close this shift.");
  return requestSupervisorApproval(client, context, { permission: "SESSION_CLOSE_OWN", resource: { type: "pos_shift", id: shift.id }, amount: asDatabaseDecimal(verdict.amount),
    reason: text(input.reason) ?? `Closing cash ${variance < 0n ? "short" : "over"} by ₹${out(verdict.amount)}`,
    action: { kind: "shift_closing_variance", fingerprint: fingerprintOf(shift, count, expected, policy), countId: count.id, cashSessionId: shift.cash_session_id, counted: money(count.counted_amount),
      expected: out(expected), variance: out(variance), type: verdict.type, cashLedgerVersion: count.cash_ledger_version, policyVersion: policy.variance.version,
      reasonCode: text(input.reasonCode, 40) }, idempotencyKey: input.idempotencyKey });
}

// A supervisor hands an unknown card / UPI outcome (or money collected for an incomplete sale) to an accountable owner, so the close can go
// ahead without forgetting it. Cash custody is never handed off this way. input: exceptionType, referenceId, assignedTo?, note.
export async function assignShiftClosingException(client, context, shiftId, input = {}) {
  const shift = await loadShift(client, context, shiftId, { lock: true });
  if (shift.cashier_user_id === context.userId) throw closeError(403, "POS_SHIFT_CLOSE_PERMISSION_DENIED", "A supervisor other than the cashier takes over an unresolved payment.");
  const note = text(input.note ?? input.reason);
  if (!note) throw closeError(400, "POS_SHIFT_CLOSE_RECONCILIATION_REQUIRED", "Say how the payment will be resolved.");
  await closingAuthority(client, context, shift, { reason: note });
  const type = String(input.exceptionType ?? "");
  if (!["PAYMENT_UNKNOWN", "SPLIT_PAYMENT"].includes(type)) throw closeError(400, "POS_SHIFT_CLOSE_RECONCILIATION_REQUIRED", "Only an unresolved card / UPI payment can be handed to an owner.");
  const blocker = (await blockersOf(client, context, shift)).items.find((item) => item.type === type && item.referenceId === input.referenceId);
  if (!blocker) throw closeError(404, "POS_SHIFT_EXCEPTION_NOT_FOUND", "That payment is not unresolved on this shift.");
  const assignee = UUID.test(String(input.assignedTo ?? "")) ? input.assignedTo : context.userId;
  const row = (await client.query(
    `INSERT INTO tenant.pos_shift_closing_exceptions (organization_id, shift_id, exception_type, reference_type, reference_id, amount, status, assigned_to, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'ASSIGNED', $7, $8, $9)
     ON CONFLICT (organization_id, shift_id, exception_type, reference_id) WHERE reference_id IS NOT NULL DO NOTHING RETURNING id`,
    [context.organizationId, shift.id, type, blocker.referenceType, blocker.referenceId, blocker.amount, assignee, note, context.userId])).rows[0];
  await event(client, context, "shift", shift.id, "pos.shift.closing_exception_assigned", { exceptionId: row?.id ?? null, type, referenceId: blocker.referenceId, assignedTo: assignee });
  return blockersOf(client, context, shift);
}

// ------------------------------------------------------------------ step 4: destinations and finalization

// Where the counted cash goes, each amount once, adding up to the count. At most one part stays in the drawer (for the next shift, or secured
// pending a handover); the safe needs its slip or bag reference; a manager is named (someone who may supervise cash, not the closer).
async function readDestinations(client, context, shift, input, counted) {
  let list = Array.isArray(input.destinations) ? input.destinations : [];
  if (!list.length && input.handoverAmount !== undefined && input.handoverAmount !== null && input.handoverAmount !== "") {
    if (!MONEY.test(String(input.handoverAmount).trim())) throw closeError(400, "POS_SHIFT_CLOSE_HANDOVER_INVALID");
    const left = decimal(String(input.handoverAmount).trim());
    if (left > counted) throw closeError(400, "POS_SHIFT_CLOSE_HANDOVER_INVALID", "The cash left in the drawer cannot be more than the cash counted.");
    const removed = sub(counted, left);
    list = [...(left > 0n ? [{ type: "NEXT_SHIFT_HANDOVER", amount: out(left) }] : []),
      ...(removed > 0n ? [{ type: "STORE_SAFE", amount: out(removed), reference: input.removalNote }] : [])];
  }
  if (counted === 0n) {
    if (list.some((entry) => Number(entry?.amount ?? 0) > 0)) throw closeError(400, "POS_SHIFT_CLOSE_HANDOVER_INVALID", "No cash was counted, so there is nothing to hand over.");
    return [];
  }
  if (!list.length) throw closeError(400, "POS_SHIFT_CLOSE_HANDOVER_REQUIRED");
  const destinations = [];
  let total = decimal("0");
  for (const entry of list) {
    const type = String(entry?.type ?? entry?.destinationType ?? "");
    if (!CASH_DESTINATIONS.includes(type)) throw closeError(400, "POS_SHIFT_CLOSE_HANDOVER_INVALID", "Choose a destination: next shift, store safe, a manager or the secured drawer.");
    const raw = String(entry?.amount ?? "").trim();
    if (!MONEY.test(raw) || decimal(raw) <= 0n) throw closeError(400, "POS_SHIFT_CLOSE_HANDOVER_INVALID", "Each destination needs an amount above zero.");
    const reference = text(entry?.reference, 120);
    if (type === "STORE_SAFE" && !reference) throw closeError(400, "POS_SHIFT_CLOSE_HANDOVER_INVALID", "Give the safe slip or bag number for the cash put in the safe.");
    let recipient = null;
    if (type === "AUTHORIZED_MANAGER") {
      recipient = UUID.test(String(entry?.recipientUserId ?? "")) ? entry.recipientUserId : null;
      if (!recipient || recipient === context.userId || recipient === shift.cashier_user_id) throw closeError(400, "POS_SHIFT_CLOSE_HANDOVER_INVALID", "Name the manager receiving the cash (not yourself).");
      const authority = await getEffectivePosPermissions(client, context, recipient).catch(() => null);
      const allowed = authority?.profileStatus === "active" && authority.grants.some((grant) => grant.enabled && ["SESSION_CLOSE_OTHER", "APPROVE_CASH_MOVEMENT_EXCEPTION"].includes(grant.code));
      if (!allowed) throw closeError(400, "POS_SHIFT_CLOSE_HANDOVER_INVALID", "That person is not authorized to receive cash.");
    }
    total = add(total, decimal(raw));
    destinations.push({ type, amount: decimal(raw), reference, note: text(entry?.note, 300), recipient });
  }
  if (destinations.filter((entry) => IN_DRAWER.includes(entry.type)).length > 1) throw closeError(400, "POS_SHIFT_CLOSE_HANDOVER_INVALID", "Only one amount stays in the drawer.");
  if (total !== counted) throw closeError(400, "POS_SHIFT_CLOSE_HANDOVER_INVALID", `The destinations add up to ₹${out(total)}; the drawer holds ₹${out(counted)}.`);
  return destinations;
}

// Check where the closing cash will go against the current count, before closing (nothing is written: the destinations are recorded by the
// close itself, in the same transaction). input: destinations[] (or handoverAmount + removalNote).
export async function prepareCashHandover(client, context, shiftId, input = {}) {
  const shift = await loadShift(client, context, shiftId);
  if (shift.lifecycle_status !== "CLOSING") throw closeError(409, "POS_SHIFT_CLOSE_NOT_STARTED");
  if (!shift.cash_session_id) throw closeError(400, "POS_SHIFT_CLOSE_HANDOVER_INVALID", "A card / UPI shift has no cash to hand over.");
  const count = await latestCountOf(client, context, shift);
  if (!count || count.status !== "SUBMITTED") throw closeError(409, "POS_SHIFT_CLOSE_CASH_COUNT_REQUIRED");
  const destinations = await readDestinations(client, context, shift, input, decimal(String(count.counted_amount)));
  return { shiftId: shift.id, countId: count.id, countedAmount: money(count.counted_amount),
    destinations: destinations.map((entry) => ({ type: entry.type, amount: out(entry.amount), reference: entry.reference, recipientUserId: entry.recipient, note: entry.note })) };
}

async function closingResultOf(client, context, closingId, showExpected) {
  const closing = (await client.query(`SELECT * FROM tenant.pos_shift_closings WHERE organization_id = $1 AND id = $2`, [context.organizationId, closingId])).rows[0];
  if (!closing) return null;
  const transfers = (await client.query(
    `SELECT transfer.*, recipient.full_name AS recipient_name, accepter.full_name AS accepted_by_name FROM tenant.pos_cash_custody_transfers transfer
       LEFT JOIN public.users recipient ON recipient.id = transfer.recipient_user_id LEFT JOIN public.users accepter ON accepter.id = transfer.accepted_by
      WHERE transfer.organization_id = $1 AND transfer.closing_id = $2 ORDER BY transfer.created_at, transfer.destination_type`, [context.organizationId, closingId])).rows;
  const exceptions = (await client.query(
    `SELECT id, exception_type, reference_id, amount, status, assigned_queue FROM tenant.pos_shift_closing_exceptions WHERE organization_id = $1 AND closing_id = $2 ORDER BY created_at`,
    [context.organizationId, closingId])).rows;
  const pending = transfers.some((transfer) => transfer.status === "PENDING_ACCEPTANCE");
  return {
    closingId: closing.id, closingReportId: closing.id, shiftId: closing.shift_id, status: closing.closing_status, closingType: closing.closing_type,
    cashSessionStatus: closing.cash_session_id ? "CLOSED" : null, closedAt: closing.closed_at,
    expectedCashAmount: closing.cash_session_id && showExpected ? money(closing.expected_cash_amount) : null,
    countedCashAmount: money(closing.counted_cash_amount), cashVarianceAmount: closing.cash_session_id && showExpected ? money(closing.variance_amount) : null,
    varianceReasonCode: closing.variance_reason_code, varianceReason: closing.variance_reason,
    handoverStatus: !closing.cash_session_id ? "NOT_APPLICABLE" : !transfers.length ? "NO_CASH" : pending ? "PENDING_ACCEPTANCE" : "TRANSFERRED",
    destinations: transfers.map((transfer) => ({ id: transfer.id, type: transfer.destination_type, amount: money(transfer.amount), reference: transfer.reference,
      recipient: transfer.recipient_name ?? null, status: transfer.status, acceptedBy: transfer.accepted_by_name ?? null, acceptedAt: transfer.accepted_at,
      receivedAmount: money(transfer.received_amount), varianceAmount: money(transfer.variance_amount) })),
    exceptions: exceptions.map((row) => ({ id: row.id, type: row.exception_type, referenceId: row.reference_id, amount: money(row.amount), status: row.status, queue: row.assigned_queue })),
    snapshotHash: closing.snapshot_hash,
  };
}

// Finalize: one closing per shift, serialized on the shift row, replayed for a repeated key. Refused with a stable code while anything is
// unresolved (a supervisor may force-close: everything left becomes an exception they own). input: closingCountId?, varianceReasonCode,
// varianceReason, approvalId, destinations[] (or the shorthand handoverAmount + removalNote), expectedVersion?, idempotencyKey, reason (a
// supervisor closing someone else's shift), force?, notes?.
export async function finalizeShiftClosing(client, context, shiftId, input = {}) {
  requirePermission(context, "pos.view");
  const key = text(input.idempotencyKey, 120);
  if (!key) throw closeError(400, "POS_SHIFT_CLOSE_OUTCOME_UNKNOWN", "Retry the close from the closing screen (a request key is needed).");
  const replay = (await client.query(`SELECT id, shift_id FROM tenant.pos_shift_closings WHERE organization_id = $1 AND idempotency_key = $2`, [context.organizationId, key])).rows[0];
  if (replay) {
    if (replay.shift_id !== shiftId) throw closeError(409, "POS_SHIFT_CLOSE_IDEMPOTENCY_CONFLICT");
    const shift = await loadShift(client, context, shiftId);
    return closingResultOf(client, context, replay.id, (await seesExpectedCash(client, context, shift.store_id)) || (await policyOf(client, context)).reveal);
  }
  const shift = await loadShift(client, context, shiftId, { lock: true });
  if (["CLOSED", "FORCE_CLOSED"].includes(shift.lifecycle_status) || shift.closing_id) throw closeError(409, "POS_SHIFT_CLOSE_ALREADY_CLOSED", undefined, { closingId: shift.closing_id });
  if (shift.lifecycle_status === "RECOVERY_REQUIRED") throw closeError(409, "POS_SHIFT_CLOSE_RECONCILIATION_REQUIRED", "The shift needs a supervisor's review before it can be closed.");
  if (["OPEN", "SUSPENDED"].includes(shift.lifecycle_status)) throw closeError(409, "POS_SHIFT_CLOSE_NOT_STARTED");
  if (shift.lifecycle_status !== "CLOSING") throw closeError(409, "POS_SHIFT_CLOSE_NOT_OPEN");
  if (input.expectedVersion !== undefined && input.expectedVersion !== null && Number(input.expectedVersion) !== Number(shift.version)) throw closeError(409, "POS_SHIFT_CLOSE_VERSION_CONFLICT");
  const policy = await policyOf(client, context);
  const force = input.force === true;
  const closeReason = text(input.reason ?? input.closeReason);

  // Cash: the current count against the expected cash now.
  let count = null; let expected = null; let variance = null; let verdict = null; let breakdown = null;
  if (shift.cash_session_id) {
    count = await latestCountOf(client, context, shift);
    if (!count || count.status !== "SUBMITTED") throw closeError(409, "POS_SHIFT_CLOSE_CASH_COUNT_REQUIRED");
    if (input.closingCountId && input.closingCountId !== count.id) throw closeError(409, "POS_SHIFT_CLOSE_COUNT_INVALID", "That count was replaced by a recount. Review the latest count.");
    ({ expected, breakdown } = await computeExpectedCash(client, context.organizationId, shift.id, shift.opening_float_amount));
    variance = sub(decimal(String(count.counted_amount)), expected);
    verdict = evaluate(policy, variance);
    // Cash Difference (0106): a cash event after the count (a refund payout confirmed, cash handed back …) makes the comparison stale.
    if (await staleCount(client, context, shift, count)) throw closeError(409, "POS_CASH_DIFFERENCE_STALE", "Cash in the drawer changed after your count. Count the drawer again.");
  } else if ((Array.isArray(input.destinations) && input.destinations.length) || (input.handoverAmount !== undefined && input.handoverAmount !== null && input.handoverAmount !== "")) {
    throw closeError(400, "POS_SHIFT_CLOSE_HANDOVER_INVALID", "A card / UPI shift has no cash to hand over.");
  }
  const authority = await closingAuthority(client, context, shift, input, verdict && variance !== 0n ? verdict.amount : null);
  if (force && (authority.own || !can(context, "pos.store.manage") || !closeReason)) throw closeError(403, "POS_SHIFT_CLOSE_PERMISSION_DENIED", "Only an outlet manager closing another cashier's shift, with a reason, can force-close it.");

  const blockers = await blockersOf(client, context, shift);
  const hard = blockers.items.filter((item) => item.blocking);
  if (hard.length && !force) throw closeError(409, BLOCKER_ERROR[hard[0].type] ?? "POS_SHIFT_CLOSE_RECONCILIATION_REQUIRED", undefined, { blockers: hard });

  let reasonCode = null; let reason = null; let approval = null; let destinations = null;
  if (verdict?.reasonRequired) {
    const picked = readDifferenceReason(policy.variance, input);
    if (picked.error) throw closeError(400, "POS_SHIFT_CLOSE_VARIANCE_REASON_REQUIRED", picked.error, { reasons: policy.reasons });
    reasonCode = picked.code;
    reason = picked.note;
    const reconciler = authority.supervisor || force;
    if (verdict.blocked && !reconciler) throw closeError(409, "POS_SHIFT_CLOSE_RECONCILIATION_REQUIRED", "The difference is above the company's hard limit: a supervisor must reconcile and close this shift.",
      { amount: out(verdict.amount) });
    if (verdict.approvalRequired && !reconciler) {
      const fingerprint = fingerprintOf(shift, count, expected, policy);
      if (!input.approvalId) throw closeError(409, "POS_SHIFT_CLOSE_APPROVAL_REQUIRED", undefined, { fingerprint, amount: out(verdict.amount), countId: count.id });
      // The approval must fit exactly this count; then where the cash goes is checked; only then is the approval used (a refused close never spends it).
      const expectation = { permission: "SESSION_CLOSE_OWN", approvalCode: "APPROVE_CASH_MOVEMENT_EXCEPTION", resource: { type: "pos_shift", id: shift.id },
        amount: asDatabaseDecimal(verdict.amount), fingerprint };
      const invalid = (error) => closeError(409, "POS_SHIFT_CLOSE_APPROVAL_INVALID", `${POS_SHIFT_CLOSE_MESSAGES.POS_SHIFT_CLOSE_APPROVAL_INVALID} ${error?.message ?? ""}`.trim());
      let pending;
      try { pending = await validateApproval(client, context, input.approvalId, expectation); } catch (error) { throw invalid(error); }
      if (pending.requested_action?.fingerprint !== fingerprint) throw invalid();
      destinations = await readDestinations(client, context, shift, input, decimal(String(count.counted_amount)));
      try { approval = await consumeApprovalAtomically(client, context, input.approvalId, expectation); } catch (error) { throw invalid(error); }
    }
  }

  if (destinations === null) destinations = shift.cash_session_id ? await readDestinations(client, context, shift, input, decimal(String(count.counted_amount))) : [];

  // Write: the count, the closing record and its snapshot, the drawer handover and destinations, exceptions, held bills, the session and cash session.
  const closingId = randomUUID();
  const closer = (await client.query(`SELECT full_name FROM public.users WHERE id = $1`, [context.userId])).rows[0]?.full_name ?? null;
  const recipients = new Map((await client.query(`SELECT id, full_name FROM public.users WHERE id = ANY($1::uuid[])`,
    [destinations.map((entry) => entry.recipient).filter(Boolean)])).rows.map((row) => [row.id, row.full_name]));
  const summary = await paymentSummaryOf(client, context, shift);
  const closedAt = (await client.query(`SELECT now() AS now`)).rows[0].now;
  const custody = !shift.cash_session_id ? "NOT_APPLICABLE" : destinations.length ? "PENDING_ACCEPTANCE" : "NO_CASH";
  const approvalInfo = approval ? (await client.query(`SELECT approval.id, users.full_name AS approver FROM tenant.pos_permission_approvals approval LEFT JOIN public.users ON users.id = approval.approver_user_id
      WHERE approval.organization_id = $1 AND approval.id = $2`, [context.organizationId, approval.id])).rows[0] : null;
  const forced = force ? hard : [];
  const pendingRefunds = blockers.items.filter((item) => item.type === "DIGITAL_REFUND");
  const snapshot = {
    version: 1, closingId, shift: { id: shift.id, number: shift.shift_number, cashier: shift.cashier_name, outlet: shift.store_name, outletCode: shift.store_code,
      terminal: shift.terminal_code, terminalName: shift.terminal_name, drawer: shift.cash_drawer_id ? `${shift.drawer_name} (${shift.drawer_code})` : null },
    times: { openedAt: shift.opened_at, closingStartedAt: shift.closing_started_at, closedAt,
      durationMinutes: shift.opened_at ? Math.round((new Date(closedAt) - new Date(shift.opened_at)) / 60000) : null },
    currency: shift.currency.trim(), sales: summary.sales, payments: summary.methods, split: summary.split, refunds: summary.refunds,
    cash: shift.cash_session_id ? { openingFloat: money(shift.opening_float_amount), openingSource: shift.cash_source, breakdown, expected: out(expected),
      counted: money(count.counted_amount), variance: out(variance), countSequence: count.count_sequence, recounts: count.count_sequence - 1, denominations: count.denominations ?? null,
      varianceReasonCode: reasonCode, varianceReasonLabel: reasonCode ? CLOSING_VARIANCE_REASONS[reasonCode] ?? reasonCode : null, varianceReason: reason,
      revealToCashier: policy.reveal } : null,
    approvals: approvalInfo ? [{ id: approvalInfo.id, approver: approvalInfo.approver, amount: out(verdict.amount) }]
      : verdict?.reasonRequired && (authority.supervisor || force) ? [{ id: null, approver: closer, amount: out(verdict.amount), reconciledBySupervisor: true }] : [],
    custody: { status: custody, destinations: destinations.map((entry) => ({ type: entry.type, amount: out(entry.amount), reference: entry.reference,
      recipient: entry.recipient ? recipients.get(entry.recipient) ?? null : null, status: "PENDING_ACCEPTANCE" })) },
    exceptions: [...blockers.items.filter((item) => item.managed), ...forced, ...pendingRefunds].map((item) => ({ type: item.type, referenceId: item.referenceId, label: item.label, amount: item.amount })),
    heldCarts: blockers.heldCarts, openBillsHeld: blockers.openBills,
    closedBy: closer, closingType: force ? "FORCE" : "NORMAL", closeReason: authority.own && !force ? null : closeReason, notes: text(input.notes ?? input.closeNotes),
  };
  if (count) await client.query(`UPDATE tenant.pos_cash_closing_counts SET status = 'FINALIZED', status_changed_at = now() WHERE organization_id = $1 AND id = $2`, [context.organizationId, count.id]);
  await client.query(
    `INSERT INTO tenant.pos_shift_closings (id, organization_id, shift_id, cash_session_id, store_id, terminal_id, cashier_user_id, closing_type, closing_status, opened_at, closing_started_at,
       closed_at, currency_code, opening_float_amount, expected_cash_amount, counted_cash_amount, variance_amount, variance_reason_code, variance_reason, approval_id, closing_count_id,
       cash_custody_status, snapshot, snapshot_hash, closed_by, close_reason, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23::jsonb, $24, $25, $26, $27)`,
    [closingId, context.organizationId, shift.id, shift.cash_session_id, shift.store_id, shift.terminal_id, shift.cashier_user_id, force ? "FORCE" : "NORMAL", force ? "FORCE_CLOSED" : "CLOSED",
      shift.opened_at, shift.closing_started_at ?? closedAt, closedAt, shift.currency.trim(), shift.cash_session_id ? money(shift.opening_float_amount) : null,
      shift.cash_session_id ? out(expected) : null, shift.cash_session_id ? money(count.counted_amount) : null, shift.cash_session_id ? out(variance) : null, reasonCode, reason,
      approval?.id ?? null, count?.id ?? null, custody, JSON.stringify(snapshot), hash(snapshot), context.userId, snapshot.closeReason, key]);

  let handoverId = null;
  const inDrawer = destinations.find((entry) => IN_DRAWER.includes(entry.type)) ?? null;
  if (shift.cash_session_id && inDrawer) {
    const counted = decimal(String(count.counted_amount));
    const removed = sub(counted, inDrawer.amount);
    const removalNote = destinations.filter((entry) => !IN_DRAWER.includes(entry.type))
      .map((entry) => `${entry.type === "STORE_SAFE" ? "Safe" : "Manager"} ₹${out(entry.amount)}${entry.reference ? ` (${entry.reference})` : ""}`).join("; ") || null;
    await client.query("SAVEPOINT pos_closing_handover");
    try {
      handoverId = (await client.query(
        `INSERT INTO tenant.pos_cash_handovers (organization_id, store_id, terminal_id, from_session_id, from_cash_session_id, closing_counted_amount, amount, removed_amount, removal_note,
           currency_code, handed_over_by, cash_drawer_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [context.organizationId, shift.store_id, shift.terminal_id, shift.id, shift.cash_session_id, asDatabaseDecimal(counted), asDatabaseDecimal(inDrawer.amount), asDatabaseDecimal(removed),
          removalNote, shift.currency.trim(), context.userId, shift.cash_drawer_id])).rows[0].id;
      await client.query("RELEASE SAVEPOINT pos_closing_handover");
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT pos_closing_handover");
      if (error?.code === "23505") throw closeError(409, "POS_SHIFT_CLOSE_HANDOVER_INVALID", "An earlier handover is still waiting for this drawer. A supervisor must settle it first.");
      throw error;
    }
  }
  for (const entry of destinations) {
    await client.query(
      `INSERT INTO tenant.pos_cash_custody_transfers (organization_id, closing_id, shift_id, cash_session_id, store_id, cash_drawer_id, destination_type, amount, currency_code, reference, note,
         recipient_user_id, handover_id, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [context.organizationId, closingId, shift.id, shift.cash_session_id, shift.store_id, shift.cash_drawer_id, entry.type, asDatabaseDecimal(entry.amount), shift.currency.trim(),
        entry.reference, entry.note, entry.recipient, IN_DRAWER.includes(entry.type) ? handoverId : null, context.userId]);
  }
  // Exceptions: what is handed on, with an owner — the cash difference (to cash control), refunds still with the provider (to refund
  // reconciliation), payments a supervisor took over, and whatever a force-close went over (to the manager who forced it).
  await client.query(`UPDATE tenant.pos_shift_closing_exceptions SET closing_id = $3 WHERE organization_id = $1 AND shift_id = $2 AND closing_id IS NULL`, [context.organizationId, shift.id, closingId]);
  const exception = (type, referenceType, referenceId, amount, values) => client.query(
    `INSERT INTO tenant.pos_shift_closing_exceptions (organization_id, shift_id, closing_id, exception_type, reference_type, reference_id, amount, status, assigned_to, assigned_queue, approval_id,
       note, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ASSIGNED', $8, $9, $10, $11, $12)
     ON CONFLICT (organization_id, shift_id, exception_type, reference_id) WHERE reference_id IS NOT NULL DO NOTHING`,
    [context.organizationId, shift.id, closingId, type, referenceType, referenceId, amount, values.assignedTo ?? null, values.queue ?? null, values.approvalId ?? null, values.note ?? null, context.userId]);
  // Cash Difference (0106): a non-zero closing difference becomes a case (investigated from the start when it was above the hard limit) —
  // never a cash movement; Finance records its treatment later.
  if (variance !== null && variance !== 0n) {
    await recordCashDifference(client, context, { context: "CLOSING", storeId: shift.store_id, terminalId: shift.terminal_id, drawerId: shift.cash_drawer_id,
      cashSessionId: shift.cash_session_id, shiftId: shift.id, cashierUserId: shift.cashier_user_id, currency: shift.currency.trim(), reference: expected,
      counted: decimal(String(count.counted_amount)), countId: count.id, ledgerVersion: count.cash_ledger_version ?? await cashLedgerVersion(client, context.organizationId, shift.id),
      recounts: count.count_sequence - 1, reasonCode, reasonNote: reason, policy: policy.variance, evaluation: verdict, approvalId: approval?.id ?? null, closingId,
      status: verdict.blocked ? "INVESTIGATING" : "OPEN", assignedTo: verdict.blocked ? context.userId : null });
    await notifyPermissionHolders(client, context, "pos.reconciliation.manage", { category: "pos_cash_difference",
      title: `Cash ${variance > 0n ? "over" : "short"} by ₹${out(variance < 0n ? -variance : variance)} at ${shift.store_name ?? "a store"}`,
      message: `Shift ${shift.shift_number ?? ""} (${shift.cashier_name ?? "cashier"}) closed with a difference${reason ? `: ${String(reason).slice(0, 200)}` : "."}`.replace("Shift  (", "Shift ("),
      href: "/pos/reconciliation", entityType: "pos_shift", entityId: shift.id });
  }
  await publishDomainEvent(client, { organizationId: context.organizationId, moduleKey: "point-of-sale", eventType: "pos.shift.closed", entityType: "pos.shift", entityId: shift.id,
    payload: { shiftNumber: shift.shift_number, storeId: shift.store_id, cashierUserId: shift.cashier_user_id, variance: variance === null ? null : out(variance) } });
  for (const item of pendingRefunds) await exception("DIGITAL_REFUND", item.referenceType, item.referenceId, item.amount, { queue: "REFUND_RECONCILIATION", note: item.label });
  for (const item of forced) await exception(item.type, item.referenceType, item.referenceId, item.amount, { assignedTo: context.userId, note: `Force-closed: ${closeReason}` });

  // Bills still being rung up (no checkout) are held for a later session; empty ones are cancelled. Held bills stay as they are.
  for (const cart of (await client.query(
    `SELECT cart.id, (SELECT count(*)::int FROM tenant.pos_cart_lines line WHERE line.organization_id = cart.organization_id AND line.cart_id = cart.id) AS lines
       FROM tenant.pos_carts cart WHERE cart.organization_id = $1 AND cart.shift_id = $2 AND cart.status IN ('draft', 'priced') AND cart.checkout_started_at IS NULL`,
    [context.organizationId, shift.id])).rows) {
    if (cart.lines) {
      await client.query(`UPDATE tenant.pos_carts SET status = 'held', held_at = now(), held_by = $3, hold_note = 'Held when the shift closed', version = version + 1, expires_at = NULL,
          updated_at = now(), updated_by = $3 WHERE organization_id = $1 AND id = $2`, [context.organizationId, cart.id, context.userId]);
      await client.query(`INSERT INTO tenant.pos_cart_events (organization_id, cart_id, event_type, summary, changes, cart_version, terminal_id, actor_user_id)
          SELECT organization_id, id, 'held', 'Held when the shift closed', '{}'::jsonb, version, terminal_id, $3 FROM tenant.pos_carts WHERE organization_id = $1 AND id = $2`,
        [context.organizationId, cart.id, context.userId]);
    } else {
      await client.query(`UPDATE tenant.pos_carts SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'Empty bill closed with the shift', version = version + 1, updated_at = now(),
          updated_by = $3 WHERE organization_id = $1 AND id = $2`, [context.organizationId, cart.id, context.userId]);
    }
  }

  await client.query(
    `UPDATE tenant.pos_shifts SET lifecycle_status = $3, expected_cash = $4, counted_cash = $5, cash_variance = $6, closed_at = $7, closed_by = $8, close_notes = $9, closing_id = $10
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, shift.id, force ? "FORCE_CLOSED" : "CLOSED", shift.cash_session_id ? out(expected) : "0", shift.cash_session_id ? money(count.counted_amount) : null,
      shift.cash_session_id ? out(variance) : null, closedAt, context.userId, snapshot.notes ?? snapshot.closeReason, closingId]);
  if (shift.cash_session_id) await client.query(`UPDATE tenant.pos_cash_sessions SET status = 'closed', closed_at = $3 WHERE organization_id = $1 AND id = $2 AND status <> 'closed'`,
    [context.organizationId, shift.cash_session_id, closedAt]);
  if (handoverId) await event(client, context, "shift", shift.id, "pos.shift.cash_handed_over", { handoverId, amount: out(inDrawer.amount) });
  await event(client, context, "shift", shift.id, force ? "pos.shift.force_closed" : "pos.shift.closed", { closingId, expected: out(expected), counted: count ? money(count.counted_amount) : null,
    variance: out(variance), reasonCode, approvalId: approval?.id ?? null, custody, destinations: destinations.map((entry) => ({ type: entry.type, amount: out(entry.amount) })),
    forced: forced.length, reason: snapshot.closeReason });
  return closingResultOf(client, context, closingId, (await seesExpectedCash(client, context, shift.store_id)) || policy.reveal);
}

// One call for a whole close (begin if needed, count, finalize) — what a scripted close or a retry from a lost response uses. The same
// rules apply as step by step. input: countedCash | denominations, plus everything finalizeShiftClosing takes.
export async function closeShift(client, context, shiftId, input = {}) {
  const key = text(input.idempotencyKey, 120) ?? randomUUID();
  const replay = (await client.query(`SELECT id FROM tenant.pos_shift_closings WHERE organization_id = $1 AND idempotency_key = $2`, [context.organizationId, key])).rows[0];
  if (!replay) {
    const shift = await loadShift(client, context, shiftId);
    const status = ["OPEN", "SUSPENDED"].includes(shift.lifecycle_status) ? (await beginShiftClosing(client, context, shiftId, input)).shift.status : shift.lifecycle_status;
    const counting = input.countedCash !== undefined || input.countedAmount !== undefined || (Array.isArray(input.denominations) && input.denominations.length);
    // Only a shift that is closing is counted; anything else gets finalizeShiftClosing's own answer (closed, under review …).
    if (status === "CLOSING" && shift.cash_session_id && counting) await submitBlindCashCount(client, context, shiftId, { ...input, countedConfirmed: input.countedConfirmed ?? true, idempotencyKey: undefined });
  }
  return finalizeShiftClosing(client, context, shiftId, { ...input, idempotencyKey: key });
}

// What a lost response would have said: the closing of this shift (or that it is still open, or closing).
export async function recoverShiftClosing(client, context, shiftId) {
  const shift = await loadShift(client, context, shiftId);
  const policy = await policyOf(client, context);
  if (shift.closing_id) return { closed: true, closing: await closingResultOf(client, context, shift.closing_id, (await seesExpectedCash(client, context, shift.store_id)) || policy.reveal) };
  return { closed: false, status: shift.lifecycle_status, version: shift.version };
}

// ------------------------------------------------------------------ report, prints, history

// The closing report: the immutable snapshot taken at the close (and whether it still matches its hash). The cashier report leaves out the
// expected cash and its breakdown (and the difference when the policy hides it); the reconciliation report needs SESSION_VIEW_EXPECTED_CASH.
export async function getShiftClosingReport(client, context, shiftId, { variant = null } = {}) {
  const shift = await loadShift(client, context, shiftId);
  if (!shift.closing_id) throw closeError(404, "POS_SHIFT_CLOSE_REPORT_UNAVAILABLE", "This shift has not been closed.");
  const sensitive = await seesExpectedCash(client, context, shift.store_id);
  const kind = String(variant ?? (sensitive ? "RECONCILIATION" : "CASHIER")).toUpperCase();
  if (!["CASHIER", "RECONCILIATION"].includes(kind)) throw closeError(400, "POS_SHIFT_CLOSE_REPORT_UNAVAILABLE", "Choose the cashier or the reconciliation report.");
  if (kind === "RECONCILIATION" && !sensitive) throw closeError(403, "POS_SHIFT_CLOSE_PERMISSION_DENIED", "The reconciliation report is for those who may see expected cash.");
  const closing = (await client.query(`SELECT * FROM tenant.pos_shift_closings WHERE organization_id = $1 AND id = $2`, [context.organizationId, shift.closing_id])).rows[0];
  const snapshot = structuredClone(closing.snapshot);
  if (kind === "CASHIER" && snapshot.cash) {
    snapshot.cash.expected = null;
    snapshot.cash.breakdown = null;
    if (!snapshot.cash.revealToCashier) snapshot.cash.variance = null;
  }
  const prints = (await client.query(`SELECT count(*)::int AS n FROM tenant.pos_shift_closing_prints WHERE organization_id = $1 AND closing_id = $2`, [context.organizationId, closing.id])).rows[0].n;
  return { closingId: closing.id, shiftId: shift.id, variant: kind, snapshot, snapshotHash: closing.snapshot_hash, verified: hash(closing.snapshot) === closing.snapshot_hash, prints,
    custodyNow: (await closingResultOf(client, context, closing.id, sensitive)).destinations };
}

// Print or reprint the closing report: recorded, nothing else changes (a printer failure can never reopen anything). A reprint is by the
// shift's cashier or someone at the outlet, with a reason when the company asks for one. input: variant, format (THERMAL | A4), reason.
export async function recordShiftClosingPrint(client, context, shiftId, input = {}) {
  const report = await getShiftClosingReport(client, context, shiftId, { variant: input.variant });
  const format = String(input.format ?? "A4").toUpperCase();
  if (!["THERMAL", "A4"].includes(format)) throw closeError(400, "POS_SHIFT_CLOSE_REPORT_UNAVAILABLE", "Print on the receipt printer (THERMAL) or as a page (A4).");
  const reprint = report.prints > 0;
  const reason = text(input.reason, 300);
  if (reprint && (await policyOf(client, context)).reprintReasonRequired && !reason) throw closeError(400, "POS_SHIFT_CLOSE_REPORT_UNAVAILABLE", "Say why the closing report is printed again.");
  await client.query(`INSERT INTO tenant.pos_shift_closing_prints (organization_id, closing_id, variant, format, is_reprint, reason, printed_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [context.organizationId, report.closingId, report.variant, format, reprint, reason, context.userId]);
  await event(client, context, "shift", shiftId, reprint ? "pos.shift.closing_report_reprinted" : "pos.shift.closing_report_printed", { variant: report.variant, format, reason });
  return { ...report, prints: report.prints + 1, printed: { format, reprint } };
}

// Closings, newest first. A cashier sees their own; those who may see expected cash see their outlets' (with expected cash and differences).
// filters: storeId, terminalId, cashierUserId, from, to (dates), withVariance, custodyPending, q (shift number), limit, offset.
export async function getShiftClosingHistory(client, context, filters = {}) {
  requirePermission(context, "pos.view");
  const sensitive = await seesExpectedCash(client, context, filters.storeId ?? undefined);
  const values = [context.organizationId];
  const where = ["closing.organization_id = $1"];
  const add$ = (value) => { values.push(value); return `$${values.length}`; };
  if (!sensitive) where.push(`closing.cashier_user_id = ${add$(context.userId)}`);
  else {
    const outlets = await accessiblePosStoreIds(client, context);
    if (outlets) where.push(`closing.store_id = ANY(${add$(outlets)}::uuid[])`);
  }
  if (UUID.test(String(filters.storeId ?? ""))) where.push(`closing.store_id = ${add$(filters.storeId)}`);
  if (UUID.test(String(filters.terminalId ?? ""))) where.push(`closing.terminal_id = ${add$(filters.terminalId)}`);
  if (UUID.test(String(filters.cashierUserId ?? ""))) where.push(`closing.cashier_user_id = ${add$(filters.cashierUserId)}`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.from ?? ""))) where.push(`closing.closed_at >= ${add$(filters.from)}::date`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.to ?? ""))) where.push(`closing.closed_at < ${add$(filters.to)}::date + 1`);
  if (filters.withVariance === true || filters.withVariance === "true") where.push("COALESCE(closing.variance_amount, 0) <> 0");
  if (filters.custodyPending === true || filters.custodyPending === "true")
    where.push(`EXISTS (SELECT 1 FROM tenant.pos_cash_custody_transfers transfer WHERE transfer.organization_id = closing.organization_id AND transfer.closing_id = closing.id AND transfer.status = 'PENDING_ACCEPTANCE')`);
  if (text(filters.q, 60)) where.push(`shift.shift_number ILIKE ${add$(`%${text(filters.q, 60)}%`)}`);
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const scope = `FROM tenant.pos_shift_closings closing
    JOIN tenant.pos_shifts shift ON shift.organization_id = closing.organization_id AND shift.id = closing.shift_id
    JOIN tenant.pos_stores store ON store.organization_id = closing.organization_id AND store.id = closing.store_id
    JOIN tenant.pos_terminals terminal ON terminal.organization_id = closing.organization_id AND terminal.id = closing.terminal_id
    LEFT JOIN public.users cashier ON cashier.id = closing.cashier_user_id
    LEFT JOIN public.users closer ON closer.id = closing.closed_by
   WHERE ${where.join(" AND ")}`;
  const total = (await client.query(`SELECT count(*)::int AS n ${scope}`, values)).rows[0].n;
  const rows = (await client.query(
    `SELECT closing.*, shift.shift_number, store.name AS store_name, terminal.code AS terminal_code, cashier.full_name AS cashier_name, closer.full_name AS closer_name,
            (SELECT count(*)::int FROM tenant.pos_cash_custody_transfers transfer WHERE transfer.organization_id = closing.organization_id AND transfer.closing_id = closing.id
               AND transfer.status = 'PENDING_ACCEPTANCE') AS pending_transfers,
            (SELECT count(*)::int FROM tenant.pos_shift_closing_exceptions exception WHERE exception.organization_id = closing.organization_id AND exception.closing_id = closing.id
               AND exception.status <> 'RESOLVED') AS open_exceptions
     ${scope} ORDER BY closing.closed_at DESC LIMIT ${limit} OFFSET ${offset}`, values)).rows;
  const reveal = (await policyOf(client, context)).reveal;
  return { total, rows: rows.map((row) => ({
    closingId: row.id, shiftId: row.shift_id, shiftNumber: row.shift_number, status: row.closing_status, outlet: row.store_name, terminal: row.terminal_code, cashier: row.cashier_name,
    closedBy: row.closer_name, openedAt: row.opened_at, closedAt: row.closed_at, cashEnabled: Boolean(row.cash_session_id), currency: row.currency_code.trim(),
    openingFloat: money(row.opening_float_amount), expectedCash: sensitive ? money(row.expected_cash_amount) : null, countedCash: money(row.counted_cash_amount),
    variance: sensitive || reveal ? money(row.variance_amount) : null, varianceReasonCode: row.variance_reason_code, custodyStatus: row.pending_transfers ? "PENDING_ACCEPTANCE"
      : row.cash_custody_status === "PENDING_ACCEPTANCE" ? "TRANSFERRED" : row.cash_custody_status, openExceptions: row.open_exceptions,
  })) };
}

// ------------------------------------------------------------------ custody acceptance and exceptions

function transferView(row) {
  return { id: row.id, closingId: row.closing_id, shiftId: row.shift_id, shiftNumber: row.shift_number ?? null, outlet: row.store_name ?? null, type: row.destination_type,
    amount: money(row.amount), currency: row.currency_code.trim(), reference: row.reference, note: row.note, recipientUserId: row.recipient_user_id, recipient: row.recipient_name ?? null,
    status: row.status, receivedAmount: money(row.received_amount), varianceAmount: money(row.variance_amount), acceptedBy: row.accepted_by_name ?? null, acceptedAt: row.accepted_at,
    handedOverBy: row.created_by_name ?? null, handedOverAt: row.created_at };
}
const TRANSFER_SELECT = `
  SELECT transfer.*, shift.shift_number, store.name AS store_name, recipient.full_name AS recipient_name, accepter.full_name AS accepted_by_name, creator.full_name AS created_by_name
    FROM tenant.pos_cash_custody_transfers transfer
    JOIN tenant.pos_shifts shift ON shift.organization_id = transfer.organization_id AND shift.id = transfer.shift_id
    JOIN tenant.pos_stores store ON store.organization_id = transfer.organization_id AND store.id = transfer.store_id
    LEFT JOIN public.users recipient ON recipient.id = transfer.recipient_user_id
    LEFT JOIN public.users accepter ON accepter.id = transfer.accepted_by
    LEFT JOIN public.users creator ON creator.id = transfer.created_by`;

async function mayReceiveCash(client, context, storeId) {
  if (can(context, "pos.store.manage")) return true;
  for (const permission of ["SESSION_CLOSE_OTHER", "APPROVE_CASH_MOVEMENT_EXCEPTION"]) {
    try { if ((await authorizePosAction(client, context, { permission, outletId: storeId })).decision !== "DENY") return true; } catch { /* next */ }
  }
  return false;
}

// Cash waiting to be accepted: handed to me, or (for those who may receive cash) at my outlets. filters: status, storeId, mine.
export async function listCashCustodyTransfers(client, context, filters = {}) {
  requirePermission(context, "pos.view");
  const values = [context.organizationId];
  const where = ["transfer.organization_id = $1"];
  const status = String(filters.status ?? "PENDING_ACCEPTANCE").toUpperCase();
  if (["PENDING_ACCEPTANCE", "ACCEPTED"].includes(status)) { values.push(status); where.push(`transfer.status = $${values.length}`); }
  if (UUID.test(String(filters.storeId ?? ""))) { values.push(filters.storeId); where.push(`transfer.store_id = $${values.length}`); }
  const supervisor = await mayReceiveCash(client, context, filters.storeId ?? undefined);
  if (filters.mine === true || filters.mine === "true" || !supervisor) {
    values.push(context.userId);
    where.push(`(transfer.recipient_user_id = $${values.length} OR transfer.created_by = $${values.length})`);
  } else {
    const outlets = await accessiblePosStoreIds(client, context);
    if (outlets) { values.push(outlets); where.push(`transfer.store_id = ANY($${values.length}::uuid[])`); }
  }
  return (await client.query(`${TRANSFER_SELECT} WHERE ${where.join(" AND ")} ORDER BY transfer.created_at DESC LIMIT 200`, values)).rows.map(transferView);
}

// Accept cash taken out of the drawer at a close: the named manager, or for the safe a supervisor at the outlet — never the person who closed.
// What was actually received is recorded; a difference stays visible with a note. Cash left in the drawer is accepted by the next opening
// count, not here. input: receivedAmount, note.
export async function acceptCashCustodyTransfer(client, context, transferId, input = {}) {
  requirePermission(context, "pos.view");
  if (!UUID.test(String(transferId ?? ""))) throw closeError(404, "POS_CASH_TRANSFER_NOT_FOUND");
  const row = (await client.query(`SELECT * FROM tenant.pos_cash_custody_transfers WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, transferId])).rows[0];
  if (!row) throw closeError(404, "POS_CASH_TRANSFER_NOT_FOUND");
  if (row.recipient_user_id !== context.userId) {
    try { await assertPosStoreAccess(client, context, row.store_id); } catch { throw closeError(404, "POS_CASH_TRANSFER_NOT_FOUND"); }
  }
  if (row.status === "ACCEPTED") throw closeError(409, "POS_CASH_TRANSFER_SETTLED");
  if (IN_DRAWER.includes(row.destination_type)) throw closeError(409, "POS_CASH_TRANSFER_BY_OPENING");
  if (row.created_by === context.userId) throw closeError(403, "POS_CASH_TRANSFER_SELF_ACCEPT");
  if (row.destination_type === "AUTHORIZED_MANAGER" && row.recipient_user_id !== context.userId) throw closeError(403, "POS_CASH_TRANSFER_NOT_RECIPIENT");
  if (row.destination_type === "STORE_SAFE" && !(await mayReceiveCash(client, context, row.store_id))) throw closeError(403, "POS_CASH_TRANSFER_NOT_RECIPIENT", "Only a supervisor at this outlet confirms cash into the safe.");
  const raw = String(input.receivedAmount ?? "").trim();
  if (!MONEY.test(raw)) throw closeError(400, "POS_SHIFT_CLOSE_COUNT_INVALID", "Enter the amount you received.");
  const received = decimal(raw);
  const difference = sub(received, decimal(String(row.amount)));
  const note = text(input.note, 300);
  if (difference !== 0n && !note) throw closeError(400, "POS_SHIFT_CLOSE_VARIANCE_REASON_REQUIRED", "The amount received differs from the amount handed over: explain the difference.");
  await client.query(`UPDATE tenant.pos_cash_custody_transfers SET status = 'ACCEPTED', received_amount = $3, variance_amount = $3::numeric - amount, accepted_by = $4, accepted_at = now(),
      acceptance_note = $5 WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id, asDatabaseDecimal(received), context.userId, note]);
  // Cash Difference (0106): received ≠ handed over is a HANDOVER difference of its own, linked to the closing difference of that shift.
  if (difference !== 0n) {
    const origin = (await client.query(`SELECT terminal_id, cashier_user_id FROM tenant.pos_shifts WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.shift_id])).rows[0];
    await recordCashDifference(client, context, { context: "HANDOVER", storeId: row.store_id, terminalId: origin?.terminal_id, drawerId: row.cash_drawer_id, cashSessionId: row.cash_session_id,
      shiftId: row.shift_id, cashierUserId: origin?.cashier_user_id, currency: row.currency_code.trim(), reference: decimal(String(row.amount)), counted: received, reasonNote: note,
      transferId: row.id, relatedId: await closingDifferenceOf(client, context.organizationId, row.shift_id) });
  }
  await event(client, context, "shift", row.shift_id, "pos.shift.cash_transfer_accepted", { transferId: row.id, type: row.destination_type, amount: money(row.amount), received: out(received),
    variance: out(difference) });
  return transferView((await client.query(`${TRANSFER_SELECT} WHERE transfer.organization_id = $1 AND transfer.id = $2`, [context.organizationId, row.id])).rows[0]);
}

// Exceptions closings handed on. filters: status (open = not resolved), shiftId, queue.
export async function listShiftClosingExceptions(client, context, filters = {}) {
  requirePermission(context, "pos.view");
  const values = [context.organizationId];
  const where = ["exception.organization_id = $1"];
  if (UUID.test(String(filters.shiftId ?? ""))) { values.push(filters.shiftId); where.push(`exception.shift_id = $${values.length}`); }
  if (String(filters.status ?? "open").toLowerCase() === "open") where.push("exception.status <> 'RESOLVED'");
  if (text(filters.queue, 60)) { values.push(text(filters.queue, 60)); where.push(`exception.assigned_queue = $${values.length}`); }
  if (!(await seesExpectedCash(client, context, undefined))) { values.push(context.userId); where.push(`exception.assigned_to = $${values.length}`); }
  else {
    const outlets = await accessiblePosStoreIds(client, context);
    if (outlets) { values.push(outlets); where.push(`shift.store_id = ANY($${values.length}::uuid[])`); }
  }
  return (await client.query(
    `SELECT exception.*, shift.shift_number, assignee.full_name AS assignee_name, resolver.full_name AS resolver_name FROM tenant.pos_shift_closing_exceptions exception
       JOIN tenant.pos_shifts shift ON shift.organization_id = exception.organization_id AND shift.id = exception.shift_id
       LEFT JOIN public.users assignee ON assignee.id = exception.assigned_to LEFT JOIN public.users resolver ON resolver.id = exception.resolved_by
      WHERE ${where.join(" AND ")} ORDER BY exception.created_at DESC LIMIT 200`, values)).rows
    .map((row) => ({ id: row.id, shiftId: row.shift_id, shiftNumber: row.shift_number, closingId: row.closing_id, type: row.exception_type, referenceType: row.reference_type,
      referenceId: row.reference_id, amount: money(row.amount), status: row.status, assignedTo: row.assignee_name ?? null, queue: row.assigned_queue, note: row.note,
      resolutionNote: row.resolution_note, resolvedBy: row.resolver_name ?? null, resolvedAt: row.resolved_at, createdAt: row.created_at }));
}

// Resolve an exception with what was done (by its owner, or a manager / reconciliation user; never the shift's cashier for their own cash
// difference). Nothing else changes: a correction to money is its own record. input: resolutionNote.
export async function resolveShiftClosingException(client, context, exceptionId, input = {}) {
  requirePermission(context, "pos.view");
  if (!UUID.test(String(exceptionId ?? ""))) throw closeError(404, "POS_SHIFT_EXCEPTION_NOT_FOUND");
  const row = (await client.query(`SELECT exception.*, shift.store_id, shift.cashier_user_id FROM tenant.pos_shift_closing_exceptions exception
      JOIN tenant.pos_shifts shift ON shift.organization_id = exception.organization_id AND shift.id = exception.shift_id
     WHERE exception.organization_id = $1 AND exception.id = $2 FOR UPDATE OF exception`, [context.organizationId, exceptionId])).rows[0];
  if (!row) throw closeError(404, "POS_SHIFT_EXCEPTION_NOT_FOUND");
  try { await assertPosStoreAccess(client, context, row.store_id); } catch { throw closeError(404, "POS_SHIFT_EXCEPTION_NOT_FOUND"); }
  if (row.status === "RESOLVED") return (await listShiftClosingExceptions(client, context, { shiftId: row.shift_id, status: "all" })).find((entry) => entry.id === row.id);
  const manager = can(context, "pos.store.manage") || can(context, "pos.reconciliation.manage");
  if (row.assigned_to !== context.userId && !manager) throw closeError(403, "POS_SHIFT_CLOSE_PERMISSION_DENIED", "Only the owner of this exception or a manager resolves it.");
  if (row.exception_type === "CASH_VARIANCE" && row.cashier_user_id === context.userId) throw closeError(403, "POS_SHIFT_CLOSE_PERMISSION_DENIED", "A cashier does not resolve their own cash difference.");
  const note = text(input.resolutionNote ?? input.note);
  if (!note) throw closeError(400, "POS_SHIFT_CLOSE_RECONCILIATION_REQUIRED", "Say how the exception was resolved.");
  await client.query(`UPDATE tenant.pos_shift_closing_exceptions SET status = 'RESOLVED', resolution_note = $3, resolved_by = $4, resolved_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, note, context.userId]);
  await event(client, context, "shift", row.shift_id, "pos.shift.closing_exception_resolved", { exceptionId: row.id, type: row.exception_type, note });
  return (await listShiftClosingExceptions(client, context, { shiftId: row.shift_id, status: "all" })).find((entry) => entry.id === row.id);
}

// ------------------------------------------------------------------ Cash Difference (0106): the same reconciliation, addressed by cash session

async function shiftOfCashSession(client, context, cashSessionId) {
  requirePermission(context, "pos.view");
  if (!UUID.test(String(cashSessionId ?? ""))) throw closeError(404, "POS_SHIFT_CLOSE_NOT_OPEN", "Cash session not found.");
  const row = (await client.query(`SELECT operating_session_id FROM tenant.pos_cash_sessions WHERE organization_id = $1 AND id = $2`, [context.organizationId, cashSessionId])).rows[0];
  if (!row) throw closeError(404, "POS_SHIFT_CLOSE_NOT_OPEN", "Cash session not found.");
  return row.operating_session_id;
}

// The closing reconciliation of a cash session: COUNT_PENDING until a count exists (nothing else is revealed — the blind count), then the
// difference with its type and status, the cash ledger version it was compared with and the policy version — expected cash only for those who
// may see it. After the close: the closing figures and the difference case.
export async function getCashSessionReconciliation(client, context, cashSessionId) {
  const shiftId = await shiftOfCashSession(client, context, cashSessionId);
  const shift = await loadShift(client, context, shiftId);
  const policy = await policyOf(client, context);
  const sensitive = await seesExpectedCash(client, context, shift.store_id);
  const count = await latestCountOf(client, context, shift);
  const base = { cashSessionId, shiftId: shift.id, context: "CLOSING", currency: shift.currency.trim(), shiftStatus: shift.lifecycle_status };
  if (!count) return { ...base, status: "COUNT_PENDING", expectedAmount: null, countedAmount: null, differenceAmount: null, differenceType: null };
  const view = await countView(client, context, shift, count, policy, sensitive);
  const difference = shift.closing_id ? (await client.query(`SELECT id, difference_number, case_status, finance_status FROM tenant.pos_cash_differences
      WHERE organization_id = $1 AND cash_session_id = $2 AND difference_context = 'CLOSING'`, [context.organizationId, cashSessionId])).rows[0] ?? null : null;
  return {
    ...base, countId: view.id, cashLedgerVersion: view.cashLedgerVersion, policyVersion: view.policyVersion, expectedAmount: view.expectedAmount, countedAmount: view.countedAmount,
    differenceAmount: view.varianceAmount, differenceType: view.differenceType, approvalRequired: view.approvalRequired, reasonRequired: view.reasonRequired, blocked: view.blocked,
    stale: view.stale, recounts: view.recounts,
    status: shift.closing_id ? (view.differenceType === "MATCH" ? "MATCHED" : "CLOSED_WITH_VARIANCE") : view.reconciliationStatus,
    case: difference ? { id: difference.id, number: difference.difference_number, status: difference.case_status, financeStatus: difference.finance_status } : null,
  };
}

// A count or recount for a cash session (the closing count of its shift).
export async function submitCashSessionCount(client, context, cashSessionId, input = {}) {
  return submitBlindCashCount(client, context, await shiftOfCashSession(client, context, cashSessionId), input);
}

// Ask a supervisor to accept the current count's difference for a cash session.
export async function requestCashSessionVarianceApproval(client, context, cashSessionId, input = {}) {
  return requestShiftClosingApproval(client, context, await shiftOfCashSession(client, context, cashSessionId), input);
}
