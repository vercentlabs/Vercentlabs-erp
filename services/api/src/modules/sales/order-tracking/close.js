// Closing an order by hand, and reopening one that was.
//
// An order closes by itself when nothing is left to deliver or invoice
// (../orders/progress.js), paid or not: collections stay with Finance. Close
// Order is for when that will not happen on its own and the work is still
// done: nothing left to deliver, but an invoicing remainder that is
// deliberately not going to be billed. It always takes a reason, never
// touches a delivered or invoiced quantity, and refuses while goods are
// still to deliver (cancel the remaining quantity first, so the order
// always reconciles: ordered = delivered + cancelled + remaining) or while a
// draft delivery or invoice is open.
import { assertOrderVisible, requireOrderPermission } from "../orders/access.js";
import { OrderError, STATUS, text } from "../orders/constants.js";
import { loadOrderLineProgress, refreshSalesOrderProgress } from "../orders/progress.js";
import { lockOrder, recordOrderEvent } from "../orders/versions.js";
import { EPSILON } from "./derive.js";
import { TRACKING_PERMISSIONS } from "./tracking.js";

// input: { reason }
export async function closeSalesOrder(client, context, orderId, input = {}) {
  requireOrderPermission(context, TRACKING_PERMISSIONS.close, "You do not have permission to close sales orders.");
  const reason = text(input.reason, 1000);
  if (!reason) throw new OrderError(400, "Give the reason for closing the order.", "SALES_ORDER_CLOSE_REASON_REQUIRED", { field: "reason" });
  const order = await lockOrder(client, context, orderId);
  await assertOrderVisible(client, context, order.id);
  if (order.lifecycle_status === STATUS.closed) return { orderId: order.id, status: STATUS.closed, changed: false };
  if (order.lifecycle_status !== STATUS.confirmed) throw new OrderError(409, "Only a confirmed order can be closed.", "SALES_ORDER_NOT_CONFIRMED");
  const lines = await loadOrderLineProgress(client, context.organizationId, order.current_version_id);
  const undelivered = lines.filter((line) => line.remainingToDeliver > EPSILON);
  if (undelivered.length)
    throw new OrderError(409, `${undelivered.map((line) => `${line.itemName} (${line.remainingToDeliver})`).join(", ")} is still to deliver. Deliver it, or cancel the remaining quantity, before closing the order.`,
      "SALES_ORDER_CLOSE_OPEN_DELIVERY");
  const open = (await client.query(
    `SELECT (SELECT string_agg(request_number, ', ') FROM tenant.sales_fulfillment_requests WHERE organization_id = $1 AND sales_order_id = $2 AND delivery_status IN ('draft', 'ready')) AS deliveries,
            (SELECT string_agg(invoice_number, ', ') FROM tenant.accounting_customer_invoices WHERE organization_id = $1 AND source_sales_order_id = $2 AND invoice_type = 'invoice'
               AND status IN ('draft', 'pending_approval', 'approved')) AS invoices,
            (SELECT count(*)::int FROM tenant.stock_reservations WHERE organization_id = $1 AND sales_order_id = $2 AND status = 'active' AND active_quantity > 0) AS reservations`,
    [context.organizationId, order.id])).rows[0];
  if (open.deliveries) throw new OrderError(409, `Delivery ${open.deliveries} is not dispatched yet. Dispatch or cancel it first.`, "SALES_ORDER_CLOSE_OPEN_DOCUMENTS");
  if (open.invoices) throw new OrderError(409, `Draft invoice ${open.invoices} is not posted yet. Post or cancel it first.`, "SALES_ORDER_CLOSE_OPEN_DOCUMENTS");
  if (open.reservations) throw new OrderError(409, "Stock is still reserved for this order. Release it first.", "SALES_ORDER_CLOSE_RESERVED");
  // What will not be invoiced: recorded, so the closure can be explained later.
  const uninvoiced = lines.filter((line) => line.remainingToInvoice > EPSILON).map((line) => ({ item: line.itemName, quantity: line.remainingToInvoice, unit: line.unit }));
  await client.query(
    `UPDATE tenant.sales_orders SET lifecycle_status = 'closed', closed_manually = true, close_reason = $3, closed_at = now(), closed_by = $4, updated_by = $4, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, order.id, reason, context.userId ?? null]);
  await recordOrderEvent(client, context, order.id, "sales_order.closed", STATUS.confirmed, STATUS.closed, { reason, manual: true, uninvoiced });
  return { orderId: order.id, status: STATUS.closed, changed: true, uninvoiced };
}

// Reopens an order that was closed by hand: it is Confirmed again with whatever was left. An order that closed by
// itself has nothing left; it opens again only when a delivery or invoice of it is undone. input: { reason }
export async function reopenClosedSalesOrder(client, context, orderId, input = {}) {
  requireOrderPermission(context, TRACKING_PERMISSIONS.reopenClosed, "You do not have permission to reopen closed sales orders.");
  const reason = text(input.reason, 1000);
  if (!reason) throw new OrderError(400, "Give the reason for reopening the order.", "SALES_ORDER_REOPEN_REASON_REQUIRED", { field: "reason" });
  const order = await lockOrder(client, context, orderId);
  await assertOrderVisible(client, context, order.id);
  if (order.lifecycle_status !== STATUS.closed) throw new OrderError(409, "Only a closed order can be reopened this way.", "SALES_ORDER_NOT_CLOSED");
  if (!order.closed_manually)
    throw new OrderError(409, "This order closed because nothing is left to deliver or invoice, so there is nothing to reopen. For more goods or services, create a new sales order.",
      "SALES_ORDER_COMPLETED");
  await client.query(
    `UPDATE tenant.sales_orders SET lifecycle_status = 'confirmed', closed_manually = false, close_reason = NULL, closed_at = NULL, closed_by = NULL, updated_by = $3, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, order.id, context.userId ?? null]);
  await recordOrderEvent(client, context, order.id, "sales_order.reopened_closed", STATUS.closed, STATUS.confirmed, { reason });
  const refreshed = await refreshSalesOrderProgress(client, context.organizationId, order.id, context.userId ?? null);
  return { orderId: order.id, status: refreshed?.lifecycleStatus ?? STATUS.confirmed, changed: true };
}
