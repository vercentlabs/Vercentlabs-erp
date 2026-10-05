// Deliveries of a sales order. An order can be delivered in several parts
// (SO-001 → DEL-001 for 6, DEL-002 for 4); each delivery names the order
// lines and quantities that left. Only goods are delivered: a service line is
// never on a delivery. A delivery cannot deliver more than is left on a line.
//
// Recording a delivery issues the stock of stock-tracked lines from their
// warehouse (consuming what was reserved for the line) and is the only way an
// order's delivered quantity changes. A retried request with the same key
// returns the delivery already made.
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { postStockMovement } from "../../stock/index.js";
import { assertOrderVisible, requireOrderAccess, requireOrderPermission } from "./access.js";
import { ORDER_PERMISSIONS, OrderError, STATUS, requireUuid, text } from "./constants.js";
import { loadOrderLineProgress, refreshSalesOrderProgress } from "./progress.js";
import { consumeLineReservation, orderStockContext } from "./stock.js";
import { lockOrder, readDate, recordOrderEvent } from "./versions.js";

const EPSILON = 1e-6;

// What a new delivery of the order would carry: every goods line with something left.
export async function getDeliveryProposal(client, context, orderId) {
  requireOrderAccess(context);
  const order = await lockOrder(client, context, orderId);
  await assertOrderVisible(client, context, order.id);
  const lines = await loadOrderLineProgress(client, context.organizationId, order.current_version_id);
  return {
    orderId: order.id, canDeliver: order.lifecycle_status === STATUS.confirmed,
    lines: lines.filter((line) => line.deliverable && line.remainingToDeliver > EPSILON).map((line) => ({
      salesOrderLineId: line.lineId, itemName: line.itemName, unit: line.unit, ordered: line.ordered, delivered: line.delivered, reserved: line.reserved,
      remaining: line.remainingToDeliver, stockTracked: line.stockTracked, warehouseId: line.warehouseId,
    })),
  };
}

// input: { idempotencyKey, lines?: [{ salesOrderLineId, quantity }], deliveryDate?, carrier?, trackingNumber?, notes? }
// Without `lines`, everything left on the order's goods lines is delivered.
export async function createDeliveryFromSalesOrder(client, context, orderId, input = {}) {
  requireOrderPermission(context, ORDER_PERMISSIONS.deliver, "You do not have permission to create deliveries.");
  const key = text(input.idempotencyKey, 200);
  if (!key) throw new OrderError(400, "A request key is required to create a delivery.", "SALES_ORDER_VALIDATION");
  const order = await lockOrder(client, context, orderId);
  await assertOrderVisible(client, context, order.id);
  const existing = (await client.query(`SELECT id, request_number, sales_order_id FROM tenant.sales_fulfillment_requests WHERE organization_id = $1 AND idempotency_key = $2`,
    [context.organizationId, key])).rows[0];
  if (existing) {
    if (existing.sales_order_id !== order.id) throw new OrderError(409, "That request key was used for another order.", "SALES_ORDER_VALIDATION");
    return { deliveryId: existing.id, deliveryNumber: existing.request_number, replayed: true };
  }
  if (order.lifecycle_status !== STATUS.confirmed) throw new OrderError(409, "Only a confirmed order can be delivered.", "SALES_ORDER_NOT_CONFIRMED");
  const progress = await loadOrderLineProgress(client, context.organizationId, order.current_version_id);
  const byId = new Map(progress.map((line) => [line.lineId, line]));
  const chosen = Array.isArray(input.lines) && input.lines.length
    ? input.lines.map((entry) => ({ line: byId.get(requireUuid(entry.salesOrderLineId, "Order line")), quantity: Number(entry.quantity) })).filter((entry) => !(entry.quantity === 0))
    : progress.filter((line) => line.deliverable && line.remainingToDeliver > EPSILON).map((line) => ({ line, quantity: line.remainingToDeliver }));
  if (!chosen.length) throw new OrderError(409, "Nothing is left to deliver on this order.", "SALES_ORDER_NOTHING_TO_DELIVER");
  const seen = new Set();
  for (const { line, quantity } of chosen) {
    if (!line) throw new OrderError(404, "An order line was not found on this order.", "SALES_ORDER_LINE_NOT_FOUND");
    if (seen.has(line.lineId)) throw new OrderError(400, `${line.itemName} is on the delivery twice.`, "SALES_ORDER_VALIDATION");
    seen.add(line.lineId);
    if (!line.deliverable) throw new OrderError(409, `${line.itemName} is a service and is not delivered.`, "SALES_ORDER_LINE_NOT_DELIVERABLE");
    if (!Number.isFinite(quantity) || quantity <= 0) throw new OrderError(400, `${line.itemName}: enter the quantity delivered.`, "SALES_ORDER_VALIDATION");
    if (quantity > line.remainingToDeliver + EPSILON)
      throw new OrderError(409, `${line.itemName}: only ${line.remainingToDeliver} ${line.unit ?? ""} is left to deliver.`.replace("  ", " "), "SALES_ORDER_DELIVERY_EXCEEDS_REMAINING");
    if (line.stockTracked && !line.warehouseId) throw new OrderError(409, `${line.itemName}: the order line has no warehouse to ship from.`, "SALES_ORDER_WAREHOUSE_REQUIRED");
  }
  const deliveryDate = readDate(input.deliveryDate, "Delivery date");
  const number = await nextDocumentNumber(client, { organizationId: context.organizationId }, { documentType: "sales_fulfillment_request", at: deliveryDate ?? new Date() });
  const carrier = text(input.carrier, 120);
  const delivery = (await client.query(
    `INSERT INTO tenant.sales_fulfillment_requests (organization_id, request_number, sales_order_id, sales_order_version_id, idempotency_key, status, payload, requested_by, completed_at,
        delivery_date, carrier, tracking_number, shipped_at, notes)
     VALUES ($1, $2, $3, $4, $5, 'completed', $6::jsonb, $7, now(), COALESCE($8::date, current_date), $9, $10, CASE WHEN $9::text IS NULL THEN NULL ELSE now() END, $11)
     RETURNING id, request_number, delivery_date`,
    [context.organizationId, number, order.id, order.current_version_id, key, JSON.stringify({ salesOrderNumber: order.sales_order_number, lines: chosen.length }), context.userId ?? null,
      deliveryDate, carrier, text(input.trackingNumber, 120), text(input.notes, 2000)])).rows[0];
  const stock = orderStockContext(context);
  for (const { line, quantity } of chosen) {
    const baseQuantity = Math.round(quantity * line.conversionFactor * 1e6) / 1e6;
    await client.query(
      `INSERT INTO tenant.sales_delivery_lines (organization_id, delivery_id, sales_order_id, sales_order_line_id, item_id, warehouse_id, quantity, base_quantity, uom_snapshot, stock_issued)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [context.organizationId, delivery.id, order.id, line.lineId, line.itemId, line.warehouseId, quantity, baseQuantity, line.unit, line.stockTracked]);
    if (!line.stockTracked) continue;
    // The goods leave: what was reserved for the line is consumed and the stock is issued.
    await consumeLineReservation(client, context, line.lineId, { itemId: line.itemId, warehouseId: line.warehouseId, baseQuantity });
    try {
      await postStockMovement(client, stock, {
        movementType: "issue", itemId: line.itemId, warehouseId: line.warehouseId, quantity: baseQuantity, referenceType: "sales_delivery", referenceId: delivery.id,
        idempotencyKey: `sales-delivery:${delivery.id}:${line.lineId}`,
      });
    } catch (error) {
      if (error?.name !== "StockError") throw error;
      throw new OrderError(409, `${line.itemName}: ${error.message}`, error.code ?? "SALES_ORDER_STOCK_UNAVAILABLE");
    }
  }
  await recordOrderEvent(client, context, order.id, "sales_order.delivery_created", STATUS.confirmed, STATUS.confirmed, {
    deliveryId: delivery.id, deliveryNumber: delivery.request_number, lines: chosen.map(({ line, quantity }) => ({ item: line.itemName, quantity, unit: line.unit })),
  });
  const refreshed = await refreshSalesOrderProgress(client, context.organizationId, order.id, context.userId ?? null);
  return { deliveryId: delivery.id, deliveryNumber: delivery.request_number, replayed: false, orderStatus: refreshed.lifecycleStatus, fulfillmentStatus: refreshed.fulfillmentStatus };
}

// The carrier and tracking number of a delivery that has left. input: { carrier, trackingNumber?, shippedAt? }
export async function recordDeliveryShipment(client, context, deliveryId, input = {}) {
  requireOrderPermission(context, ORDER_PERMISSIONS.deliver, "You do not have permission to update deliveries.");
  const carrier = text(input.carrier, 120);
  if (!carrier) throw new OrderError(400, "Enter the carrier.", "SALES_DELIVERY_VALIDATION", { field: "carrier" });
  const shippedAt = input.shippedAt ? new Date(input.shippedAt) : new Date();
  if (Number.isNaN(shippedAt.getTime()) || shippedAt.getTime() > Date.now() + 60_000) throw new OrderError(400, "The shipped date is not valid.", "SALES_DELIVERY_VALIDATION", { field: "shippedAt" });
  const delivery = (await client.query(`SELECT id, sales_order_id, request_number, status, delivered_at FROM tenant.sales_fulfillment_requests WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
    [context.organizationId, requireUuid(deliveryId, "Delivery")])).rows[0];
  if (!delivery || delivery.status !== "completed") throw new OrderError(404, "Delivery not found.", "SALES_DELIVERY_NOT_FOUND");
  await assertOrderVisible(client, context, delivery.sales_order_id);
  if (delivery.delivered_at) throw new OrderError(409, "This delivery has already been received.", "SALES_DELIVERY_RECEIVED");
  const trackingNumber = text(input.trackingNumber, 120);
  await client.query(`UPDATE tenant.sales_fulfillment_requests SET carrier = $3, tracking_number = $4, shipped_at = $5 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, delivery.id, carrier, trackingNumber, shippedAt]);
  await recordOrderEvent(client, context, delivery.sales_order_id, "sales_order.shipped", STATUS.confirmed, STATUS.confirmed,
    { deliveryId: delivery.id, deliveryNumber: delivery.request_number, carrier, trackingNumber });
  return { deliveryId: delivery.id, carrier, trackingNumber, shippedAt };
}

// The customer received the goods. input: { receivedBy, deliveredAt?, note? }
export async function recordDeliveryReceipt(client, context, deliveryId, input = {}) {
  requireOrderPermission(context, ORDER_PERMISSIONS.deliver, "You do not have permission to update deliveries.");
  const receivedBy = text(input.receivedBy, 160);
  if (!receivedBy) throw new OrderError(400, "Say who received the goods.", "SALES_DELIVERY_VALIDATION", { field: "receivedBy" });
  const delivery = (await client.query(`SELECT id, sales_order_id, request_number, status, delivered_at, completed_at FROM tenant.sales_fulfillment_requests WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
    [context.organizationId, requireUuid(deliveryId, "Delivery")])).rows[0];
  if (!delivery || delivery.status !== "completed") throw new OrderError(404, "Delivery not found.", "SALES_DELIVERY_NOT_FOUND");
  await assertOrderVisible(client, context, delivery.sales_order_id);
  if (delivery.delivered_at) return { deliveryId: delivery.id, deliveredAt: delivery.delivered_at, replayed: true };
  const deliveredAt = input.deliveredAt ? new Date(input.deliveredAt) : new Date();
  if (Number.isNaN(deliveredAt.getTime()) || deliveredAt.getTime() > Date.now() + 60_000) throw new OrderError(400, "The received date is not valid.", "SALES_DELIVERY_VALIDATION", { field: "deliveredAt" });
  const note = text(input.note, 1000);
  await client.query(`UPDATE tenant.sales_fulfillment_requests SET delivered_at = $3, received_by = $4, delivery_note = $5, shipped_at = COALESCE(shipped_at, completed_at) WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, delivery.id, deliveredAt, receivedBy, note]);
  await recordOrderEvent(client, context, delivery.sales_order_id, "sales_order.delivery_received", STATUS.confirmed, STATUS.confirmed,
    { deliveryId: delivery.id, deliveryNumber: delivery.request_number, receivedBy, note });
  return { deliveryId: delivery.id, deliveredAt, receivedBy };
}
