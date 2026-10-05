// A delivery's life: Draft → Ready to dispatch → Dispatched → Delivered, or
// Cancelled before it is dispatched. Every transition is its own operation.
//
// Dispatch is the moment the goods leave: under the order's lock it checks
// again that each line still has that much to deliver, consumes the line's
// reservations (issuing from the very rows they hold) and takes anything
// beyond them from stock that is free now, all in one transaction. Nothing
// is issued if any line fails. Dispatching or marking delivered again
// returns what was done the first time.
//
// A dispatched delivery is never cancelled or edited (its quantities are
// locked by the database too); goods coming back use a sales return.
import { StockError } from "../../stock/index.js";
import { changeSalesOrderLineWarehouse } from "../availability/warehouse.js";
import { STATUS, dayOf, requireUuid, text } from "../orders/constants.js";
import { loadOrderLineProgress, refreshSalesOrderProgress } from "../orders/progress.js";
import { lockOrder, readDate, recordOrderEvent } from "../orders/versions.js";
import { consumeReservationForDelivery } from "../reservations/service.js";
import { deliveryCan, loadDelivery, requireDeliveryPermission } from "./access.js";
import { DELIVERY_CANCEL_REASONS, DELIVERY_PERMISSIONS, DELIVERY_STATUS, DeliveryError, OPEN, SHIPPED } from "./constants.js";
import { recordDeliveryEvent } from "./records.js";
import { SHIPMENT_FIELDS, readPackageCount, readTrackingUrl } from "./shipment.js";

const EPSILON = 1e-6;
const round = (value) => Math.round(Number(value) * 1e6) / 1e6;

async function deliveryLines(client, organizationId, deliveryId) {
  return (await client.query(
    `SELECT id, sales_order_line_id, item_id, warehouse_id, quantity, item_name_snapshot, uom_snapshot FROM tenant.sales_delivery_lines
      WHERE organization_id = $1 AND delivery_id = $2 ORDER BY sequence NULLS LAST, created_at`, [organizationId, deliveryId])).rows;
}

function checkVersion(delivery, input) {
  if (input.expectedVersion != null && Number(input.expectedVersion) !== Number(delivery.version))
    throw new DeliveryError(409, "Someone else changed this delivery. Reload it and try again.", "SALES_DELIVERY_VERSION_CONFLICT");
}

function readPastDate(value, label, { notBefore } = {}) {
  const day = readDate(value, label);
  if (!day) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (day > today) throw new DeliveryError(400, `${label} cannot be in the future.`, "SALES_DELIVERY_VALIDATION", { field: label });
  if (notBefore && day < notBefore) throw new DeliveryError(400, `${label} cannot be before ${notBefore}.`, "SALES_DELIVERY_VALIDATION", { field: label });
  return day;
}

// Draft → Ready to dispatch: the lines are checked and the delivery is handed to the warehouse.
export async function markDeliveryReady(client, context, deliveryId, input = {}) {
  requireDeliveryPermission(context, DELIVERY_PERMISSIONS.edit, "You do not have permission to prepare deliveries.");
  const delivery = await loadDelivery(client, context, deliveryId, { lock: true });
  if (delivery.delivery_status === DELIVERY_STATUS.ready) return { deliveryId: delivery.id, status: DELIVERY_STATUS.ready, changed: false };
  if (delivery.delivery_status !== DELIVERY_STATUS.draft) throw new DeliveryError(409, "Only a draft delivery can be marked ready.", "SALES_DELIVERY_LOCKED");
  checkVersion(delivery, input);
  if (delivery.order_status !== STATUS.confirmed) throw new DeliveryError(409, "The order is no longer confirmed.", "SALES_ORDER_NOT_CONFIRMED");
  const lines = await deliveryLines(client, context.organizationId, delivery.id);
  if (!lines.length) throw new DeliveryError(409, "Add at least one line before marking the delivery ready.", "SALES_DELIVERY_EMPTY");
  if (!delivery.shipping_address_snapshot || !Object.keys(delivery.shipping_address_snapshot).length)
    throw new DeliveryError(409, "Choose the ship-to address first.", "SALES_DELIVERY_ADDRESS_REQUIRED");
  await client.query(`UPDATE tenant.sales_fulfillment_requests SET delivery_status = 'ready', ready_at = now(), ready_by = $3, version = version + 1 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, delivery.id, context.userId ?? null]);
  await recordDeliveryEvent(client, context, delivery.id, "sales_delivery.ready", DELIVERY_STATUS.draft, DELIVERY_STATUS.ready);
  return { deliveryId: delivery.id, status: DELIVERY_STATUS.ready, changed: true };
}

// Ready → Draft, to change its lines.
export async function returnDeliveryToDraft(client, context, deliveryId, input = {}) {
  requireDeliveryPermission(context, DELIVERY_PERMISSIONS.edit, "You do not have permission to prepare deliveries.");
  const delivery = await loadDelivery(client, context, deliveryId, { lock: true });
  if (delivery.delivery_status === DELIVERY_STATUS.draft) return { deliveryId: delivery.id, status: DELIVERY_STATUS.draft, changed: false };
  if (delivery.delivery_status !== DELIVERY_STATUS.ready) throw new DeliveryError(409, "Only a delivery ready to dispatch can go back to draft.", "SALES_DELIVERY_LOCKED");
  checkVersion(delivery, input);
  await client.query(`UPDATE tenant.sales_fulfillment_requests SET delivery_status = 'draft', ready_at = NULL, ready_by = NULL, version = version + 1 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, delivery.id]);
  await recordDeliveryEvent(client, context, delivery.id, "sales_delivery.returned_to_draft", DELIVERY_STATUS.ready, DELIVERY_STATUS.draft, { reason: text(input.reason, 500) ?? undefined });
  return { deliveryId: delivery.id, status: DELIVERY_STATUS.draft, changed: true };
}

// The goods leave. input: { dispatchDate?, carrier?, trackingNumber?, trackingUrl?, vehicleReference?, packageCount?, expectedVersion? }
export async function dispatchDelivery(client, context, deliveryId, input = {}) {
  requireDeliveryPermission(context, DELIVERY_PERMISSIONS.dispatch, "You do not have permission to dispatch deliveries.");
  // The order is locked first (as everything that changes its quantities does), then the delivery.
  const seen = await loadDelivery(client, context, deliveryId);
  const order = await lockOrder(client, context, seen.sales_order_id);
  const delivery = await loadDelivery(client, context, deliveryId, { lock: true });
  if (SHIPPED.includes(delivery.delivery_status))
    return { deliveryId: delivery.id, deliveryNumber: delivery.request_number, status: delivery.delivery_status, replayed: true, fulfillmentStatus: order.fulfillment_status };
  if (delivery.delivery_status === DELIVERY_STATUS.cancelled) throw new DeliveryError(409, "A cancelled delivery cannot be dispatched.", "SALES_DELIVERY_CANCELLED");
  checkVersion(delivery, input);
  if (order.lifecycle_status !== STATUS.confirmed)
    throw new DeliveryError(409, "Only a confirmed order's delivery can be dispatched.", "SALES_ORDER_NOT_CONFIRMED");
  const dispatchDate = readPastDate(input.dispatchDate, "Dispatch date", { notBefore: dayOf(order.confirmed_at) }) ?? new Date().toISOString().slice(0, 10);
  const shipment = {
    carrier: text(input.carrier, 120) ?? delivery.carrier, tracking_number: text(input.trackingNumber, 120) ?? delivery.tracking_number,
    vehicle_reference: text(input.vehicleReference, 120) ?? delivery.vehicle_reference,
    tracking_url: input.trackingUrl === undefined ? delivery.tracking_url : readTrackingUrl(input.trackingUrl),
    package_count: input.packageCount === undefined ? delivery.package_count : readPackageCount(input.packageCount),
  };
  const lines = await deliveryLines(client, context.organizationId, delivery.id);
  if (!lines.length) throw new DeliveryError(409, "The delivery has no lines.", "SALES_DELIVERY_EMPTY");
  const progress = new Map((await loadOrderLineProgress(client, context.organizationId, order.current_version_id)).map((line) => [line.lineId, line]));

  // Every line is checked before any stock moves.
  for (const line of lines) {
    const state = progress.get(line.sales_order_line_id);
    if (!state)
      throw new DeliveryError(409, `${line.item_name_snapshot} is no longer on the order. Cancel this delivery and create a new one.`, "SALES_DELIVERY_ORDER_CHANGED");
    if (Number(line.quantity) > state.remainingToDeliver + EPSILON)
      throw new DeliveryError(409, `${line.item_name_snapshot}: only ${state.remainingToDeliver} ${state.unit ?? ""} is left to deliver on the order. Change the quantity first.`.replace("  ", " "),
        "SALES_ORDER_DELIVERY_EXCEEDS_REMAINING");
    if (state.stockTracked && line.warehouse_id !== state.warehouseId)
      throw new DeliveryError(409, `${line.item_name_snapshot} now ships from another warehouse. Change the delivery's warehouse first.`, "SALES_DELIVERY_WAREHOUSE_MISMATCH");
  }
  const consumption = [];
  for (const line of lines) {
    const state = progress.get(line.sales_order_line_id);
    if (!state.stockTracked) continue;
    try {
      const used = await consumeReservationForDelivery(client, context, {
        order, line: state, warehouseId: delivery.warehouse_id, quantity: Number(line.quantity), deliveryId: delivery.id, deliveryLineId: line.id,
      });
      consumption.push({ item: state.itemName, unit: state.unit, reservations: used.consumed, fromFreeStock: used.fromFreeStock });
    } catch (error) {
      if (!(error instanceof StockError)) throw error;
      throw new DeliveryError(409, `${state.itemName}: ${error.message}`, error.code ?? "SALES_ORDER_STOCK_UNAVAILABLE");
    }
  }
  await client.query(
    `UPDATE tenant.sales_delivery_lines line SET stock_issued = COALESCE(item.track_inventory, false) AND item.item_type <> 'service', updated_at = now()
       FROM tenant.items item WHERE item.organization_id = line.organization_id AND item.id = line.item_id AND line.organization_id = $1 AND line.delivery_id = $2`,
    [context.organizationId, delivery.id]);
  await client.query(
    `UPDATE tenant.sales_fulfillment_requests
        SET delivery_status = 'dispatched', dispatch_date = $3::date, dispatched_at = now(), dispatched_by = $4, shipped_at = now(), completed_at = now(), delivery_date = $3::date,
            carrier = $5, tracking_number = $6, vehicle_reference = $7, tracking_url = $8, package_count = $9, ready_at = COALESCE(ready_at, now()), ready_by = COALESCE(ready_by, $4), version = version + 1
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, delivery.id, dispatchDate, context.userId ?? null, shipment.carrier, shipment.tracking_number, shipment.vehicle_reference,
      shipment.tracking_url, shipment.package_count]);
  const summary = lines.map((line) => ({ item: line.item_name_snapshot, quantity: Number(line.quantity), unit: line.uom_snapshot }));
  await recordDeliveryEvent(client, context, delivery.id, "sales_delivery.dispatched", delivery.delivery_status, DELIVERY_STATUS.dispatched, {
    dispatchDate, carrier: shipment.carrier, trackingNumber: shipment.tracking_number, lines: summary,
    stock: consumption.map((entry) => ({ item: entry.item, unit: entry.unit, reservations: entry.reservations, fromFreeStock: entry.fromFreeStock })),
  });
  await recordOrderEvent(client, context, order.id, "sales_order.delivery_dispatched", order.lifecycle_status, order.lifecycle_status,
    { deliveryId: delivery.id, deliveryNumber: delivery.request_number, dispatchDate, lines: summary });
  if (consumption.some((entry) => entry.reservations.length))
    await recordOrderEvent(client, context, order.id, "sales_order.reservation_consumed", order.lifecycle_status, order.lifecycle_status, {
      deliveryId: delivery.id, deliveryNumber: delivery.request_number,
      lines: consumption.filter((entry) => entry.reservations.length).map((entry) => ({
        item: entry.item, unit: entry.unit, quantity: round(entry.reservations.reduce((total, used) => total + used.quantity, 0)),
        reservations: entry.reservations.map((used) => used.reservation).filter(Boolean),
      })),
    });
  const refreshed = await refreshSalesOrderProgress(client, context.organizationId, order.id, context.userId ?? null);
  return { deliveryId: delivery.id, deliveryNumber: delivery.request_number, status: DELIVERY_STATUS.dispatched, replayed: false, dispatchDate,
    orderStatus: refreshed.lifecycleStatus, fulfillmentStatus: refreshed.fulfillmentStatus };
}

// The customer received the goods. input: { deliveredAt? (date), receivedBy?, note? }
export async function markDeliveryDelivered(client, context, deliveryId, input = {}) {
  requireDeliveryPermission(context, DELIVERY_PERMISSIONS.deliver, "You do not have permission to mark deliveries delivered.");
  const delivery = await loadDelivery(client, context, deliveryId, { lock: true });
  if (delivery.delivery_status === DELIVERY_STATUS.delivered)
    return { deliveryId: delivery.id, status: DELIVERY_STATUS.delivered, deliveredAt: delivery.delivered_at, replayed: true };
  if (delivery.delivery_status !== DELIVERY_STATUS.dispatched)
    throw new DeliveryError(409, delivery.delivery_status === DELIVERY_STATUS.cancelled ? "A cancelled delivery cannot be delivered." : "Dispatch the delivery first.", "SALES_DELIVERY_NOT_DISPATCHED");
  const day = readPastDate(input.deliveredAt, "Delivered date", { notBefore: dayOf(delivery.dispatch_date) });
  const receivedBy = text(input.receivedBy, 160);
  const note = text(input.note, 1000);
  const deliveredAt = (await client.query(
    `UPDATE tenant.sales_fulfillment_requests
        SET delivery_status = 'delivered', delivered_at = CASE WHEN $3::date IS NULL OR $3::date = current_date THEN now() ELSE $3::date + time '12:00' END,
            delivered_by = $4, received_by = $5, delivery_note = $6, version = version + 1
      WHERE organization_id = $1 AND id = $2 RETURNING delivered_at`,
    [context.organizationId, delivery.id, day, context.userId ?? null, receivedBy, note])).rows[0].delivered_at;
  await recordDeliveryEvent(client, context, delivery.id, "sales_delivery.delivered", DELIVERY_STATUS.dispatched, DELIVERY_STATUS.delivered,
    { deliveredAt, receivedBy, note });
  await recordOrderEvent(client, context, delivery.sales_order_id, "sales_order.delivery_received", delivery.order_status, delivery.order_status,
    { deliveryId: delivery.id, deliveryNumber: delivery.request_number, receivedBy, note });
  return { deliveryId: delivery.id, status: DELIVERY_STATUS.delivered, deliveredAt, receivedBy, replayed: false };
}

// Cancels a delivery before it is dispatched. Nothing moved, so nothing is reversed; the
// order's reservations stay as they are. input: { reasonCode, reason? }
export async function cancelDelivery(client, context, deliveryId, input = {}) {
  requireDeliveryPermission(context, DELIVERY_PERMISSIONS.cancel, "You do not have permission to cancel deliveries.");
  const delivery = await loadDelivery(client, context, deliveryId, { lock: true });
  if (delivery.delivery_status === DELIVERY_STATUS.cancelled) return { deliveryId: delivery.id, status: DELIVERY_STATUS.cancelled, changed: false };
  if (SHIPPED.includes(delivery.delivery_status))
    throw new DeliveryError(409, "A dispatched delivery cannot be cancelled. Record a sales return for goods that come back.", "SALES_DELIVERY_DISPATCHED");
  const code = text(input.reasonCode, 40);
  const reason = text(input.reason, 1000);
  if (!code || !DELIVERY_CANCEL_REASONS.some((entry) => entry.code === code))
    throw new DeliveryError(400, "Choose the reason for cancelling.", "SALES_DELIVERY_CANCEL_REASON_REQUIRED", { field: "reasonCode" });
  if (code === "other" && !reason) throw new DeliveryError(400, "Describe the reason for cancelling.", "SALES_DELIVERY_CANCEL_REASON_REQUIRED", { field: "reason" });
  const label = [DELIVERY_CANCEL_REASONS.find((entry) => entry.code === code).label, reason].filter(Boolean).join(": ");
  await client.query(
    `UPDATE tenant.sales_fulfillment_requests SET delivery_status = 'cancelled', cancelled_at = now(), cancelled_by = $3, cancel_reason_code = $4, cancel_reason = $5, version = version + 1
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, delivery.id, context.userId ?? null, code, label]);
  await recordDeliveryEvent(client, context, delivery.id, "sales_delivery.cancelled", delivery.delivery_status, DELIVERY_STATUS.cancelled, { reasonCode: code, reason: label });
  await recordOrderEvent(client, context, delivery.sales_order_id, "sales_order.delivery_cancelled", delivery.order_status, delivery.order_status,
    { deliveryId: delivery.id, deliveryNumber: delivery.request_number, reasonCode: code, reason: label });
  return { deliveryId: delivery.id, status: DELIVERY_STATUS.cancelled, changed: true };
}

// Carrier, tracking, vehicle, expected date and packages: until the goods are delivered.
export async function updateShipmentDetails(client, context, deliveryId, input = {}) {
  requireDeliveryPermission(context, DELIVERY_PERMISSIONS.edit, "You do not have permission to update shipments.");
  const delivery = await loadDelivery(client, context, deliveryId, { lock: true });
  if (![...OPEN, DELIVERY_STATUS.dispatched].includes(delivery.delivery_status))
    throw new DeliveryError(409, "The shipment of a delivered or cancelled delivery cannot be changed.", "SALES_DELIVERY_LOCKED");
  checkVersion(delivery, input);
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined;
  const values = [context.organizationId, delivery.id];
  const sets = [];
  const changes = [];
  for (const [key, [column, read]] of Object.entries(SHIPMENT_FIELDS)) {
    if (!has(key)) continue;
    const value = read(input[key]);
    const current = column === "expected_delivery_date" ? dayOf(delivery[column]) : delivery[column];
    if (String(current ?? "") === String(value ?? "")) continue;
    values.push(value);
    sets.push(`${column} = $${values.length}`);
    changes.push({ what: key, from: current ?? null, to: value ?? null });
  }
  if (!changes.length) return { deliveryId: delivery.id, changed: false, version: Number(delivery.version) };
  const version = (await client.query(`UPDATE tenant.sales_fulfillment_requests SET ${sets.join(", ")}, version = version + 1 WHERE organization_id = $1 AND id = $2 RETURNING version`, values)).rows[0].version;
  await recordDeliveryEvent(client, context, delivery.id, "sales_delivery.shipment_updated", delivery.delivery_status, delivery.delivery_status, { changes });
  return { deliveryId: delivery.id, changed: true, changes, version: Number(version) };
}
// Moves a draft delivery to another warehouse: each stock line's fulfillment warehouse
// changes with it (releasing its reservation there and reserving in the new one).
// input: { warehouseId, reason? }
export async function changeDeliveryWarehouse(client, context, deliveryId, input = {}) {
  requireDeliveryPermission(context, DELIVERY_PERMISSIONS.edit, "You do not have permission to prepare deliveries.");
  if (!deliveryCan(context, DELIVERY_PERMISSIONS.changeWarehouse))
    throw new DeliveryError(403, "You do not have permission to change the fulfillment warehouse.", "PERMISSION_DENIED");
  const warehouseId = requireUuid(input.warehouseId, "Warehouse");
  const seen = await loadDelivery(client, context, deliveryId);
  await lockOrder(client, context, seen.sales_order_id);
  const delivery = await loadDelivery(client, context, deliveryId, { lock: true });
  if (delivery.delivery_status !== DELIVERY_STATUS.draft) throw new DeliveryError(409, "Return the delivery to Draft to change its warehouse.", "SALES_DELIVERY_LOCKED");
  if (delivery.warehouse_id === warehouseId) return { deliveryId: delivery.id, changed: false };
  const warehouse = (await client.query(`SELECT id, name, status, sales_fulfillment FROM tenant.warehouses WHERE organization_id = $1 AND id = $2`, [context.organizationId, warehouseId])).rows[0];
  if (!warehouse) throw new DeliveryError(404, "Warehouse not found.", "SALES_WAREHOUSE_NOT_FOUND");
  if (warehouse.status !== "active" || !warehouse.sales_fulfillment)
    throw new DeliveryError(409, `${warehouse.name} is inactive or not used for sales fulfillment.`, "SALES_WAREHOUSE_NOT_ELIGIBLE");
  const lines = (await client.query(
    `SELECT line.id, line.sales_order_line_id, line.item_name_snapshot, COALESCE(item.track_inventory, false) AND item.item_type <> 'service' AS stock_tracked
       FROM tenant.sales_delivery_lines line JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
      WHERE line.organization_id = $1 AND line.delivery_id = $2`, [context.organizationId, delivery.id])).rows;
  const from = delivery.warehouse_id;
  let released = 0;
  for (const line of lines.filter((entry) => entry.stock_tracked)) {
    const result = await changeSalesOrderLineWarehouse(client, context, delivery.sales_order_id, { lineId: line.sales_order_line_id, warehouseId, reason: text(input.reason, 500) });
    released += result.reservationsReleased ?? 0;
  }
  await client.query(`UPDATE tenant.sales_delivery_lines line SET warehouse_id = $3, updated_at = now() WHERE line.organization_id = $1 AND line.delivery_id = $2 AND line.warehouse_id IS NOT NULL`,
    [context.organizationId, delivery.id, warehouseId]);
  await client.query(`UPDATE tenant.sales_fulfillment_requests SET warehouse_id = $3, version = version + 1 WHERE organization_id = $1 AND id = $2`, [context.organizationId, delivery.id, warehouseId]);
  const names = new Map((await client.query(`SELECT id, name FROM tenant.warehouses WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
    [context.organizationId, [from, warehouseId].filter(Boolean)])).rows.map((row) => [row.id, row.name]));
  await recordDeliveryEvent(client, context, delivery.id, "sales_delivery.warehouse_changed", delivery.delivery_status, delivery.delivery_status,
    { from: names.get(from) ?? null, to: names.get(warehouseId), reason: text(input.reason, 500) ?? undefined, reservationsReleased: released });
  await refreshSalesOrderProgress(client, context.organizationId, delivery.sales_order_id, context.userId ?? null);
  return { deliveryId: delivery.id, changed: true, warehouseId };
}
