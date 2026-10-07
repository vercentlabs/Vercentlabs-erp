// What happens to a purchase order after it is drafted. Every change is an
// explicit operation with its own permission and checks; there is no status
// update. Confirming commits the company: it re-validates the order against
// today's masters (supplier usable, lines, prices, warehouses, taxes) and
// keeps the exact document as the next numbered version. It never moves
// stock, creates a payable or books tax.
import { createHash } from "node:crypto";

import { decimal, formatDecimal, min, sub } from "../../../core/decimal.js";
import { loadPurchaseOrder, requirePoPermission } from "./access.js";
import { CANCEL_REASONS, PO_PERMISSIONS, PurchaseOrderError, STATUS, dayOf, fail, readDate, requireUuid, text } from "./constants.js";
import { databaseToday, resolveOrderDocument, validateForConfirmation } from "./document.js";
import { recordPoEvent, updateOrderHeader } from "./persist.js";
import { calculateClosureEligibility, loadLineProgress } from "./progress.js";

const dec = (value) => formatDecimal(value);

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

function checkRevision(order, expectedRevision) {
  if (expectedRevision !== undefined && expectedRevision !== null && Number(expectedRevision) !== Number(order.revision))
    throw new PurchaseOrderError(409, "This order changed after you opened it. Reload it and try again.", "PURCHASE_ORDER_STALE");
}

function readReason(input, { required = true } = {}) {
  const reasonCode = text(input.reasonCode, 60);
  const reason = text(input.reason, 1000);
  if (required && !CANCEL_REASONS.some((entry) => entry.code === reasonCode)) fail("Choose the reason.", "reasonCode");
  if (reasonCode === "other" && (!reason || reason.length < 3)) fail("Describe the reason.", "reason");
  return { reasonCode, reason };
}

// Anything done against the order: posted or draft receipts, bills, cancellations or returns.
// Draft supplier bills are not execution: they commit nothing, and are matched again against the amended order.
async function executionOf(client, organizationId, orderId) {
  const row = (await client.query(
    `SELECT (SELECT count(*) FROM tenant.goods_receipts WHERE organization_id = $1 AND purchase_order_id = $2 AND status <> 'cancelled')::int AS receipts,
            (SELECT count(*) FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND source_purchase_order_id = $2 AND status NOT IN ('cancelled', 'reversed', 'draft'))::int AS bills,
            (SELECT count(*) FROM tenant.purchase_order_line_cancellations WHERE organization_id = $1 AND purchase_order_id = $2)::int AS cancellations`,
    [organizationId, orderId])).rows[0];
  return { ...row, any: row.receipts + row.bills + row.cancellations > 0 };
}

// The document as confirmed: everything the supplier is told, plus the identifiers it was made from.
async function confirmationSnapshot(client, organizationId, orderId) {
  const order = (await client.query(`SELECT * FROM tenant.purchase_orders WHERE organization_id = $1 AND id = $2`, [organizationId, orderId])).rows[0];
  const lines = (await client.query(`SELECT * FROM tenant.purchase_order_lines WHERE organization_id = $1 AND purchase_order_id = $2 ORDER BY line_number`, [organizationId, orderId])).rows;
  const taxes = (await client.query(`SELECT * FROM tenant.purchase_order_line_taxes WHERE organization_id = $1 AND purchase_order_id = $2 ORDER BY purchase_order_line_id, sequence`,
    [organizationId, orderId])).rows;
  const company = (await client.query(`SELECT name, legal_name, tax_id FROM public.organizations WHERE id = $1`, [organizationId])).rows[0] ?? {};
  const strip = ({ organization_id: _o, internal_notes: _i, revision: _r, updated_at: _u, updated_by: _ub, ...rest }) => rest;
  return {
    order: strip(order),
    lines: lines.map(({ organization_id: _o, updated_at: _u, ...rest }) => rest),
    taxes: taxes.map(({ organization_id: _o, ...rest }) => rest),
    company: { name: company.legal_name || company.name || null, taxId: company.tax_id ?? null },
  };
}

// confirmPurchaseOrder. A retried confirmation of an order already confirmed changes nothing.
export async function confirmPurchaseOrder(client, context, orderId, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.confirm, "You do not have permission to confirm purchase orders.");
  const order = await loadPurchaseOrder(client, context, orderId, { lock: true });
  if (order.status === STATUS.confirmed && (input.expectedRevision === undefined || Number(input.expectedRevision) + 1 === Number(order.revision)))
    return { id: order.id, versionNumber: order.version_number, status: order.status, replayed: true };
  if (order.status !== STATUS.draft) throw new PurchaseOrderError(409, `A ${order.status} order cannot be confirmed.`, "PURCHASE_ORDER_INVALID_STATE");
  checkRevision(order, input.expectedRevision);
  // Re-validated against today's masters: a supplier blocked since the draft was made stops it here.
  const { header, priced } = await resolveOrderDocument(client, context, {}, { order, today: await databaseToday(client) });
  validateForConfirmation(header, priced);
  await updateOrderHeader(client, context, order.id, header, priced);
  const version = Number(order.version_number) + 1;
  await client.query(`UPDATE tenant.purchase_order_confirmations SET superseded_at = now() WHERE organization_id = $1 AND purchase_order_id = $2 AND superseded_at IS NULL`,
    [context.organizationId, order.id]);
  await client.query(
    `UPDATE tenant.purchase_orders SET status = 'confirmed', version_number = $3, confirmed_by = $4, confirmed_at = now(), communication_status = 'not_sent',
            acknowledged_at = NULL, acknowledged_by = NULL, acknowledgement_reference = NULL, updated_by = $4, updated_at = now(),
            matching_policy = COALESCE(matching_policy, (SELECT CASE WHEN settings.billing_basis = 'order' THEN 'two_way' WHEN settings.bill_held_goods THEN 'three_way_received'
                                                                   ELSE 'three_way_accepted' END FROM tenant.procurement_settings settings WHERE settings.organization_id = $1), 'three_way_accepted')
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, order.id, version, context.userId ?? null]);
  const snapshot = await confirmationSnapshot(client, context.organizationId, order.id);
  const hash = createHash("sha256").update(stable({ order: { ...snapshot.order, confirmed_at: null, status: null }, lines: snapshot.lines, taxes: snapshot.taxes })).digest("hex");
  await client.query(
    `INSERT INTO tenant.purchase_order_confirmations (organization_id, purchase_order_id, version_number, amendment_reason, snapshot, content_hash, grand_total, confirmed_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
    [context.organizationId, order.id, version, version > 1 ? order.amendment_reason : null, JSON.stringify(snapshot), hash, formatDecimal(priced.totals.grandTotal), context.userId ?? null]);
  await recordPoEvent(client, context, order.id, version > 1 ? "purchase_order.reconfirmed" : "purchase_order.confirmed",
    `${version > 1 ? `Amendment confirmed as version ${version}` : "Confirmed"} · ${header.currencyCode} ${dec(priced.totals.grandTotal)}`,
    { from: STATUS.draft, to: STATUS.confirmed, details: { version, total: dec(priced.totals.grandTotal), contentHash: hash } });
  return { id: order.id, versionNumber: version, status: STATUS.confirmed, replayed: false };
}

// amendPurchaseOrder: a confirmed order nothing has been done against goes back to Draft, with the reason;
// its confirmed version stays on record and the reconfirmation becomes the next version.
export async function amendPurchaseOrder(client, context, orderId, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.amend, "You do not have permission to amend purchase orders.");
  const order = await loadPurchaseOrder(client, context, orderId, { lock: true });
  if (order.status !== STATUS.confirmed) throw new PurchaseOrderError(409, "Only a confirmed order can be amended.", "PURCHASE_ORDER_INVALID_STATE");
  checkRevision(order, input.expectedRevision);
  const reason = text(input.reason, 1000);
  if (!reason || reason.length < 3) fail("Give the reason for the amendment.", "reason");
  const executed = await executionOf(client, context.organizationId, order.id);
  if (executed.any)
    throw new PurchaseOrderError(409, "Goods have been received, billed or cancelled against this order, so its quantities, products, prices and taxes can no longer change. Update the expected dates or cancel what is still outstanding instead.",
      "PURCHASE_ORDER_EXECUTED");
  await client.query(`UPDATE tenant.purchase_orders SET status = 'draft', amendment_reason = $3, revision = revision + 1, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, order.id, reason, context.userId ?? null]);
  await recordPoEvent(client, context, order.id, "purchase_order.amendment_started", `Amendment started: ${reason}`,
    { from: STATUS.confirmed, to: STATUS.draft, details: { version: order.version_number, reason } });
  return { id: order.id, status: STATUS.draft, versionNumber: order.version_number, revision: Number(order.revision) + 1 };
}

// Cancels an order nothing has been done against. Its confirmations and history stay.
export async function cancelPurchaseOrder(client, context, orderId, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.cancel, "You do not have permission to cancel purchase orders.");
  const order = await loadPurchaseOrder(client, context, orderId, { lock: true });
  if (order.status === STATUS.cancelled) return { id: order.id, status: order.status, replayed: true };
  if (![STATUS.draft, STATUS.confirmed].includes(order.status)) throw new PurchaseOrderError(409, `A ${order.status} order cannot be cancelled.`, "PURCHASE_ORDER_INVALID_STATE");
  checkRevision(order, input.expectedRevision);
  const { reasonCode, reason } = readReason(input);
  const executed = await executionOf(client, context.organizationId, order.id);
  if (executed.any)
    throw new PurchaseOrderError(409, "Goods have been received or billed against this order. Cancel the remaining quantity instead; what was received or billed stays.", "PURCHASE_ORDER_EXECUTED");
  await client.query(
    `UPDATE tenant.purchase_orders SET status = 'cancelled', cancelled_by = $3, cancelled_at = now(), cancel_reason_code = $4, cancel_reason = $5, revision = revision + 1,
            updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`, [context.organizationId, order.id, context.userId ?? null, reasonCode, reason]);
  if (order.source_quotation_id)
    await client.query(`UPDATE tenant.supplier_quotations SET status = 'received', converted_purchase_order_id = NULL, updated_at = now() WHERE organization_id = $1 AND id = $2 AND converted_purchase_order_id = $3`,
      [context.organizationId, order.source_quotation_id, order.id]);
  await recordPoEvent(client, context, order.id, "purchase_order.cancelled",
    `Cancelled: ${CANCEL_REASONS.find((entry) => entry.code === reasonCode).label}${reason ? ` (${reason})` : ""}`, { from: order.status, to: STATUS.cancelled, details: { reasonCode, reason } });
  return { id: order.id, status: STATUS.cancelled, replayed: false };
}

// cancelRemainingPurchaseOrderQty. input: { lines?: [{ lineId, quantity }] (default: everything outstanding), reasonCode, reason? }.
// What is cancelled is recorded beside the line; the ordered quantity never changes. A billed quantity cannot be cancelled
// (Finance corrects the bill first). A draft receipt reserves nothing: it is checked again when posted.
export async function cancelRemainingPurchaseOrderQty(client, context, orderId, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.cancel, "You do not have permission to cancel purchase order quantities.");
  const order = await loadPurchaseOrder(client, context, orderId, { lock: true });
  if (order.status !== STATUS.confirmed) throw new PurchaseOrderError(409, "Only a confirmed order has outstanding quantities to cancel.", "PURCHASE_ORDER_INVALID_STATE");
  const { reasonCode, reason } = readReason(input);
  const progress = await loadLineProgress(client, context.organizationId, order.id);
  const cancelable = (line) => {
    const open = line.receiptRequired ? line.remainingToReceive : sub(sub(line.ordered, line.cancelled), line.billed);
    const unbilled = sub(sub(line.ordered, line.cancelled), line.billed > line.received ? line.billed : line.received);
    const value = line.receiptRequired ? min(open, unbilled) : open;
    return value > 0n ? value : 0n;
  };
  const requested = Array.isArray(input.lines) && input.lines.length
    ? input.lines.map((entry) => {
      const line = progress.find((candidate) => candidate.lineId === requireUuid(entry.lineId, "Line"));
      if (!line) throw new PurchaseOrderError(404, "That line is not on this order.", "PURCHASE_ORDER_LINE_NOT_FOUND");
      const raw = String(entry.quantity ?? "").trim();
      if (!/^\d+(?:\.\d{1,6})?$/.test(raw) || decimal(raw) <= 0n) fail(`Line ${line.lineNumber}: enter the quantity to cancel.`, "quantity");
      return { line, quantity: decimal(raw), rejectionId: entry.receivingRejectionId ? requireUuid(entry.receivingRejectionId, "Rejection") : null };
    })
    : progress.map((line) => ({ line, quantity: cancelable(line) })).filter((entry) => entry.quantity > 0n);
  if (!requested.length) throw new PurchaseOrderError(409, "Nothing is outstanding on this order.", "PURCHASE_ORDER_NOTHING_OUTSTANDING");
  for (const entry of requested) {
    const { line, quantity } = entry;
    const limit = cancelable(line);
    if (quantity > limit)
      throw new PurchaseOrderError(409, limit === 0n
        ? `Line ${line.lineNumber}: nothing outstanding can be cancelled${line.billed > line.received ? " (it is already billed; Finance must correct the bill first)" : ""}.`
        : `Line ${line.lineNumber}: at most ${dec(limit)} can be cancelled.`, "PURCHASE_ORDER_CANCEL_EXCEEDS_OUTSTANDING");
    entry.cancellationId = (await client.query(
      `INSERT INTO tenant.purchase_order_line_cancellations (organization_id, purchase_order_id, purchase_order_line_id, quantity, reason_code, reason, cancelled_by, receiving_rejection_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [context.organizationId, order.id, line.lineId, formatDecimal(quantity), reasonCode, reason, context.userId ?? null, entry.rejectionId ?? null])).rows[0].id;
  }
  await client.query(`UPDATE tenant.purchase_orders SET revision = revision + 1, updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, order.id, context.userId ?? null]);
  await recordPoEvent(client, context, order.id, "purchase_order.remaining_cancelled",
    `Cancelled outstanding quantity: ${requested.map(({ line, quantity }) => `line ${line.lineNumber} × ${dec(quantity)}`).join(", ")} (${CANCEL_REASONS.find((entry) => entry.code === reasonCode).label})`,
    { from: STATUS.confirmed, to: STATUS.confirmed, details: { reasonCode, reason, lines: requested.map(({ line, quantity }) => ({ lineId: line.lineId, quantity: dec(quantity) })) } });
  return { id: order.id, cancelled: requested.map(({ line, quantity, cancellationId }) => ({ lineId: line.lineId, quantity: dec(quantity), cancellationId })) };
}

export async function calculatePurchaseOrderClosureEligibility(client, context, orderId) {
  const order = await loadPurchaseOrder(client, context, orderId);
  const progress = await loadLineProgress(client, context.organizationId, order.id);
  const draftReceipts = Number((await client.query(`SELECT count(*) FROM tenant.goods_receipts WHERE organization_id = $1 AND purchase_order_id = $2 AND status = 'draft'`,
    [context.organizationId, order.id])).rows[0].count);
  return calculateClosureEligibility(order, progress, { draftReceipts });
}

// closePurchaseOrder: nothing left to receive or bill. Payment may still be outstanding: the payable stays with Finance.
export async function closePurchaseOrder(client, context, orderId, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.close, "You do not have permission to close purchase orders.");
  const order = await loadPurchaseOrder(client, context, orderId, { lock: true });
  if (order.status === STATUS.closed) return { id: order.id, status: order.status, replayed: true };
  const eligibility = await calculatePurchaseOrderClosureEligibility(client, context, order.id);
  if (!eligibility.eligible) throw new PurchaseOrderError(409, `The order cannot be closed yet: ${eligibility.reasons[0]}`, "PURCHASE_ORDER_NOT_READY_TO_CLOSE", { reasons: eligibility.reasons });
  const reason = text(input.reason, 1000);
  await client.query(
    `UPDATE tenant.purchase_orders SET status = 'closed', closed_by = $3, closed_at = now(), close_reason = $4, revision = revision + 1, updated_by = $3, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, order.id, context.userId ?? null, reason]);
  await recordPoEvent(client, context, order.id, "purchase_order.closed", `Closed${reason ? `: ${reason}` : ""}`, { from: STATUS.confirmed, to: STATUS.closed, details: { reason } });
  return { id: order.id, status: STATUS.closed, replayed: false };
}

// Moves the expected delivery of a confirmed order (header and/or lines). input: { expectedDeliveryDate?, lines?: [{ lineId, expectedDeliveryDate }], reason }.
// The confirmed version is not rewritten; the change is in the history.
export async function updatePurchaseOrderExpectedDates(client, context, orderId, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.updateDates, "You do not have permission to change expected delivery dates.");
  const order = await loadPurchaseOrder(client, context, orderId, { lock: true });
  if (order.status !== STATUS.confirmed) throw new PurchaseOrderError(409, "Only a confirmed order's expected dates are updated this way. Edit a draft instead.", "PURCHASE_ORDER_INVALID_STATE");
  const reason = text(input.reason, 1000);
  if (!reason || reason.length < 3) fail("Give the reason for the new date.", "reason");
  const orderDate = dayOf(order.order_date);
  const changes = [];
  if (Object.prototype.hasOwnProperty.call(input, "expectedDeliveryDate")) {
    const next = readDate(input.expectedDeliveryDate, "Expected delivery date");
    if (next && next < orderDate) fail("The expected delivery date cannot be before the order date.", "expectedDeliveryDate", "PURCHASE_ORDER_DATE_INVALID");
    await client.query(`UPDATE tenant.purchase_orders SET expected_delivery_date = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, order.id, next, context.userId ?? null]);
    changes.push({ line: null, from: dayOf(order.expected_delivery_date), to: next });
  }
  for (const entry of Array.isArray(input.lines) ? input.lines : []) {
    const next = readDate(entry.expectedDeliveryDate, "Expected delivery date");
    if (next && next < orderDate) fail("The expected delivery date cannot be before the order date.", "expectedDeliveryDate", "PURCHASE_ORDER_DATE_INVALID");
    const line = (await client.query(`UPDATE tenant.purchase_order_lines SET expected_delivery_date = $4, updated_at = now() WHERE organization_id = $1 AND purchase_order_id = $2 AND id = $3
       RETURNING line_number, (SELECT expected_delivery_date FROM tenant.purchase_order_lines WHERE id = $3) AS before`,
      [context.organizationId, order.id, requireUuid(entry.lineId, "Line"), next])).rows[0];
    if (!line) throw new PurchaseOrderError(404, "That line is not on this order.", "PURCHASE_ORDER_LINE_NOT_FOUND");
    changes.push({ line: line.line_number, from: dayOf(line.before), to: next });
  }
  if (!changes.length) fail("Enter the new expected date.", "expectedDeliveryDate");
  await client.query(`UPDATE tenant.purchase_orders SET revision = revision + 1 WHERE organization_id = $1 AND id = $2`, [context.organizationId, order.id]);
  await recordPoEvent(client, context, order.id, "purchase_order.expected_dates_changed",
    `Expected delivery changed: ${changes.map((change) => `${change.line ? `line ${change.line} ` : ""}${change.to ?? "none"}`).join(", ")} (${reason})`, { details: { changes, reason } });
  return { id: order.id, changes };
}

// Receives a confirmed line in another warehouse. Not while a draft receipt for it is open.
export async function changePurchaseOrderLineWarehouse(client, context, orderId, lineId, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.changeWarehouse, "You do not have permission to change the receiving warehouse.");
  const order = await loadPurchaseOrder(client, context, orderId, { lock: true });
  if (order.status !== STATUS.confirmed) throw new PurchaseOrderError(409, "Edit the draft to change its warehouse.", "PURCHASE_ORDER_INVALID_STATE");
  const line = (await client.query(`SELECT * FROM tenant.purchase_order_lines WHERE organization_id = $1 AND purchase_order_id = $2 AND id = $3 FOR UPDATE`,
    [context.organizationId, order.id, requireUuid(lineId, "Line")])).rows[0];
  if (!line) throw new PurchaseOrderError(404, "That line is not on this order.", "PURCHASE_ORDER_LINE_NOT_FOUND");
  if (line.product_type === "service") fail("A service is not received into a warehouse.", "warehouseId", "PURCHASE_ORDER_VALIDATION", 409);
  const warehouse = (await client.query(`SELECT id, name FROM tenant.warehouses WHERE organization_id = $1 AND id = $2 AND status = 'active'`,
    [context.organizationId, requireUuid(input.warehouseId, "Warehouse")])).rows[0];
  if (!warehouse) fail("Choose an active warehouse.", "warehouseId", "PURCHASE_ORDER_WAREHOUSE_INVALID", 409);
  const draft = (await client.query(
    `SELECT 1 FROM tenant.goods_receipt_lines line JOIN tenant.goods_receipts receipt ON receipt.organization_id = line.organization_id AND receipt.id = line.goods_receipt_id
      WHERE line.organization_id = $1 AND line.purchase_order_line_id = $2 AND receipt.status = 'draft' LIMIT 1`, [context.organizationId, line.id])).rows[0];
  if (draft) throw new PurchaseOrderError(409, "A draft goods receipt is open for this line. Post or cancel it first.", "PURCHASE_ORDER_RECEIPT_IN_PROGRESS");
  const reason = text(input.reason, 1000);
  await client.query(`UPDATE tenant.purchase_order_lines SET receiving_warehouse_id = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`, [context.organizationId, line.id, warehouse.id]);
  await client.query(`UPDATE tenant.purchase_orders SET revision = revision + 1, updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, order.id, context.userId ?? null]);
  await recordPoEvent(client, context, order.id, "purchase_order.warehouse_changed", `Line ${line.line_number} now received at ${warehouse.name}${reason ? ` (${reason})` : ""}`,
    { details: { lineId: line.id, from: line.receiving_warehouse_id, to: warehouse.id, reason } });
  return { id: order.id, lineId: line.id, warehouseId: warehouse.id };
}

// changePurchaseOrderMatchingPolicy: the order's matching policy — 3-Way on accepted goods, 3-Way on physically received goods, or 2-Way
// (billing before receipt, for a genuinely agreed advance invoice). Fixed at confirmation; changed only by someone allowed to accept matching
// exceptions, with a business reason, recorded on the order and in its history. Whoever records a bill can never change it. Draft bills are
// matched again under the new policy (the revision changes); posted bills keep the policy they were posted with in their evidence.
// input: { policy, reason }
export const MATCHING_POLICY_LABELS = Object.freeze({ three_way_accepted: "3-Way — acceptance required", three_way_received: "3-Way — physical receipt", two_way: "2-Way — PO-based billing" });
export async function changePurchaseOrderMatchingPolicy(client, context, orderId, input = {}) {
  requirePoPermission(context, "procurement.matching.override", "You do not have permission to change an order's matching policy.");
  const order = await loadPurchaseOrder(client, context, orderId, { lock: true });
  if (!["confirmed", "draft"].includes(order.status)) throw new PurchaseOrderError(409, `The order is ${order.status}: its matching policy no longer changes.`, "PURCHASE_ORDER_INVALID_STATE");
  const policy = String(input.policy ?? "");
  if (!MATCHING_POLICY_LABELS[policy]) fail("Choose the matching policy: 3-Way on accepted goods, 3-Way on received goods, or 2-Way.", "policy");
  const reason = text(input.reason, 1000);
  if (!reason || reason.length < 10) fail("Explain why the order's matching policy changes (at least a sentence).", "reason");
  if (order.matching_policy === policy) return { id: order.id, policy, replayed: true };
  await client.query(
    `UPDATE tenant.purchase_orders SET matching_policy = $3, matching_policy_reason = $4, matching_policy_changed_by = $5, matching_policy_changed_at = now(), revision = revision + 1,
            updated_by = $5, updated_at = now() WHERE organization_id = $1 AND id = $2`, [context.organizationId, order.id, policy, reason, context.userId ?? null]);
  await recordPoEvent(client, context, order.id, "purchase_order.matching_policy_changed",
    `Matching policy: ${MATCHING_POLICY_LABELS[order.matching_policy] ?? "workspace default"} → ${MATCHING_POLICY_LABELS[policy]} — ${reason}`,
    { details: { from: order.matching_policy, to: policy, reason } });
  return { id: order.id, policy, replayed: false };
}
