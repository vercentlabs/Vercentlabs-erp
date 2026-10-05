// A sales order's stock: availability, reservation and release.
//
// A quotation never commits stock; a confirmed sales order can. Only lines
// for stock-tracked products take part (a service or a non-stock product has
// nothing to check or reserve), each against the warehouse on the line.
//
// Stock stays the owner of stock: availability comes from Stock, a
// reservation is made by Stock (which locks the product, so two orders can
// never reserve the same unit) and lowers what is available, not what is on
// hand. Stock on hand falls only when a delivery issues the goods. A
// reservation belongs to its order line and is released when the delivery
// consumes it or the line, or the order, is cancelled or reopened.
import {
  getStockAvailability, listActiveStockReservationsByReference, releaseStockReservation, reserveStock,
} from "../../stock/index.js";
import { assertOrderVisible, requireOrderAccess, requireOrderPermission } from "./access.js";
import { ORDER_PERMISSIONS, OrderError, STATUS, requireUuid, text } from "./constants.js";
import { loadOrderLineProgress, refreshSalesOrderProgress } from "./progress.js";
import { lockOrder, recordOrderEvent } from "./versions.js";

export const RESERVATION_REFERENCE = "sales_order_line";
const EPSILON = 1e-6;
const round = (value) => Math.round(value * 1e6) / 1e6;

// Reserving and issuing for an order needs Stock rights the salesperson may
// not hold; the Sales permission checked by each operation is what authorises it.
export function orderStockContext(context) {
  return { organizationId: context.organizationId, userId: context.userId ?? null, permissions: ["stock.view", "stock.reserve", "stock.issue"], roleSlugs: [] };
}

// For every stock-tracked line still to deliver: ordered, on hand, reserved
// for other demand, available, already reserved for this line and the
// shortage, in the line's selling unit.
export async function checkSalesOrderAvailability(client, context, orderId) {
  requireOrderAccess(context);
  const order = await lockOrder(client, context, orderId);
  await assertOrderVisible(client, context, order.id);
  const lines = await loadOrderLineProgress(client, context.organizationId, order.current_version_id);
  const stock = orderStockContext(context);
  const warehouses = new Map((await client.query(`SELECT id, name FROM tenant.warehouses WHERE organization_id = $1`, [context.organizationId])).rows.map((row) => [row.id, row.name]));
  const result = [];
  for (const line of lines) {
    if (!line.stockTracked) continue;
    const toDeliver = line.remainingToDeliver;
    const base = { lineId: line.lineId, sequence: line.sequence, itemName: line.itemName, unit: line.unit, ordered: line.ordered, delivered: line.delivered, remaining: toDeliver,
      reserved: round(line.reserved), warehouseId: line.warehouseId, warehouseName: line.warehouseId ? warehouses.get(line.warehouseId) ?? null : null };
    if (!line.warehouseId) { result.push({ ...base, onHand: null, reservedElsewhere: null, available: null, shortage: null, canReserve: 0, problem: "Choose a warehouse on this line." }); continue; }
    const availability = await getStockAvailability(client, stock, { itemId: line.itemId, warehouseId: line.warehouseId });
    const factor = line.conversionFactor;
    const onHand = Number(availability.onHandQuantity) / factor;
    const available = Number(availability.availableToPromise) / factor;
    const unreserved = Math.max(0, toDeliver - line.reserved);
    result.push({
      ...base,
      onHand: round(onHand),
      reservedElsewhere: round(Math.max(0, Number(availability.reservedQuantity) / factor - line.reserved)),
      available: round(available),
      // What this line still needs and stock cannot cover.
      shortage: round(Math.max(0, unreserved - available)),
      canReserve: round(Math.min(unreserved, Math.max(0, available))),
      problem: availability.qualityScopeBlocked ? "This product is on quality hold in this warehouse." : null,
    });
  }
  return { orderId: order.id, status: order.lifecycle_status, lines: result, shortages: result.filter((line) => line.shortage > EPSILON || line.problem).length };
}

// Reserves what is available for each line, up to what is still to deliver.
// A line is reserved partly when stock is short. Safe to repeat: only the
// quantity not yet reserved is asked for.
export async function reserveOrderLines(client, context, order, { lineIds = null } = {}) {
  const lines = await loadOrderLineProgress(client, context.organizationId, order.current_version_id);
  const stock = orderStockContext(context);
  const outcome = [];
  for (const line of lines) {
    if (!line.stockTracked || (lineIds && !lineIds.includes(line.lineId))) continue;
    const wanted = round(line.remainingToDeliver - line.reserved);
    if (wanted <= EPSILON) continue;
    if (!line.warehouseId) { outcome.push({ lineId: line.lineId, itemName: line.itemName, wanted, reserved: 0, problem: "No warehouse on the line." }); continue; }
    const availability = await getStockAvailability(client, stock, { itemId: line.itemId, warehouseId: line.warehouseId });
    const available = Math.max(0, Number(availability.availableToPromise) / line.conversionFactor);
    const quantity = round(Math.min(wanted, available));
    if (quantity <= EPSILON) { outcome.push({ lineId: line.lineId, itemName: line.itemName, wanted, reserved: 0, problem: "No stock available." }); continue; }
    try {
      await reserveStock(client, stock, {
        itemId: line.itemId, warehouseId: line.warehouseId, quantity: round(quantity * line.conversionFactor), referenceType: RESERVATION_REFERENCE, referenceId: line.lineId,
      });
      outcome.push({ lineId: line.lineId, itemName: line.itemName, wanted, reserved: quantity, problem: quantity + EPSILON < wanted ? "Stock is short: reserved what is available." : null });
    } catch (error) {
      // Stock refused (the quantity is spread over several bins or batches, or is on hold): nothing is reserved for this line.
      if (error?.name !== "StockError") throw error;
      outcome.push({ lineId: line.lineId, itemName: line.itemName, wanted, reserved: 0, problem: error.message });
    }
  }
  return outcome;
}

// input: { lineIds? } — every stock line when omitted.
export async function reserveSalesOrderStock(client, context, orderId, input = {}) {
  requireOrderPermission(context, ORDER_PERMISSIONS.reserve, "You do not have permission to reserve stock for sales orders.");
  const order = await lockOrder(client, context, orderId);
  await assertOrderVisible(client, context, order.id);
  if (order.lifecycle_status !== STATUS.confirmed) throw new OrderError(409, "Stock is reserved for a confirmed order.", "SALES_ORDER_NOT_CONFIRMED");
  const lineIds = Array.isArray(input.lineIds) && input.lineIds.length ? input.lineIds.map((id) => requireUuid(id, "Order line")) : null;
  const outcome = await reserveOrderLines(client, context, order, { lineIds });
  const reserved = outcome.filter((line) => line.reserved > EPSILON);
  if (reserved.length)
    await recordOrderEvent(client, context, order.id, "sales_order.stock_reserved", order.lifecycle_status, order.lifecycle_status,
      { lines: reserved.map((line) => ({ item: line.itemName, quantity: line.reserved })), short: outcome.filter((line) => line.problem).length });
  const progress = await refreshSalesOrderProgress(client, context.organizationId, order.id, context.userId ?? null);
  return { orderId: order.id, lines: outcome, reservedLines: reserved.length, fulfillmentStatus: progress.fulfillmentStatus };
}

// Releases the reservations of an order (or of one line). how: "released"
// (given back) or "cancelled" (the demand is gone). Returns how many were released.
export async function releaseOrderReservations(client, context, order, { lineId = null, how = "released" } = {}) {
  const stock = orderStockContext(context);
  const lineIds = lineId ? [lineId] : (await client.query(`SELECT id FROM tenant.sales_order_lines WHERE organization_id = $1 AND sales_order_version_id = $2`,
    [context.organizationId, order.current_version_id])).rows.map((row) => row.id);
  let released = 0;
  for (const id of lineIds)
    for (const reservation of await listActiveStockReservationsByReference(client, stock, { referenceType: RESERVATION_REFERENCE, referenceId: id })) {
      await releaseStockReservation(client, stock, reservation.id, { status: how });
      released += 1;
    }
  return released;
}

// input: { lineId?, reason }
export async function releaseSalesOrderReservation(client, context, orderId, input = {}) {
  requireOrderPermission(context, ORDER_PERMISSIONS.reserve, "You do not have permission to release stock reserved for sales orders.");
  const reason = text(input.reason, 500);
  if (!reason) throw new OrderError(400, "Say why the reservation is released.", "SALES_ORDER_RELEASE_REASON_REQUIRED", { field: "reason" });
  const order = await lockOrder(client, context, orderId);
  await assertOrderVisible(client, context, order.id);
  const released = await releaseOrderReservations(client, context, order, { lineId: input.lineId ? requireUuid(input.lineId, "Order line") : null });
  if (released) await recordOrderEvent(client, context, order.id, "sales_order.stock_released", order.lifecycle_status, order.lifecycle_status, { reservations: released, reason });
  const progress = await refreshSalesOrderProgress(client, context.organizationId, order.id, context.userId ?? null);
  return { orderId: order.id, released, fulfillmentStatus: progress.fulfillmentStatus };
}

// A delivery consumes the line's reservation for what it issues; what is left
// reserved stays reserved for the rest of the line. baseQuantity: in base units.
export async function consumeLineReservation(client, context, lineId, { itemId, warehouseId, baseQuantity }) {
  const stock = orderStockContext(context);
  let remaining = Number(baseQuantity);
  for (const reservation of await listActiveStockReservationsByReference(client, stock, { referenceType: RESERVATION_REFERENCE, referenceId: lineId })) {
    if (remaining <= EPSILON) break;
    const held = Number(reservation.quantity);
    await releaseStockReservation(client, stock, reservation.id, { status: "consumed" });
    if (held > remaining + EPSILON)
      await reserveStock(client, stock, { itemId, warehouseId, quantity: round(held - remaining), referenceType: RESERVATION_REFERENCE, referenceId: lineId });
    remaining -= Math.min(held, remaining);
  }
}
