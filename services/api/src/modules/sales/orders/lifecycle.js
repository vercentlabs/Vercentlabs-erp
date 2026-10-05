// A sales order's life after it is confirmed (confirming is in
// ../order-confirmations): reopened to Draft while nothing has been delivered
// or invoiced, which supersedes its confirmation; cancelled whole; or, once
// execution has started, what is left cancelled line by line while the
// delivered and invoiced part stays. An order closes by itself when nothing
// is left to deliver or invoice.
//
// Every transition is its own operation; there is no "set status".
import { reverseSalesCommissionsForOrder } from "../after-sales.js";
import { assertOrderVisible, requireOrderPermission } from "./access.js";
import { CANCEL_REASONS, FULFILLMENT, INVOICING, ORDER_PERMISSIONS, OrderError, STATUS, requireUuid, text } from "./constants.js";
import { loadOrderLineProgress, refreshSalesOrderProgress } from "./progress.js";
import { supersedeCurrentConfirmation } from "../order-confirmations/snapshot.js";
import { SYSTEM_RELEASE_REASONS } from "../reservations/constants.js";
import { releaseOrderReservations, trimLineReservation } from "../reservations/service.js";
import { lockOrder, recordOrderEvent } from "./versions.js";

const EPSILON = 1e-6;

async function lockVisible(client, context, orderId) {
  const order = await lockOrder(client, context, orderId);
  await assertOrderVisible(client, context, order.id);
  return order;
}

// Deliveries and valid invoices of the order: what stops a reopen or a full cancellation.
async function downstream(client, context, orderId) {
  return (await client.query(
    `SELECT (SELECT count(*) FROM tenant.sales_fulfillment_requests WHERE organization_id = $1 AND sales_order_id = $2 AND status = 'completed')::int AS deliveries,
            (SELECT count(*) FROM tenant.accounting_customer_invoices WHERE organization_id = $1 AND source_sales_order_id = $2 AND invoice_type = 'invoice'
               AND status NOT IN ('cancelled', 'reversed'))::int AS invoices`, [context.organizationId, orderId])).rows[0];
}

// Confirmed → Draft, while nothing has been delivered or invoiced. Stock
// reserved for the order is released and its current confirmation is
// superseded (kept, no longer current); confirming again makes the next
// revision. input: { reason }
export async function reopenSalesOrder(client, context, orderId, input = {}) {
  requireOrderPermission(context, ORDER_PERMISSIONS.reopen, "You do not have permission to reopen sales orders.");
  const reason = text(input.reason, 1000);
  if (!reason) throw new OrderError(400, "Give the reason for reopening the order.", "SALES_ORDER_REOPEN_REASON_REQUIRED", { field: "reason" });
  const order = await lockVisible(client, context, orderId);
  if (order.lifecycle_status !== STATUS.confirmed) throw new OrderError(409, "Only a confirmed order can be reopened.", "SALES_ORDER_NOT_CONFIRMED");
  const used = await downstream(client, context, order.id);
  if (used.deliveries || used.invoices)
    throw new OrderError(409, "This order has a delivery or an invoice and cannot be reopened. Cancel the remaining quantity, or use a return or a credit note.", "SALES_ORDER_IN_EXECUTION");
  // A draft never holds stock: what was reserved goes back, and is reserved again when the order is confirmed again.
  const released = (await releaseOrderReservations(client, context, order, { how: "released", reasonCode: "order_reopened", reason: `${SYSTEM_RELEASE_REASONS.order_reopened}: ${reason}` })).reduce((total, line) => total + line.count, 0);
  await client.query(
    `UPDATE tenant.sales_orders SET lifecycle_status = $3, fulfillment_status = $4, billing_status = $5, confirmed_at = NULL, confirmed_by = NULL, updated_by = $6, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, order.id, STATUS.draft, FULFILLMENT.notStarted, INVOICING.notBillable, context.userId ?? null]);
  await client.query(
    `UPDATE tenant.sales_order_line_progress progress SET confirmed_quantity = 0, reserved_quantity = 0, updated_by = $3, updated_at = now()
       FROM tenant.sales_order_lines line WHERE progress.sales_order_line_id = line.id AND line.organization_id = $1 AND line.sales_order_version_id = $2`,
    [context.organizationId, order.current_version_id, context.userId ?? null]);
  await reverseSalesCommissionsForOrder(client, context, order.id, `Order reopened: ${reason}`);
  const superseded = await supersedeCurrentConfirmation(client, context, order.id, reason);
  await recordOrderEvent(client, context, order.id, "sales_order.reopened", STATUS.confirmed, STATUS.draft, { reason, reservationsReleased: released, supersededConfirmation: superseded?.version ?? null });
  return { orderId: order.id, status: STATUS.draft, reservationsReleased: released, supersededConfirmation: superseded?.version ?? null };
}

function readCancelReason(input, { required }) {
  const code = text(input.reasonCode, 40);
  const reason = text(input.reason, 1000);
  if (code && !CANCEL_REASONS.some((entry) => entry.code === code)) throw new OrderError(400, "Choose a cancellation reason from the list.", "SALES_ORDER_CANCEL_REASON_INVALID");
  if (required && !code && !reason) throw new OrderError(400, "Give the reason for cancelling.", "SALES_ORDER_CANCEL_REASON_REQUIRED", { field: "reasonCode" });
  if (code === "other" && !reason) throw new OrderError(400, "Describe the reason for cancelling.", "SALES_ORDER_CANCEL_REASON_REQUIRED", { field: "reason" });
  return { code, reason, label: [CANCEL_REASONS.find((entry) => entry.code === code)?.label, reason].filter(Boolean).join(": ") || null };
}

// Cancels the whole order: a draft, or a confirmed order with nothing
// delivered or invoiced. Reservations are released; the order is kept.
// input: { reasonCode?, reason? } — a reason is required once confirmed.
export async function cancelSalesOrder(client, context, orderId, input = {}) {
  requireOrderPermission(context, ORDER_PERMISSIONS.cancel, "You do not have permission to cancel sales orders.");
  const order = await lockVisible(client, context, orderId);
  if (order.lifecycle_status === STATUS.cancelled) return { orderId: order.id, status: STATUS.cancelled, changed: false, sourceOpportunityId: order.source_opportunity_id ?? null };
  if (order.lifecycle_status === STATUS.closed) throw new OrderError(409, "A closed order cannot be cancelled. Use a return or a credit note.", "SALES_ORDER_CLOSED");
  const used = await downstream(client, context, order.id);
  if (used.deliveries || used.invoices)
    throw new OrderError(409, "This order has a delivery or an invoice. Cancel its remaining quantity instead; what was delivered and invoiced stays.", "SALES_ORDER_IN_EXECUTION");
  const cancellation = readCancelReason(input, { required: order.lifecycle_status === STATUS.confirmed });
  const released = (await releaseOrderReservations(client, context, order, { how: "cancelled", reasonCode: "order_cancelled", reason: SYSTEM_RELEASE_REASONS.order_cancelled })).reduce((total, line) => total + line.count, 0);
  await client.query(
    `UPDATE tenant.sales_orders
        SET lifecycle_status = $3, fulfillment_status = $4, billing_status = $5, cancelled_at = now(), cancelled_by = $6, cancel_reason_code = $7, cancel_reason = $8,
            updated_by = $6, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, order.id, STATUS.cancelled, FULFILLMENT.cancelled, INVOICING.blocked, context.userId ?? null, cancellation.code, cancellation.reason]);
  // The quotation it came from can become an order again.
  if (order.source_quotation_id)
    await client.query(`UPDATE tenant.sales_quotations SET converted_order_id = NULL, updated_at = now() WHERE organization_id = $1 AND id = $2 AND converted_order_id = $3`,
      [context.organizationId, order.source_quotation_id, order.id]);
  await reverseSalesCommissionsForOrder(client, context, order.id, `Order cancelled: ${cancellation.label ?? "no reason given"}`);
  await recordOrderEvent(client, context, order.id, "sales_order.cancelled", order.lifecycle_status, STATUS.cancelled,
    { reasonCode: cancellation.code, reason: cancellation.label, reservationsReleased: released });
  return { orderId: order.id, status: STATUS.cancelled, changed: true, sourceOpportunityId: order.source_opportunity_id ?? null };
}

// Cancels what is left of a confirmed order's lines: the undelivered quantity
// of a product, the uninvoiced quantity of a service. The ordered quantity is
// never rewritten: 10 ordered, 6 delivered, 4 cancelled.
// input: { lines?: [{ salesOrderLineId, quantity? }], reasonCode?, reason? } — every line with something left when `lines` is omitted.
export async function cancelSalesOrderRemaining(client, context, orderId, input = {}) {
  requireOrderPermission(context, ORDER_PERMISSIONS.cancelRemaining, "You do not have permission to cancel a remaining quantity.");
  const order = await lockVisible(client, context, orderId);
  if (order.lifecycle_status !== STATUS.confirmed) throw new OrderError(409, "A remaining quantity is cancelled on a confirmed order.", "SALES_ORDER_NOT_CONFIRMED");
  const cancellation = readCancelReason(input, { required: true });
  const progress = await loadOrderLineProgress(client, context.organizationId, order.current_version_id);
  const byId = new Map(progress.map((line) => [line.lineId, line]));
  // A product can lose what is not yet delivered; a service what is not yet invoiced.
  const cancellable = (line) => (line.deliverable ? Math.min(line.remainingToDeliver, Math.max(0, line.ordered - line.cancelled - line.invoiced)) : line.remainingToInvoice);
  const requested = Array.isArray(input.lines) && input.lines.length
    ? input.lines.map((entry) => ({ line: byId.get(requireUuid(entry.salesOrderLineId, "Order line")), quantity: entry.quantity }))
    : progress.filter((line) => cancellable(line) > EPSILON).map((line) => ({ line, quantity: null }));
  if (!requested.length) throw new OrderError(409, "Nothing is left to cancel on this order.", "SALES_ORDER_NOTHING_TO_CANCEL");
  const cancelled = [];
  for (const { line, quantity } of requested) {
    if (!line) throw new OrderError(404, "An order line was not found on this order.", "SALES_ORDER_LINE_NOT_FOUND");
    const available = cancellable(line);
    const amount = quantity == null || quantity === "" ? available : Number(quantity);
    if (!Number.isFinite(amount) || amount <= 0) throw new OrderError(400, `${line.itemName}: enter a quantity to cancel.`, "SALES_ORDER_VALIDATION");
    if (amount > available + EPSILON)
      throw new OrderError(409, `${line.itemName}: only ${available} ${line.unit ?? ""} can be cancelled; the rest is already delivered or invoiced.`.replace("  ", " "), "SALES_ORDER_CANCEL_EXCEEDS_REMAINING");
    await client.query(`UPDATE tenant.sales_order_line_progress SET cancelled_quantity = cancelled_quantity + $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND sales_order_line_id = $2`,
      [context.organizationId, line.lineId, amount, context.userId ?? null]);
    // Only stock held beyond what is still to deliver goes back; the rest stays reserved.
    await trimLineReservation(client, context, order, line.lineId, "quantity_cancelled");
    cancelled.push({ lineId: line.lineId, item: line.itemName, quantity: amount, unit: line.unit });
  }
  await recordOrderEvent(client, context, order.id, "sales_order.quantity_cancelled", STATUS.confirmed, STATUS.confirmed,
    { lines: cancelled, reasonCode: cancellation.code, reason: cancellation.label });
  const refreshed = await refreshSalesOrderProgress(client, context.organizationId, order.id, context.userId ?? null);
  // Everything left was cancelled and nothing was ever delivered or invoiced: that is a cancelled order.
  if (refreshed.lifecycleStatus === STATUS.confirmed && refreshed.lines.every((line) => line.ordered - line.cancelled <= EPSILON)) {
    await client.query(
      `UPDATE tenant.sales_orders SET lifecycle_status = $3, fulfillment_status = $4, billing_status = $5, cancelled_at = now(), cancelled_by = $6, cancel_reason_code = $7,
              cancel_reason = $8, updated_by = $6, updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, order.id, STATUS.cancelled, FULFILLMENT.cancelled, INVOICING.blocked, context.userId ?? null, cancellation.code, cancellation.reason]);
    await recordOrderEvent(client, context, order.id, "sales_order.cancelled", STATUS.confirmed, STATUS.cancelled, { reasonCode: cancellation.code, reason: cancellation.label });
    return { orderId: order.id, status: STATUS.cancelled, cancelled };
  }
  return { orderId: order.id, status: refreshed.lifecycleStatus, cancelled, fulfillmentStatus: refreshed.fulfillmentStatus, billingStatus: refreshed.billingStatus };
}
