// POS Shift Opening (0103). Opening a shift starts a POS operating session (tenant.pos_shifts: who operates which terminal, from when) and, when
// the counter takes cash, its linked cash session (tenant.pos_cash_sessions: the float the cashier counted and confirmed, and where it came
// from). A card- or UPI-only counter opens without one, and may open one later with a counted float — never an implicit ₹0.
//
//   one terminal, one open session   the terminal's row is locked while opening and the database allows one open session per terminal and
//                                    per cashier; the same cashier opening again gets their session back (a refresh, a double click)
//   idempotent                       a repeated request returns the session the first one opened, even when its answer was lost
//   handover                         cash left in the drawer at the last close is the documented handover; the opening count is compared with
//                                    it, the difference kept as the opening variance and, over the outlet's threshold, approved by a supervisor
//                                    (exactly this terminal, amount and handover; once; not by the cashier) — the previous session is never changed
//   atomic                           the session, its cash session, the opening cash event and the handover acceptance commit together or not at all
//
// Shift opening never creates a sale, a stock movement or an accounting entry: the float is custody, not revenue.
import { createHash } from "node:crypto";

import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { decimal, add, sub, asDatabaseDecimal, formatDecimal } from "../../../core/decimal.js";
import { beginIdempotentOperation, completeIdempotentOperation } from "../../../core/idempotency.js";
import { CONFIRM_WITH_CODE, identityConfirmed } from "../../../core/auth/code-sign-in.js";
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess, accessiblePosStoreIds } from "../shared/access-control.js";
import { event } from "../shared/audit.js";
import { validateTerminalOperationAccess, isTerminalPaymentMethodEnabled } from "../terminals/index.js";
import { assertCashierCanOpenSession } from "../cashiers/index.js";
import { assertPosAction, authorizePosAction, consumeApprovalAtomically } from "../permissions/index.js";
import { closingDifferenceOf, recordCashDifference } from "./cash-differences.js";

export const POS_SHIFT_MESSAGES = Object.freeze({
  POS_SHIFT_PERMISSION_DENIED: "You cannot open a shift at this counter.",
  POS_SHIFT_TERMINAL_NOT_ASSIGNED: "This counter is not assigned to you.",
  POS_SHIFT_TERMINAL_DISABLED: "This counter is unavailable. Contact your manager.",
  POS_SHIFT_ALREADY_OPEN: "A shift is already open at this counter.",
  POS_SHIFT_PREVIOUS_NOT_RESOLVED: "The previous shift needs to be closed or reviewed.",
  POS_SHIFT_CASH_COUNT_REQUIRED: "Enter the cash currently in the drawer.",
  POS_SHIFT_CASH_AMOUNT_INVALID: "Enter a valid opening cash amount.",
  POS_SHIFT_HANDOVER_MISMATCH: "Opening cash differs from the amount handed over.",
  POS_SHIFT_APPROVAL_REQUIRED: "Supervisor approval is required.",
  POS_SHIFT_APPROVAL_INVALID: "Approval no longer matches the opening details.",
  POS_SHIFT_CASH_SESSION_FAILED: "Cash setup could not be completed. Check the shift status.",
  POS_SHIFT_CONFIG_INCOMPLETE: "This counter needs additional setup before selling.",
  POS_SHIFT_VERSION_CONFLICT: "Counter status changed. Refresh and try again.",
  POS_SHIFT_IDEMPOTENCY_CONFLICT: "This opening request conflicts with an earlier attempt.",
  POS_SHIFT_OPENING_UNKNOWN: "Checking whether your shift opened. Do not open another.",
  POS_SHIFT_RECOVERY_REQUIRED: "The shift needs review before sales can continue.",
  POS_SHIFT_CASH_SESSION_REQUIRED: "This shift has no cash drawer open. Count the drawer to open a cash session before taking cash.",
  POS_SHIFT_NOT_OPERATIONAL: "This shift is not open for sales.",
  POS_SHIFT_DRAWER_IN_USE: "This cash drawer is held by another open cash session. Close or hand it over first.",
  POS_SHIFT_DRAWER_NOT_ASSIGNED: "That cash drawer is not assigned to this counter.",
  POS_SHIFT_VARIANCE_LIMIT_EXCEEDED: "The count differs from the handover by more than the company allows. A manager must resolve it before the drawer opens.",
  POS_SHIFT_CASH_SOURCE_INVALID: "Choose where the opening cash came from: a fresh float or cash already in the drawer.",
});
const shiftError = (status, code, message = POS_SHIFT_MESSAGES[code], details = undefined) => {
  const error = posError(status, message, code);
  if (details) error.details = details;
  return error;
};

const privileged = (c) => Boolean(c.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug)));
const can = (c, permission) => privileged(c) || Boolean(c.permissions?.includes(permission));
// Money as two-decimal text ("2000.00").
const money = (value) => {
  if (value === null || value === undefined) return null;
  const [whole, fraction = ""] = formatDecimal(decimal(String(value))).split(".");
  return `${whole}.${(fraction + "00").slice(0, 2)}`;
};
const text = (value, max = 500) => { const out = String(value ?? "").trim(); return out ? out.slice(0, max) : null; };
const MONEY = /^\d{1,14}(\.\d{1,2})?$/;

// The refusals a cashier sees, from the terminal, cashier and permission checks underneath.
function translate(error) {
  if (String(error?.code ?? "").startsWith("POS_SHIFT_")) return error;
  switch (error?.code) {
    case "TERMINAL_INACTIVE": case "OUTLET_INACTIVE": case "TERMINAL_NOT_FOUND": return shiftError(409, "POS_SHIFT_TERMINAL_DISABLED");
    case "TERMINAL_ACCESS_DENIED": case "FORBIDDEN": case "PERMISSION_DENIED": case "POS_PERMISSION_DENIED": case "CASHIER_PERMISSION_DENIED":
      return shiftError(403, "POS_SHIFT_PERMISSION_DENIED");
    case "CASHIER_OUTLET_ACCESS_DENIED": case "CASHIER_NOT_ASSIGNED": case "POS_OUTLET_ACCESS_DENIED": return shiftError(403, "POS_SHIFT_TERMINAL_NOT_ASSIGNED");
    case "CASHIER_INACTIVE": case "CASHIER_USER_INACTIVE": case "CASHIER_NOT_FOUND": return shiftError(403, "POS_SHIFT_PERMISSION_DENIED", `${POS_SHIFT_MESSAGES.POS_SHIFT_PERMISSION_DENIED} ${error.message}`);
    case "CASHIER_SESSION_ALREADY_OPEN": return shiftError(409, "POS_SHIFT_ALREADY_OPEN", `You already have a shift open on another counter. ${error.message}`, error.details);
    case "TERMINAL_SESSION_ALREADY_OPEN": return shiftError(409, "POS_SHIFT_ALREADY_OPEN", undefined, error.details);
    default: return error;
  }
}

async function policyOf(client, context) {
  const row = (await client.query(
    `SELECT cash_payments_enabled, opening_variance_approval_above, opening_variance_block_above, opening_count_denominations, long_open_shift_hours
       FROM tenant.pos_settings WHERE organization_id = $1`, [context.organizationId])).rows[0];
  return {
    cashPayments: row?.cash_payments_enabled !== false,
    approvalAbove: row ? (row.opening_variance_approval_above === null ? null : decimal(String(row.opening_variance_approval_above))) : decimal("0"),
    // Above this difference from the handover the drawer cannot be opened until a manager resolves it (empty = no hard limit).
    blockAbove: row?.opening_variance_block_above === null || row?.opening_variance_block_above === undefined ? null : decimal(String(row.opening_variance_block_above)),
    denominations: Array.isArray(row?.opening_count_denominations) ? row.opening_count_denominations.map(Number) : [500, 200, 100, 50, 20, 10, 5, 2, 1],
    longOpenHours: Number(row?.long_open_shift_hours ?? 14),
  };
}

// The counter as Inventory, payments and printing see it: its outlet, its cash drawer (and who holds it), the payment methods that can be used,
// and what would only warn.
async function counterOf(client, context, terminalId) {
  const terminal = await validateTerminalOperationAccess(client, context, terminalId);
  const row = (await client.query(
    `SELECT terminal.id, terminal.code, terminal.name, terminal.version, terminal.status, terminal.cash_management_enabled, terminal.store_id, terminal.cash_drawer_id,
            drawer.code AS drawer_code, drawer.name AS drawer_name, drawer.status AS drawer_status, COALESCE(drawer.cash_account_id, terminal.cash_account_id) AS cash_account_id,
            (SELECT cash.operating_session_id FROM tenant.pos_cash_sessions cash WHERE cash.organization_id = terminal.organization_id AND cash.cash_drawer_id = terminal.cash_drawer_id
                AND cash.status IN ('open', 'closing') LIMIT 1) AS drawer_holder,
            store.code AS store_code, store.name AS store_name, store.currency_code, store.active AS store_active, warehouse.id AS warehouse_id, warehouse.status AS warehouse_status,
            (SELECT count(*)::int FROM tenant.pos_receipt_printers printer WHERE printer.organization_id = terminal.organization_id AND printer.terminal_id = terminal.id) AS printers,
            EXISTS (SELECT 1 FROM tenant.pos_payment_provider_configs config WHERE config.organization_id = terminal.organization_id AND config.store_id = terminal.store_id
                     AND config.payment_method = 'card' AND config.active AND COALESCE(config.configuration_status, 'ready') = 'ready') AS card_ready,
            EXISTS (SELECT 1 FROM tenant.pos_payment_provider_configs config WHERE config.organization_id = terminal.organization_id AND config.store_id = terminal.store_id
                     AND config.payment_method = 'upi' AND config.active AND COALESCE(config.configuration_status, 'ready') = 'ready') AS upi_ready
       FROM tenant.pos_terminals terminal
       JOIN tenant.pos_stores store ON store.organization_id = terminal.organization_id AND store.id = terminal.store_id
       LEFT JOIN tenant.pos_cash_drawers drawer ON drawer.organization_id = terminal.organization_id AND drawer.id = terminal.cash_drawer_id
       LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = store.organization_id AND warehouse.id = store.warehouse_id
      WHERE terminal.organization_id = $1 AND terminal.id = $2`, [context.organizationId, terminal.id])).rows[0];
  const enabled = {};
  for (const method of ["cash", "card", "upi"]) enabled[method] = await isTerminalPaymentMethodEnabled(client, context.organizationId, terminal.id, method);
  return { ...row, sessionId: terminal.session_id ?? null, sessionCashierId: terminal.session_cashier_id ?? null, enabled };
}

// Cash handed over in this drawer at its last close and not yet received (by drawer; a handover from before drawers existed, by terminal).
async function pendingHandoverOf(client, context, terminalId, drawerId = null) {
  return (await client.query(
    `SELECT handover.*, shift.shift_number AS from_shift_number, users.full_name AS handed_over_by_name FROM tenant.pos_cash_handovers handover
       JOIN tenant.pos_shifts shift ON shift.organization_id = handover.organization_id AND shift.id = handover.from_session_id
       LEFT JOIN public.users ON users.id = handover.handed_over_by
      WHERE handover.organization_id = $1 AND handover.status = 'pending'
        AND (($3::uuid IS NOT NULL AND handover.cash_drawer_id = $3) OR (handover.cash_drawer_id IS NULL AND handover.terminal_id = $2))
      ORDER BY handover.handed_over_at DESC LIMIT 1`, [context.organizationId, terminalId, drawerId])).rows[0] ?? null;
}

// The opening count: an amount (two decimals at most, not negative) and, optionally, the notes and coins that make it up. When both are given
// they must agree — one confirmed figure, never a silent choice between two.
function readCount(input, policy) {
  let total = null;
  let details = null;
  if (Array.isArray(input.denominations) && input.denominations.length) {
    details = [];
    let sum = decimal("0");
    for (const entry of input.denominations) {
      const denomination = Number(entry?.denomination);
      const count = Number(entry?.count ?? 0);
      if (!policy.denominations.includes(denomination)) throw shiftError(400, "POS_SHIFT_CASH_AMOUNT_INVALID", `₹${entry?.denomination} is not a counted denomination here.`);
      if (!Number.isInteger(count) || count < 0) throw shiftError(400, "POS_SHIFT_CASH_AMOUNT_INVALID", "Counts are whole numbers, zero or more.");
      if (count) details.push({ denomination, count, amount: money(denomination * count) });
      sum = add(sum, decimal(String(denomination * count)));
    }
    total = sum;
  }
  const raw = input.openingCash ?? input.openingCashAmount;
  if (raw === undefined || raw === null || raw === "") {
    if (total === null) throw shiftError(400, "POS_SHIFT_CASH_COUNT_REQUIRED");
    return { amount: total, details };
  }
  const value = String(raw).trim();
  if (!MONEY.test(value)) throw shiftError(400, "POS_SHIFT_CASH_AMOUNT_INVALID");
  const amount = decimal(value);
  if (total !== null && total !== amount) throw shiftError(400, "POS_SHIFT_CASH_AMOUNT_INVALID", `The notes and coins add up to ₹${money(asDatabaseDecimal(total))}, not ₹${money(value)}.`);
  return { amount, details };
}

const fingerprintOf = (terminalId, amount, handoverId) => createHash("sha256").update(`${terminalId}|${money(asDatabaseDecimal(amount))}|${handoverId ?? "-"}`).digest("hex").slice(0, 32);
const absoluteOf = (value) => (value < 0n ? -value : value);

// The cash part of an opening: the counter's own drawer (never one the cashier picks; never one another cash session holds), any handover
// waiting in it (a reference sent by the client must be that one), the count, where the cash came from, and the difference policy — a reason
// for any difference, a supervisor above the approval threshold, no opening above the hard limit.
async function evaluateCash(client, context, { counter, policy, input, requireConfirmation, ownSessionId = null }) {
  if (input.cashDrawerId && input.cashDrawerId !== counter.cash_drawer_id) throw shiftError(409, "POS_SHIFT_DRAWER_NOT_ASSIGNED");
  if (counter.cash_drawer_id && counter.drawer_status !== "active") throw shiftError(409, "POS_SHIFT_CONFIG_INCOMPLETE", "This counter's cash drawer is inactive. Ask a manager to assign another.");
  if (counter.drawer_holder && counter.drawer_holder !== ownSessionId) throw shiftError(409, "POS_SHIFT_DRAWER_IN_USE");
  const handover = await pendingHandoverOf(client, context, counter.id, counter.cash_drawer_id);
  if (input.handoverId && input.handoverId !== handover?.id) throw shiftError(409, "POS_SHIFT_HANDOVER_MISMATCH", "That handover is not the one waiting in this drawer.");
  const count = readCount(input, policy);
  if (requireConfirmation && input.openingCashConfirmed !== true) throw shiftError(400, "POS_SHIFT_CASH_COUNT_REQUIRED", "Confirm that you counted the cash in the drawer.");
  const requested = input.sourceType ? String(input.sourceType).toUpperCase() : null;
  let sourceType;
  if (handover) {
    if (requested && requested !== "HANDOVER") throw shiftError(409, "POS_SHIFT_HANDOVER_MISMATCH", "Cash was handed over in this drawer: the opening count receives it.");
    sourceType = "HANDOVER";
  } else {
    if (requested === "HANDOVER") throw shiftError(409, "POS_SHIFT_HANDOVER_MISMATCH", "No handover is waiting in this drawer.");
    if (requested && !["FRESH_FLOAT", "EXISTING_DRAWER", "ZERO_FLOAT"].includes(requested)) throw shiftError(400, "POS_SHIFT_CASH_SOURCE_INVALID");
    if (requested === "ZERO_FLOAT" && count.amount !== 0n) throw shiftError(400, "POS_SHIFT_CASH_SOURCE_INVALID", "A zero float has no cash in it.");
    sourceType = count.amount === 0n ? "ZERO_FLOAT" : requested ?? "FRESH_FLOAT";
  }
  let variance = null;
  let approvalRequired = false;
  let blocked = false;
  let fingerprint = null;
  if (handover) {
    variance = sub(count.amount, decimal(String(handover.amount)));
    const absolute = absoluteOf(variance);
    blocked = variance !== 0n && policy.blockAbove !== null && absolute > policy.blockAbove;
    approvalRequired = !blocked && variance !== 0n && policy.approvalAbove !== null && absolute > policy.approvalAbove;
    fingerprint = fingerprintOf(counter.id, count.amount, handover.id);
  }
  return { handover, count, sourceType, sourceReference: text(input.sourceReference, 200), variance, approvalRequired, blocked, reasonRequired: variance !== null && variance !== 0n, fingerprint };
}

// Everything about an opening, checked without changing anything: who, which counter, what is open there, cash mode, the count against any
// handover, whether approval is needed, and what is ready. Throws the first refusal; returns warnings that do not stop it.
async function evaluate(client, context, input, { requireConfirmation }) {
  if (!can(context, "pos.view")) throw shiftError(403, "POS_SHIFT_PERMISSION_DENIED");
  const policy = await policyOf(client, context);
  let counter;
  try { counter = await counterOf(client, context, input.terminalId); } catch (error) { throw translate(error); }
  if (input.storeId && input.storeId !== counter.store_id) throw shiftError(409, "POS_SHIFT_TERMINAL_NOT_ASSIGNED", "That counter belongs to another outlet.");
  // No cashier profile at all is a permission matter; a profile without this outlet is an assignment one.
  const profile = (await client.query(`SELECT status FROM tenant.pos_cashiers WHERE organization_id = $1 AND user_id = $2`, [context.organizationId, context.userId])).rows[0];
  if (!profile && !privileged(context)) throw shiftError(403, "POS_SHIFT_PERMISSION_DENIED", `${POS_SHIFT_MESSAGES.POS_SHIFT_PERMISSION_DENIED} You have no cashier profile.`);
  try { await assertPosStoreAccess(client, context, counter.store_id, counter.id); } catch { throw shiftError(403, "POS_SHIFT_TERMINAL_NOT_ASSIGNED"); }
  if (input.expectedTerminalVersion !== undefined && input.expectedTerminalVersion !== null && Number(input.expectedTerminalVersion) !== Number(counter.version))
    throw shiftError(409, "POS_SHIFT_VERSION_CONFLICT");
  // Someone's session is open on this counter: the same cashier gets it back; anyone else is refused (handover goes through closing).
  if (counter.sessionId) {
    const open = (await client.query(`SELECT * FROM tenant.pos_shifts WHERE organization_id = $1 AND id = $2`, [context.organizationId, counter.sessionId])).rows[0];
    if (open.cashier_user_id === context.userId) {
      if (["RECOVERY_REQUIRED", "SUSPENDED"].includes(open.lifecycle_status)) throw shiftError(409, "POS_SHIFT_RECOVERY_REQUIRED", undefined, { shiftId: open.id });
      return { restore: open, counter, policy };
    }
    if (["RECOVERY_REQUIRED", "SUSPENDED", "CLOSING"].includes(open.lifecycle_status)) throw shiftError(409, "POS_SHIFT_PREVIOUS_NOT_RESOLVED", undefined, { shiftNumber: open.shift_number });
    throw shiftError(409, "POS_SHIFT_ALREADY_OPEN", `A shift is already open at counter ${counter.code} (${open.shift_number}).`, { shiftNumber: open.shift_number });
  }
  // The cashier: an active profile with this outlet, no shift open elsewhere, and SESSION_OPEN_OWN.
  try {
    await assertCashierCanOpenSession(client, context, { outletId: counter.store_id, userId: context.userId });
    await assertPosAction(client, context, { permission: "SESSION_OPEN_OWN", outletId: counter.store_id });
  } catch (error) { throw translate(error); }
  // Physical cash still in limbo at this counter (taken for a bill never finalised) blocks a new custody.
  const limbo = (await client.query(
    `SELECT payment.id FROM tenant.pos_payments payment JOIN tenant.pos_shifts shift ON shift.organization_id = payment.organization_id AND shift.id = payment.shift_id
      WHERE payment.organization_id = $1 AND shift.terminal_id = $2 AND payment.payment_method = 'cash' AND payment.custody_status IN ('pending', 'reconciliation_required') LIMIT 1`,
    [context.organizationId, counter.id])).rows[0];
  if (limbo) throw shiftError(409, "POS_SHIFT_PREVIOUS_NOT_RESOLVED", "Cash taken at this counter on an earlier shift is still awaiting finalisation or reconciliation.");

  const cashEnabled = input.cashEnabled === undefined || input.cashEnabled === null ? Boolean(counter.cash_management_enabled) : Boolean(input.cashEnabled);
  if (cashEnabled && !counter.cash_management_enabled) throw shiftError(409, "POS_SHIFT_CONFIG_INCOMPLETE", "This counter does not handle cash. Open a card / UPI shift instead.");
  if (!cashEnabled && await pendingHandoverOf(client, context, counter.id, counter.cash_drawer_id))
    throw shiftError(409, "POS_SHIFT_PREVIOUS_NOT_RESOLVED", "Cash was handed over in this drawer. Open the shift with a cash count to receive it.");
  if (!cashEnabled && (input.openingCash ?? input.openingCashAmount) && Number(input.openingCash ?? input.openingCashAmount) > 0)
    throw shiftError(400, "POS_SHIFT_CASH_AMOUNT_INVALID", "A card / UPI shift takes no opening cash.");
  const methods = {
    cash: cashEnabled && policy.cashPayments && counter.enabled.cash,
    card: counter.enabled.card && counter.card_ready,
    upi: counter.enabled.upi && counter.upi_ready,
  };
  if (!methods.cash && !methods.card && !methods.upi) throw shiftError(409, "POS_SHIFT_CONFIG_INCOMPLETE", "No payment method can be taken at this counter: enable cash, or set up card or UPI.");
  const warnings = [];
  if (!counter.warehouse_id || counter.warehouse_status !== "active") warnings.push({ code: "POS_SHIFT_WAREHOUSE_NOT_CONFIGURED", message: "This store's stock location is not set up: only services can be sold." });
  if (counter.enabled.card && !counter.card_ready) warnings.push({ code: "POS_SHIFT_CARD_UNAVAILABLE", message: "Card payments are not set up for this store, so card will be unavailable." });
  if (counter.enabled.upi && !counter.upi_ready) warnings.push({ code: "POS_SHIFT_UPI_UNAVAILABLE", message: "UPI payments are not set up for this store, so UPI will be unavailable." });
  if (!counter.printers) warnings.push({ code: "POS_SHIFT_PRINTER_NOT_CONFIGURED", message: "No receipt printer is set up: receipts print through the browser." });
  if (cashEnabled && !policy.cashPayments) warnings.push({ code: "POS_SHIFT_CASH_PAYMENTS_OFF", message: "Cash payments are turned off for the company: the drawer is counted but cash cannot be taken." });
  if (cashEnabled && !counter.cash_drawer_id) warnings.push({ code: "POS_SHIFT_DRAWER_CREATED", message: `This counter has no cash drawer yet: its own drawer (${counter.code}) is set up when the shift opens.` });
  const pendingPayments = Number((await client.query(
    `SELECT count(*)::int AS n FROM tenant.pos_payments payment JOIN tenant.pos_carts cart ON cart.organization_id = payment.organization_id AND cart.id = payment.cart_id
      WHERE payment.organization_id = $1 AND cart.terminal_id = $2 AND payment.sale_id IS NULL AND payment.payment_method <> 'cash'
        AND (payment.status IN ('initiated', 'pending', 'authorized') OR payment.status = 'captured')`, [context.organizationId, counter.id])).rows[0].n);
  if (pendingPayments) warnings.push({ code: "POS_SHIFT_PENDING_PAYMENTS", message: `${pendingPayments} card / UPI payment(s) from an earlier checkout at this counter are still being resolved; they stay with their original bill.` });
  const heldCarts = Number((await client.query(`SELECT count(*)::int AS n FROM tenant.pos_carts WHERE organization_id = $1 AND terminal_id = $2 AND status = 'held'`,
    [context.organizationId, counter.id])).rows[0].n);
  if (heldCarts) warnings.push({ code: "POS_SHIFT_HELD_BILLS", message: `${heldCarts} held bill(s) at this counter can be resumed (their stock is checked again).` });

  const cash = cashEnabled ? await evaluateCash(client, context, { counter, policy, input, requireConfirmation }) : null;
  return { counter, policy, cashEnabled, methods, warnings, cash, handover: cash?.handover ?? null, count: cash?.count ?? null, variance: cash?.variance ?? null,
    approvalRequired: Boolean(cash?.approvalRequired), fingerprint: cash?.fingerprint ?? null };
}

const handoverView = (context, handover, variance) => (handover ? {
  id: handover.id, fromShiftNumber: handover.from_shift_number, handedOverBy: handover.handed_over_by_name, handedOverAt: handover.handed_over_at,
  // The documented amount only for those who may see expected cash; everyone sees that a handover is waiting.
  ...(can(context, "pos.store.manage") || privileged(context) || context.posExpectedCashVisible
    ? { amount: money(handover.amount), variance: variance === null ? null : money(asDatabaseDecimal(variance)) } : {}),
} : null);

async function expectedCashVisible(client, context, storeId) {
  try { return (await authorizePosAction(client, context, { permission: "SESSION_VIEW_EXPECTED_CASH", outletId: storeId })).decision === "ALLOW"; } catch { return false; }
}

// The cash waiting at a counter's drawer from its last close (a supervisor or manager looking before anyone opens): who handed it over and when;
// the amount, what was taken out and why only for those who may see expected cash at that outlet.
export async function getTerminalHandover(client, context, terminalId) {
  requirePermission(context, "pos.view");
  const terminal = (await client.query(`SELECT id, store_id, cash_drawer_id FROM tenant.pos_terminals WHERE organization_id = $1 AND id = $2`, [context.organizationId, terminalId])).rows[0];
  if (!terminal) throw shiftError(404, "POS_SHIFT_TERMINAL_DISABLED", "Counter not found.");
  try { await assertPosStoreAccess(client, context, terminal.store_id, terminal.id); } catch { throw shiftError(403, "POS_SHIFT_TERMINAL_NOT_ASSIGNED"); }
  const handover = await pendingHandoverOf(client, context, terminal.id, terminal.cash_drawer_id);
  if (!handover) return null;
  const visible = can(context, "pos.store.manage") || privileged(context) || await expectedCashVisible(client, context, terminal.store_id);
  return { ...handoverView({ ...context, posExpectedCashVisible: visible }, handover, null), cashDrawerId: handover.cash_drawer_id,
    ...(visible ? { closingCounted: money(handover.closing_counted_amount), removed: money(handover.removed_amount), removalNote: handover.removal_note } : {}) };
}

// Preview: everything the opening would check, nothing saved. input: terminalId, cashEnabled?, openingCash?, denominations?, sourceType?.
export async function previewShiftOpening(client, context, input = {}) {
  const result = await evaluate(client, context, input, { requireConfirmation: false });
  if (result.restore) return { action: "RESTORE", shift: await shiftView(client, context, result.restore.id) };
  const visible = await expectedCashVisible(client, context, result.counter.store_id);
  const cash = result.cash;
  return {
    action: "OPEN", terminalId: result.counter.id, terminalCode: result.counter.code, storeId: result.counter.store_id, storeName: result.counter.store_name, terminalVersion: result.counter.version,
    cashEnabled: result.cashEnabled, cashDrawer: result.cashEnabled ? { id: result.counter.cash_drawer_id, code: result.counter.drawer_code ?? result.counter.code,
      name: result.counter.drawer_name ?? `${result.counter.name} drawer`, createdOnOpening: !result.counter.cash_drawer_id } : null,
    openingCashAmount: cash ? money(asDatabaseDecimal(cash.count.amount)) : null, denominations: cash?.count.details ?? null, sourceType: cash?.sourceType ?? null,
    handover: handoverView({ ...context, posExpectedCashVisible: visible }, result.handover, result.variance), approvalRequired: result.approvalRequired, approvalFingerprint: result.fingerprint,
    // What the supervisor approves: the size of the difference (the handover amount itself stays with those who may see expected cash).
    approvalAmount: result.approvalRequired ? money(asDatabaseDecimal(absoluteOf(result.variance))) : null,
    varianceReasonRequired: Boolean(cash?.reasonRequired), varianceBlocked: Boolean(cash?.blocked),
    paymentMethods: result.methods, warnings: result.warnings, readyToOpen: !cash?.blocked,
  };
}

// The counter-selection screen: the outlets and counters this cashier may open, which are free, any shift already open for them, and — for the
// chosen counter — the handover waiting and what is ready. Preselects when there is one choice.
export async function getShiftOpeningContext(client, context, input = {}) {
  requirePermission(context, "pos.view");
  const current = await currentShiftRow(client, context);
  const stores = await accessiblePosStoreIds(client, context);
  const terminals = (await client.query(
    `SELECT terminal.id, terminal.code, terminal.name, terminal.cash_management_enabled, store.id AS store_id, store.code AS store_code, store.name AS store_name,
            shift.id AS shift_id, shift.shift_number, shift.cashier_user_id, users.full_name AS cashier_name
       FROM tenant.pos_terminals terminal
       JOIN tenant.pos_stores store ON store.organization_id = terminal.organization_id AND store.id = terminal.store_id AND store.active
       LEFT JOIN tenant.pos_shifts shift ON shift.organization_id = terminal.organization_id AND shift.terminal_id = terminal.id AND shift.status IN ('open', 'closing')
       LEFT JOIN public.users ON users.id = shift.cashier_user_id
      WHERE terminal.organization_id = $1 AND terminal.status = 'active' AND ($2::uuid[] IS NULL OR store.id = ANY($2::uuid[]))
      ORDER BY lower(store.name), terminal.code`, [context.organizationId, stores])).rows;
  const company = (await client.query(`SELECT name FROM public.organizations WHERE id = $1`, [context.organizationId])).rows[0]?.name ?? null;
  const counters = terminals.map((row) => ({ terminalId: row.id, code: row.code, name: row.name, storeId: row.store_id, storeName: row.store_name, cashCounter: row.cash_management_enabled,
    occupied: Boolean(row.shift_id), mine: row.cashier_user_id === context.userId, occupiedBy: row.shift_id && row.cashier_user_id !== context.userId ? row.cashier_name : null }));
  const free = counters.filter((counter) => !counter.occupied);
  const chosen = input.terminalId ?? (free.length === 1 ? free[0].terminalId : null);
  let readiness = null;
  if (chosen && !current) {
    try { readiness = await previewShiftOpening(client, context, { terminalId: chosen, openingCash: "0" }); }
    catch (error) { readiness = { blocked: { code: error.code, message: error.message } }; }
  }
  return { company, cashier: { userId: context.userId }, currentShift: current ? await shiftView(client, context, current.id) : null, counters, selectedTerminalId: chosen, readiness,
    denominations: (await policyOf(client, context)).denominations };
}

// A counter taking cash has a drawer: its assigned one, or — first time — its own (code = the counter's), never one the cashier picks.
async function ensureTerminalDrawer(client, context, counter) {
  if (counter.cash_drawer_id) return counter;
  await client.query(
    `INSERT INTO tenant.pos_cash_drawers (organization_id, store_id, code, name, cash_account_id, created_by)
     SELECT $1, terminal.store_id, terminal.code, terminal.name || ' drawer', terminal.cash_account_id, $3 FROM tenant.pos_terminals terminal WHERE terminal.organization_id = $1 AND terminal.id = $2
     ON CONFLICT DO NOTHING`, [context.organizationId, counter.id, context.userId]);
  const drawer = (await client.query(
    `SELECT drawer.* FROM tenant.pos_cash_drawers drawer JOIN tenant.pos_terminals terminal ON terminal.organization_id = drawer.organization_id AND terminal.store_id = drawer.store_id
      WHERE drawer.organization_id = $1 AND terminal.id = $2 AND upper(btrim(drawer.code)) = upper(btrim(terminal.code))`, [context.organizationId, counter.id])).rows[0];
  await client.query(`UPDATE tenant.pos_terminals SET cash_drawer_id = $3 WHERE organization_id = $1 AND id = $2 AND cash_drawer_id IS NULL`, [context.organizationId, counter.id, drawer.id]);
  const holder = (await client.query(`SELECT operating_session_id FROM tenant.pos_cash_sessions WHERE organization_id = $1 AND cash_drawer_id = $2 AND status IN ('open', 'closing') LIMIT 1`,
    [context.organizationId, drawer.id])).rows[0]?.operating_session_id ?? null;
  if (holder) throw shiftError(409, "POS_SHIFT_DRAWER_IN_USE");
  return { ...counter, cash_drawer_id: drawer.id, drawer_code: drawer.code, drawer_name: drawer.name, drawer_status: drawer.status, cash_account_id: drawer.cash_account_id ?? counter.cash_account_id };
}

// A difference from the handover: a reason always; above the hard limit no opening; above the approval threshold a supervisor's approval for
// exactly this counter, amount and handover, used once.
async function applyVariancePolicy(client, context, { counter, cash, input }) {
  const reason = text(input.varianceReason);
  if (!cash?.reasonRequired) return { reason, approval: null };
  if (cash.blocked) throw shiftError(409, "POS_SHIFT_VARIANCE_LIMIT_EXCEEDED");
  if (!reason) throw shiftError(400, "POS_SHIFT_HANDOVER_MISMATCH", `${POS_SHIFT_MESSAGES.POS_SHIFT_HANDOVER_MISMATCH} Say why the count differs.`);
  if (!cash.approvalRequired) return { reason, approval: null };
  if (!input.approvalId) throw shiftError(409, "POS_SHIFT_APPROVAL_REQUIRED", undefined, { fingerprint: cash.fingerprint, terminalId: counter.id, terminalVersion: counter.version });
  let approval;
  try {
    approval = await consumeApprovalAtomically(client, context, input.approvalId, { permission: "SESSION_OPEN_OWN", approvalCode: "APPROVE_CASH_MOVEMENT_EXCEPTION",
      resource: { type: "pos_terminal", id: counter.id }, amount: asDatabaseDecimal(absoluteOf(cash.variance)), fingerprint: cash.fingerprint });
  } catch (error) { throw shiftError(409, "POS_SHIFT_APPROVAL_INVALID", `${POS_SHIFT_MESSAGES.POS_SHIFT_APPROVAL_INVALID} ${error.message}`); }
  if (!approval.requested_action?.fingerprint || approval.requested_action.fingerprint !== cash.fingerprint) throw shiftError(409, "POS_SHIFT_APPROVAL_INVALID");
  return { reason, approval };
}

// The cash session with its confirmed opening count, the opening cash event, and the handover received — one step, inside the opening's
// transaction. The drawer's single custodian is guaranteed by the database (one open cash session per drawer).
async function createCashCustody(client, context, { shift, counter, cash, reason, approval, notes, idempotencyKey, previous }) {
  const currency = (counter.currency_code ?? "INR").trim() || "INR";
  const opening = asDatabaseDecimal(cash.count.amount);
  let row;
  await client.query("SAVEPOINT pos_cash_custody");
  try {
    row = (await client.query(
      `INSERT INTO tenant.pos_cash_sessions (organization_id, operating_session_id, store_id, terminal_id, currency_code, opening_float_amount, opening_source, denomination_details,
         handover_id, handover_amount, opening_variance_amount, variance_reason, approval_id, opening_notes, opening_confirmed_by, cash_drawer_id, source_type, source_reference,
         cash_account_id, opening_idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) RETURNING *`,
      [context.organizationId, shift.id, counter.store_id, counter.id, currency, opening, cash.handover ? "handover" : previous ? "new_float" : "first_opening",
        cash.count.details ? JSON.stringify(cash.count.details) : null, cash.handover?.id ?? null, cash.handover ? money(cash.handover.amount) : null,
        cash.variance === null ? "0" : asDatabaseDecimal(cash.variance), reason, approval?.id ?? null, text(notes), context.userId, counter.cash_drawer_id, cash.sourceType,
        cash.sourceReference, counter.cash_account_id ?? null, idempotencyKey ? String(idempotencyKey) : null])).rows[0];
    await client.query("RELEASE SAVEPOINT pos_cash_custody");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT pos_cash_custody");
    if (error?.code === "23505" && error.constraint === "pos_cash_sessions_drawer_custody_uidx") throw shiftError(409, "POS_SHIFT_DRAWER_IN_USE");
    throw error;
  }
  // The float is the drawer's starting custody (the 'opening' event, never a cash-in), so expected cash counts it once.
  if (cash.count.amount > 0n) {
    const number = await nextDocumentNumber(client, context, { documentType: "pos_cash_movement", prefix: "CASH" });
    await client.query(
      `INSERT INTO tenant.pos_cash_movements (organization_id, shift_id, movement_number, movement_type, amount, reason, created_by, cash_event, terminal_id, store_id, currency_code)
       VALUES ($1, $2, $3, 'opening', $4, 'Opening float', $5, 'opening', $6, $7, $8)`,
      [context.organizationId, shift.id, number, opening, context.userId, counter.id, counter.store_id, currency]);
  }
  if (cash.handover) {
    await client.query(
      `UPDATE tenant.pos_cash_handovers SET status = 'accepted', to_session_id = $3, to_cash_session_id = $4, received_amount = $5, variance_amount = $6, accepted_by = $7, accepted_at = now()
        WHERE organization_id = $1 AND id = $2 AND status = 'pending'`,
      [context.organizationId, cash.handover.id, shift.id, row.id, opening, asDatabaseDecimal(cash.variance), context.userId]);
    // Shift Closing (0105): the closing's "left in the drawer" destination is accepted by this count — the next custodian, never the closer's word.
    await client.query(
      `UPDATE tenant.pos_cash_custody_transfers SET status = 'ACCEPTED', received_amount = $3, variance_amount = $3 - amount, accepted_by = $4, accepted_at = now(),
              acceptance_note = 'Counted at the opening of the next shift'
        WHERE organization_id = $1 AND handover_id = $2 AND status = 'PENDING_ACCEPTANCE'`,
      [context.organizationId, cash.handover.id, opening, context.userId]);
    // Cash Difference (0106): the incoming cashier's difference from what was handed over is its own case (OPENING), never merged with the
    // previous shift's closing difference — linked to it so the same missing cash is not accounted for twice.
    if (cash.variance !== 0n) {
      await recordCashDifference(client, context, { context: "OPENING", storeId: counter.store_id, terminalId: counter.id, drawerId: counter.cash_drawer_id, cashSessionId: row.id,
        shiftId: shift.id, cashierUserId: context.userId, currency, reference: decimal(String(cash.handover.amount)), counted: cash.count.amount, reasonCode: "PREVIOUS_HANDOVER_MISMATCH",
        reasonNote: reason, approvalId: approval?.id ?? null, handoverId: cash.handover.id, relatedId: await closingDifferenceOf(client, context.organizationId, cash.handover.from_session_id) });
    }
    await event(client, context, "shift", shift.id, cash.variance === 0n ? "pos.shift.handover_matched" : "pos.shift.opening_variance",
      { handoverId: cash.handover.id, fromSessionId: cash.handover.from_session_id, handedOver: money(cash.handover.amount), counted: money(opening),
        variance: money(asDatabaseDecimal(cash.variance)), reason, approvalId: approval?.id ?? null });
  }
  await event(client, context, "shift", shift.id, "pos.shift.opening_float_confirmed", { amount: money(opening), currency, source: cash.sourceType, drawerId: counter.cash_drawer_id,
    denominations: Boolean(cash.count.details) });
  if (approval) await event(client, context, "shift", shift.id, "pos.shift.opening_approved", { approvalId: approval.id, approver: approval.approver_user_id });
  return row;
}

// Open the shift. input: terminalId, storeId?, cashEnabled?, cashDrawerId?, openingCash (string) | denominations, openingCashConfirmed, sourceType?,
// sourceReference?, handoverId?, varianceReason?, approvalId?, expectedTerminalVersion?, notes?, idempotencyKey (required).
export async function openShift(client, context, input = {}) {
  if (!can(context, "pos.view")) throw shiftError(403, "POS_SHIFT_PERMISSION_DENIED");
  let idempotency;
  try {
    idempotency = await beginIdempotentOperation(client, context, { operation: "pos.shift.open", key: input.idempotencyKey, payload: { ...input, idempotencyKey: undefined }, required: true });
  } catch (error) {
    if (/IDEMPOTENCY/.test(error.code ?? "")) throw shiftError(409, "POS_SHIFT_IDEMPOTENCY_CONFLICT");
    throw error;
  }
  if (idempotency.replayed) return { ...(await shiftView(client, context, idempotency.response.id)), ...idempotency.response, replayed: true };
  // Two openings of one counter queue here: the second sees the first's session (or the database's one-session-per-terminal index refuses it).
  if (input.terminalId) await client.query(`SELECT id FROM tenant.pos_terminals WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, input.terminalId]);
  const result = await evaluate(client, context, input, { requireConfirmation: true });
  if (result.restore) {
    const view = await shiftView(client, context, result.restore.id);
    const response = { ...result.restore, ...view, restored: true };
    await recordShiftOpeningAttempt(client, context, { terminalId: result.counter.id, storeId: result.counter.store_id, outcome: "restored", sessionId: result.restore.id });
    await event(client, context, "shift", result.restore.id, "pos.shift.restored", { terminalId: result.counter.id });
    await completeIdempotentOperation(client, context, idempotency, { response: { id: result.restore.id, restored: true }, aggregateType: "pos_shift", aggregateId: result.restore.id });
    return response;
  }
  const { cashEnabled, cash } = result;
  let counter = result.counter;
  const { reason, approval } = await applyVariancePolicy(client, context, { counter, cash, input });
  if (cashEnabled) counter = await ensureTerminalDrawer(client, context, counter);
  const previous = (await client.query(`SELECT id FROM tenant.pos_shifts WHERE organization_id = $1 AND terminal_id = $2 AND status IN ('closed', 'cancelled')
      ORDER BY closed_at DESC NULLS LAST, created_at DESC LIMIT 1`, [context.organizationId, counter.id])).rows[0]?.id ?? null;
  const shiftNumber = await nextDocumentNumber(client, context, { documentType: `pos_shift:${counter.id}`, prefix: "SHIFT" });
  const opening = cash ? asDatabaseDecimal(cash.count.amount) : "0";
  await client.query("SAVEPOINT pos_shift_open");
  let shift;
  try {
    shift = (await client.query(
      `INSERT INTO tenant.pos_shifts (organization_id, store_id, terminal_id, shift_number, cashier_user_id, status, lifecycle_status, opening_cash, expected_cash, opened_at, opened_by,
         cash_enabled, previous_session_id, opening_approval_id, opening_idempotency_key)
       VALUES ($1, $2, $3, $4, $5, 'open', 'OPEN', $6, $6, now(), $5, $7, $8, $9, $10) RETURNING *`,
      [context.organizationId, counter.store_id, counter.id, shiftNumber, context.userId, opening, cashEnabled, previous, approval?.id ?? null, String(input.idempotencyKey)])).rows[0];
    await client.query("RELEASE SAVEPOINT pos_shift_open");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT pos_shift_open");
    if (error?.code === "23505") throw shiftError(409, "POS_SHIFT_ALREADY_OPEN", error.constraint === "pos_cashier_open_shift_uidx" ? "You already have a shift open on another counter." : undefined);
    throw error;
  }
  if (cashEnabled) {
    // The cash session and its opening count, in the same transaction: a cash shift never exists without one.
    const custody = await createCashCustody(client, context, { shift, counter, cash, reason, approval, notes: input.notes, idempotencyKey: input.idempotencyKey, previous });
    await client.query(`UPDATE tenant.pos_shifts SET cash_session_id = $3 WHERE organization_id = $1 AND id = $2`, [context.organizationId, shift.id, custody.id]);
    shift.cash_session_id = custody.id;
  }
  await event(client, context, "shift", shift.id, "pos.shift.opened", { shiftNumber, storeId: counter.store_id, terminalId: counter.id, cashEnabled });
  await recordShiftOpeningAttempt(client, context, { terminalId: counter.id, storeId: counter.store_id, outcome: "opened", sessionId: shift.id });
  const view = await shiftView(client, context, shift.id);
  const response = { ...shift, ...view, replayed: false };
  await completeIdempotentOperation(client, context, idempotency, { response: { ...shift, replayed: false }, aggregateType: "pos_shift", aggregateId: shift.id });
  return response;
}

// A card / UPI shift that now needs to take cash: a cash session with a counted, confirmed float in the counter's drawer (any waiting handover
// is received here) — the same rules as opening. input: openingCash | denominations, openingCashConfirmed, sourceType?, sourceReference?,
// handoverId?, varianceReason?, approvalId?.
export async function openPosCashSession(client, context, shiftId, input = {}) {
  requirePermission(context, "pos.view");
  const shift = (await client.query(`SELECT * FROM tenant.pos_shifts WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, shiftId])).rows[0];
  if (!shift) throw posError(404, "Shift was not found.", "POS_SHIFT_NOT_FOUND");
  if (shift.cashier_user_id !== context.userId) throw shiftError(403, "POS_SHIFT_PERMISSION_DENIED", "Only the shift's own cashier opens its cash drawer.");
  if (shift.lifecycle_status !== "OPEN") throw shiftError(409, "POS_SHIFT_NOT_OPERATIONAL");
  if (shift.cash_session_id) return shiftView(client, context, shift.id);
  const policy = await policyOf(client, context);
  let counter;
  try { counter = await counterOf(client, context, shift.terminal_id); } catch (error) { throw translate(error); }
  if (!counter.cash_management_enabled) throw shiftError(409, "POS_SHIFT_CONFIG_INCOMPLETE", "This counter does not handle cash.");
  const cash = await evaluateCash(client, context, { counter, policy, input, requireConfirmation: true, ownSessionId: shift.id });
  const { reason, approval } = await applyVariancePolicy(client, context, { counter, cash, input });
  counter = await ensureTerminalDrawer(client, context, counter);
  const custody = await createCashCustody(client, context, { shift, counter, cash, reason, approval, notes: input.notes, idempotencyKey: null, previous: shift.previous_session_id });
  const opening = asDatabaseDecimal(cash.count.amount);
  await client.query(`UPDATE tenant.pos_shifts SET cash_session_id = $3, cash_enabled = true, opening_cash = $4, expected_cash = expected_cash + $4 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, shift.id, custody.id, opening]);
  await event(client, context, "shift", shift.id, "pos.shift.cash_session_opened", { amount: money(opening), handoverId: cash.handover?.id ?? null, drawerId: counter.cash_drawer_id });
  return shiftView(client, context, shift.id);
}

// Before cash is taken or paid out on a shift: it must be open for sales and have an open cash session.
export async function assertShiftCashSession(client, context, shiftId) {
  const row = (await client.query(
    `SELECT shift.lifecycle_status, shift.cash_enabled, cash.status AS cash_status FROM tenant.pos_shifts shift
       LEFT JOIN tenant.pos_cash_sessions cash ON cash.organization_id = shift.organization_id AND cash.id = shift.cash_session_id
      WHERE shift.organization_id = $1 AND shift.id = $2`, [context.organizationId, shiftId])).rows[0];
  if (!row) throw posError(404, "Shift was not found.", "POS_SHIFT_NOT_FOUND");
  if (!row.cash_enabled || row.cash_status !== "open") throw shiftError(409, "POS_SHIFT_CASH_SESSION_REQUIRED");
}

// Before a sale on a shift: the shift must be open (not suspended, closing or under review).
export async function assertShiftOperational(client, context, shiftId) {
  const row = (await client.query(`SELECT lifecycle_status FROM tenant.pos_shifts WHERE organization_id = $1 AND id = $2`, [context.organizationId, shiftId])).rows[0];
  if (!row) throw posError(404, "Shift was not found.", "POS_SHIFT_NOT_FOUND");
  if (row.lifecycle_status === "RECOVERY_REQUIRED" || row.lifecycle_status === "SUSPENDED") throw shiftError(409, "POS_SHIFT_RECOVERY_REQUIRED");
  if (row.lifecycle_status !== "OPEN") throw shiftError(409, "POS_SHIFT_NOT_OPERATIONAL");
}

async function currentShiftRow(client, context) {
  return (await client.query(`SELECT * FROM tenant.pos_shifts WHERE organization_id = $1 AND cashier_user_id = $2 AND status IN ('open', 'closing') ORDER BY opened_at DESC LIMIT 1`,
    [context.organizationId, context.userId])).rows[0] ?? null;
}

// The shift as the counter shows it: number, outlet, counter, cashier, server opening time, cash mode and float, handover and variance (amounts for
// those who may see expected cash), what can be taken, and whether checkout is open.
export async function shiftView(client, context, shiftId) {
  const row = (await client.query(
    `SELECT shift.*, store.name AS store_name, store.code AS store_code, terminal.code AS terminal_code, terminal.name AS terminal_name, users.full_name AS cashier_name,
            cash.id AS cash_id, cash.opening_float_amount, cash.currency_code, cash.opening_source, cash.handover_id, cash.handover_amount, cash.opening_variance_amount,
            cash.variance_reason, cash.approval_id AS cash_approval_id, cash.denomination_details, cash.opening_confirmed_at, cash.status AS cash_status, previous.shift_number AS previous_shift_number,
            cash.source_type, cash.source_reference, cash.cash_drawer_id, drawer.code AS drawer_code, drawer.name AS drawer_name,
            (SELECT count(*)::int FROM tenant.pos_cash_opening_corrections correction WHERE correction.organization_id = cash.organization_id AND correction.cash_session_id = cash.id) AS corrections
       FROM tenant.pos_shifts shift
       JOIN tenant.pos_stores store ON store.organization_id = shift.organization_id AND store.id = shift.store_id
       JOIN tenant.pos_terminals terminal ON terminal.organization_id = shift.organization_id AND terminal.id = shift.terminal_id
       LEFT JOIN public.users ON users.id = shift.cashier_user_id
       LEFT JOIN tenant.pos_cash_sessions cash ON cash.organization_id = shift.organization_id AND cash.id = shift.cash_session_id
       LEFT JOIN tenant.pos_shifts previous ON previous.organization_id = shift.organization_id AND previous.id = shift.previous_session_id
       LEFT JOIN tenant.pos_cash_drawers drawer ON drawer.organization_id = cash.organization_id AND drawer.id = cash.cash_drawer_id
      WHERE shift.organization_id = $1 AND shift.id = $2`, [context.organizationId, shiftId])).rows[0];
  if (!row) throw posError(404, "Shift was not found.", "POS_SHIFT_NOT_FOUND");
  const mine = row.cashier_user_id === context.userId;
  if (!mine) await assertPosStoreAccess(client, context, row.store_id);
  const seeAmounts = mine || can(context, "pos.store.manage") || privileged(context) || await expectedCashVisible(client, context, row.store_id);
  const methods = {};
  for (const method of ["cash", "card", "upi"]) methods[method] = await isTerminalPaymentMethodEnabled(client, context.organizationId, row.terminal_id, method);
  methods.cash = methods.cash && row.cash_status === "open";
  return {
    shiftId: row.id, shiftNumber: row.shift_number, status: row.lifecycle_status, storeId: row.store_id, storeName: row.store_name, terminalId: row.terminal_id,
    terminalCode: row.terminal_code, terminalName: row.terminal_name, cashierUserId: row.cashier_user_id, cashierName: row.cashier_name, openedAt: row.opened_at, closedAt: row.closed_at,
    cashEnabled: row.cash_enabled, cashSessionId: row.cash_id ?? null, cashSessionStatus: row.cash_status ?? null,
    openingCashAmount: row.cash_id ? money(row.opening_float_amount) : null, currency: (row.currency_code ?? "INR").trim(), openingSource: row.opening_source ?? null,
    denominations: row.denomination_details ?? null, openingConfirmedAt: row.opening_confirmed_at ?? null, previousShiftNumber: row.previous_shift_number ?? null,
    sourceType: row.source_type ?? null, sourceReference: row.source_reference ?? null, openingCorrections: Number(row.corrections ?? 0),
    cashDrawer: row.cash_drawer_id ? { id: row.cash_drawer_id, code: row.drawer_code, name: row.drawer_name } : null,
    handover: row.handover_id ? { id: row.handover_id, ...(seeAmounts ? { amount: money(row.handover_amount), variance: money(row.opening_variance_amount) } : {}), reason: row.variance_reason,
      approved: Boolean(row.cash_approval_id) } : null,
    paymentMethods: methods, readyForCheckout: row.lifecycle_status === "OPEN", version: row.version,
    suspension: row.suspended_at && row.lifecycle_status === "SUSPENDED" ? { at: row.suspended_at, reason: row.suspension_reason, byCashier: row.suspended_by === row.cashier_user_id } : null,
    review: row.recovery_flagged_at ? { reason: row.recovery_reason, flaggedAt: row.recovery_flagged_at, resolution: row.recovery_resolution, resolvedAt: row.recovery_resolved_at } : null,
  };
}

// The signed-in cashier's shift now (restored after a refresh or a lost connection), or null.
export async function getCurrentPosShift(client, context) {
  requirePermission(context, "pos.view");
  const row = await currentShiftRow(client, context);
  return row ? shiftView(client, context, row.id) : null;
}

// A refused or failed opening, kept with its sanitized reason (written by the route in its own transaction once the request's has rolled back).
export async function recordShiftOpeningAttempt(client, context, { terminalId = null, storeId = null, outcome, code = null, message = null, sessionId = null }) {
  let store = storeId;
  if (!store && terminalId && /^[0-9a-f-]{36}$/i.test(String(terminalId)))
    store = (await client.query(`SELECT store_id FROM tenant.pos_terminals WHERE organization_id = $1 AND id = $2`, [context.organizationId, terminalId])).rows[0]?.store_id ?? null;
  await client.query(
    `INSERT INTO tenant.pos_shift_opening_attempts (organization_id, user_id, store_id, terminal_id, outcome, code, message, session_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [context.organizationId, context.userId ?? null, store, /^[0-9a-f-]{36}$/i.test(String(terminalId ?? "")) ? terminalId : null, outcome, code, text(message, 300), sessionId]);
}

// Shift openings (history): who opened which counter when, cash or card / UPI, float, handover and variance, approval — outlets the user may see.
// filters: from, to, storeId, terminalId, cashierUserId, status, limit, offset.
export async function listPosShiftOpenings(client, context, filters = {}) {
  requirePermission(context, "pos.view");
  const stores = await accessiblePosStoreIds(client, context);
  const own = !can(context, "pos.store.manage") && !privileged(context) && !(await canViewAll(client, context));
  const values = [context.organizationId, stores, filters.from ?? null, filters.to ?? null, filters.storeId ?? null, filters.terminalId ?? null, own ? context.userId : filters.cashierUserId ?? null,
    filters.status ?? null, Math.min(Number(filters.limit) || 50, 200), Number(filters.offset) || 0];
  const { rows } = await client.query(
    `SELECT shift.id, count(*) OVER () AS total FROM tenant.pos_shifts shift
      WHERE shift.organization_id = $1 AND ($2::uuid[] IS NULL OR shift.store_id = ANY($2::uuid[])) AND ($3::date IS NULL OR shift.opened_at >= $3::date)
        AND ($4::date IS NULL OR shift.opened_at < $4::date + 1) AND ($5::uuid IS NULL OR shift.store_id = $5) AND ($6::uuid IS NULL OR shift.terminal_id = $6)
        AND ($7::uuid IS NULL OR shift.cashier_user_id = $7) AND ($8::text IS NULL OR shift.lifecycle_status = upper($8))
      ORDER BY shift.opened_at DESC NULLS LAST LIMIT $9 OFFSET $10`, values);
  const out = [];
  for (const row of rows) out.push(await shiftView(client, context, row.id));
  return { rows: out, total: Number(rows[0]?.total ?? 0) };
}

async function canViewAll(client, context) {
  try { return (await authorizePosAction(client, context, { permission: "SESSION_VIEW_EXPECTED_CASH" })).decision === "ALLOW"; } catch { return false; }
}

// Shift opening reporting for a period: open shifts by outlet, active counters, openings, opening floats, cash versus card / UPI shifts,
// variances and approved openings, shifts open too long, refused openings, and handovers still waiting.
export async function getShiftOpeningSummary(client, context, { from = null, to = null } = {}) {
  requirePermission(context, "pos.view");
  if (!can(context, "pos.store.manage") && !privileged(context) && !(await canViewAll(client, context))) throw shiftError(403, "POS_SHIFT_PERMISSION_DENIED", "You cannot see shift reporting.");
  const stores = await accessiblePosStoreIds(client, context);
  const today = new Date();
  const start = from ?? new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const end = to ?? today.toISOString().slice(0, 10);
  const policy = await policyOf(client, context);
  const scope = `shift.organization_id = $1 AND ($2::uuid[] IS NULL OR shift.store_id = ANY($2::uuid[]))`;
  const [totals, open, long, refused, waiting, sources, corrections] = await Promise.all([
    client.query(`SELECT count(*)::int AS openings, count(*) FILTER (WHERE shift.cash_enabled)::int AS cash_shifts, count(*) FILTER (WHERE NOT shift.cash_enabled)::int AS digital_shifts,
        COALESCE(sum(cash.opening_float_amount), 0)::text AS opening_floats, count(*) FILTER (WHERE cash.opening_variance_amount <> 0)::int AS variances,
        COALESCE(sum(cash.opening_variance_amount), 0)::text AS variance_total, count(*) FILTER (WHERE shift.opening_approval_id IS NOT NULL)::int AS approved
        FROM tenant.pos_shifts shift LEFT JOIN tenant.pos_cash_sessions cash ON cash.organization_id = shift.organization_id AND cash.id = shift.cash_session_id
       WHERE ${scope} AND shift.opened_at >= $3::date AND shift.opened_at < $4::date + 1`, [context.organizationId, stores, start, end]),
    client.query(`SELECT store.name AS outlet, count(*)::int AS open_shifts, count(DISTINCT shift.terminal_id)::int AS active_counters
        FROM tenant.pos_shifts shift JOIN tenant.pos_stores store ON store.organization_id = shift.organization_id AND store.id = shift.store_id
       WHERE ${scope} AND shift.status IN ('open', 'closing') GROUP BY store.name ORDER BY store.name`, [context.organizationId, stores]),
    client.query(`SELECT shift.id, shift.shift_number, terminal.code AS terminal, users.full_name AS cashier, shift.opened_at FROM tenant.pos_shifts shift
        JOIN tenant.pos_terminals terminal ON terminal.organization_id = shift.organization_id AND terminal.id = shift.terminal_id LEFT JOIN public.users ON users.id = shift.cashier_user_id
       WHERE ${scope} AND shift.status IN ('open', 'closing') AND shift.opened_at < now() - make_interval(hours => $3) ORDER BY shift.opened_at LIMIT 50`,
      [context.organizationId, stores, policy.longOpenHours]),
    client.query(`SELECT attempt.code, count(*)::int AS attempts FROM tenant.pos_shift_opening_attempts attempt
       WHERE attempt.organization_id = $1 AND ($2::uuid[] IS NULL OR attempt.store_id = ANY($2::uuid[])) AND attempt.outcome IN ('denied', 'failed')
         AND attempt.attempted_at >= $3::date AND attempt.attempted_at < $4::date + 1 GROUP BY attempt.code ORDER BY attempts DESC`, [context.organizationId, stores, start, end]),
    client.query(`SELECT count(*)::int AS waiting FROM tenant.pos_cash_handovers handover WHERE handover.organization_id = $1 AND ($2::uuid[] IS NULL OR handover.store_id = ANY($2::uuid[]))
        AND handover.status = 'pending'`, [context.organizationId, stores]),
    client.query(`SELECT COALESCE(cash.source_type, 'FRESH_FLOAT') AS source, count(*)::int AS openings, COALESCE(sum(cash.opening_float_amount), 0)::text AS amount
        FROM tenant.pos_cash_sessions cash WHERE cash.organization_id = $1 AND ($2::uuid[] IS NULL OR cash.store_id = ANY($2::uuid[])) AND cash.opened_at >= $3::date
         AND cash.opened_at < $4::date + 1 GROUP BY 1 ORDER BY 1`, [context.organizationId, stores, start, end]),
    client.query(`SELECT count(*)::int AS corrections FROM tenant.pos_cash_opening_corrections correction JOIN tenant.pos_cash_sessions cash ON cash.organization_id = correction.organization_id
         AND cash.id = correction.cash_session_id WHERE correction.organization_id = $1 AND ($2::uuid[] IS NULL OR cash.store_id = ANY($2::uuid[])) AND correction.recorded_at >= $3::date
         AND correction.recorded_at < $4::date + 1`, [context.organizationId, stores, start, end]),
  ]);
  const t = totals.rows[0];
  return {
    from: start, to: end,
    totals: { openings: t.openings, cashShifts: t.cash_shifts, digitalShifts: t.digital_shifts, openingFloats: money(t.opening_floats), variances: t.variances, varianceTotal: money(t.variance_total),
      approvedOpenings: t.approved, handoversWaiting: waiting.rows[0].waiting, openingCorrections: corrections.rows[0].corrections },
    floatsBySource: sources.rows.map((row) => ({ source: row.source, openings: row.openings, amount: money(row.amount) })),
    openByOutlet: open.rows.map((row) => ({ outlet: row.outlet, openShifts: row.open_shifts, activeCounters: row.active_counters })),
    longOpen: long.rows.map((row) => ({ shiftId: row.id, shiftNumber: row.shift_number, terminal: row.terminal, cashier: row.cashier, openedAt: row.opened_at })),
    refusals: refused.rows.map((row) => ({ code: row.code, attempts: row.attempts })), longOpenHours: policy.longOpenHours,
  };
}

// ------------------------------------------------------------------ the rest of the lifecycle (pause, resume, review)

async function lockShift(client, context, shiftId) {
  const shift = (await client.query(`SELECT * FROM tenant.pos_shifts WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, shiftId])).rows[0];
  if (!shift) throw posError(404, "Shift was not found.", "POS_SHIFT_NOT_FOUND");
  try { await assertPosStoreAccess(client, context, shift.store_id, shift.terminal_id); } catch { throw shiftError(403, "POS_SHIFT_PERMISSION_DENIED"); }
  return shift;
}

// A supervisor acting on someone else's shift: SESSION_CLOSE_OTHER at that outlet, with a reason.
async function assertSupervisor(client, context, shift, reason) {
  try { await assertPosAction(client, context, { permission: "SESSION_CLOSE_OTHER", outletId: shift.store_id, reason }); }
  catch { throw shiftError(403, "POS_SHIFT_PERMISSION_DENIED", "Only a supervisor can do this to another cashier's shift."); }
}

// Pause a shift (a break, the counter left unattended): no new sales until its cashier signs in again. The cashier pauses their own; a
// supervisor may pause anyone's, with a reason. Not while a card / UPI payment or cash taken is still being settled. input: reason.
export async function suspendPosShift(client, context, shiftId, input = {}) {
  requirePermission(context, "pos.view");
  const shift = await lockShift(client, context, shiftId);
  const reason = text(input.reason);
  if (shift.cashier_user_id !== context.userId) {
    if (!reason) throw posError(400, "Say why you are pausing another cashier's shift.", "POS_REASON_REQUIRED");
    await assertSupervisor(client, context, shift, reason);
  }
  if (shift.lifecycle_status !== "OPEN") throw shiftError(409, "POS_SHIFT_NOT_OPERATIONAL", `This shift is ${shift.lifecycle_status.toLowerCase().replace(/_/g, " ")}, not open.`);
  const pending = (await client.query(
    `SELECT 1 FROM tenant.pos_payments WHERE organization_id = $1 AND shift_id = $2 AND sale_id IS NULL
        AND (status IN ('initiated', 'pending', 'authorized') OR status = 'captured' OR custody_status IN ('pending', 'reconciliation_required')) LIMIT 1`,
    [context.organizationId, shiftId])).rows[0];
  if (pending) throw shiftError(409, "POS_SHIFT_PAYMENT_IN_PROGRESS", "A payment on this shift is still being settled. Finish or resolve it before pausing.");
  await client.query(`UPDATE tenant.pos_shifts SET lifecycle_status = 'SUSPENDED', suspended_at = now(), suspended_by = $3, suspension_reason = $4, resumed_at = NULL
                       WHERE organization_id = $1 AND id = $2`, [context.organizationId, shiftId, context.userId, reason]);
  await event(client, context, "shift", shiftId, "pos.shift.suspended", { by: context.userId, reason, own: shift.cashier_user_id === context.userId });
  return shiftView(client, context, shiftId);
}

// Resume a paused shift: only its own cashier, by entering their password again (whoever stands at the counter must be them) — or, for a
// cashier without a password, the code emailed to them.
export async function resumePosShift(client, context, shiftId, input = {}) {
  requirePermission(context, "pos.view");
  const shift = await lockShift(client, context, shiftId);
  if (shift.cashier_user_id !== context.userId) throw shiftError(403, "POS_SHIFT_PERMISSION_DENIED", "Only the shift's own cashier can resume it.");
  if (shift.lifecycle_status !== "SUSPENDED") throw shiftError(409, "POS_SHIFT_NOT_OPERATIONAL", "This shift is not paused.");
  const confirmed = await identityConfirmed(client, { userId: context.userId, sessionId: context.sessionId ?? null, password: input.password });
  if (!confirmed.ok) throw confirmed.needsCode ? shiftError(401, "AUTH_REAUTH_REQUIRED", CONFIRM_WITH_CODE) : shiftError(401, "POS_SHIFT_REAUTH_FAILED", "That password is not right. Sign in again to resume your shift.");
  await client.query(`UPDATE tenant.pos_shifts SET lifecycle_status = 'OPEN', resumed_at = now() WHERE organization_id = $1 AND id = $2`, [context.organizationId, shiftId]);
  await event(client, context, "shift", shiftId, "pos.shift.resumed", { by: context.userId });
  return shiftView(client, context, shiftId);
}

// A supervisor stops a shift for review (cash that does not add up, a counter left in a bad state): no sales, no closing, no pausing until
// someone other than its cashier clears it. input: reason.
export async function flagPosShiftForRecovery(client, context, shiftId, input = {}) {
  requirePermission(context, "pos.view");
  const shift = await lockShift(client, context, shiftId);
  const reason = text(input.reason);
  if (!reason) throw posError(400, "Say why the shift needs review.", "POS_REASON_REQUIRED");
  if (shift.cashier_user_id === context.userId) throw shiftError(403, "POS_SHIFT_PERMISSION_DENIED", "A supervisor other than the shift's cashier flags it for review.");
  await assertSupervisor(client, context, shift, reason);
  if (!["OPEN", "SUSPENDED"].includes(shift.lifecycle_status)) throw shiftError(409, "POS_SHIFT_NOT_OPERATIONAL", "Only an open or paused shift can be flagged for review.");
  await client.query(`UPDATE tenant.pos_shifts SET lifecycle_status = 'RECOVERY_REQUIRED', recovery_reason = $3, recovery_flagged_by = $4, recovery_flagged_at = now(),
                       recovery_resolution = NULL, recovery_resolved_by = NULL, recovery_resolved_at = NULL WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, shiftId, reason, context.userId]);
  await event(client, context, "shift", shiftId, "pos.shift.recovery_required", { by: context.userId, reason });
  return shiftView(client, context, shiftId);
}

// Clear the review: a supervisor (never the shift's own cashier) records what was found; the shift is paused, so its cashier signs in again to
// carry on (or closes it). input: resolution.
export async function resolvePosShiftRecovery(client, context, shiftId, input = {}) {
  requirePermission(context, "pos.view");
  const shift = await lockShift(client, context, shiftId);
  const resolution = text(input.resolution);
  if (!resolution) throw posError(400, "Record what was found and done.", "POS_REASON_REQUIRED");
  if (shift.cashier_user_id === context.userId) throw shiftError(403, "POS_SHIFT_PERMISSION_DENIED", "Someone other than the shift's cashier clears its review.");
  await assertSupervisor(client, context, shift, resolution);
  if (shift.lifecycle_status !== "RECOVERY_REQUIRED") throw shiftError(409, "POS_SHIFT_NOT_OPERATIONAL", "This shift is not under review.");
  await client.query(`UPDATE tenant.pos_shifts SET lifecycle_status = 'SUSPENDED', recovery_resolution = $3, recovery_resolved_by = $4, recovery_resolved_at = now(),
                       suspended_at = now(), suspended_by = $4, suspension_reason = 'Review cleared: the cashier signs in again' WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, shiftId, resolution, context.userId]);
  await event(client, context, "shift", shiftId, "pos.shift.recovery_resolved", { by: context.userId, resolution });
  return shiftView(client, context, shiftId);
}
