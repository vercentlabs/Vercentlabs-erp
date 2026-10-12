// POS-CAP-001 configuration surface: tenant.pos_settings, the organization-level policy every checkout, return and offline-sync path
// consults (discount limits and the supervisor-approval threshold, return-approval rules, negative stock, price override, cart expiry,
// shift reconciliation). cart.js, sale-completion.js, offline-sync.js and return-lifecycle.js each SELECT these columns. It is
// configuration, not a transaction, so the guarantees are validation + authorization + an audit event per change. An outlet's own payment
// methods and the provider behind each are part of the outlet (outlets/index.js).
import { posError } from "../shared/errors.js";
import { requirePermission } from "../shared/access-control.js";
import { event } from "../shared/audit.js";

export const POS_SETTINGS_DEFAULTS = Object.freeze({
  require_shift_reconciliation: true,
  allow_negative_stock: false,
  allow_price_override: false,
  require_return_approval: true,
  prohibit_self_return_approval: true,
  default_currency_code: "INR",
  max_line_discount_percent: "100",
  max_cart_discount_percent: "100",
  discount_approval_threshold_percent: "10",
  cart_expiry_minutes: 240,
  // Cart (0086): how long a held bill is kept, and how long an idle checkout lock lasts when no payment is pending.
  held_cart_retention_hours: 24,
  checkout_lock_minutes: 15,
  // Stock Reduction (0101): the longest a checkout may hold its stock reservation while payment is under way (renewals stop there).
  stock_reservation_max_hold_minutes: 30,
  // Shift Opening (0103): an opening count that differs from the cash handed over by more than this needs a supervisor (empty = never; 0 = any
  // difference); the notes and coins counted; when an open shift is reported as open too long.
  opening_variance_approval_above: 0,
  // Opening Cash Float (0104): above this difference from the handover the drawer cannot open until a manager resolves it (empty = no hard limit).
  opening_variance_block_above: null,
  opening_count_denominations: [500, 200, 100, 50, 20, 10, 5, 2, 1],
  long_open_shift_hours: 14,
  // Shift Closing (0105): a closing difference above this needs a supervisor (empty = never; 0 = any difference); above the hard limit only a
  // supervisor can reconcile and close (empty = none); the blind count, and whether the counter sees the comparison after counting; the reasons.
  closing_variance_approval_above: 0,
  closing_variance_block_above: null,
  closing_blind_count: true,
  closing_reveal_expected_after_count: true,
  closing_variance_reasons: ["COUNTING_ERROR", "INCORRECT_CHANGE", "CASH_REFUND_ERROR", "MISSING_CASH_MOVEMENT", "CASH_RECEIPT_ERROR", "DRAWER_SHORTAGE", "DRAWER_OVERAGE", "PREVIOUS_HANDOVER_MISMATCH", "UNKNOWN", "OTHER"],
  // Cash Difference (0106): separate tolerances / hard limits for shortages and overages (empty = the general ones), and whether "I am not sure"
  // needs a note.
  closing_shortage_approval_above: null,
  closing_overage_approval_above: null,
  closing_shortage_block_above: null,
  closing_overage_block_above: null,
  cash_difference_unknown_note_required: true,
  // Payment Reconciliation (0108): when an in-flight payment counts as unknown, when a provider refund is overdue, and above which amount a manual
  // match or resolution needs a second person.
  reconciliation_unknown_after_minutes: 30,
  reconciliation_refund_overdue_days: 7,
  reconciliation_manual_approval_above: "10000",
  // Walk-In Customer (0087): from this bill total a walk-in invoice needs the buyer's name and address (tax policy; empty = never).
  walk_in_buyer_details_required_above: "50000",
  // Item Discounts (0090): how a manual line discount meets an automatic promotion, whether a line may be discounted in full, whether a
  // reason is always required.
  manual_discount_stacking: "non_stackable",
  allow_full_line_discount: false,
  discount_reason_required: false,
  // Cart Discounts (0091): whether discounts may bring a bill to a zero total.
  allow_zero_total_sale: false,
  // Cash Payments (0092): cash on or off, quick tender amounts, a ceiling on one cash tender and a large-cash warning (empty = none).
  cash_payments_enabled: true,
  cash_quick_amounts_enabled: true,
  max_cash_tender_amount: null,
  large_cash_warning_amount: null,
  // Split Payments (0095): paying one bill with several tenders, and how a return refund is shared across them.
  split_payments_enabled: true,
  refund_allocation_policy: "proportional",
  // Receipt Reprinting (0097): whether every reprint needs a reason.
  receipt_reprint_reason_required: false,
  // Returns (0099): the return policy.
  returns_enabled: true,
  return_window_days: 30,
  allow_no_receipt_returns: true,
  require_return_reason: true,
  require_return_condition: true,
  allow_partial_returns: true,
  allow_cross_outlet_returns: false,
  require_inspection_before_refund: false,
  return_approval_above: null,
  return_reasons: ["damaged_product", "defective_product", "wrong_item", "wrong_size_variant", "customer_changed_mind", "quality_issue", "not_as_described", "other"],
  return_restrictions: [],
});
const RETURN_REASON_CODES = ["damaged_product", "defective_product", "wrong_item", "wrong_size_variant", "customer_changed_mind", "quality_issue", "not_as_described", "other"];

const SETTINGS_COLUMNS = Object.keys(POS_SETTINGS_DEFAULTS);
const BOOLEAN_SETTINGS = ["require_shift_reconciliation", "allow_negative_stock", "allow_price_override", "require_return_approval", "prohibit_self_return_approval",
  "allow_full_line_discount", "discount_reason_required", "allow_zero_total_sale", "cash_payments_enabled", "cash_quick_amounts_enabled", "split_payments_enabled",
  "receipt_reprint_reason_required", "returns_enabled", "allow_no_receipt_returns", "require_return_reason", "require_return_condition", "allow_partial_returns",
  "allow_cross_outlet_returns", "require_inspection_before_refund", "closing_blind_count", "closing_reveal_expected_after_count", "cash_difference_unknown_note_required"];
const CLOSING_REASON_CODES = ["CASH_REFUND_DISCREPANCY", "COUNTING_ERROR", "INCORRECT_CHANGE", "CASH_REFUND_ERROR", "MISSING_CASH_MOVEMENT", "CASH_RECEIPT_ERROR", "DRAWER_SHORTAGE", "DRAWER_OVERAGE", "PREVIOUS_HANDOVER_MISMATCH", "UNKNOWN", "OTHER"];
const PERCENT_SETTINGS = ["max_line_discount_percent", "max_cart_discount_percent", "discount_approval_threshold_percent"];


// --- settings ----------------------------------------------------------------

export async function getPosSettings(client, context) {
  requirePermission(context, "pos.settings.manage");
  const result = await client.query(`SELECT ${SETTINGS_COLUMNS.join(",")},updated_at FROM tenant.pos_settings WHERE organization_id=$1`, [
    context.organizationId,
  ]);
  const row = result.rows[0];
  return {
    // `configured` lets the screen say "using defaults" honestly rather than
    // presenting the fallback values as if someone had chosen them.
    configured: Boolean(row),
    updatedAt: row?.updated_at ?? null,
    settings: row ? Object.fromEntries(SETTINGS_COLUMNS.map((column) => [column, row[column]])) : { ...POS_SETTINGS_DEFAULTS },
  };
}

function normalizeSettingsInput(input) {
  const changes = {};
  for (const column of BOOLEAN_SETTINGS) {
    if (input[column] === undefined) continue;
    if (typeof input[column] !== "boolean") throw posError(400, `${column} must be true or false.`, "POS_SETTINGS_INVALID");
    changes[column] = input[column];
  }
  for (const column of PERCENT_SETTINGS) {
    if (input[column] === undefined) continue;
    const value = Number(input[column]);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw posError(400, `${column} must be a percentage between 0 and 100.`, "POS_SETTINGS_INVALID");
    }
    changes[column] = value;
  }
  if (input.cart_expiry_minutes !== undefined) {
    const minutes = Number(input.cart_expiry_minutes);
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 10080) {
      throw posError(400, "cart_expiry_minutes must be a whole number between 5 and 10080 (one week).", "POS_SETTINGS_INVALID");
    }
    changes.cart_expiry_minutes = minutes;
  }
  for (const [column, low, high, label] of [["held_cart_retention_hours", 1, 2160, "hours"], ["checkout_lock_minutes", 2, 240, "minutes"], ["stock_reservation_max_hold_minutes", 5, 240, "minutes"],
    ["reconciliation_unknown_after_minutes", 1, 10080, "minutes"], ["reconciliation_refund_overdue_days", 1, 90, "days"]]) {
    if (input[column] === undefined) continue;
    const value = Number(input[column]);
    if (!Number.isInteger(value) || value < low || value > high) throw posError(400, `${column} must be a whole number of ${label} between ${low} and ${high}.`, "POS_SETTINGS_INVALID");
    changes[column] = value;
  }
  if (input.walk_in_buyer_details_required_above !== undefined) {
    const raw = input.walk_in_buyer_details_required_above;
    if (raw === null || raw === "") changes.walk_in_buyer_details_required_above = null;
    else {
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) throw posError(400, "walk_in_buyer_details_required_above must be zero or more (or empty for never).", "POS_SETTINGS_INVALID");
      changes.walk_in_buyer_details_required_above = value;
    }
  }
  for (const column of ["max_cash_tender_amount", "large_cash_warning_amount"]) {
    if (input[column] === undefined) continue;
    const raw = input[column];
    if (raw === null || raw === "") { changes[column] = null; continue; }
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) throw posError(400, `${column} must be more than zero (or empty for none).`, "POS_SETTINGS_INVALID");
    changes[column] = value;
  }
  if (input.refund_allocation_policy !== undefined) {
    if (!["proportional", "electronic_first"].includes(input.refund_allocation_policy))
      throw posError(400, "refund_allocation_policy must be proportional or electronic_first.", "POS_SETTINGS_INVALID");
    changes.refund_allocation_policy = input.refund_allocation_policy;
  }
  if (input.manual_discount_stacking !== undefined) {
    if (!["non_stackable", "stackable", "manual_replaces_automatic"].includes(input.manual_discount_stacking))
      throw posError(400, "manual_discount_stacking must be non_stackable, stackable or manual_replaces_automatic.", "POS_SETTINGS_INVALID");
    changes.manual_discount_stacking = input.manual_discount_stacking;
  }
  // Returns (0099): the window (empty = no limit), approval above an amount, the allowed reasons, and item / category restrictions.
  if (input.return_window_days !== undefined) {
    const raw = input.return_window_days;
    if (raw === null || raw === "") changes.return_window_days = null;
    else {
      const days = Number(raw);
      if (!Number.isInteger(days) || days < 0 || days > 3650) throw posError(400, "return_window_days must be a whole number of days from 0 to 3650 (or empty for no limit).", "POS_SETTINGS_INVALID");
      changes.return_window_days = days;
    }
  }
  if (input.return_approval_above !== undefined) {
    const raw = input.return_approval_above;
    if (raw === null || raw === "") changes.return_approval_above = null;
    else {
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) throw posError(400, "return_approval_above must be more than zero (or empty for none).", "POS_SETTINGS_INVALID");
      changes.return_approval_above = value;
    }
  }
  if (input.opening_variance_approval_above !== undefined) {
    const raw = input.opening_variance_approval_above;
    if (raw === null || raw === "") changes.opening_variance_approval_above = null;
    else {
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) throw posError(400, "opening_variance_approval_above must be zero or more (or empty for never).", "POS_SETTINGS_INVALID");
      changes.opening_variance_approval_above = value;
    }
  }
  if (input.opening_variance_block_above !== undefined) {
    const raw = input.opening_variance_block_above;
    if (raw === null || raw === "") changes.opening_variance_block_above = null;
    else {
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) throw posError(400, "opening_variance_block_above must be more than zero (or empty for no hard limit).", "POS_SETTINGS_INVALID");
      changes.opening_variance_block_above = value;
    }
  }
  for (const [column, minimum] of [["reconciliation_manual_approval_above", 0], ["closing_variance_approval_above", 0], ["closing_variance_block_above", 0.01], ["closing_shortage_approval_above", 0], ["closing_overage_approval_above", 0],
    ["closing_shortage_block_above", 0.01], ["closing_overage_block_above", 0.01]]) {
    if (input[column] === undefined) continue;
    const raw = input[column];
    if (raw === null || raw === "") { changes[column] = null; continue; }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < minimum) throw posError(400, `${column} must be ${minimum ? "more than zero" : "zero or more"} (or empty).`, "POS_SETTINGS_INVALID");
    changes[column] = value;
  }
  if (input.closing_variance_reasons !== undefined) {
    const list = Array.isArray(input.closing_variance_reasons) ? [...new Set(input.closing_variance_reasons.map(String))] : [];
    if (!list.length || list.some((code) => !CLOSING_REASON_CODES.includes(code)))
      throw posError(400, `closing_variance_reasons must be chosen from ${CLOSING_REASON_CODES.join(", ")}.`, "POS_SETTINGS_INVALID");
    changes.closing_variance_reasons = JSON.stringify(list.includes("OTHER") ? list : [...list, "OTHER"]);
  }
  if (input.opening_count_denominations !== undefined) {
    const list = Array.isArray(input.opening_count_denominations) ? [...new Set(input.opening_count_denominations.map(Number))].sort((a, b) => b - a) : [];
    if (!list.length || list.length > 20 || list.some((value) => !Number.isFinite(value) || value <= 0 || Math.round(value * 100) !== value * 100))
      throw posError(400, "opening_count_denominations must list the notes and coins counted (positive amounts).", "POS_SETTINGS_INVALID");
    changes.opening_count_denominations = JSON.stringify(list);
  }
  if (input.long_open_shift_hours !== undefined) {
    const hours = Number(input.long_open_shift_hours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 72) throw posError(400, "long_open_shift_hours must be a whole number of hours from 1 to 72.", "POS_SETTINGS_INVALID");
    changes.long_open_shift_hours = hours;
  }
  if (input.return_reasons !== undefined) {
    const reasons = Array.isArray(input.return_reasons) ? [...new Set(input.return_reasons.map((code) => String(code).toLowerCase()))] : [];
    if (!reasons.length || reasons.some((code) => !RETURN_REASON_CODES.includes(code))) throw posError(400, "return_reasons must list one or more known reasons.", "POS_SETTINGS_INVALID");
    changes.return_reasons = JSON.stringify(reasons);
  }
  if (input.return_restrictions !== undefined) {
    const list = Array.isArray(input.return_restrictions) ? input.return_restrictions : null;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!list || list.length > 500 || list.some((entry) => !["item", "category"].includes(entry?.type) || !uuid.test(String(entry?.id ?? "")) || !["blocked", "approval"].includes(entry?.mode)))
      throw posError(400, "return_restrictions is a list of { type: item | category, id, mode: blocked | approval }.", "POS_SETTINGS_INVALID");
    changes.return_restrictions = JSON.stringify(list.map((entry) => ({ type: entry.type, id: entry.id, mode: entry.mode })));
  }
  if (input.default_currency_code !== undefined) {
    const code = String(input.default_currency_code).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) throw posError(400, "default_currency_code must be a 3-letter currency code.", "POS_SETTINGS_INVALID");
    changes.default_currency_code = code;
  }
  return changes;
}

export async function updatePosSettings(client, context, input = {}) {
  requirePermission(context, "pos.settings.manage");
  const changes = normalizeSettingsInput(input);
  if (!Object.keys(changes).length) throw posError(400, "No settings were provided to change.", "POS_SETTINGS_EMPTY");

  // Cross-field rule: a supervisor-approval threshold ABOVE the hard cap can
  // never be reached (the cap rejects first), which is almost certainly a
  // typo rather than intent -- fail loudly instead of saving a dead setting.
  const current = await getPosSettings(client, context);
  const merged = { ...current.settings, ...changes };
  if (Number(merged.discount_approval_threshold_percent) > Number(merged.max_line_discount_percent)) {
    throw posError(
      409,
      "The supervisor-approval threshold cannot be higher than the maximum line discount — no discount could ever reach it.",
      "POS_SETTINGS_CONFLICT",
    );
  }

  const columns = Object.keys(changes);
  const insertColumns = ["organization_id", ...columns];
  const placeholders = insertColumns.map((_, index) => `$${index + 1}`);
  const values = [context.organizationId, ...columns.map((column) => changes[column])];
  const result = await client.query(
    `INSERT INTO tenant.pos_settings (${insertColumns.join(",")}) VALUES (${placeholders.join(",")})
     ON CONFLICT (organization_id) DO UPDATE SET ${columns.map((column) => `${column}=EXCLUDED.${column}`).join(",")},updated_at=now()
     RETURNING ${SETTINGS_COLUMNS.join(",")},updated_at`,
    values,
  );

  const before = Object.fromEntries(columns.map((column) => [column, current.settings[column]]));
  const after = Object.fromEntries(columns.map((column) => [column, result.rows[0][column]]));
  await event(client, context, "pos_settings", context.organizationId, "pos.settings.updated", { before, after });

  return {
    configured: true,
    updatedAt: result.rows[0].updated_at,
    settings: Object.fromEntries(SETTINGS_COLUMNS.map((column) => [column, result.rows[0][column]])),
  };
}
