// Dropship (report Phase 3): a sales order line marked "Ship from supplier" raises a purchase order addressed to the customer (the Sales
// bridge marks it here). The goods never come to us: when the supplier has delivered, "Delivered to the customer" records, in one step, the
// goods receipt (into the line's warehouse, on paper) and the sales order's delivery out of the same warehouse, dispatched and delivered,
// so stock is unchanged, the cost of the sale is the purchase price and the order and the sale move on together.
import { formatDecimal } from "../../../core/decimal.js";
import { deliverDropshipToCustomer } from "../bridges/sales.js";
import { loadPurchaseOrder, requirePoPermission } from "./access.js";
import { PO_PERMISSIONS, PurchaseOrderError, STATUS, fail, readDate, requireUuid, text } from "./constants.js";
import { databaseToday } from "./document.js";
import { recordPoEvent } from "./persist.js";
import { loadLineProgress } from "./progress.js";
import { createGoodsReceiptFromPurchaseOrder } from "./receipts.js";

// Called by the Sales bridge after it created the order: links: [{ lineNumber, salesOrderLineId }].
export async function markPurchaseOrderDropship(client, context, orderId, { salesOrderId, salesOrderNumber, customerName = null, links = [] }) {
  await client.query(
    `UPDATE tenant.purchase_orders SET dropship_sales_order_id = $3, dropship_sales_order_number = $4, dropship_customer_name = $5 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, orderId, salesOrderId, salesOrderNumber, text(customerName, 300)]);
  for (const link of links)
    await client.query(`UPDATE tenant.purchase_order_lines SET dropship_sales_order_line_id = $4 WHERE organization_id = $1 AND purchase_order_id = $2 AND line_number = $3`,
      [context.organizationId, orderId, link.lineNumber, link.salesOrderLineId]);
}

// input: { lines?: [{ purchaseOrderLineId, quantity }] (default: everything still to deliver), deliveredOn?, supplierChallanNumber?, trackingReference?,
// carrierName?, idempotencyKey? }. Returns { receiptId, receiptNumber, deliveryId, deliveryNumber }.
export async function confirmDropshipDelivery(client, context, orderId, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.receive, "You do not have permission to receive goods.");
  requirePoPermission(context, PO_PERMISSIONS.post, "You do not have permission to finalise goods receipts.");
  const order = await loadPurchaseOrder(client, context, orderId, { lock: true });
  if (!order.dropship_sales_order_id) fail("This order is not shipped by the supplier to a customer.", "orderId", "PURCHASE_ORDER_NOT_DROPSHIP", 409);
  if (order.status !== STATUS.confirmed) fail("Confirm the order first.", "orderId", "PURCHASE_ORDER_NOT_CONFIRMED", 409);
  const progress = await loadLineProgress(client, context.organizationId, order.id);
  const stored = new Map((await client.query(
    `SELECT id, line_number, dropship_sales_order_line_id, receiving_warehouse_id FROM tenant.purchase_order_lines WHERE organization_id = $1 AND purchase_order_id = $2`,
    [context.organizationId, order.id])).rows.map((row) => [row.id, row]));
  const requested = Array.isArray(input.lines) && input.lines.length
    ? input.lines.map((line) => ({ lineId: requireUuid(line.purchaseOrderLineId, "Order line"), quantity: String(line.quantity ?? "").trim() }))
    : progress.filter((line) => line.remainingToReceive > 0n).map((line) => ({ lineId: line.lineId, quantity: formatDecimal(line.remainingToReceive) }));
  const chosen = requested.filter((line) => Number(line.quantity) > 0);
  if (!chosen.length) fail("Nothing is left to deliver on this order.", "lines", "PURCHASE_ORDER_NOTHING_TO_RECEIVE", 409);
  for (const line of chosen) {
    const row = stored.get(line.lineId);
    if (!row) throw new PurchaseOrderError(404, "That order line was not found.", "PURCHASE_ORDER_LINE_NOT_FOUND");
    if (!row.dropship_sales_order_line_id) fail(`Line ${row.line_number} is not for the customer's order.`, "lines", "PURCHASE_ORDER_NOT_DROPSHIP", 409);
  }
  const warehouses = [...new Set(chosen.map((line) => stored.get(line.lineId).receiving_warehouse_id ?? order.default_warehouse_id))];
  if (warehouses.length !== 1) fail("Deliver the lines of one warehouse at a time.", "lines", "PURCHASE_ORDER_DROPSHIP_WAREHOUSES", 409);
  const deliveredOn = readDate(input.deliveredOn, "Delivered on") ?? (await databaseToday(client, context.organizationId));
  const key = text(input.idempotencyKey, 160);
  const receipt = await createGoodsReceiptFromPurchaseOrder(client, context, order.id, {
    warehouseId: warehouses[0], receiptDate: deliveredOn, supplierChallanNumber: input.supplierChallanNumber, trackingReference: input.trackingReference,
    carrierName: input.carrierName, notes: `Delivered by the supplier to ${order.dropship_customer_name ?? "the customer"} for sales order ${order.dropship_sales_order_number ?? ""}`.trim(),
    lines: chosen.map((line) => ({ purchaseOrderLineId: line.lineId, acceptedQuantity: line.quantity })), post: true, idempotencyKey: key ? `${key}:receipt` : undefined,
  });
  const delivery = await deliverDropshipToCustomer(client, context, {
    salesOrderId: order.dropship_sales_order_id, warehouseId: warehouses[0], deliveredOn, key: `dropship:${receipt.id}`,
    trackingNumber: text(input.trackingReference, 120), carrier: text(input.carrierName, 120),
    note: `Delivered by the supplier: purchase order ${order.purchase_order_number}, goods receipt ${receipt.receiptNumber}`,
    lines: chosen.map((line) => ({ salesOrderLineId: stored.get(line.lineId).dropship_sales_order_line_id, quantity: line.quantity })),
  });
  await client.query(`UPDATE tenant.goods_receipts SET dropship_delivery_id = $3, dropship_delivery_number = $4 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, receipt.id, delivery.deliveryId, delivery.deliveryNumber]);
  await recordPoEvent(client, context, order.id, "purchase_order.dropship_delivered",
    `Delivered by the supplier to the customer: goods receipt ${receipt.receiptNumber}, sales delivery ${delivery.deliveryNumber}`,
    { details: { receiptId: receipt.id, deliveryId: delivery.deliveryId } });
  return { receiptId: receipt.id, receiptNumber: receipt.receiptNumber, deliveryId: delivery.deliveryId, deliveryNumber: delivery.deliveryNumber };
}
