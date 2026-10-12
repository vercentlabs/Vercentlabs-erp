// POS Returns (migration 0099): goods taken back against a completed sale. The original sale is never edited, deleted or recreated.
//
//  - Find the sale (receipt / invoice number, scanned receipt code, sale reference) and see what can still be returned: sold, already
//    returned, held by other open returns, and the original price, discounts and tax of each unit — never today's price.
//  - A return is prepared as a draft: per line the quantity (in the unit sold), one reason, the physical condition and the disposition of
//    the goods. Its quantities are claimed at once (two counters can never return the same last unit; a serial is never returned twice).
//  - The return policy decides which exceptions it carries — outside the return window, a restricted item, no receipt, another outlet, a high
//    value, a refund above the cashier's limit, or "every return is approved". An initiator holding RETURN_POLICY_OVERRIDE may override the
//    window or a restricted item with a reason; everything else waits for a supervisor (never the initiator) to approve that exact version.
//  - Inspection, when the company requires it, decides what happens to goods still on hold before any money is paid back.
//  - Posting, in one transaction: the amounts worked out again from the sale's snapshot (the return that takes a line's last units takes
//    exactly what is left, so returns always add up to the sale), stock received by disposition (never available unless restocked; services
//    move no stock), the sale's returned quantities, coupons and loyalty, the refund obligations, the credit note and the return receipt.
//  - Refunds keep their own status: card and UPI through the provider (processing / succeeded / failed / unknown — an unknown outcome is
//    never retried blindly), cash paid from the cashier's open session — immediately when the cashier confirms the cash was handed over,
//    else waiting for that confirmation; a payment the provider cannot refund (standalone machine, static QR) waits for Finance to record it.
import { createHash } from "node:crypto";

import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { beginIdempotentOperation, completeIdempotentOperation } from "../../../core/idempotency.js";
import { add, sub, mul, div, decimal, asDatabaseDecimal, roundMoney, formatDecimal } from "../../../core/decimal.js";
import { postStockMovement, moveStockWithinWarehouse } from "../../stock/index.js";
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess, accessiblePosStoreIds } from "../shared/access-control.js";
import { authorizePosAction } from "../permissions/index.js";
import { event } from "../shared/audit.js";
import { releasePosCouponRedemptionForFullReturn } from "../assortment-pricing-customer-and-cart/coupons.js";
import { reversePosLoyaltyForReturn } from "../assortment-pricing-customer-and-cart/loyalty.js";
import { allocateReturnRefund } from "../tender-and-payment-execution/split-payments.js";
import {
  createPosRefund, executePosRefund, confirmPosRefundCash, recordPosManualRefund, refreshPosRefund, retryPosRefundComponent, returnRefundStatus,
} from "../tender-and-payment-execution/refunds.js";
import { issuePosDocument, resolvePosReceiptFromCode } from "../transaction-continuity-and-documents/receipt-printing.js";
import { issuePosReturnCreditNote } from "../transaction-continuity-and-documents/gst-invoices.js";

export const POS_RETURN_MESSAGES = Object.freeze({
  POS_RETURN_DISABLED: "Returns are turned off for this company.",
  POS_RETURN_SALE_NOT_FOUND: "Transaction could not be found.",
  POS_RETURN_SALE_NOT_ELIGIBLE: "This sale cannot be returned.",
  POS_RETURN_SALE_FULLY_RETURNED: "Everything on this sale has already been returned.",
  POS_RETURN_LINES_REQUIRED: "Choose at least one item to return.",
  POS_RETURN_LINE_MISMATCH: "An item does not belong to this sale.",
  POS_RETURN_DUPLICATE_LINE: "An item appears twice on this return.",
  POS_RETURN_QUANTITY_EXCEEDED: "The quantity is more than can still be returned.",
  POS_RETURN_QUANTITY_INVALID: "Enter a quantity in the unit it was sold in.",
  POS_RETURN_PARTIAL_NOT_ALLOWED: "Partial returns are not allowed — return the whole line.",
  POS_RETURN_REASON_REQUIRED: "Choose a return reason for each item.",
  POS_RETURN_REASON_INVALID: "That return reason is not allowed.",
  POS_RETURN_REASON_NOTE_REQUIRED: "Describe the reason.",
  POS_RETURN_CONDITION_REQUIRED: "Record the condition of each returned item.",
  POS_RETURN_DISPOSITION_INVALID: "That stock disposition is not allowed for this item.",
  POS_RETURN_SERIAL_MISMATCH: "This serial number was not sold on this sale.",
  POS_RETURN_SERIAL_ALREADY_RETURNED: "This serial number has already been returned.",
  POS_RETURN_BATCH_EXPIRED: "An expired batch cannot go back into sellable stock.",
  POS_RETURN_ITEM_NOT_RETURNABLE: "This item cannot be returned.",
  POS_RETURN_NO_RECEIPT_NOT_ALLOWED: "Returns without a receipt are not allowed.",
  POS_RETURN_CROSS_OUTLET_NOT_ALLOWED: "This sale was made at another outlet; returns are taken only where the sale was made.",
  POS_RETURN_PERMISSION_DENIED: "You do not have permission to take this return.",
  POS_RETURN_APPROVAL_REQUIRED: "This return needs a supervisor's approval.",
  POS_RETURN_APPROVER_NOT_AUTHORIZED: "You are not authorized to approve this return.",
  POS_RETURN_SELF_APPROVAL: "You cannot approve a return you started.",
  POS_RETURN_INSPECTION_REQUIRED: "Inspect the returned goods before posting.",
  POS_RETURN_STATE_INVALID: "This return cannot be changed in its current state.",
  POS_RETURN_VERSION_CONFLICT: "This return changed. Review it again.",
  POS_RETURN_NOT_FOUND: "Return not found.",
  POS_RETURN_CASH_SESSION_REQUIRED: "Open your cash session to pay a cash refund.",
  POS_RETURN_HOLD_LOCATION_MISSING: "No non-sellable returns location is set up for this outlet.",
  POS_RETURN_REFUND_UNKNOWN: "The refund outcome is being checked with the provider. Do not refund again.",
  POS_RETURN_NOTHING_TO_CONFIRM: "There is no refund waiting for confirmation.",
});
const returnError = (status, code, detail = null) => posError(status, detail ? `${POS_RETURN_MESSAGES[code]} ${detail}` : POS_RETURN_MESSAGES[code], code);
const REASONS = ["damaged_product", "defective_product", "wrong_item", "wrong_size_variant", "customer_changed_mind", "quality_issue", "not_as_described", "other"];
const CONDITIONS = ["unopened", "good", "opened", "damaged", "defective"];
const DISPOSITIONS = ["return_hold", "restock_approved", "damaged", "quarantined", "rejected_not_received"];
const ACTIVE = ["draft", "awaiting_approval", "awaiting_inspection", "approved", "posting", "recovery_required"];
const LEGACY_STATUS = { draft: "draft", awaiting_approval: "pending_approval", awaiting_inspection: "approved", approved: "approved", posting: "approved", recovery_required: "approved",
  posted: "completed", rejected: "rejected", cancelled: "cancelled" };
// Exceptions and the supervisor grant that approves each.
const EXCEPTION_GRANT = { outside_window: "APPROVE_RETURN_POLICY_EXCEPTION", restricted_item: "APPROVE_RETURN_POLICY_EXCEPTION", cross_outlet: "APPROVE_RETURN_POLICY_EXCEPTION",
  high_value: "APPROVE_RETURN_POLICY_EXCEPTION", approval_policy: "APPROVE_RETURN_POLICY_EXCEPTION", no_receipt: "APPROVE_NO_RECEIPT_RETURN", refund_limit: "APPROVE_REFUND_EXCEPTION" };
const OVERRIDABLE = ["outside_window", "restricted_item"];
const EXCEPTION_LABEL = { outside_window: "Outside the return window", restricted_item: "Restricted item", cross_outlet: "Sold at another outlet", high_value: "High-value return",
  approval_policy: "Every return is approved", no_receipt: "No receipt", refund_limit: "Refund above the cashier's limit" };
const money = (value) => (value === null || value === undefined ? null : formatDecimal(decimal(String(value)), 2));
const posAdministrator = (context) => context.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug))
  || context.permissions?.includes("pos.store.manage") || context.permissions?.includes("pos.settings.manage");
const grantAllowed = async (client, context, request) => posAdministrator(context) || (await authorizePosAction(client, context, request)).decision === "ALLOW";

async function returnSettings(client, context) {
  const row = (await client.query(`SELECT * FROM tenant.pos_settings WHERE organization_id=$1`, [context.organizationId])).rows[0] ?? {};
  return {
    enabled: row.returns_enabled !== false, windowDays: row.return_window_days === undefined ? 30 : row.return_window_days, allowNoReceipt: row.allow_no_receipt_returns !== false,
    requireReason: row.require_return_reason !== false, requireCondition: row.require_return_condition !== false, allowPartial: row.allow_partial_returns !== false,
    allowCrossOutlet: row.allow_cross_outlet_returns === true, requireInspection: row.require_inspection_before_refund === true,
    approvalAbove: row.return_approval_above ?? null, approveAll: row.require_return_approval !== false, reasons: Array.isArray(row.return_reasons) ? row.return_reasons : REASONS,
    restrictions: Array.isArray(row.return_restrictions) ? row.return_restrictions : [],
  };
}

// ------------------------------------------------------------------ the sale and what can still be returned

async function saleFor(client, context, saleId, { lock = false } = {}) {
  const sale = (await client.query(`SELECT * FROM tenant.pos_sales WHERE organization_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`, [context.organizationId, saleId])).rows[0];
  if (!sale) throw returnError(404, "POS_RETURN_SALE_NOT_FOUND");
  await assertPosStoreAccess(client, context, sale.store_id);
  if (!["completed", "partially_returned", "returned"].includes(sale.status)) throw returnError(409, "POS_RETURN_SALE_NOT_ELIGIBLE", `It is ${sale.status}.`);
  return sale;
}

async function saleLinesFor(client, context, saleId, { lock = false, ids = null } = {}) {
  return (await client.query(
    `SELECT line.*, item.item_type, item.track_inventory, item.group_id, item.code AS item_code, unit.code AS uom_code, unit.decimal_places AS uom_decimals,
            batch.batch_number, batch.expires_on, serial.serial_number,
            COALESCE((SELECT sum(rl.quantity) FROM tenant.pos_return_lines rl WHERE rl.organization_id = line.organization_id AND rl.sale_line_id = line.id AND rl.claim_active), 0) AS claimed_quantity
       FROM tenant.pos_sale_lines line
       LEFT JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
       LEFT JOIN tenant.units_of_measure unit ON unit.organization_id = line.organization_id AND unit.id = line.uom_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id = line.organization_id AND batch.id = line.batch_id
       LEFT JOIN tenant.stock_serials serial ON serial.organization_id = line.organization_id AND serial.id = line.serial_id
      WHERE line.organization_id=$1 AND line.sale_id=$2 ${ids ? "AND line.id = ANY($3::uuid[])" : ""} ORDER BY line.line_number${lock ? " FOR UPDATE OF line" : ""}`,
    ids ? [context.organizationId, saleId, ids] : [context.organizationId, saleId])).rows;
}

const isStockItem = (line) => line.item_type !== "service" && line.track_inventory !== false;
function restrictionOf(settings, line) {
  const match = settings.restrictions.find((entry) => (entry.type === "item" && entry.id === line.item_id) || (entry.type === "category" && line.group_id && entry.id === line.group_id));
  return match ? (match.mode === "approval" ? "approval" : "blocked") : null;
}
function windowOf(settings, sale) {
  if (settings.windowDays === null || settings.windowDays === undefined) return { days: null, deadline: null, outside: false };
  const soldAt = new Date(sale.completed_at ?? sale.sale_date);
  const deadline = new Date(soldAt.getTime() + Number(settings.windowDays) * 86400000);
  return { days: Number(settings.windowDays), deadline: deadline.toISOString(), outside: Date.now() > deadline.getTime() };
}

// The share of a sale line that `quantity` gives back, from the sale's snapshot and the returns already posted on it. The return that
// takes the line's last units takes exactly what is left, so all returns of a line add up to what was charged.
async function lineAmounts(client, context, saleLine, quantity, excludeReturnId = null) {
  const sold = decimal(String(saleLine.quantity));
  const qty = decimal(String(quantity));
  const prior = (await client.query(
    `SELECT COALESCE(sum(rl.quantity), 0)::text AS quantity, COALESCE(sum(rl.refund_amount), 0)::text AS refund, COALESCE(sum(rl.tax_amount), 0)::text AS tax,
            COALESCE(sum(rl.discount_amount), 0)::text AS discount, COALESCE(sum(rl.cart_discount_amount), 0)::text AS cart_discount, COALESCE(sum(rl.gross_amount), 0)::text AS gross,
            COALESCE(jsonb_agg(rl.tax_components) FILTER (WHERE rl.tax_components IS NOT NULL), '[]'::jsonb) AS components
       FROM tenant.pos_return_lines rl JOIN tenant.pos_returns ret ON ret.organization_id = rl.organization_id AND ret.id = rl.return_id
      WHERE rl.organization_id = $1 AND rl.sale_line_id = $2 AND ret.lifecycle_status = 'posted' AND ($3::uuid IS NULL OR ret.id <> $3)`,
    [context.organizationId, saleLine.id, excludeReturnId])).rows[0];
  const last = add(decimal(prior.quantity), qty) >= sold;
  const share = (total, already) => (last ? sub(decimal(String(total ?? 0)), decimal(String(already ?? 0))) : roundMoney(div(mul(decimal(String(total ?? 0)), qty), sold), 2));
  const grossTotal = saleLine.gross_amount ?? asDatabaseDecimal(mul(sold, decimal(String(saleLine.list_unit_price ?? saleLine.unit_price ?? 0))));
  const refund = share(saleLine.line_total, prior.refund);
  const tax = share(saleLine.tax_amount, prior.tax);
  const components = Array.isArray(saleLine.tax_components) ? saleLine.tax_components : JSON.parse(saleLine.tax_components || "[]");
  const priorByType = new Map();
  for (const list of prior.components ?? []) for (const component of list ?? []) priorByType.set(component.type, add(priorByType.get(component.type) ?? 0n, decimal(String(component.taxAmount ?? 0))));
  let allocated = 0n;
  const returned = components.map((component, index) => {
    const amount = index === components.length - 1 ? sub(tax, allocated) : share(component.taxAmount, priorByType.get(component.type) ?? 0n);
    allocated = add(allocated, amount);
    return { type: component.type, label: component.label, rate: component.rate, taxAmount: asDatabaseDecimal(amount) };
  });
  return { refund, tax, taxable: sub(refund, tax), gross: share(grossTotal, prior.gross), discount: share(saleLine.discount_amount, prior.discount),
    cartDiscount: share(saleLine.cart_discount_amount, prior.cart_discount), components: returned };
}

const maskedPayments = (rows) => rows.map((row) => ({ method: row.payment_method, amount: money(row.amount), refunded: money(row.refunded_amount ?? 0),
  card: row.card_last_four ? `•••• ${row.card_last_four}` : null, reference: row.provider_transaction_reference ? `UTR …${String(row.provider_transaction_reference).slice(-4)}` : null }));

// What can still be returned from a sale, for the person at this outlet. storeId: the outlet taking the return (defaults to the sale's).
export async function getPosSaleReturnEligibility(client, context, saleId, input = {}) {
  requirePermission(context, "pos.view");
  const settings = await returnSettings(client, context);
  const sale = await saleFor(client, context, saleId);
  const lines = await saleLinesFor(client, context, sale.id);
  const payments = (await client.query(`SELECT * FROM tenant.pos_payments WHERE organization_id=$1 AND sale_id=$2 AND status NOT IN ('failed','voided') ORDER BY captured_at NULLS LAST`,
    [context.organizationId, sale.id])).rows;
  const window = windowOf(settings, sale);
  const processingStoreId = input.storeId ?? sale.store_id;
  const view = [];
  for (const line of lines) {
    const sold = decimal(String(line.quantity));
    const claimed = decimal(String(line.claimed_quantity));
    const returnable = sub(sold, claimed);
    const unit = returnable > 0n ? await lineAmounts(client, context, line, "1") : null;
    view.push({
      saleLineId: line.id, itemId: line.item_id, description: line.description, sku: line.sku ?? line.item_code ?? null, uom: line.uom_code ?? null,
      wholeUnits: Number(line.uom_decimals ?? 0) === 0, sold: asDatabaseDecimal(sold), returned: asDatabaseDecimal(decimal(String(line.returned_quantity ?? 0))),
      heldByOpenReturns: asDatabaseDecimal(sub(claimed, decimal(String(line.returned_quantity ?? 0)))), returnable: asDatabaseDecimal(returnable),
      unitPrice: money(line.list_unit_price ?? line.unit_price), lineTotal: money(line.line_total), discount: money(line.discount_amount), cartDiscount: money(line.cart_discount_amount),
      unitRefund: unit ? money(asDatabaseDecimal(unit.refund)) : null, unitTaxable: unit ? money(asDatabaseDecimal(unit.taxable)) : null, unitTax: unit ? money(asDatabaseDecimal(unit.tax)) : null,
      taxRate: line.tax_rate === null ? null : String(Number(line.tax_rate)), hsnSac: line.hsn_sac_snapshot ?? null,
      stockItem: isStockItem(line), serial: line.serial_id ? { id: line.serial_id, number: line.serial_number } : null,
      batch: line.batch_id ? { id: line.batch_id, number: line.batch_number, expiresOn: line.expires_on, expired: line.expires_on ? new Date(line.expires_on) < new Date(new Date().toDateString()) : false } : null,
      restriction: restrictionOf(settings, line),
    });
  }
  const anyReturnable = view.some((line) => decimal(line.returnable) > 0n && line.restriction !== "blocked");
  return {
    sale: { id: sale.id, receiptNumber: sale.receipt_number, invoiceNumber: sale.invoice_number ?? null, status: sale.status, soldAt: sale.completed_at ?? sale.sale_date,
      storeId: sale.store_id, grandTotal: money(sale.grand_total), currency: sale.currency_code, customerMode: sale.customer_mode,
      customer: sale.buyer_name_snapshot ?? (sale.customer_mode === "walk_in" ? "Walk-in customer" : null), documentType: sale.tax_document_type },
    payments: maskedPayments(payments), lines: view, returnable: anyReturnable, fullyReturned: !anyReturnable && view.every((line) => decimal(line.returnable) === 0n),
    window, crossOutlet: processingStoreId !== sale.store_id, crossOutletAllowed: settings.allowCrossOutlet,
    policy: { reasons: settings.reasons, requireReason: settings.requireReason, requireCondition: settings.requireCondition, allowPartial: settings.allowPartial,
      allowNoReceipt: settings.allowNoReceipt, requireInspection: settings.requireInspection, enabled: settings.enabled },
  };
}

// A receipt / invoice number, a scanned receipt code or a sale reference → the sale to return against.
export async function findPosSaleForReturn(client, context, input = {}) {
  requirePermission(context, "pos.view");
  const code = String(input.code ?? input.receiptNumber ?? "").trim();
  if (!code) throw posError(400, "Scan the receipt or enter its number.", "POS_RETURN_RECEIPT_REQUIRED");
  let saleId = null;
  if (/^POSR[0-9A-F]{10}$/i.test(code)) {
    const found = await resolvePosReceiptFromCode(client, context, code);
    saleId = found.saleId ?? (found.sourceType === "pos_sale" ? found.sourceId : null);
  } else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code)) {
    saleId = code.toLowerCase();
  } else {
    saleId = (await client.query(`SELECT id FROM tenant.pos_sales WHERE organization_id=$1 AND (receipt_number=$2 OR invoice_number=$2) ORDER BY (receipt_number=$2) DESC LIMIT 1`,
      [context.organizationId, code])).rows[0]?.id ?? null;
  }
  if (!saleId) throw returnError(404, "POS_RETURN_SALE_NOT_FOUND");
  return getPosSaleReturnEligibility(client, context, saleId, { storeId: input.storeId });
}

// ------------------------------------------------------------------ preparing a return

function defaultDisposition(condition, stockItem) {
  if (!stockItem) return "not_applicable";
  return { unopened: "restock_approved", good: "restock_approved", opened: "return_hold", damaged: "damaged", defective: "quarantined" }[condition] ?? "return_hold";
}

// Check and price the requested lines (quantities in the unit sold). Returns normalized lines and totals; throws on what no one may override.
async function buildLines(client, context, sale, saleLines, requested, settings, returnId = null) {
  if (!Array.isArray(requested) || !requested.length) throw returnError(400, "POS_RETURN_LINES_REQUIRED");
  const ids = requested.map((line) => line.saleLineId);
  if (new Set(ids).size !== ids.length) throw returnError(400, "POS_RETURN_DUPLICATE_LINE");
  const byId = new Map(saleLines.map((line) => [line.id, line]));
  const out = [];
  for (const input of requested) {
    const line = byId.get(input.saleLineId);
    if (!line) throw returnError(409, "POS_RETURN_LINE_MISMATCH");
    const qty = String(input.quantity ?? "").trim();
    if (!/^\d+(\.\d{1,6})?$/.test(qty) || decimal(qty) <= 0n) throw returnError(400, "POS_RETURN_QUANTITY_INVALID");
    if (Number(line.uom_decimals ?? 0) === 0 && decimal(qty) % 1000000n !== 0n) throw returnError(400, "POS_RETURN_QUANTITY_INVALID", `${line.description} is sold in whole ${line.uom_code ?? "units"}.`);
    const ownClaim = returnId ? decimal(String((await client.query(`SELECT COALESCE(sum(quantity),0)::text AS q FROM tenant.pos_return_lines WHERE organization_id=$1 AND return_id=$2 AND sale_line_id=$3 AND claim_active`,
      [context.organizationId, returnId, line.id])).rows[0].q)) : 0n;
    const remaining = add(sub(decimal(String(line.quantity)), decimal(String(line.claimed_quantity))), ownClaim);
    if (decimal(qty) > remaining) throw returnError(409, "POS_RETURN_QUANTITY_EXCEEDED", `${line.description}: ${asDatabaseDecimal(remaining)} can still be returned.`);
    if (!settings.allowPartial && decimal(qty) !== remaining) throw returnError(409, "POS_RETURN_PARTIAL_NOT_ALLOWED");
    if (restrictionOf(settings, line) === "blocked") throw returnError(409, "POS_RETURN_ITEM_NOT_RETURNABLE", line.description);
    const reason = input.reasonCode ? String(input.reasonCode).toLowerCase() : null;
    if (settings.requireReason && !reason) throw returnError(400, "POS_RETURN_REASON_REQUIRED");
    if (reason && (!REASONS.includes(reason) || !settings.reasons.includes(reason))) throw returnError(400, "POS_RETURN_REASON_INVALID");
    const note = input.reasonNote ? String(input.reasonNote).trim().slice(0, 300) || null : null;
    if (reason === "other" && !note) throw returnError(400, "POS_RETURN_REASON_NOTE_REQUIRED");
    const stockItem = isStockItem(line);
    const condition = stockItem ? (input.conditionCode ? String(input.conditionCode).toLowerCase() : null) : "not_applicable";
    if (stockItem && settings.requireCondition && !condition) throw returnError(400, "POS_RETURN_CONDITION_REQUIRED", line.description);
    if (condition && condition !== "not_applicable" && !CONDITIONS.includes(condition)) throw returnError(400, "POS_RETURN_CONDITION_REQUIRED");
    const disposition = stockItem ? (input.dispositionCode ? String(input.dispositionCode).toLowerCase() : defaultDisposition(condition, true)) : "not_applicable";
    checkDisposition(line, condition, disposition);
    if (line.serial_id) {
      if (decimal(qty) !== 1000000n) throw returnError(400, "POS_RETURN_QUANTITY_INVALID", "A serial-numbered item is returned one at a time.");
      if (input.serialId && input.serialId !== line.serial_id) throw returnError(409, "POS_RETURN_SERIAL_MISMATCH");
    }
    if (input.batchId && line.batch_id && input.batchId !== line.batch_id) throw returnError(409, "POS_RETURN_LINE_MISMATCH", "That batch was not sold on this line.");
    const amounts = await lineAmounts(client, context, line, qty, returnId);
    const factor = decimal(String(line.uom_factor ?? "1").match(/^\d+(?:\.\d{1,6})?/)?.[0] ?? "1");
    out.push({ line, quantity: qty, baseQuantity: asDatabaseDecimal(mul(decimal(qty), factor)), reason, note, condition, disposition, amounts, stockItem });
  }
  return out;
}
function checkDisposition(line, condition, disposition) {
  if (!isStockItem(line)) { if (disposition !== "not_applicable") throw returnError(400, "POS_RETURN_DISPOSITION_INVALID", "A service is not stock."); return; }
  if (!DISPOSITIONS.includes(disposition)) throw returnError(400, "POS_RETURN_DISPOSITION_INVALID");
  if (disposition === "restock_approved" && ["damaged", "defective"].includes(condition)) throw returnError(400, "POS_RETURN_DISPOSITION_INVALID", "Damaged or defective goods cannot be restocked.");
  if (disposition === "restock_approved" && line.expires_on && new Date(line.expires_on) < new Date(new Date().toDateString())) throw returnError(409, "POS_RETURN_BATCH_EXPIRED");
}

// The exceptions this return carries, and which of them the initiator's override already covers.
async function evaluatePolicy(client, context, { sale, settings, lines, receiptPresent, processingStoreId, refundTotal, overrideReason }) {
  const exceptions = [];
  if (windowOf(settings, sale).outside) exceptions.push("outside_window");
  if (lines.some((entry) => restrictionOf(settings, entry.line) === "approval")) exceptions.push("restricted_item");
  if (!receiptPresent) exceptions.push("no_receipt");
  if (processingStoreId !== sale.store_id) exceptions.push("cross_outlet");
  if (settings.approvalAbove !== null && decimal(String(refundTotal)) > decimal(String(settings.approvalAbove))) exceptions.push("high_value");
  if (refundTotal > 0n && !(await grantAllowed(client, context, { permission: "REFUND_INITIATE", outletId: processingStoreId, amount: asDatabaseDecimal(refundTotal) }))) exceptions.push("refund_limit");
  if (settings.approveAll) exceptions.push("approval_policy");
  const canOverride = Boolean(overrideReason) && await grantAllowed(client, context, { permission: "RETURN_POLICY_OVERRIDE", outletId: processingStoreId, reason: overrideReason });
  const overridden = canOverride ? exceptions.filter((code) => OVERRIDABLE.includes(code)) : [];
  return { exceptions, overridden, needsApproval: exceptions.filter((code) => !overridden.includes(code)) };
}

async function writeLines(client, context, returnId, lines) {
  // An unposted return's lines are replaced whole (nothing has moved for them yet).
  await client.query(`DELETE FROM tenant.pos_return_lines WHERE organization_id=$1 AND return_id=$2 AND stock_movement_id IS NULL`, [context.organizationId, returnId]);
  for (const entry of lines) {
    try {
      await client.query(
        `INSERT INTO tenant.pos_return_lines (organization_id, return_id, sale_line_id, quantity, refund_amount, restock, taxable_amount, tax_amount, tax_components, discount_amount,
           cart_discount_amount, gross_amount, item_id, uom_id, base_quantity, batch_id, serial_id, tracking_snapshot, reason_code, reason_note, condition_code, disposition_code, claim_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20,$21,$22,true)`,
        [context.organizationId, returnId, entry.line.id, entry.quantity, asDatabaseDecimal(entry.amounts.refund), entry.disposition === "restock_approved", asDatabaseDecimal(entry.amounts.taxable),
          asDatabaseDecimal(entry.amounts.tax), JSON.stringify(entry.amounts.components), asDatabaseDecimal(entry.amounts.discount), asDatabaseDecimal(entry.amounts.cartDiscount),
          asDatabaseDecimal(entry.amounts.gross), entry.line.item_id, entry.line.uom_id, entry.baseQuantity, entry.line.batch_id, entry.line.serial_id,
          JSON.stringify({ serial: entry.line.serial_number ?? null, batch: entry.line.batch_number ?? null, expiresOn: entry.line.expires_on ?? null }),
          entry.reason, entry.note, entry.condition, entry.disposition]);
    } catch (error) {
      if (error.constraint === "pos_return_lines_serial_claim_uidx") throw returnError(409, "POS_RETURN_SERIAL_ALREADY_RETURNED");
      if (error.constraint === "pos_return_line_quantity_claim") throw returnError(409, "POS_RETURN_QUANTITY_EXCEEDED");
      throw error;
    }
  }
}

function totalsOf(lines) {
  const sum = (key) => lines.reduce((total, entry) => add(total, entry.amounts[key]), 0n);
  return { refund: sum("refund"), tax: sum("tax"), taxable: sum("taxable") };
}

async function isFullReturn(client, context, saleId, returnId) {
  const row = (await client.query(
    `SELECT bool_and(COALESCE((SELECT sum(rl.quantity) FROM tenant.pos_return_lines rl WHERE rl.organization_id = line.organization_id AND rl.sale_line_id = line.id AND rl.claim_active), 0) >= line.quantity) AS full
       FROM tenant.pos_sale_lines line WHERE line.organization_id=$1 AND line.sale_id=$2`, [context.organizationId, saleId])).rows[0];
  void returnId;
  return Boolean(row?.full);
}

// Start a return. input: saleId, storeId (the outlet taking it; defaults to the sale's), receiptPresent (default true), lines [{ saleLineId,
// quantity, reasonCode, reasonNote, conditionCode, dispositionCode?, serialId?, batchId? }], reasonSummary, overrideReason, idempotencyKey.
export async function createPosReturn(client, context, input = {}) {
  requirePermission(context, "pos.view");
  const settings = await returnSettings(client, context);
  if (!settings.enabled) throw returnError(409, "POS_RETURN_DISABLED");
  const idempotency = await beginIdempotentOperation(client, context, { operation: "pos.return.create", key: input.idempotencyKey, payload: { ...input, idempotencyKey: undefined }, required: true });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };
  const sale = await saleFor(client, context, input.saleId, { lock: true });
  const processingStoreId = input.storeId ?? sale.store_id;
  await assertPosStoreAccess(client, context, processingStoreId);
  const receiptPresent = input.receiptPresent !== false;
  if (processingStoreId !== sale.store_id && !settings.allowCrossOutlet) throw returnError(409, "POS_RETURN_CROSS_OUTLET_NOT_ALLOWED");
  if (!receiptPresent && !settings.allowNoReceipt) throw returnError(409, "POS_RETURN_NO_RECEIPT_NOT_ALLOWED");
  const grant = receiptPresent ? "RETURN_WITH_RECEIPT" : "RETURN_WITHOUT_RECEIPT";
  if (!(await grantAllowed(client, context, { permission: grant, outletId: processingStoreId, reason: input.reasonSummary || input.overrideReason || (receiptPresent ? undefined : "")})))
    throw returnError(403, "POS_RETURN_PERMISSION_DENIED", receiptPresent ? "" : "A return without a receipt needs RETURN_WITHOUT_RECEIPT and a reason.");
  const saleLines = await saleLinesFor(client, context, sale.id, { lock: true, ids: (input.lines ?? []).map((line) => line.saleLineId) });
  const lines = await buildLines(client, context, sale, saleLines, input.lines, settings);
  const totals = totalsOf(lines);
  const overrideReason = input.overrideReason ? String(input.overrideReason).trim().slice(0, 300) || null : null;
  const policy = await evaluatePolicy(client, context, { sale, settings, lines, receiptPresent, processingStoreId, refundTotal: totals.refund, overrideReason });
  const returnNumber = await nextDocumentNumber(client, context, { documentType: "pos_return", prefix: "RET" });
  const shift = (await client.query(`SELECT id, terminal_id FROM tenant.pos_shifts WHERE organization_id=$1 AND store_id=$2 AND cashier_user_id=$3 AND status='open' ORDER BY opened_at DESC LIMIT 1`,
    [context.organizationId, processingStoreId, context.userId])).rows[0];
  const row = (await client.query(
    `INSERT INTO tenant.pos_returns (organization_id, store_id, terminal_id, shift_id, sale_id, return_number, reason, status, lifecycle_status, refund_total, requested_by, receipt_present,
       customer_id, original_invoice_id, sale_store_id, currency_code, return_value, tax_adjustment_amount, exceptions, override_reason, return_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'draft','draft',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,'partial') RETURNING *`,
    [context.organizationId, processingStoreId, shift?.terminal_id ?? sale.terminal_id, shift?.id ?? sale.shift_id, sale.id, returnNumber,
      input.reasonSummary ? String(input.reasonSummary).slice(0, 300) : lines.map((entry) => entry.reason).filter(Boolean).join(", ") || null, asDatabaseDecimal(totals.refund), context.userId,
      receiptPresent, sale.customer_id, sale.gst_invoice_id ?? null, sale.store_id, sale.currency_code, asDatabaseDecimal(totals.taxable), asDatabaseDecimal(totals.tax),
      JSON.stringify(policy.exceptions.map((code) => ({ code, overridden: policy.overridden.includes(code) }))), overrideReason])).rows[0];
  await writeLines(client, context, row.id, lines);
  if (await isFullReturn(client, context, sale.id, row.id)) await client.query(`UPDATE tenant.pos_returns SET return_type='full' WHERE id=$1`, [row.id]);
  await event(client, context, "return", row.id, "pos.return.created", { saleId: sale.id, refundTotal: asDatabaseDecimal(totals.refund), exceptions: policy.exceptions, receiptPresent });
  const response = await getPosReturn(client, context, row.id);
  await completeIdempotentOperation(client, context, idempotency, { response, aggregateType: "pos_return", aggregateId: row.id });
  return response;
}

async function lockReturn(client, context, returnId) {
  const row = (await client.query(`SELECT * FROM tenant.pos_returns WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, returnId])).rows[0];
  if (!row) throw returnError(404, "POS_RETURN_NOT_FOUND");
  await assertPosStoreAccess(client, context, row.store_id);
  return row;
}
const checkVersion = (row, expected) => { if (expected !== undefined && expected !== null && Number(expected) !== Number(row.version)) throw returnError(409, "POS_RETURN_VERSION_CONFLICT"); };
async function setState(client, context, row, lifecycle, extra = {}, sets = []) {
  const assignments = ["lifecycle_status=$3", "status=$4", "version=version+1", "updated_at=now()", ...sets];
  const values = [context.organizationId, row.id, lifecycle, LEGACY_STATUS[lifecycle], ...Object.values(extra)];
  Object.keys(extra).forEach((column, index) => assignments.push(`${column}=$${index + 5}`));
  return (await client.query(`UPDATE tenant.pos_returns SET ${assignments.join(", ")} WHERE organization_id=$1 AND id=$2 RETURNING *`, values)).rows[0];
}

// Change an unposted return (lines, receipt, override). Any change voids an approval: the return goes back to draft.
export async function updatePosReturn(client, context, returnId, input = {}) {
  requirePermission(context, "pos.view");
  const row = await lockReturn(client, context, returnId);
  checkVersion(row, input.expectedVersion);
  if (!["draft", "awaiting_approval", "awaiting_inspection", "approved"].includes(row.lifecycle_status)) throw returnError(409, "POS_RETURN_STATE_INVALID");
  const settings = await returnSettings(client, context);
  const sale = await saleFor(client, context, row.sale_id, { lock: true });
  const receiptPresent = input.receiptPresent === undefined ? row.receipt_present : input.receiptPresent !== false;
  if (!receiptPresent && !settings.allowNoReceipt) throw returnError(409, "POS_RETURN_NO_RECEIPT_NOT_ALLOWED");
  if (!(await grantAllowed(client, context, { permission: receiptPresent ? "RETURN_WITH_RECEIPT" : "RETURN_WITHOUT_RECEIPT", outletId: row.store_id, reason: input.overrideReason ?? row.reason ?? "" })))
    throw returnError(403, "POS_RETURN_PERMISSION_DENIED");
  const requested = input.lines ?? (await client.query(`SELECT sale_line_id AS "saleLineId", quantity::text AS quantity, reason_code AS "reasonCode", reason_note AS "reasonNote",
      condition_code AS "conditionCode", disposition_code AS "dispositionCode" FROM tenant.pos_return_lines WHERE organization_id=$1 AND return_id=$2 AND claim_active`, [context.organizationId, row.id])).rows;
  const saleLines = await saleLinesFor(client, context, sale.id, { lock: true, ids: requested.map((line) => line.saleLineId) });
  const lines = await buildLines(client, context, sale, saleLines, requested, settings, row.id);
  const totals = totalsOf(lines);
  const overrideReason = input.overrideReason === undefined ? row.override_reason : input.overrideReason ? String(input.overrideReason).trim().slice(0, 300) : null;
  const policy = await evaluatePolicy(client, context, { sale, settings, lines, receiptPresent, processingStoreId: row.store_id, refundTotal: totals.refund, overrideReason });
  await writeLines(client, context, row.id, lines);
  const saved = await setState(client, context, row, "draft", { refund_total: asDatabaseDecimal(totals.refund), return_value: asDatabaseDecimal(totals.taxable),
    tax_adjustment_amount: asDatabaseDecimal(totals.tax), receipt_present: receiptPresent, override_reason: overrideReason,
    exceptions: JSON.stringify(policy.exceptions.map((code) => ({ code, overridden: policy.overridden.includes(code) }))), return_type: (await isFullReturn(client, context, sale.id, row.id)) ? "full" : "partial" },
    ["approved_by=NULL", "approved_at=NULL", "approved_version=NULL"]);
  await event(client, context, "return", row.id, "pos.return.updated", { version: saved.version, refundTotal: asDatabaseDecimal(totals.refund) });
  return getPosReturn(client, context, row.id);
}

const needsApproval = (row) => (row.exceptions ?? []).filter((entry) => !entry.overridden).map((entry) => entry.code);
const inspectionPending = async (client, context, row, settings) => settings.requireInspection && (await client.query(
  `SELECT 1 FROM tenant.pos_return_lines WHERE organization_id=$1 AND return_id=$2 AND claim_active AND disposition_code = 'return_hold' LIMIT 1`, [context.organizationId, row.id])).rows.length > 0;

// Ask for a supervisor's approval of this version (no-op when none is needed).
export async function requestPosReturnApproval(client, context, returnId, input = {}) {
  requirePermission(context, "pos.view");
  const row = await lockReturn(client, context, returnId);
  checkVersion(row, input.expectedVersion);
  if (row.lifecycle_status !== "draft") throw returnError(409, "POS_RETURN_STATE_INVALID");
  if (!needsApproval(row).length) return getPosReturn(client, context, row.id);
  await setState(client, context, row, "awaiting_approval");
  await event(client, context, "return", row.id, "pos.return.approval_requested", { exceptions: needsApproval(row), version: row.version + 1 });
  return getPosReturn(client, context, row.id);
}

// A supervisor approves exactly this version: not the initiator, with the grant for every exception it carries (a refund above a limit
// within their own approval limit). Then the return waits for inspection if goods are still on hold and the company inspects first.
export async function approvePosReturn(client, context, returnId, input = {}) {
  requirePermission(context, "pos.view");
  const row = await lockReturn(client, context, returnId);
  checkVersion(row, input.expectedVersion);
  if (!["draft", "awaiting_approval"].includes(row.lifecycle_status)) throw returnError(409, "POS_RETURN_STATE_INVALID");
  if (row.requested_by === context.userId) throw returnError(403, "POS_RETURN_SELF_APPROVAL");
  if (!posAdministrator(context) && !context.permissions?.includes("pos.return.approve")) {
    for (const code of needsApproval(row)) {
      const decision = await authorizePosAction(client, context, { permission: EXCEPTION_GRANT[code], outletId: row.store_id, amount: code === "refund_limit" ? row.refund_total : undefined });
      if (decision.decision !== "ALLOW") throw returnError(403, "POS_RETURN_APPROVER_NOT_AUTHORIZED", EXCEPTION_LABEL[code]);
    }
    if (!needsApproval(row).length) throw returnError(403, "POS_RETURN_APPROVER_NOT_AUTHORIZED");
  }
  const settings = await returnSettings(client, context);
  const next = (await inspectionPending(client, context, row, settings)) ? "awaiting_inspection" : "approved";
  const saved = await setState(client, context, row, next, { approved_by: context.userId, approval_note: input.note ? String(input.note).slice(0, 300) : null },
    ["approved_at=now()", "approved_version=version+1"]);
  await event(client, context, "return", row.id, "pos.return.approved", { version: saved.version, exceptions: needsApproval(row), note: input.note ?? null });
  return getPosReturn(client, context, row.id);
}

export async function rejectPosReturn(client, context, returnId, input = {}) {
  requirePermission(context, "pos.view");
  const row = await lockReturn(client, context, returnId);
  checkVersion(row, input.expectedVersion);
  if (!["draft", "awaiting_approval", "awaiting_inspection", "approved"].includes(row.lifecycle_status)) throw returnError(409, "POS_RETURN_STATE_INVALID");
  if (row.requested_by === context.userId) throw returnError(403, "POS_RETURN_SELF_APPROVAL");
  if (!posAdministrator(context) && !context.permissions?.includes("pos.return.approve")) {
    const any = await authorizePosAction(client, context, { permission: "APPROVE_RETURN_POLICY_EXCEPTION", outletId: row.store_id });
    if (any.decision === "DENY" && any.reasonCode !== "POS_PERMISSION_LIMIT_EXCEEDED") throw returnError(403, "POS_RETURN_APPROVER_NOT_AUTHORIZED");
  }
  const reason = String(input.reason ?? "").trim();
  if (!reason) throw posError(400, "Say why the return is rejected.", "POS_REASON_REQUIRED");
  await client.query(`UPDATE tenant.pos_return_lines SET claim_active=false WHERE organization_id=$1 AND return_id=$2`, [context.organizationId, row.id]);
  await setState(client, context, row, "rejected", { rejected_by: context.userId, rejection_reason: reason.slice(0, 300) }, ["rejected_at=now()"]);
  await event(client, context, "return", row.id, "pos.return.rejected", { reason });
  return getPosReturn(client, context, row.id);
}

export async function cancelPosReturn(client, context, returnId, input = {}) {
  requirePermission(context, "pos.view");
  const row = await lockReturn(client, context, returnId);
  checkVersion(row, input.expectedVersion);
  if (!["draft", "awaiting_approval", "awaiting_inspection", "approved"].includes(row.lifecycle_status)) throw returnError(409, "POS_RETURN_STATE_INVALID", "A posted return is never cancelled.");
  if (row.requested_by !== context.userId && !posAdministrator(context) && !context.permissions?.includes("pos.return.approve")) throw returnError(403, "POS_RETURN_PERMISSION_DENIED");
  await client.query(`UPDATE tenant.pos_return_lines SET claim_active=false WHERE organization_id=$1 AND return_id=$2`, [context.organizationId, row.id]);
  await setState(client, context, row, "cancelled", { cancelled_by: context.userId, cancel_reason: input.reason ? String(input.reason).slice(0, 300) : null }, ["cancelled_at=now()"]);
  await event(client, context, "return", row.id, "pos.return.cancelled", { reason: input.reason ?? null });
  return getPosReturn(client, context, row.id);
}

// Inspection: the condition and final disposition of goods (restock, damaged, quarantine, not received). Changes no money and keeps an
// approval: what happens to the goods is not a commercial change. lines: [{ lineId, conditionCode?, dispositionCode }].
export async function recordPosReturnInspection(client, context, returnId, input = {}) {
  requirePermission(context, "pos.view");
  const row = await lockReturn(client, context, returnId);
  checkVersion(row, input.expectedVersion);
  if (!["draft", "awaiting_approval", "awaiting_inspection", "approved"].includes(row.lifecycle_status)) throw returnError(409, "POS_RETURN_STATE_INVALID");
  if (!posAdministrator(context) && !context.permissions?.includes("pos.return.approve")
      && !(await grantAllowed(client, context, { permission: "APPROVE_RETURN_POLICY_EXCEPTION", outletId: row.store_id }))) throw returnError(403, "POS_RETURN_PERMISSION_DENIED", "Inspection needs a supervisor.");
  const lines = (await client.query(
    `SELECT rl.*, sl.expires_on, sl.item_type, sl.track_inventory FROM tenant.pos_return_lines rl
       JOIN (SELECT line.id, batch.expires_on, item.item_type, item.track_inventory FROM tenant.pos_sale_lines line
               LEFT JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
               LEFT JOIN tenant.stock_batches batch ON batch.organization_id = line.organization_id AND batch.id = line.batch_id WHERE line.organization_id = $1) sl ON sl.id = rl.sale_line_id
      WHERE rl.organization_id=$1 AND rl.return_id=$2 AND rl.claim_active`, [context.organizationId, row.id])).rows;
  for (const change of input.lines ?? []) {
    const line = lines.find((entry) => entry.id === change.lineId);
    if (!line) throw returnError(409, "POS_RETURN_LINE_MISMATCH");
    const condition = change.conditionCode ? String(change.conditionCode).toLowerCase() : line.condition_code;
    const disposition = String(change.dispositionCode ?? line.disposition_code).toLowerCase();
    checkDisposition(line, condition, disposition);
    await client.query(`UPDATE tenant.pos_return_lines SET condition_code=$3, disposition_code=$4, restock=$5 WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, line.id, condition, disposition, disposition === "restock_approved"]);
  }
  const settings = await returnSettings(client, context);
  const next = row.lifecycle_status === "awaiting_inspection" && !(await inspectionPending(client, context, row, settings)) ? "approved" : row.lifecycle_status;
  await client.query(`UPDATE tenant.pos_returns SET lifecycle_status=$3, status=$4, inspected_by=$5, inspected_at=now(), version=version+1, updated_at=now(),
      approved_version=CASE WHEN approved_version IS NOT NULL THEN approved_version + 1 END WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, row.id, next, LEGACY_STATUS[next], context.userId]);
  await event(client, context, "return", row.id, "pos.return.inspected", { lines: (input.lines ?? []).map((change) => ({ lineId: change.lineId, disposition: change.dispositionCode })) });
  return getPosReturn(client, context, row.id);
}

// ------------------------------------------------------------------ posting

// Where returned goods go: restocked into the outlet's selling location; held, quarantined or damaged into a non-sellable location (one with
// that disposition in the warehouse, else the outlet's returns location — never a sellable one).
async function locationFor(client, context, { warehouseId, sellingLocationId, returnsLocationId }, disposition) {
  if (disposition === "restock_approved") return sellingLocationId;
  const wanted = { damaged: ["damaged"], quarantined: ["quarantined", "quality_hold"], return_hold: ["quality_hold", "quarantined"] }[disposition];
  const byDisposition = (await client.query(
    `SELECT id FROM tenant.warehouse_locations WHERE organization_id=$1 AND warehouse_id=$2 AND status='active' AND disposition = ANY($3::text[])
      ORDER BY (id = $4::uuid) DESC, array_position($3::text[], disposition), code LIMIT 1`, [context.organizationId, warehouseId, wanted, returnsLocationId ?? null])).rows[0]?.id;
  if (byDisposition) return byDisposition;
  if (returnsLocationId) {
    const returns = (await client.query(`SELECT disposition FROM tenant.warehouse_locations WHERE organization_id=$1 AND id=$2`, [context.organizationId, returnsLocationId])).rows[0];
    if (returns && returns.disposition !== "available") return returnsLocationId;
  }
  throw returnError(409, "POS_RETURN_HOLD_LOCATION_MISSING");
}

const stockContext = (context) => ({ ...context, permissions: [...new Set([...(context.permissions || []), "stock.receive", "stock.issue", "stock.adjust"])] });

// Post the return. input: expectedVersion, cashRefundConfirmed (the cash was handed to the customer now), idempotencyKey, refundOutcome
// (sandbox scripting only).
export async function postPosReturn(client, context, returnId, input = {}) {
  requirePermission(context, "pos.view");
  const idempotency = await beginIdempotentOperation(client, context, { operation: "pos.return.post", key: input.idempotencyKey, payload: { returnId, cash: Boolean(input.cashRefundConfirmed) }, required: true });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };
  const row = await lockReturn(client, context, returnId);
  if (row.lifecycle_status === "posted") {
    const response = await getPosReturn(client, context, row.id);
    await completeIdempotentOperation(client, context, idempotency, { response, aggregateType: "pos_return", aggregateId: row.id });
    return { ...response, replayed: true };
  }
  checkVersion(row, input.expectedVersion);
  if (!["draft", "approved"].includes(row.lifecycle_status)) {
    throw returnError(409, row.lifecycle_status === "awaiting_inspection" ? "POS_RETURN_INSPECTION_REQUIRED" : row.lifecycle_status === "awaiting_approval" ? "POS_RETURN_APPROVAL_REQUIRED" : "POS_RETURN_STATE_INVALID");
  }
  const settings = await returnSettings(client, context);
  const approvalNeeded = needsApproval(row);
  if (approvalNeeded.length && !(row.lifecycle_status === "approved" && Number(row.approved_version) === Number(row.version))) throw returnError(409, "POS_RETURN_APPROVAL_REQUIRED",
    approvalNeeded.map((code) => EXCEPTION_LABEL[code]).join(", "));
  if (await inspectionPending(client, context, row, settings)) throw returnError(409, "POS_RETURN_INSPECTION_REQUIRED");
  // Permission is checked again now, not only when the return was started.
  if (!(await grantAllowed(client, context, { permission: row.receipt_present ? "RETURN_WITH_RECEIPT" : "RETURN_WITHOUT_RECEIPT", outletId: row.store_id, reason: row.reason ?? "return" })))
    throw returnError(403, "POS_RETURN_PERMISSION_DENIED");
  const sale = await saleFor(client, context, row.sale_id, { lock: true });
  const returnLines = (await client.query(`SELECT * FROM tenant.pos_return_lines WHERE organization_id=$1 AND return_id=$2 AND claim_active ORDER BY created_at, id`, [context.organizationId, row.id])).rows;
  if (!returnLines.length) throw returnError(409, "POS_RETURN_LINES_REQUIRED");
  const saleLines = await saleLinesFor(client, context, sale.id, { lock: true, ids: returnLines.map((line) => line.sale_line_id) });
  const byId = new Map(saleLines.map((line) => [line.id, line]));
  const store = (await client.query(`SELECT warehouse_id, selling_location_id, returns_location_id FROM tenant.pos_stores WHERE organization_id=$1 AND id=$2`, [context.organizationId, row.store_id])).rows[0];

  // Final amounts from the sale's snapshot and the returns posted before this one.
  let refundTotal = 0n; let taxTotal = 0n; let taxableTotal = 0n;
  for (const line of returnLines) {
    const saleLine = byId.get(line.sale_line_id);
    const amounts = await lineAmounts(client, context, saleLine, String(line.quantity), row.id);
    refundTotal = add(refundTotal, amounts.refund); taxTotal = add(taxTotal, amounts.tax); taxableTotal = add(taxableTotal, amounts.taxable);
    await client.query(`UPDATE tenant.pos_return_lines SET refund_amount=$3, taxable_amount=$4, tax_amount=$5, tax_components=$6::jsonb, discount_amount=$7, cart_discount_amount=$8, gross_amount=$9
      WHERE organization_id=$1 AND id=$2`, [context.organizationId, line.id, asDatabaseDecimal(amounts.refund), asDatabaseDecimal(amounts.taxable), asDatabaseDecimal(amounts.tax),
      JSON.stringify(amounts.components), asDatabaseDecimal(amounts.discount), asDatabaseDecimal(amounts.cartDiscount), asDatabaseDecimal(amounts.gross)]);
    // Stock, by disposition. Never available unless restocked; services and goods not received move nothing.
    if (["restock_approved", "return_hold", "damaged", "quarantined"].includes(line.disposition_code) && isStockItem(saleLine) && !line.stock_movement_id) {
      const sameOutlet = row.store_id === sale.store_id;
      const warehouseId = sameOutlet ? saleLine.warehouse_id : store.warehouse_id;
      const locationId = await locationFor(client, context, { warehouseId, sellingLocationId: sameOutlet ? (saleLine.warehouse_location_id ?? store.selling_location_id) : store.selling_location_id,
        returnsLocationId: store.returns_location_id }, line.disposition_code);
      const unitCost = (await client.query(`SELECT unit_cost FROM tenant.stock_movements WHERE organization_id=$1 AND id=$2`, [context.organizationId, saleLine.stock_movement_id])).rows[0]?.unit_cost ?? 0;
      const factor = decimal(String(saleLine.uom_factor ?? "1").match(/^\d+(?:\.\d{1,6})?/)?.[0] ?? "1");
      const movement = await postStockMovement(client, stockContext(context), {
        movementType: "receipt", ledgerType: "sales_return", itemId: saleLine.item_id, warehouseId, warehouseLocationId: locationId, batchId: saleLine.batch_id, serialId: saleLine.serial_id,
        quantity: asDatabaseDecimal(mul(decimal(String(line.quantity)), factor)), unitCost: Number(unitCost || 0), referenceType: "pos_return", referenceId: row.id,
        reason: `POS return ${row.return_number} — ${line.disposition_code.replace(/_/g, " ")}`, idempotencyKey: `pos-return:${row.id}:line:${line.id}:receipt`,
      });
      await client.query(`UPDATE tenant.pos_return_lines SET stock_movement_id=$3, stock_location_id=$4 WHERE organization_id=$1 AND id=$2`, [context.organizationId, line.id, movement.id, locationId]);
    }
    const moved = await client.query(`UPDATE tenant.pos_sale_lines SET returned_quantity=returned_quantity+$3 WHERE organization_id=$1 AND id=$2 AND returned_quantity+$3 <= quantity RETURNING id`,
      [context.organizationId, saleLine.id, String(line.quantity)]);
    if (!moved.rows[0]) throw returnError(409, "POS_RETURN_QUANTITY_EXCEEDED");
  }
  // A refund above the poster's own limit needs the approved refund-limit exception.
  if (refundTotal > 0n && !approvalNeeded.includes("refund_limit")
      && !(await grantAllowed(client, context, { permission: "REFUND_INITIATE", outletId: row.store_id, amount: asDatabaseDecimal(refundTotal) })))
    throw returnError(409, "POS_RETURN_APPROVAL_REQUIRED", EXCEPTION_LABEL.refund_limit);

  const fullyReturned = Boolean((await client.query(`SELECT bool_and(returned_quantity >= quantity) AS full FROM tenant.pos_sale_lines WHERE organization_id=$1 AND sale_id=$2`,
    [context.organizationId, sale.id])).rows[0]?.full);
  await client.query(`UPDATE tenant.pos_sales SET status=$3 WHERE organization_id=$1 AND id=$2`, [context.organizationId, sale.id, fullyReturned ? "returned" : "partially_returned"]);
  if (fullyReturned) await releasePosCouponRedemptionForFullReturn(client, context, sale.id);
  if (sale.customer_id) {
    await reversePosLoyaltyForReturn(client, context, { returnId: row.id, saleId: sale.id, customerId: sale.customer_id, programId: sale.loyalty_program_id,
      returnedLines: returnLines.map((line) => ({ saleLineId: line.sale_line_id, soldQuantity: byId.get(line.sale_line_id).quantity, returnQuantity: line.quantity,
        redeemPoints: byId.get(line.sale_line_id).loyalty_redeem_points })) });
  }
  const postingShift = await cashSessionFor(client, context, row);
  await client.query(`UPDATE tenant.pos_returns SET refund_total=$3, return_value=$4, tax_adjustment_amount=$5, posting_shift_id=$6, updated_at=now() WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, row.id, asDatabaseDecimal(refundTotal), asDatabaseDecimal(taxableTotal), asDatabaseDecimal(taxTotal), postingShift?.id ?? null]);

  await client.query(`UPDATE tenant.pos_returns SET lifecycle_status='posted', status='completed', posted_by=$3, posted_at=now(), completed_by=$3, completed_at=now(), refund_status=$4,
      version=version+1, updated_at=now() WHERE organization_id=$1 AND id=$2`, [context.organizationId, row.id, context.userId, refundTotal > 0n ? "not_initiated" : "not_required"]);
  // Refunds (0100): the money is a refund of its own — created for the return's whole refund (already approved with the return when it was
  // above the poster's limit) and executed now, unless the cashier refunds later from the return (initiateRefund: false).
  let refundStatus = refundTotal > 0n ? "not_initiated" : "not_required";
  if (refundTotal > 0n && input.initiateRefund !== false) {
    const refund = await createPosRefund(client, context, "pos_return", row.id, { idempotencyKey: `${input.idempotencyKey}:refund`, preApproved: true, reasonCode: "return_refund" });
    await executePosRefund(client, context, refund.id, { cashPayoutConfirmed: Boolean(input.cashRefundConfirmed), outcome: input.refundOutcome, fallbackShiftId: postingShift?.id ?? row.shift_id });
    refundStatus = await returnRefundStatus(client, context, row.id);
  }
  await event(client, context, "return", row.id, "pos.return.posted", { refundTotal: asDatabaseDecimal(refundTotal), refundStatus, saleStatus: fullyReturned ? "returned" : "partially_returned" });
  await issuePosReturnCreditNote(client, context, row.id);
  await issuePosDocument(client, context, "pos_return", row.id);
  const response = await getPosReturn(client, context, row.id);
  await completeIdempotentOperation(client, context, idempotency, { response, aggregateType: "pos_return", aggregateId: row.id });
  return response;
}

// The drawer the return's refunds may be paid from: the poster's own open session at the outlet, else the open session the return was taken
// at (a supervisor posting at the cashier's counter).
async function cashSessionFor(client, context, ret) {
  const own = (await client.query(`SELECT id, terminal_id FROM tenant.pos_shifts WHERE organization_id=$1 AND store_id=$2 AND cashier_user_id=$3 AND status='open' ORDER BY opened_at DESC LIMIT 1`,
    [context.organizationId, ret.store_id, context.userId])).rows[0];
  if (own) return own;
  return (await client.query(`SELECT id, terminal_id FROM tenant.pos_shifts WHERE organization_id=$1 AND id=$2 AND store_id=$3 AND status='open'`,
    [context.organizationId, ret.shift_id, ret.store_id])).rows[0] ?? null;
}

const refundsOf = async (client, context, returnId) => (await client.query(
  `SELECT id, status FROM tenant.payment_refunds WHERE organization_id=$1 AND source_type='pos_return' AND source_id=$2 AND status <> 'cancelled' ORDER BY created_at`,
  [context.organizationId, returnId])).rows;

// Refund a posted return now (when it was posted without refunding, or after a refund was cancelled): the rest of what it owes.
export async function initiatePosReturnRefund(client, context, returnId, input = {}) {
  requirePermission(context, "pos.view");
  const ret = await lockReturn(client, context, returnId);
  if (ret.lifecycle_status !== "posted") throw returnError(409, "POS_RETURN_STATE_INVALID");
  const refund = await createPosRefund(client, context, "pos_return", ret.id, { amount: input.amount, reasonCode: "return_refund", reasonNote: input.reasonNote,
    idempotencyKey: input.idempotencyKey, preApproved: Boolean(input.preApproved) });
  if (refund.status === "AUTHORIZED" && input.execute !== false)
    await executePosRefund(client, context, refund.id, { cashPayoutConfirmed: Boolean(input.cashRefundConfirmed), outcome: input.refundOutcome, fallbackShiftId: (await cashSessionFor(client, context, ret))?.id ?? ret.shift_id });
  await client.query(`UPDATE tenant.pos_returns SET refund_status=$3, updated_at=now() WHERE organization_id=$1 AND id=$2`, [context.organizationId, ret.id, await returnRefundStatus(client, context, ret.id)]);
  return getPosReturn(client, context, ret.id);
}

// Confirm a waiting refund of the return: cash handed to the customer (from an open session), or — for reconciliation users — a refund made
// outside the provider with its reference. Each once.
export async function confirmPosReturnRefund(client, context, returnId, input = {}) {
  requirePermission(context, "pos.view");
  const ret = await lockReturn(client, context, returnId);
  if (ret.lifecycle_status !== "posted") throw returnError(409, "POS_RETURN_STATE_INVALID");
  const waiting = (await client.query(
    `SELECT component.id, component.refund_id, component.execution FROM tenant.payment_refund_components component
       JOIN tenant.payment_refunds refund ON refund.organization_id = component.organization_id AND refund.id = component.refund_id
      WHERE refund.organization_id=$1 AND refund.source_type='pos_return' AND refund.source_id=$2 AND refund.status <> 'cancelled' AND component.status='pending'
        AND ($3::uuid IS NULL OR component.payment_id=$3)`, [context.organizationId, ret.id, input.paymentId ?? null])).rows;
  if (!waiting.length) throw returnError(409, "POS_RETURN_NOTHING_TO_CONFIRM");
  const shift = await cashSessionFor(client, context, ret);
  for (const component of waiting) {
    if (component.execution === "cash") await confirmPosRefundCash(client, context, component.refund_id, { componentId: component.id, fallbackShiftId: shift?.id ?? ret.shift_id });
    else if (component.execution === "manual") {
      if (!input.externalReference) throw posError(400, "Enter the reference of the refund made outside the provider.", "POS_RETURN_REFUND_REFERENCE_REQUIRED");
      await recordPosManualRefund(client, context, component.refund_id, { componentId: component.id, reference: input.externalReference });
    }
  }
  return getPosReturn(client, context, ret.id);
}

// Try again the refunds that failed. A refund still processing or with an unknown outcome is asked of the provider, never sent again.
export async function retryPosReturnRefunds(client, context, returnId, input = {}) {
  requirePermission(context, "pos.view");
  const ret = await lockReturn(client, context, returnId);
  if (ret.lifecycle_status !== "posted") throw returnError(409, "POS_RETURN_STATE_INVALID");
  let retried = 0;
  let unknown = false;
  for (const refund of await refundsOf(client, context, ret.id)) {
    await refreshPosRefund(client, context, refund.id);
    const states = (await client.query(`SELECT status FROM tenant.payment_refund_components WHERE organization_id=$1 AND refund_id=$2`, [context.organizationId, refund.id])).rows.map((row) => row.status);
    if (states.includes("failed")) { await retryPosRefundComponent(client, context, refund.id, { outcome: input.refundOutcome }); retried += 1; }
    else if (states.includes("unknown")) unknown = true;
  }
  if (!retried && unknown) throw returnError(409, "POS_RETURN_REFUND_UNKNOWN");
  await client.query(`UPDATE tenant.pos_returns SET refund_status=$3, updated_at=now() WHERE organization_id=$1 AND id=$2`, [context.organizationId, ret.id, await returnRefundStatus(client, context, ret.id)]);
  await event(client, context, "return", ret.id, "pos.return.refund_retried", { retried });
  return getPosReturn(client, context, ret.id);
}

// After posting: goods held for inspection are released — back to sellable stock, or to damaged / quarantined stock. Moves stock inside the
// warehouse only; no money changes.
export async function releasePosReturnStock(client, context, returnId, input = {}) {
  requirePermission(context, "pos.view");
  const ret = await lockReturn(client, context, returnId);
  if (ret.lifecycle_status !== "posted") throw returnError(409, "POS_RETURN_STATE_INVALID");
  if (!posAdministrator(context) && !context.permissions?.includes("pos.return.approve")
      && !(await grantAllowed(client, context, { permission: "APPROVE_RETURN_POLICY_EXCEPTION", outletId: ret.store_id }))) throw returnError(403, "POS_RETURN_PERMISSION_DENIED");
  const line = (await client.query(`SELECT rl.*, sl.batch_id AS sale_batch_id, sl.warehouse_location_id AS sale_location_id, sl.warehouse_id AS sale_warehouse_id, batch.expires_on
      FROM tenant.pos_return_lines rl JOIN tenant.pos_sale_lines sl ON sl.organization_id = rl.organization_id AND sl.id = rl.sale_line_id
      LEFT JOIN tenant.stock_batches batch ON batch.organization_id = sl.organization_id AND batch.id = sl.batch_id
     WHERE rl.organization_id=$1 AND rl.return_id=$2 AND rl.id=$3 FOR UPDATE OF rl`, [context.organizationId, ret.id, input.lineId])).rows[0];
  if (!line) throw returnError(409, "POS_RETURN_LINE_MISMATCH");
  if (!line.stock_movement_id || !["return_hold", "quarantined"].includes(line.disposition_code) || line.released_movement_id) throw returnError(409, "POS_RETURN_STATE_INVALID", "Only goods still on hold can be released.");
  const disposition = String(input.dispositionCode ?? "").toLowerCase();
  if (!["restock_approved", "damaged", "quarantined"].includes(disposition) || disposition === line.disposition_code) throw returnError(400, "POS_RETURN_DISPOSITION_INVALID");
  checkDisposition({ item_type: "product", track_inventory: true, expires_on: line.expires_on }, line.condition_code, disposition);
  const movement = (await client.query(`SELECT warehouse_id, quantity FROM tenant.stock_movements WHERE organization_id=$1 AND id=$2`, [context.organizationId, line.stock_movement_id])).rows[0];
  const store = (await client.query(`SELECT selling_location_id, returns_location_id FROM tenant.pos_stores WHERE organization_id=$1 AND id=$2`, [context.organizationId, ret.store_id])).rows[0];
  const to = await locationFor(client, context, { warehouseId: movement.warehouse_id, sellingLocationId: ret.store_id === ret.sale_store_id ? (line.sale_location_id ?? store.selling_location_id) : store.selling_location_id,
    returnsLocationId: store.returns_location_id }, disposition);
  const moved = await moveStockWithinWarehouse(client, stockContext(context), { itemId: line.item_id, warehouseId: movement.warehouse_id, fromLocationId: line.stock_location_id, toLocationId: to,
    batchId: line.batch_id, serialIds: line.serial_id ? [line.serial_id] : undefined, quantity: String(Math.abs(Number(movement.quantity))), referenceType: "pos_return", referenceId: ret.id,
    reason: `POS return ${ret.return_number} — released: ${disposition.replace(/_/g, " ")}`, idempotencyKey: `pos-return:${ret.id}:line:${line.id}:release` });
  const movedId = moved?.movements?.[moved.movements.length - 1]?.id ?? null;
  await client.query(`UPDATE tenant.pos_return_lines SET released_movement_id=$3, released_disposition=$4 WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, line.id, movedId, disposition]);
  await event(client, context, "return", ret.id, "pos.return.stock_released", { lineId: line.id, disposition });
  return getPosReturn(client, context, ret.id);
}

// ------------------------------------------------------------------ reading

const lineView = (line) => ({
  id: line.id, saleLineId: line.sale_line_id, description: line.description, quantity: String(Number(line.quantity)), uom: line.uom_code ?? null,
  reasonCode: line.reason_code, reasonNote: line.reason_note, conditionCode: line.condition_code, dispositionCode: line.disposition_code, releasedDisposition: line.released_disposition,
  grossAmount: money(line.gross_amount), discount: money(line.discount_amount), cartDiscount: money(line.cart_discount_amount), taxableAmount: money(line.taxable_amount), taxAmount: money(line.tax_amount),
  refundAmount: money(line.refund_amount), serial: line.tracking_snapshot?.serial ?? null, batch: line.tracking_snapshot?.batch ?? null, stockMoved: Boolean(line.stock_movement_id), hsnSac: line.hsn_sac_snapshot ?? null,
});

export async function getPosReturn(client, context, returnId) {
  requirePermission(context, "pos.view");
  const row = (await client.query(
    `SELECT ret.*, sale.receipt_number, sale.invoice_number, sale.completed_at AS sale_completed_at, sale.grand_total AS sale_total, requester.full_name AS requested_by_name,
            approver.full_name AS approved_by_name, poster.full_name AS posted_by_name, store.name AS store_name
       FROM tenant.pos_returns ret JOIN tenant.pos_sales sale ON sale.organization_id = ret.organization_id AND sale.id = ret.sale_id
       LEFT JOIN public.users requester ON requester.id = ret.requested_by LEFT JOIN public.users approver ON approver.id = ret.approved_by
       LEFT JOIN public.users poster ON poster.id = ret.posted_by LEFT JOIN tenant.pos_stores store ON store.organization_id = ret.organization_id AND store.id = ret.store_id
      WHERE ret.organization_id=$1 AND ret.id=$2`, [context.organizationId, returnId])).rows[0];
  if (!row) throw returnError(404, "POS_RETURN_NOT_FOUND");
  await assertPosStoreAccess(client, context, row.store_id);
  if (row.lifecycle_status === "posted") row.refund_status = await returnRefundStatus(client, context, row.id);
  const lines = (await client.query(
    `SELECT rl.*, sl.description, sl.hsn_sac_snapshot, unit.code AS uom_code FROM tenant.pos_return_lines rl
       JOIN tenant.pos_sale_lines sl ON sl.organization_id = rl.organization_id AND sl.id = rl.sale_line_id
       LEFT JOIN tenant.units_of_measure unit ON unit.organization_id = sl.organization_id AND unit.id = sl.uom_id
      WHERE rl.organization_id=$1 AND rl.return_id=$2 AND (rl.claim_active OR $3) ORDER BY sl.line_number`,
    [context.organizationId, row.id, ["posted", "rejected", "cancelled"].includes(row.lifecycle_status)])).rows;
  const refunds = (await client.query(
    `SELECT component.*, refund.refund_number, refund.id AS refund_id, refund.status AS refund_status FROM tenant.payment_refund_components component
       JOIN tenant.payment_refunds refund ON refund.organization_id = component.organization_id AND refund.id = component.refund_id
      WHERE refund.organization_id=$1 AND refund.source_type='pos_return' AND refund.source_id=$2 AND refund.status <> 'cancelled' AND component.status <> 'cancelled'
      ORDER BY component.created_at, component.id`, [context.organizationId, row.id])).rows;
  const legacyRefunds = refunds.length ? [] : (await client.query(
    `SELECT * FROM tenant.pos_return_payment_refunds WHERE organization_id=$1 AND return_id=$2 ORDER BY created_at`, [context.organizationId, row.id])).rows;
  const refundTotal = decimal(String(row.refund_total));
  const exceptions = (row.exceptions ?? []).map((entry) => ({ ...entry, label: EXCEPTION_LABEL[entry.code] ?? entry.code }));
  const pendingApproval = exceptions.filter((entry) => !entry.overridden).map((entry) => entry.code);
  let allocation = null;
  if (row.lifecycle_status !== "posted" && refundTotal > 0n) {
    const payments = (await client.query(`SELECT * FROM tenant.pos_payments WHERE organization_id=$1 AND sale_id=$2 AND status IN ('captured','partially_refunded') ORDER BY id`,
      [context.organizationId, row.sale_id])).rows;
    if (payments.length) {
      const { shares } = await allocateReturnRefund(client, context, payments, refundTotal);
      allocation = payments.map((payment, index) => ({ method: payment.payment_method, amount: asDatabaseDecimal(shares[index]) })).filter((entry) => decimal(entry.amount) > 0n);
    }
  }
  return {
    id: row.id, returnNumber: row.return_number, status: String(row.lifecycle_status).toUpperCase(), refundStatus: String(row.refund_status).toUpperCase(), version: row.version,
    saleId: row.sale_id, receiptNumber: row.receipt_number, invoiceNumber: row.invoice_number, saleDate: row.sale_completed_at, storeId: row.store_id, storeName: row.store_name,
    crossOutlet: row.sale_store_id && row.sale_store_id !== row.store_id, returnType: row.return_type, receiptPresent: row.receipt_present, reasonSummary: row.reason,
    currency: row.currency_code ?? "INR", returnValue: money(row.return_value), taxAdjustment: money(row.tax_adjustment_amount), refundDue: money(row.refund_total),
    exceptions, approvalRequired: pendingApproval.length > 0 && !(row.lifecycle_status === "approved" && Number(row.approved_version) === Number(row.version)),
    overrideReason: row.override_reason, requestedBy: row.requested_by_name, requestedById: row.requested_by, approvedBy: row.approved_by_name, approvedAt: row.approved_at,
    rejectionReason: row.rejection_reason, cancelReason: row.cancel_reason, postedBy: row.posted_by_name, postedAt: row.posted_at, createdAt: row.created_at,
    creditNoteNumber: row.credit_note_number ?? null, creditNoteId: row.credit_note_id ?? null,
    lines: lines.map(lineView), refundAllocation: allocation,
    refundIds: [...new Set(refunds.map((component) => component.refund_id))],
    refunds: [
      ...refunds.map((component) => ({ paymentId: component.payment_id, componentId: component.id, refundId: component.refund_id, refundNumber: component.refund_number,
        method: component.refund_method, amount: money(component.allocated_amount),
        status: component.refund_status === "awaiting_approval" ? "AWAITING_APPROVAL" : component.status === "succeeded" ? "SUCCEEDED" : component.status === "failed" ? "FAILED"
          : component.status === "pending" ? (component.execution === "cash" ? "AWAITING_CASH_PAYOUT" : component.execution === "manual" ? "AWAITING_MANUAL_REFUND" : "PENDING")
          : String(component.status).toUpperCase(),
        reference: component.provider_refund_id ? `…${String(component.provider_refund_id).slice(-8)}` : null, confirmedAt: component.resolved_at })),
      ...legacyRefunds.map((refund) => ({ paymentId: refund.payment_id, componentId: null, refundId: null, refundNumber: null, method: refund.payment_method, amount: money(refund.refund_amount),
        status: refund.status === "completed" ? "SUCCEEDED" : refund.status === "failed" ? "FAILED" : "PENDING", reference: null, confirmedAt: refund.confirmed_at })),
    ],
    refundRemaining: money(asDatabaseDecimal(sub(refundTotal, refunds.filter((component) => component.status !== "failed").reduce((sum, component) => add(sum, decimal(String(component.allocated_amount))), 0n)))),
  };
}

// Return history: by return, receipt, invoice or credit-note number; lifecycle and refund status; dates; at the outlets the person may see.
export async function listPosReturns(client, context, options = {}) {
  requirePermission(context, "pos.view");
  const values = [context.organizationId];
  const where = [];
  const search = String(options.search ?? "").trim();
  if (search) { values.push(search); where.push(`(ret.return_number = $${values.length} OR sale.receipt_number = $${values.length} OR sale.invoice_number = $${values.length} OR ret.credit_note_number = $${values.length})`); }
  if (options.status) { values.push(String(options.status).toLowerCase()); where.push(`ret.lifecycle_status = $${values.length}`); }
  if (options.refundStatus) { values.push(String(options.refundStatus).toLowerCase()); where.push(`ret.refund_status = $${values.length}`); }
  if (options.saleId) { values.push(options.saleId); where.push(`ret.sale_id = $${values.length}`); }
  if (options.dateFrom) { values.push(options.dateFrom); where.push(`ret.created_at >= $${values.length}::date`); }
  if (options.dateTo) { values.push(options.dateTo); where.push(`ret.created_at < $${values.length}::date + 1`); }
  const stores = await accessiblePosStoreIds(client, context);
  if (stores) { values.push(stores); where.push(`ret.store_id = ANY($${values.length}::uuid[])`); }
  const filter = where.length ? ` AND ${where.join(" AND ")}` : "";
  const limit = Math.min(Number(options.limit) || 25, 100);
  const offset = Math.max(Number(options.offset) || 0, 0);
  const total = (await client.query(`SELECT count(*)::int AS n FROM tenant.pos_returns ret JOIN tenant.pos_sales sale ON sale.organization_id = ret.organization_id AND sale.id = ret.sale_id
     WHERE ret.organization_id=$1${filter}`, values)).rows[0].n;
  const rows = (await client.query(
    `SELECT ret.id, ret.return_number, ret.lifecycle_status, ret.refund_status, ret.refund_total, ret.return_type, ret.receipt_present, ret.created_at, ret.posted_at, ret.credit_note_number,
            ret.currency_code, ret.exceptions, sale.receipt_number, sale.invoice_number, requester.full_name AS requested_by_name,
            (SELECT count(*)::int FROM tenant.pos_return_lines rl WHERE rl.organization_id = ret.organization_id AND rl.return_id = ret.id AND (rl.claim_active OR ret.lifecycle_status IN ('posted','rejected','cancelled'))) AS line_count
       FROM tenant.pos_returns ret JOIN tenant.pos_sales sale ON sale.organization_id = ret.organization_id AND sale.id = ret.sale_id
       LEFT JOIN public.users requester ON requester.id = ret.requested_by
      WHERE ret.organization_id=$1${filter} ORDER BY ret.created_at DESC, ret.id DESC LIMIT ${limit} OFFSET ${offset}`, values)).rows;
  return { total, rows: rows.map((row) => ({ id: row.id, returnNumber: row.return_number, status: String(row.lifecycle_status).toUpperCase(), refundStatus: String(row.refund_status).toUpperCase(),
    refundDue: money(row.refund_total), currency: row.currency_code ?? "INR", returnType: row.return_type, receiptPresent: row.receipt_present, createdAt: row.created_at, postedAt: row.posted_at,
    receiptNumber: row.receipt_number, invoiceNumber: row.invoice_number, creditNoteNumber: row.credit_note_number, requestedBy: row.requested_by_name, lines: row.line_count,
    exceptions: (row.exceptions ?? []).map((entry) => entry.code) })) };
}

// Returns over a period: counts by status, posted values (gross, discounts, net, tax), by reason, condition and disposition, by item, outlet
// and cashier, exceptions and no-receipt returns, and refunds by method and status — refunded money kept apart from what is still owed.
export async function getPosReturnSummary(client, context, input = {}) {
  requirePermission(context, "pos.view");
  const today = new Date().toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(input.from ?? "") ? input.from : `${today.slice(0, 8)}01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(input.to ?? "") ? input.to : today;
  const values = [context.organizationId, from, to, await accessiblePosStoreIds(client, context)];
  const scope = `ret.organization_id=$1 AND ret.created_at >= $2::date AND ret.created_at < $3::date + 1 AND ($4::uuid[] IS NULL OR ret.store_id = ANY($4::uuid[]))`;
  const byStatus = (await client.query(`SELECT ret.lifecycle_status AS status, count(*)::int AS returns FROM tenant.pos_returns ret WHERE ${scope} GROUP BY 1 ORDER BY 1`, values)).rows;
  const posted = (await client.query(
    `SELECT count(DISTINCT ret.id)::int AS returns, COALESCE(sum(rl.quantity),0)::text AS quantity, COALESCE(sum(rl.gross_amount),0)::text AS gross, COALESCE(sum(rl.discount_amount),0)::text AS discounts,
            COALESCE(sum(rl.taxable_amount),0)::text AS net, COALESCE(sum(rl.tax_amount),0)::text AS tax, COALESCE(sum(rl.refund_amount),0)::text AS refund_due,
            count(DISTINCT ret.id) FILTER (WHERE NOT ret.receipt_present)::int AS no_receipt,
            count(DISTINCT ret.id) FILTER (WHERE jsonb_array_length(ret.exceptions) > 0)::int AS with_exceptions
       FROM tenant.pos_returns ret JOIN tenant.pos_return_lines rl ON rl.organization_id = ret.organization_id AND rl.return_id = ret.id
      WHERE ${scope} AND ret.lifecycle_status = 'posted'`, values)).rows[0];
  const group = async (column) => (await client.query(
    `SELECT COALESCE(${column}, 'not recorded') AS key, count(*)::int AS lines, COALESCE(sum(rl.quantity),0)::text AS quantity, COALESCE(sum(rl.refund_amount),0)::text AS value
       FROM tenant.pos_returns ret JOIN tenant.pos_return_lines rl ON rl.organization_id = ret.organization_id AND rl.return_id = ret.id
       LEFT JOIN tenant.pos_sale_lines sl ON sl.organization_id = rl.organization_id AND sl.id = rl.sale_line_id
       LEFT JOIN tenant.pos_stores store ON store.organization_id = ret.organization_id AND store.id = ret.store_id
       LEFT JOIN public.users person ON person.id = ret.requested_by
      WHERE ${scope} AND ret.lifecycle_status = 'posted' GROUP BY 1 ORDER BY 4 DESC LIMIT 20`, values)).rows;
  const refunds = (await client.query(
    `SELECT method, status, count(*)::int AS refunds, COALESCE(sum(amount),0)::text AS amount FROM (
       SELECT component.refund_method AS method, CASE component.status WHEN 'succeeded' THEN 'completed' WHEN 'failed' THEN 'failed' ELSE 'pending' END AS status, component.allocated_amount AS amount
         FROM tenant.pos_returns ret JOIN tenant.payment_refunds refund ON refund.organization_id = ret.organization_id AND refund.source_type = 'pos_return' AND refund.source_id = ret.id
         JOIN tenant.payment_refund_components component ON component.organization_id = refund.organization_id AND component.refund_id = refund.id
        WHERE ${scope} AND refund.status <> 'cancelled' AND component.status <> 'cancelled'
       UNION ALL
       SELECT legacy.payment_method, legacy.status, legacy.refund_amount FROM tenant.pos_returns ret JOIN tenant.pos_return_payment_refunds legacy ON legacy.organization_id = ret.organization_id AND legacy.return_id = ret.id
        WHERE ${scope} AND legacy.refund_component_id IS NULL) rows GROUP BY 1, 2 ORDER BY 1, 2`, values)).rows;
  return { from, to, byStatus, posted, byReason: await group("rl.reason_code"), byCondition: await group("rl.condition_code"), byDisposition: await group("COALESCE(rl.released_disposition, rl.disposition_code)"),
    byItem: await group("sl.description"), byOutlet: await group("store.name"), byCashier: await group("person.full_name"), refunds };
}

// For tests and recovery tools: the fingerprint of a return's lines (what an approval covered).
export const returnFingerprint = (lines) => createHash("sha256").update(JSON.stringify(lines.map((line) => [line.saleLineId, String(line.quantity)]))).digest("hex");
