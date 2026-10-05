// Stock Reservation for sales orders: the only way Sales commits inventory.
//
// Reserve: for a confirmed order's inventory-tracked line, in its fulfillment
// warehouse (the line's, else the order's default), up to what is still to
// deliver and not yet reserved:
//   remaining  = ordered − delivered − cancelled
//   unreserved = remaining − reserved for this line
//   reserved now = min(unreserved, usable stock available now)
// Stock is checked again under a lock at that moment (two orders can never
// reserve the same unit), and what is short stays unreserved demand, ready
// to be reserved when stock arrives. A draft, a service or a non-stock
// product is never reserved; asking for more than the line still needs is
// refused. A retried request with the same key reserves nothing twice.
//
// Release: by hand with a reason (all or part of a line, newest first), or by
// the system when the order is cancelled, reopened, a remaining quantity is
// cancelled or the line moves to another warehouse.
//
// Delivery consumes the line's reservations, issuing the goods from the rows
// they were reserved in; anything delivered beyond them comes from stock that
// is free now. A reservation in another warehouse stops the delivery.
//
// Every reservation, consumption and release is on the order's history.
// Inventory owns the reservation records; nothing here edits a quantity.
import { beginIdempotentOperation, completeIdempotentOperation } from "../../../core/idempotency.js";
import { StockError, consumeStockReservation, reconcileStockReservations, releaseStockReservation, reserveAvailableStock } from "../../stock/index.js";
import { assertOrderVisible, orderCan, orderScopeSql, requireOrderAccess, requireOrderPermission } from "../orders/access.js";
import { OrderError, STATUS, requireUuid, text } from "../orders/constants.js";
import { loadOrderLineProgress, refreshSalesOrderProgress } from "../orders/progress.js";
import { lockOrder, recordOrderEvent } from "../orders/versions.js";
import {
  RECORD_STATUS_LABELS, RELEASE_REASONS, RESERVATION_PERMISSIONS, RESERVATION_REFERENCE, RESERVATION_STATUS_LABELS, STALE_AFTER_DAYS, SYSTEM_RELEASE_REASONS,
  reservationStatusOf,
} from "./constants.js";

const EPSILON = 1e-6;
const round = (value) => Math.round(Number(value) * 1e6) / 1e6;

// Inventory rights the salesperson may not hold; the Sales permission checked by each operation authorises them.
export function orderStockContext(context) {
  return { organizationId: context.organizationId, userId: context.userId ?? null, permissions: ["stock.view", "stock.reserve", "stock.issue"], roleSlugs: [] };
}

async function confirmedOrder(client, context, orderId) {
  const order = await lockOrder(client, context, orderId);
  await assertOrderVisible(client, context, order.id);
  if (order.lifecycle_status !== STATUS.confirmed)
    throw new OrderError(409, order.lifecycle_status === STATUS.draft ? "Confirm the order before reserving stock: a draft cannot hold inventory." : "Stock is reserved only for a confirmed order.",
      "SALES_ORDER_NOT_CONFIRMED");
  return order;
}

const defaultWarehouseOf = async (client, context, order) =>
  (await client.query(`SELECT default_warehouse_id FROM tenant.sales_order_versions WHERE organization_id = $1 AND id = $2`, [context.organizationId, order.current_version_id])).rows[0]?.default_warehouse_id ?? null;

// Reserves up to `wanted` (line unit) for one line. Returns the outcome; never throws for a shortage.
async function reserveLine(client, context, order, line, wanted, defaultWarehouseId) {
  const outcome = { lineId: line.lineId, itemName: line.itemName, unit: line.unit, wanted: round(wanted), reserved: 0, shortage: round(wanted), reservations: [], warehouseId: null, problem: null };
  const warehouseId = line.warehouseId ?? defaultWarehouseId;
  if (!warehouseId) return { ...outcome, problem: "Warehouse required before reservation." };
  const warehouse = (await client.query(`SELECT id, name, status, sales_fulfillment FROM tenant.warehouses WHERE organization_id = $1 AND id = $2`, [context.organizationId, warehouseId])).rows[0];
  if (!warehouse || warehouse.status !== "active" || !warehouse.sales_fulfillment)
    return { ...outcome, warehouseId, problem: `${warehouse?.name ?? "The warehouse"} is inactive or not used for sales fulfillment.` };
  // The order's default warehouse becomes the line's fulfillment warehouse once stock is held there.
  if (!line.warehouseId)
    await client.query(`UPDATE tenant.sales_order_line_progress SET fulfillment_warehouse_id = $3, updated_at = now() WHERE organization_id = $1 AND sales_order_line_id = $2`,
      [context.organizationId, line.lineId, warehouseId]);
  let result;
  try {
    result = await reserveAvailableStock(client, orderStockContext(context), {
      itemId: line.itemId, warehouseId, maxQuantity: round(wanted * line.conversionFactor), referenceType: RESERVATION_REFERENCE, referenceId: line.lineId,
      salesOrderId: order.id, salesOrderLineId: line.lineId, salesQuantityPerBase: 1 / line.conversionFactor, salesUom: line.unit,
    });
  } catch (error) {
    if (!(error instanceof StockError)) throw error;
    return { ...outcome, warehouseId, warehouseName: warehouse.name, problem: error.message };
  }
  const reserved = round(result.reserved / line.conversionFactor);
  return {
    ...outcome, warehouseId, warehouseName: warehouse.name, reserved, shortage: round(Math.max(0, wanted - reserved)),
    reservations: result.reservations.map((reservation) => reservation.reservation_number),
    problem: result.blockedByQuality ? "This product is on quality hold in this warehouse." : reserved + EPSILON < wanted ? (reserved > EPSILON ? "Stock is short: reserved what is available." : "No stock available.") : null,
  };
}

// Reserves every inventory-tracked line's unreserved demand, or the lines given. Used on confirmation and by Reserve Available.
export async function reserveOrderLines(client, context, order, { lineIds = null } = {}) {
  const lines = await loadOrderLineProgress(client, context.organizationId, order.current_version_id);
  const defaultWarehouseId = await defaultWarehouseOf(client, context, order);
  const outcome = [];
  for (const line of lines) {
    if (!line.stockTracked || (lineIds && !lineIds.includes(line.lineId))) continue;
    const unreserved = round(line.remainingToDeliver - line.reserved);
    if (unreserved <= EPSILON) continue;
    outcome.push(await reserveLine(client, context, order, line, unreserved, defaultWarehouseId));
  }
  return outcome;
}

function reservedEvent(outcome) {
  const reserved = outcome.filter((line) => line.reserved > EPSILON);
  return {
    lines: reserved.map((line) => ({ item: line.itemName, quantity: line.reserved, unit: line.unit, warehouse: line.warehouseName, reservations: line.reservations })),
    short: outcome.filter((line) => line.problem).map((line) => ({ item: line.itemName, shortage: line.shortage, problem: line.problem })),
  };
}

async function idempotent(client, context, operation, key, payload, run) {
  const idempotency = await beginIdempotentOperation(client, context, { operation, key: text(key, 200), payload });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };
  const response = await run();
  await completeIdempotentOperation(client, context, idempotency, { response, aggregateType: "sales_order", aggregateId: payload.orderId });
  return { ...response, replayed: false };
}

async function finish(client, context, order, outcome) {
  if (outcome.some((line) => line.reserved > EPSILON))
    await recordOrderEvent(client, context, order.id, "sales_order.stock_reserved", order.lifecycle_status, order.lifecycle_status, reservedEvent(outcome));
  const progress = await refreshSalesOrderProgress(client, context.organizationId, order.id, context.userId ?? null);
  const lines = await loadOrderLineProgress(client, context.organizationId, order.current_version_id);
  return {
    orderId: order.id, lines: outcome, reservedLines: outcome.filter((line) => line.reserved > EPSILON).length, fulfillmentStatus: progress.fulfillmentStatus,
    reservationStatus: reservationStatusOf(lines),
  };
}

// Reserve Available / Reserve Remaining for the whole order (or the lines given).
// input: { lineIds?, idempotencyKey? }
export async function reserveSalesOrderStock(client, context, orderId, input = {}) {
  requireOrderPermission(context, RESERVATION_PERMISSIONS.reserve, "You do not have permission to reserve stock for sales orders.");
  const lineIds = Array.isArray(input.lineIds) && input.lineIds.length ? input.lineIds.map((id) => requireUuid(id, "Order line")) : null;
  const order = await confirmedOrder(client, context, orderId);
  return idempotent(client, context, "sales.order.reserve", input.idempotencyKey, { orderId: order.id, lineIds }, async () =>
    finish(client, context, order, await reserveOrderLines(client, context, order, { lineIds })));
}

// Reserves a chosen quantity of one line (all of its unreserved demand when no quantity is given).
// input: { lineId, quantity?, idempotencyKey? }
export async function reserveSalesOrderLine(client, context, orderId, input = {}) {
  requireOrderPermission(context, RESERVATION_PERMISSIONS.reserve, "You do not have permission to reserve stock for sales orders.");
  const lineId = requireUuid(input.lineId, "Order line");
  const order = await confirmedOrder(client, context, orderId);
  return idempotent(client, context, "sales.order.reserve_line", input.idempotencyKey, { orderId: order.id, lineId, quantity: input.quantity ?? null }, async () => {
    const lines = await loadOrderLineProgress(client, context.organizationId, order.current_version_id);
    const line = lines.find((entry) => entry.lineId === lineId);
    if (!line) throw new OrderError(404, "That line is not on this order.", "SALES_ORDER_LINE_NOT_FOUND");
    if (!line.stockTracked)
      throw new OrderError(409, `${line.itemName} is ${line.deliverable ? "not inventory tracked" : "a service"}: it is never reserved.`, "SALES_RESERVATION_NOT_STOCK");
    const unreserved = round(line.remainingToDeliver - line.reserved);
    if (unreserved <= EPSILON)
      throw new OrderError(409, `${line.itemName}: everything still to deliver is already reserved.`, "SALES_RESERVATION_NOTHING_TO_RESERVE");
    const wanted = input.quantity == null || input.quantity === "" ? unreserved : Number(input.quantity);
    if (!Number.isFinite(wanted) || wanted <= 0) throw new OrderError(400, "Enter the quantity to reserve.", "SALES_ORDER_VALIDATION");
    if (wanted > unreserved + EPSILON)
      throw new OrderError(409, `${line.itemName}: only ${unreserved} ${line.unit ?? ""} is still to reserve (ordered ${line.ordered}, delivered ${line.delivered}, cancelled ${line.cancelled}, reserved ${round(line.reserved)}).`.replace("  ", " "),
        "SALES_RESERVATION_EXCEEDS_DEMAND");
    return finish(client, context, order, [await reserveLine(client, context, order, line, wanted, await defaultWarehouseOf(client, context, order))]);
  });
}

// Gives back what an order (or one line) holds. quantity in the line's unit, from the newest reservation first.
// how: "released" (given back) or "cancelled" (the demand is gone). Returns the lines released, for the caller's history.
export async function releaseOrderReservations(client, context, order, { lineId = null, quantity = null, how = "released", reasonCode, reason = null } = {}) {
  const stock = orderStockContext(context);
  const values = [context.organizationId, order.id];
  const { rows } = await client.query(
    `SELECT reservation.*, line.item_name_snapshot, line.uom_snapshot, COALESCE(NULLIF(line.conversion_factor, 0), 1) AS factor
       FROM tenant.stock_reservations reservation
       JOIN tenant.sales_order_lines line ON line.organization_id = reservation.organization_id AND line.id = reservation.sales_order_line_id
      WHERE reservation.organization_id = $1 AND reservation.sales_order_id = $2 AND reservation.status = 'active'${lineId ? ` AND reservation.sales_order_line_id = $${values.push(lineId)}` : ""}
      ORDER BY reservation.created_at DESC, reservation.reservation_number DESC NULLS LAST, reservation.id`, values);
  let left = quantity == null ? null : Number(quantity) * Number(rows[0]?.factor ?? 1);
  const released = new Map();
  for (const reservation of rows) {
    if (left != null && left <= EPSILON) break;
    const take = left == null ? Number(reservation.active_quantity) : Math.min(left, Number(reservation.active_quantity));
    await releaseStockReservation(client, stock, reservation.id, { status: how, quantity: round(take), reasonCode, reason });
    if (left != null) left = round(left - take);
    const entry = released.get(reservation.sales_order_line_id) ?? { item: reservation.item_name_snapshot, unit: reservation.uom_snapshot, quantity: 0, count: 0, reservations: [] };
    entry.count += 1;
    entry.quantity = round(entry.quantity + take / Number(reservation.factor));
    if (reservation.reservation_number) entry.reservations.push(reservation.reservation_number);
    released.set(reservation.sales_order_line_id, entry);
  }
  return [...released.values()];
}

// After a remaining quantity is cancelled: gives back only what a line holds beyond what is still to deliver.
export async function trimLineReservation(client, context, order, lineId, reasonCode) {
  const line = (await loadOrderLineProgress(client, context.organizationId, order.current_version_id)).find((entry) => entry.lineId === lineId);
  if (!line) return [];
  const excess = round(line.reserved - line.remainingToDeliver);
  if (excess <= EPSILON) return [];
  return releaseOrderReservations(client, context, order, { lineId, quantity: excess, how: "cancelled", reasonCode, reason: SYSTEM_RELEASE_REASONS[reasonCode] ?? null });
}

// Release Reservation by hand. input: { lineId?, quantity?, reasonCode, reason? }
export async function releaseSalesOrderReservation(client, context, orderId, input = {}) {
  requireOrderPermission(context, RESERVATION_PERMISSIONS.release, "You do not have permission to release stock reservations.");
  const reasonCode = text(input.reasonCode, 40);
  const reason = text(input.reason, 500);
  if (!reasonCode && !reason) throw new OrderError(400, "Say why the reservation is released.", "SALES_ORDER_RELEASE_REASON_REQUIRED", { field: "reasonCode" });
  if (reasonCode && !RELEASE_REASONS.some((entry) => entry.code === reasonCode)) throw new OrderError(400, "Choose a release reason from the list.", "SALES_ORDER_RELEASE_REASON_INVALID");
  if (reasonCode === "other" && !reason) throw new OrderError(400, "Describe the reason for releasing.", "SALES_ORDER_RELEASE_REASON_REQUIRED", { field: "reason" });
  const order = await lockOrder(client, context, orderId);
  await assertOrderVisible(client, context, order.id);
  const lineId = input.lineId ? requireUuid(input.lineId, "Order line") : null;
  let quantity = null;
  if (input.quantity != null && input.quantity !== "") {
    if (!lineId) throw new OrderError(400, "Choose the line to release part of its reservation.", "SALES_ORDER_VALIDATION");
    quantity = Number(input.quantity);
    const line = (await loadOrderLineProgress(client, context.organizationId, order.current_version_id)).find((entry) => entry.lineId === lineId);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new OrderError(400, "Enter the quantity to release.", "SALES_ORDER_VALIDATION");
    if (!line || quantity > line.reserved + EPSILON)
      throw new OrderError(409, `Only ${round(line?.reserved ?? 0)} ${line?.unit ?? ""} is reserved on this line.`.replace("  ", " "), "SALES_RESERVATION_EXCEEDS_ACTIVE");
  }
  const label = [RELEASE_REASONS.find((entry) => entry.code === reasonCode)?.label, reason].filter(Boolean).join(": ");
  const released = await releaseOrderReservations(client, context, order, { lineId, quantity, how: "released", reasonCode: reasonCode ?? "other", reason: label });
  if (released.length)
    await recordOrderEvent(client, context, order.id, "sales_order.stock_released", order.lifecycle_status, order.lifecycle_status,
      { lines: released, reasonCode, reason: label, reservations: released.reduce((total, line) => total + line.reservations.length, 0) });
  const progress = await refreshSalesOrderProgress(client, context.organizationId, order.id, context.userId ?? null);
  return { orderId: order.id, released: released.length, lines: released, fulfillmentStatus: progress.fulfillmentStatus };
}

// A delivery of `quantity` (line unit) for a line, from `warehouseId`: consumes the line's reservations
// oldest first and issues from their rows; anything beyond them comes from stock that is free now.
export async function consumeReservationForDelivery(client, context, { order, line, warehouseId, quantity, deliveryId, deliveryLineId }) {
  const stock = orderStockContext(context);
  const factor = line.conversionFactor || 1;
  const reservations = (await client.query(
    `SELECT reservation.*, warehouse.name AS warehouse_name FROM tenant.stock_reservations reservation
       JOIN tenant.warehouses warehouse ON warehouse.organization_id = reservation.organization_id AND warehouse.id = reservation.warehouse_id
      WHERE reservation.organization_id = $1 AND reservation.sales_order_line_id = $2 AND reservation.status = 'active'
      ORDER BY reservation.created_at, reservation.reservation_number NULLS FIRST, reservation.id FOR UPDATE OF reservation`, [context.organizationId, line.lineId])).rows;
  const elsewhere = reservations.find((reservation) => reservation.warehouse_id !== warehouseId);
  if (elsewhere)
    throw new OrderError(409, `${line.itemName} is reserved in ${elsewhere.warehouse_name}. Deliver from there, or change the line's warehouse (which releases that reservation) first.`, "SALES_DELIVERY_WAREHOUSE_MISMATCH");
  let left = round(quantity * factor);
  const consumed = [];
  const issue = (id) => ({ deliveryId, deliveryLineId, issue: { referenceType: "sales_delivery", referenceId: deliveryId, idempotencyKey: `sales-delivery:${deliveryId}:${id}` } });
  for (const reservation of reservations) {
    if (left <= EPSILON) break;
    const take = round(Math.min(left, Number(reservation.active_quantity)));
    await consumeStockReservation(client, stock, reservation.id, take, issue(reservation.id));
    consumed.push({ reservation: reservation.reservation_number, quantity: round(take / factor) });
    left = round(left - take);
  }
  let fromFreeStock = 0;
  if (left > EPSILON) {
    // Delivered beyond what was reserved: take it from stock no other order holds, now.
    const extra = await reserveAvailableStock(client, stock, {
      itemId: line.itemId, warehouseId, maxQuantity: left, referenceType: RESERVATION_REFERENCE, referenceId: line.lineId, salesOrderId: order.id, salesOrderLineId: line.lineId,
      salesQuantityPerBase: 1 / factor, salesUom: line.unit,
    });
    if (extra.reserved + EPSILON < left)
      throw new OrderError(409, `${line.itemName}: only ${round((quantity * factor - left + extra.reserved) / factor)} ${line.unit ?? ""} can be delivered from this warehouse now.`.replace("  ", " "), "SALES_ORDER_STOCK_UNAVAILABLE");
    for (const reservation of extra.reservations) await consumeStockReservation(client, stock, reservation.id, Number(reservation.quantity), issue(reservation.id));
    fromFreeStock = round(left / factor);
  }
  return { consumed, fromFreeStock };
}

// The reservations of an order: what each reserved, still holds, consumed (by which delivery) and released, and for how long it has been held.
export async function getSalesOrderReservations(client, context, orderId) {
  requireOrderAccess(context);
  requireOrderPermission(context, RESERVATION_PERMISSIONS.view, "You do not have permission to view stock reservations.");
  const id = requireUuid(orderId);
  await assertOrderVisible(client, context, id);
  const [reservations, consumptions] = [
    await client.query(
      `SELECT reservation.id, reservation.reservation_number, reservation.status, reservation.sales_order_line_id, line.item_name_snapshot, line.uom_snapshot,
              COALESCE(NULLIF(line.conversion_factor, 0), 1) AS factor, reservation.quantity, reservation.active_quantity, reservation.consumed_quantity, reservation.released_quantity,
              warehouse.name AS warehouse_name, location.code AS location_code, batch.batch_number, reservation.created_at AS reserved_at, reserver.full_name AS reserved_by_name,
              reservation.released_at, releaser.full_name AS released_by_name, reservation.release_reason, reservation.release_reason_code,
              (current_date - reservation.created_at::date) AS days_held
         FROM tenant.stock_reservations reservation
         JOIN tenant.sales_order_lines line ON line.organization_id = reservation.organization_id AND line.id = reservation.sales_order_line_id
         JOIN tenant.warehouses warehouse ON warehouse.organization_id = reservation.organization_id AND warehouse.id = reservation.warehouse_id
         LEFT JOIN tenant.warehouse_locations location ON location.organization_id = reservation.organization_id AND location.id = reservation.warehouse_location_id
         LEFT JOIN tenant.stock_batches batch ON batch.organization_id = reservation.organization_id AND batch.id = reservation.batch_id
         LEFT JOIN public.users reserver ON reserver.id = reservation.reserved_by
         LEFT JOIN public.users releaser ON releaser.id = reservation.released_by
        WHERE reservation.organization_id = $1 AND reservation.sales_order_id = $2
        ORDER BY reservation.created_at DESC, reservation.id`, [context.organizationId, id]),
    await client.query(
      `SELECT consumption.reservation_id, consumption.quantity, consumption.consumed_at, delivery.request_number AS delivery_number
         FROM tenant.stock_reservation_consumptions consumption
         JOIN tenant.stock_reservations reservation ON reservation.id = consumption.reservation_id
         LEFT JOIN tenant.sales_fulfillment_requests delivery ON delivery.organization_id = consumption.organization_id AND delivery.id = consumption.delivery_id
        WHERE consumption.organization_id = $1 AND reservation.sales_order_id = $2 ORDER BY consumption.consumed_at`, [context.organizationId, id]),
  ];
  // Quantities in the line's unit, as the order shows them.
  const unit = (row, value) => round(Number(value) / Number(row.factor));
  return reservations.rows.map((row) => ({
    id: row.id, reservationNumber: row.reservation_number, status: row.status, statusLabel: RECORD_STATUS_LABELS[row.status] ?? row.status, lineId: row.sales_order_line_id,
    itemName: row.item_name_snapshot, unit: row.uom_snapshot, reserved: unit(row, row.quantity), active: unit(row, row.active_quantity), consumed: unit(row, row.consumed_quantity),
    released: unit(row, row.released_quantity), warehouseName: row.warehouse_name, location: row.location_code, batch: row.batch_number, reservedAt: row.reserved_at,
    reservedByName: row.reserved_by_name, releasedAt: row.released_at, releasedByName: row.released_by_name, releaseReason: row.release_reason,
    daysHeld: row.status === "active" ? Number(row.days_held) : null, stale: row.status === "active" && Number(row.days_held) >= STALE_AFTER_DAYS,
    consumptions: consumptions.rows.filter((entry) => entry.reservation_id === row.id).map((entry) => ({ deliveryNumber: entry.delivery_number, quantity: unit(row, entry.quantity), consumedAt: entry.consumed_at })),
  }));
}

// Checks reservations against what they should be: Inventory's cached reserved quantities against the
// reservations themselves, and each order line's active reservation against what is still to deliver.
// With repair (and the permission to adjust stock), the cache is rebuilt and excess sales reservations are released.
export async function reconcileSalesReservations(client, context, { repair = false } = {}) {
  requireOrderPermission(context, RESERVATION_PERMISSIONS.viewAll, "You do not have permission to review all stock reservations.");
  const values = [context.organizationId];
  const scope = orderScopeSql(context, values, "sales_order");
  const { rows } = await client.query(
    `SELECT sales_order.id, sales_order.sales_order_number, sales_order.lifecycle_status, sales_order.current_version_id FROM tenant.sales_orders sales_order
      WHERE sales_order.organization_id = $1${scope}
        AND EXISTS (SELECT 1 FROM tenant.stock_reservations reservation WHERE reservation.organization_id = sales_order.organization_id AND reservation.sales_order_id = sales_order.id
                     AND reservation.status = 'active')`, values);
  const excess = [];
  for (const order of rows) {
    const lines = await loadOrderLineProgress(client, context.organizationId, order.current_version_id);
    const holding = order.lifecycle_status === STATUS.confirmed;
    for (const line of lines) {
      const allowed = holding ? line.remainingToDeliver : 0;
      if (line.reserved > allowed + EPSILON) excess.push({ orderId: order.id, orderNumber: order.sales_order_number, lineId: line.lineId, item: line.itemName, reserved: round(line.reserved), needed: round(allowed) });
    }
  }
  if (repair) {
    for (const entry of excess) {
      const order = await lockOrder(client, context, entry.orderId);
      const released = await releaseOrderReservations(client, context, order, { lineId: entry.lineId, quantity: round(entry.reserved - entry.needed), how: "released", reasonCode: "reservation_correction", reason: "Reconciliation: more was reserved than still needed" });
      await recordOrderEvent(client, context, order.id, "sales_order.stock_released", order.lifecycle_status, order.lifecycle_status, { lines: released, reasonCode: "reservation_correction", reason: "Reconciliation" });
      await refreshSalesOrderProgress(client, context.organizationId, order.id, context.userId ?? null);
    }
  }
  const stock = await reconcileStockReservations(client, repair && orderCan(context, "stock.adjust") ? { ...orderStockContext(context), permissions: ["stock.view", "stock.adjust"] } : orderStockContext(context), { repair: repair && orderCan(context, "stock.adjust") });
  return { salesExcess: excess, stock };
}

export { RESERVATION_STATUS_LABELS };
