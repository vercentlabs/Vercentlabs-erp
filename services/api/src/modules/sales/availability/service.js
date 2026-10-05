// Availability Check: what a sales order (or a product, or a list of
// products for a form) can have from stock now.
//
// For each inventory-tracked order line, in its fulfillment warehouse (the
// line's own, else the order's default):
//   ordered, delivered, cancelled → remaining to fulfil
//   reserved for this line        → what is still to reserve
//   on hand, reserved by other demand, unusable, available
//   reservable now, shortage, and Available / Partially available / Unavailable
// The order's own reservations are never counted as competing demand. Two
// lines of the same product and warehouse share what is available, so the
// same unit is never offered twice. Quantities are compared in the product's
// base unit and shown in the line's unit.
//
// Other warehouses with stock are shown to users allowed to see them; the
// line's warehouse is never changed by a check, and stock is never moved.
// Services and products that are not stock tracked are not checked.
//
// A check is a point-in-time reading with its time: it reserves nothing,
// locks nothing and is not written to the order's history. Reserving checks
// the stock again.
import { assertOrderVisible, orderCan, requireOrderAccess } from "../orders/access.js";
import { OrderError, requireUuid } from "../orders/constants.js";
import { loadOrderLineProgress } from "../orders/progress.js";
import { AVAILABILITY_PERMISSIONS, RESULT_LABELS, SUMMARY_LABELS } from "./constants.js";
import { EPSILON, availabilityResult, calculateRemainingDemand, round, stockPositions, suggestAlternativeWarehouses } from "./engine.js";

function requireCheck(context, permission) {
  if (!orderCan(context, permission)) throw new OrderError(403, "You do not have permission to check stock availability.", "PERMISSION_DENIED");
}
const toUnit = (base, factor) => round(base / (factor || 1));
const checkedAt = async (client) => (await client.query(`SELECT now() AS at`)).rows[0].at;

// The order's lines with what the availability check needs: quantities, base unit and fulfillment warehouse.
async function orderLines(client, context, order) {
  const lines = await loadOrderLineProgress(client, context.organizationId, order.current_version_id);
  const extra = new Map((await client.query(
    `SELECT line.id, line.base_quantity, unit.code AS base_unit, item.item_type FROM tenant.sales_order_lines line
       JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
       LEFT JOIN tenant.units_of_measure unit ON unit.organization_id = item.organization_id AND unit.id = item.uom_id
      WHERE line.organization_id = $1 AND line.sales_order_version_id = $2`, [context.organizationId, order.current_version_id])).rows.map((row) => [row.id, row]));
  return lines.map((line) => {
    const warehouseId = line.warehouseId ?? order.default_warehouse_id ?? null;
    return {
      ...line, baseUnit: extra.get(line.lineId)?.base_unit ?? null, isService: extra.get(line.lineId)?.item_type === "service",
      fulfillmentWarehouseId: warehouseId, warehouseSource: line.warehouseId ? "line" : warehouseId ? "order_default" : null,
    };
  });
}

// The availability of each line of an order, sharing what is available between lines of the same product and warehouse.
function evaluate(lines, positions, { showOtherWarehouses }) {
  // What this order already holds in each warehouse, in base units: not competing demand.
  const own = new Map();
  for (const line of lines) {
    if (!line.stockTracked || !line.fulfillmentWarehouseId) continue;
    const key = `${line.itemId}|${line.fulfillmentWarehouseId}`;
    own.set(key, (own.get(key) ?? 0) + line.reserved * line.conversionFactor);
  }
  const pool = new Map();
  return lines.map((line) => {
    const base = {
      lineId: line.lineId, sequence: line.sequence, itemId: line.itemId, itemName: line.itemName, unit: line.unit, isService: line.isService, stockTracked: line.stockTracked,
      ordered: line.ordered, delivered: line.delivered, cancelled: line.cancelled, reserved: round(line.reserved),
    };
    if (!line.stockTracked) return { ...base, result: "not_tracked", resultLabel: RESULT_LABELS.not_tracked };
    const { remaining, unreserved } = calculateRemainingDemand(line);
    const demand = { ...base, remaining, unreservedDemand: unreserved, baseUnit: line.baseUnit, conversionFactor: line.conversionFactor };
    if (!line.fulfillmentWarehouseId)
      return { ...demand, warehouseId: null, warehouseName: null, warehouseSource: null, result: remaining > EPSILON ? "no_warehouse" : "not_required",
        resultLabel: remaining > EPSILON ? RESULT_LABELS.no_warehouse : RESULT_LABELS.not_required, problem: remaining > EPSILON ? "Choose the warehouse this line ships from." : null,
        alternatives: showOtherWarehouses ? suggestAlternativeWarehouses(positions, line.itemId, null) : [] };
    const key = `${line.itemId}|${line.fulfillmentWarehouseId}`;
    const position = positions.get(key);
    const factor = line.conversionFactor || 1;
    const eligible = Boolean(position?.eligible);
    // What is free in the warehouse, less what earlier lines of this order take from it.
    const freeBase = eligible ? (pool.has(key) ? pool.get(key) : position.available) : 0;
    const reservableBase = Math.min(freeBase, unreserved * factor);
    pool.set(key, Math.max(0, freeBase - reservableBase));
    const reservable = toUnit(reservableBase, factor);
    const result = availabilityResult({ remaining, ownReserved: line.reserved, reservable });
    const shortage = round(Math.max(0, unreserved - reservable));
    return {
      ...demand,
      warehouseId: line.fulfillmentWarehouseId, warehouseName: position?.warehouseName ?? null, warehouseSource: line.warehouseSource,
      onHand: position ? toUnit(position.onHand, factor) : 0,
      reservedByOthers: position ? toUnit(Math.max(0, position.reserved - (own.get(key) ?? 0)), factor) : 0,
      unusable: position ? toUnit(position.unusable + (position.held ?? 0), factor) : 0,
      available: position && eligible ? toUnit(position.available, factor) : 0,
      reservable, shortage, result, resultLabel: RESULT_LABELS[result],
      baseRequired: round(remaining * factor), baseAvailable: position && eligible ? position.available : 0,
      problem: !eligible ? "This warehouse is inactive or not used for sales fulfillment." : position?.qualityBlocked ? "This product is on quality hold in this warehouse." : null,
      alternatives: showOtherWarehouses ? suggestAlternativeWarehouses(positions, line.itemId, line.fulfillmentWarehouseId).map((alternative) => ({ ...alternative, available: toUnit(alternative.available, factor), onHand: toUnit(alternative.onHand, factor) })) : [],
    };
  });
}

// The order as a whole: Fully available, Partially available or Unavailable, over the lines still to fulfil.
function summarize(lines) {
  const open = lines.filter((line) => line.stockTracked && line.remaining > EPSILON);
  if (!open.length) return "not_required";
  if (open.every((line) => line.result === "available")) return "fully_available";
  if (open.some((line) => line.result === "available" || line.result === "partially_available")) return "partially_available";
  return "unavailable";
}

// The order's availability now, line by line, with an order-level summary.
export async function checkSalesOrderAvailability(client, context, orderId) {
  requireOrderAccess(context);
  requireCheck(context, AVAILABILITY_PERMISSIONS.check);
  const id = requireUuid(orderId);
  await assertOrderVisible(client, context, id);
  return computeOrderAvailability(client, context, id);
}

// The same check for an order the caller already has open (used when confirming).
export async function computeOrderAvailability(client, context, id) {
  const order = (await client.query(
    `SELECT sales_order.id, sales_order.sales_order_number, sales_order.lifecycle_status, sales_order.current_version_id, version.default_warehouse_id
       FROM tenant.sales_orders sales_order
       JOIN tenant.sales_order_versions version ON version.organization_id = sales_order.organization_id AND version.id = sales_order.current_version_id
      WHERE sales_order.organization_id = $1 AND sales_order.id = $2`, [context.organizationId, id])).rows[0];
  if (!order) throw new OrderError(404, "Sales order not found.", "SALES_ORDER_NOT_FOUND");
  const lines = await orderLines(client, context, order);
  const positions = await stockPositions(client, context.organizationId, lines.filter((line) => line.stockTracked).map((line) => line.itemId));
  const result = evaluate(lines, positions, { showOtherWarehouses: orderCan(context, AVAILABILITY_PERMISSIONS.otherWarehouses) });
  const summary = summarize(result);
  return {
    orderId: order.id, orderNumber: order.sales_order_number, status: order.lifecycle_status, checkedAt: await checkedAt(client),
    // A draft's availability is for information: nothing can be reserved until the order is confirmed.
    informational: order.lifecycle_status === "draft",
    summary, summaryLabel: SUMMARY_LABELS[summary], lines: result,
    shortages: result.filter((line) => line.shortage > EPSILON || line.problem).length,
  };
}

// One line of an order.
export async function checkLineAvailability(client, context, orderId, lineId) {
  const check = await checkSalesOrderAvailability(client, context, orderId);
  const line = check.lines.find((entry) => entry.lineId === requireUuid(lineId, "Order line"));
  if (!line) throw new OrderError(404, "That line is not on this order.", "SALES_ORDER_LINE_NOT_FOUND");
  return { ...check, lines: [line] };
}

// A product in every warehouse that fulfils sales, with the total across them.
export async function checkWarehouseAvailability(client, context, itemId) {
  requireCheck(context, AVAILABILITY_PERMISSIONS.view);
  const id = requireUuid(itemId, "Product");
  const item = (await client.query(
    `SELECT item.id, item.name, item.item_type, COALESCE(item.track_inventory, false) AS track_inventory, unit.code AS base_unit FROM tenant.items item
       LEFT JOIN tenant.units_of_measure unit ON unit.organization_id = item.organization_id AND unit.id = item.uom_id
      WHERE item.organization_id = $1 AND item.id = $2`, [context.organizationId, id])).rows[0];
  if (!item) throw new OrderError(404, "Product not found.", "SALES_PRODUCT_NOT_FOUND");
  const tracked = item.track_inventory && item.item_type !== "service";
  const positions = tracked ? [...(await stockPositions(client, context.organizationId, [id])).values()].filter((position) => position.eligible) : [];
  const total = (key) => round(positions.reduce((sum, position) => sum + (position[key] ?? 0), 0));
  return {
    itemId: item.id, itemName: item.name, unit: item.base_unit, stockTracked: tracked, checkedAt: await checkedAt(client),
    warehouses: positions.map((position) => ({ warehouseId: position.warehouseId, warehouseCode: position.warehouseCode, warehouseName: position.warehouseName, onHand: position.onHand,
      reserved: position.reserved, unusable: round(position.unusable + (position.held ?? 0)), available: position.available, qualityBlocked: position.qualityBlocked })),
    totals: { onHand: total("onHand"), reserved: total("reserved"), available: total("available") },
  };
}

// Several products at once, for a quotation or an order being prepared:
// input.lines: [{ itemId, warehouseId?, quantity, uomId? }]. Informational only.
export async function checkItemsAvailability(client, context, input = {}) {
  requireCheck(context, AVAILABILITY_PERMISSIONS.view);
  const requested = (Array.isArray(input.lines) ? input.lines : []).slice(0, 500).map((line, index) => ({
    index, itemId: requireUuid(line.itemId, "Product"), warehouseId: line.warehouseId ? requireUuid(line.warehouseId, "Warehouse") : null,
    quantity: Math.max(0, Number(line.quantity) || 0), uomId: line.uomId ? requireUuid(line.uomId, "Unit") : null,
  }));
  if (!requested.length) return { checkedAt: await checkedAt(client), lines: [] };
  const items = new Map((await client.query(
    `SELECT item.id, item.name, item.item_type, COALESCE(item.track_inventory, false) AS track_inventory, item.uom_id, unit.code AS base_unit FROM tenant.items item
       LEFT JOIN tenant.units_of_measure unit ON unit.organization_id = item.organization_id AND unit.id = item.uom_id
      WHERE item.organization_id = $1 AND item.id = ANY($2::uuid[])`, [context.organizationId, requested.map((line) => line.itemId)])).rows.map((row) => [row.id, row]));
  const conversions = (await client.query(
    `SELECT item_id, from_uom_id, to_uom_id, conversion_factor FROM tenant.item_uom_conversions WHERE organization_id = $1 AND item_id = ANY($2::uuid[]) AND status = 'active'`,
    [context.organizationId, requested.map((line) => line.itemId)])).rows;
  // How many base units one of the chosen unit is: the same conversion pricing uses.
  const factorOf = (item, uomId) => {
    if (!uomId || uomId === item.uom_id) return 1;
    const direct = conversions.find((row) => row.item_id === item.id && row.from_uom_id === uomId && row.to_uom_id === item.uom_id);
    if (direct) return Number(direct.conversion_factor);
    throw new OrderError(400, `${item.name} is not sold in that unit.`, "SALES_AVAILABILITY_UNIT_INVALID");
  };
  const positions = await stockPositions(client, context.organizationId, requested.filter((line) => items.get(line.itemId)).map((line) => line.itemId));
  const pool = new Map();
  const showOtherWarehouses = orderCan(context, AVAILABILITY_PERMISSIONS.otherWarehouses);
  return {
    checkedAt: await checkedAt(client),
    lines: requested.map((line) => {
      const item = items.get(line.itemId);
      if (!item) throw new OrderError(404, "Product not found.", "SALES_PRODUCT_NOT_FOUND");
      if (!item.track_inventory || item.item_type === "service") return { index: line.index, itemId: item.id, itemName: item.name, result: "not_tracked", resultLabel: RESULT_LABELS.not_tracked };
      const factor = factorOf(item, line.uomId);
      const alternatives = showOtherWarehouses ? suggestAlternativeWarehouses(positions, item.id, line.warehouseId).map((alternative) => ({ ...alternative, available: toUnit(alternative.available, factor) })) : [];
      if (!line.warehouseId) return { index: line.index, itemId: item.id, itemName: item.name, result: "no_warehouse", resultLabel: RESULT_LABELS.no_warehouse, alternatives };
      const key = `${item.id}|${line.warehouseId}`;
      const position = positions.get(key);
      const freeBase = position?.eligible ? (pool.has(key) ? pool.get(key) : position.available) : 0;
      const reservableBase = Math.min(freeBase, line.quantity * factor);
      pool.set(key, Math.max(0, freeBase - reservableBase));
      const reservable = toUnit(reservableBase, factor);
      const result = availabilityResult({ remaining: line.quantity, ownReserved: 0, reservable });
      return {
        index: line.index, itemId: item.id, itemName: item.name, warehouseId: line.warehouseId, warehouseName: position?.warehouseName ?? null, required: line.quantity,
        onHand: position ? toUnit(position.onHand, factor) : 0, reserved: position ? toUnit(position.reserved, factor) : 0, available: position?.eligible ? toUnit(position.available, factor) : 0,
        reservable, shortage: round(Math.max(0, line.quantity - reservable)), result, resultLabel: RESULT_LABELS[result], baseUnit: item.base_unit, alternatives,
      };
    }),
  };
}
