// Manufacturing from Sales demand — the engine. Finds confirmed Sales Order lines of manufactured products, keeps one demand per line
// (re-bound to the same line by sequence and product when the order is reopened and confirmed again), and works out each demand's
// coverage, every unit counted once:
//
//   outstanding        ordered − cancelled − delivered                        (Sales, in the product's base unit)
//   reserved           stock Inventory holds for the line                      (confirmed physical cover)
//   in production      released orders' assigned output not yet received      (committed future cover)
//   proposed           draft orders' assigned output                           (planned, not committed)
//   ready to allocate  assigned output received but not yet reserved          (physical, waiting for a reservation)
//   uncovered          outstanding − reserved − in production                  (needs a supply decision)
//   recommended        uncovered − proposed − ready to allocate − (make to stock: free stock)
//
// A received unit leaves "in production" the moment it is received; a reserved unit is counted once, as reserved.
import { resolveEffectiveBom } from "../boms/bom-engine.js";
import { loadOrderLineProgress } from "../../sales/orders/progress.js";
import { D, ZERO, add, freeStock, has, max, min, moError, mul, q, sub, text, uuid } from "../orders/mo-core.js";

export const DEMAND = Object.freeze({
  view: "manufacturing.demand.view", plan: "manufacturing.demand.plan", createMo: "manufacturing.demand.create_mo", allocate: "manufacturing.demand.allocate",
  reallocate: "manufacturing.demand.reallocate", release: "manufacturing.demand.release_allocation", approveException: "manufacturing.demand.approve_exception",
  viewCost: "manufacturing.demand.view_cost", export: "manufacturing.demand.export",
});
export const STATUS_LABEL = Object.freeze({ NEEDS_REVIEW: "Needs review", PARTIALLY_COVERED: "Partially covered", COVERED: "Covered", IN_PRODUCTION: "In production",
  READY_FOR_FULFILLMENT: "Ready for fulfilment", FULFILLED: "Fulfilled", ON_HOLD: "On hold", CANCELLED: "Cancelled" });
const MESSAGES = Object.freeze({
  MFG_DEMAND_NOT_FOUND: "The manufacturing demand was not found.",
  MFG_DEMAND_SALES_NOT_CONFIRMED: "Confirm the Sales Order before creating production.",
  MFG_DEMAND_LINE_CANCELLED: "This Sales Order item has been cancelled.",
  MFG_DEMAND_ALREADY_COVERED: "This item already has enough stock or planned supply.",
  MFG_DEMAND_QTY_EXCEEDS: "The quantity exceeds the available manufacturing requirement.",
  MFG_DEMAND_ITEM_NOT_MANUFACTURABLE: "This item cannot be manufactured.",
  MFG_DEMAND_BOM_MISSING: "Create and approve a BOM for this product.",
  MFG_DEMAND_BOM_NOT_EFFECTIVE: "No approved BOM is valid for the selected production date.",
  MFG_DEMAND_WAREHOUSE_INVALID: "Select an authorized warehouse.",
  MFG_DEMAND_SOURCE_CHANGED: "The Sales Order changed. Review the updated requirement.",
  MFG_DEMAND_ALLOCATION_CONFLICT: "Another user has allocated some of this demand. Refresh to continue.",
  MFG_DEMAND_MO_INELIGIBLE: "This Manufacturing Order cannot cover the selected demand.",
  MFG_DEMAND_EXCESS_PRODUCTION: "Production exceeds the allocated customer requirement.",
  MFG_DEMAND_CANCEL_REVIEW_REQUIRED: "Production has started. A manager must review cancellation.",
  MFG_DEMAND_RESERVATION_FAILED: "Finished goods could not be reserved for this order.",
  MFG_DEMAND_OPERATION_UNKNOWN: "Checking whether the previous action succeeded. Do not repeat it.",
  MFG_DEMAND_PERMISSION_DENIED: "You do not have permission to perform this action.",
});
export class DemandError extends Error {
  constructor(status, code, message, details) {
    super(message ?? MESSAGES[code] ?? "The demand action failed.");
    this.name = "DemandError";
    this.status = status;
    this.code = code;
    if (details) this.details = details;
  }
}
export const demandError = (status, code, message, details) => new DemandError(status, code, message, details);
export const needDemand = (c, permission) => { if (!has(c, permission)) throw demandError(403, "MFG_DEMAND_PERMISSION_DENIED"); };
export { D, ZERO, add, has, max, min, moError, mul, q, sub, text, uuid };

const PRODUCING = new Set(["RELEASED", "IN_PROGRESS", "ON_HOLD", "COMPLETION_PENDING", "RECOVERY_REQUIRED"]);
const PLANNED = new Set(["DRAFT", "AWAITING_APPROVAL"]);

export async function demandEvent(client, c, demandId, action, { allocationId = null, orderId = null, quantity = null, sourceType = null, sourceId = null, summary = null, details = {} } = {}) {
  await client.query(
    `INSERT INTO tenant.manufacturing_demand_events (organization_id, demand_id, allocation_id, manufacturing_order_id, action, quantity, source_type, source_id, summary, details, actor_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,
    [c.organizationId, demandId, allocationId, orderId, action, quantity === null ? null : q(quantity), sourceType, sourceId, summary ? String(summary).slice(0, 1000) : null, JSON.stringify(details), c.userId ?? null]);
}

// A product is manufactured when it has a live BOM or a manufacturing policy.
const MANUFACTURED = `(EXISTS (SELECT 1 FROM tenant.manufacturing_bom_masters master WHERE master.organization_id = line.organization_id AND master.finished_item_id = line.item_id AND master.archived_at IS NULL)
    OR EXISTS (SELECT 1 FROM tenant.manufacturing_item_policies policy WHERE policy.organization_id = line.organization_id AND policy.item_id = line.item_id))`;

// Demand for every confirmed order's current lines of manufactured stocked products; a demand whose order was amended follows the line with
// the same sequence and product (and is cancelled when the line is gone or became another product).
export async function syncDemands(client, c, { orderId = null } = {}) {
  const lines = (await client.query(
    `SELECT line.id, line.sequence, line.item_id, sales_order.id AS order_id, version.version_number
       FROM tenant.sales_orders sales_order
       JOIN tenant.sales_order_versions version ON version.id = sales_order.current_version_id
       JOIN tenant.sales_order_lines line ON line.sales_order_version_id = version.id
       JOIN tenant.items item ON item.id = line.item_id
      WHERE sales_order.organization_id = $1 AND ($2::uuid IS NULL OR sales_order.id = $2) AND sales_order.lifecycle_status = 'confirmed'
        AND item.item_type = 'product' AND item.track_inventory AND ${MANUFACTURED}
        AND NOT EXISTS (SELECT 1 FROM tenant.manufacturing_sales_demands demand WHERE demand.organization_id = line.organization_id AND demand.sales_order_line_id = line.id)`,
    [c.organizationId, orderId])).rows;
  for (const line of lines) {
    const slot = (await client.query(
      `SELECT * FROM tenant.manufacturing_sales_demands WHERE organization_id = $1 AND sales_order_id = $2 AND line_sequence = $3 AND planning_status <> 'CANCELLED' FOR UPDATE`,
      [c.organizationId, line.order_id, line.sequence])).rows[0];
    if (slot && slot.item_id === line.item_id) {
      await client.query(`UPDATE tenant.manufacturing_sales_demands SET sales_order_line_id = $3, source_version_number = $4, version = version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`,
        [c.organizationId, slot.id, line.id, line.version_number]);
      await demandEvent(client, c, slot.id, "SOURCE_AMENDED", { summary: `Sales Order amended (version ${line.version_number}); demand follows the line`, details: { fromLineId: slot.sales_order_line_id, toLineId: line.id } });
      continue;
    }
    if (slot) {
      await client.query(`UPDATE tenant.manufacturing_sales_demands SET planning_status = 'CANCELLED', exception = 'The order line became another product', version = version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`,
        [c.organizationId, slot.id]);
      await demandEvent(client, c, slot.id, "CANCELLED", { summary: "The order line became another product" });
    }
    const created = (await client.query(
      `INSERT INTO tenant.manufacturing_sales_demands (organization_id, sales_order_id, sales_order_line_id, line_sequence, item_id, source_version_number) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT DO NOTHING RETURNING id`, [c.organizationId, line.order_id, line.id, line.sequence, line.item_id, line.version_number])).rows[0];
    if (created) await demandEvent(client, c, created.id, "DETECTED", { summary: "Confirmed customer demand for a manufactured product" });
  }
}

// Everything about one demand as it stands now, from Sales, Inventory and the manufacturing orders; persisted back (status, projections,
// allocation states) when it changed. Returns the evaluated view.
export async function evaluateDemand(client, c, demand) {
  const order = (await client.query(
    `SELECT sales_order.id, sales_order.sales_order_number, sales_order.lifecycle_status, sales_order.current_version_id, sales_order.requested_delivery_date, version.version_number,
            version.priority, version.customer_snapshot->>'displayName' AS customer, version.default_warehouse_id
       FROM tenant.sales_orders sales_order JOIN tenant.sales_order_versions version ON version.id = sales_order.current_version_id
      WHERE sales_order.organization_id = $1 AND sales_order.id = $2`, [c.organizationId, demand.sales_order_id])).rows[0];
  const lineRow = (await client.query(
    `SELECT line.*, uom.code AS uom_code FROM tenant.sales_order_lines line LEFT JOIN tenant.units_of_measure uom ON uom.id = line.uom_id
      WHERE line.organization_id = $1 AND line.id = $2`, [c.organizationId, demand.sales_order_line_id])).rows[0];
  const onCurrent = lineRow?.sales_order_version_id === order.current_version_id;
  const progress = onCurrent ? (await loadOrderLineProgress(client, c.organizationId, order.current_version_id)).find((row) => row.lineId === lineRow.id) : null;
  const factor = D(String(progress?.conversionFactor ?? lineRow?.conversion_factor ?? 1));
  const base = (value) => mul(D(String(value ?? 0)), factor);
  const ordered = progress ? base(progress.ordered) : D(demand.ordered_quantity);
  const cancelled = progress ? base(progress.cancelled) : D(demand.cancelled_quantity);
  const delivered = progress ? base(progress.delivered) : D(demand.delivered_quantity);
  const reserved = progress ? base(progress.reserved) : ZERO;
  const outstanding = max(sub(sub(ordered, cancelled), delivered), ZERO);
  const warehouseId = progress?.warehouseId ?? order.default_warehouse_id ?? null;
  const requiredDate = lineRow?.promised_delivery_date ?? lineRow?.requested_delivery_date ?? order.requested_delivery_date ?? null;
  const item = (await client.query(`SELECT item.id, item.code, item.name, item.uom_id, uom.code AS base_uom FROM tenant.items item LEFT JOIN tenant.units_of_measure uom ON uom.id = item.uom_id WHERE item.id = $1`,
    [demand.item_id])).rows[0];
  const policy = (await client.query(`SELECT * FROM tenant.manufacturing_item_policies WHERE organization_id = $1 AND item_id = $2`, [c.organizationId, demand.item_id])).rows[0] ?? null;
  // Cancelled: the order, the whole line, or a reconfirmed order without this line.
  const cancelledDemand = demand.planning_status === "CANCELLED" || order.lifecycle_status === "cancelled" || (order.lifecycle_status === "confirmed" && !onCurrent)
    || (progress && outstanding === ZERO && delivered === ZERO && cancelled > ZERO);
  const allocations = (await client.query(
    `SELECT allocation.*, mo.mo_number, mo.status AS mo_status, mo.planned_base_quantity, mo.received_quantity AS mo_received, mo.accepted_quantity AS mo_accepted, mo.planned_end_at,
            mo.finished_goods_warehouse_id
       FROM tenant.manufacturing_demand_allocations allocation JOIN tenant.manufacturing_orders mo ON mo.id = allocation.manufacturing_order_id
      WHERE allocation.organization_id = $1 AND allocation.demand_id = $2 ORDER BY allocation.created_at`, [c.organizationId, demand.id])).rows;
  let inProduction = ZERO;
  let proposed = ZERO;
  let receivedUnreserved = ZERO;
  let deliveredLeft = delivered;
  const views = [];
  for (const allocation of allocations) {
    if (allocation.status === "RELEASED") { views.push({ ...allocation, open: ZERO }); continue; }
    const allocated = D(allocation.allocated_quantity);
    const received = D(allocation.received_quantity);
    const reservedPart = D(allocation.reserved_quantity);
    const fulfilled = min(deliveredLeft, reservedPart);
    deliveredLeft = sub(deliveredLeft, fulfilled);
    let status;
    let exception = null;
    let open = ZERO;
    if (allocation.mo_status === "CANCELLED") {
      status = "RELEASED";
    } else if (PLANNED.has(allocation.mo_status)) {
      status = "PROPOSED";
      proposed = add(proposed, allocated);
    } else if (PRODUCING.has(allocation.mo_status)) {
      open = sub(allocated, received);
      inProduction = add(inProduction, open);
      status = received > ZERO ? "PARTIALLY_RECEIVED" : "COMMITTED";
    } else {
      status = received === ZERO ? "RELEASED" : fulfilled >= received ? "FULFILLED" : "AVAILABLE_FOR_FULFILLMENT";
    }
    if (status !== "RELEASED") receivedUnreserved = add(receivedUnreserved, max(sub(received, reservedPart), ZERO));
    if (cancelledDemand && status !== "RELEASED" && status !== "FULFILLED") { status = "EXCEPTION"; exception = "The customer demand was cancelled: review this order's supply."; }
    if (status !== allocation.status || fulfilled !== D(allocation.fulfilled_quantity) || exception !== (allocation.exception ?? null)) {
      const reason = status === "RELEASED" ? (allocation.mo_status === "CANCELLED" ? "Manufacturing order cancelled" : "Manufacturing order completed with nothing received for this demand") : null;
      await client.query(
        `UPDATE tenant.manufacturing_demand_allocations SET status = $3, fulfilled_quantity = $4, exception = $5, release_reason = COALESCE(release_reason, $6), released_at = CASE WHEN $3 = 'RELEASED' THEN clock_timestamp() ELSE released_at END,
                version = version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, allocation.id, status, q(fulfilled), exception, reason]);
      if (status !== allocation.status) await demandEvent(client, c, demand.id, status === "RELEASED" ? "ALLOCATION_RELEASED" : "ALLOCATION_STATUS", { allocationId: allocation.id, orderId: allocation.manufacturing_order_id,
        summary: `${allocation.mo_number}: ${allocation.status.toLowerCase()} → ${status.toLowerCase()}${reason ? ` (${reason})` : ""}` });
    }
    views.push({ ...allocation, status, exception, fulfilled_quantity: q(fulfilled), open });
  }
  const readyToAllocate = min(receivedUnreserved, max(sub(outstanding, reserved), ZERO));
  const uncovered = max(sub(sub(outstanding, reserved), inProduction), ZERO);
  const free = warehouseId ? await freeStock(client, c, demand.item_id, warehouseId) : ZERO;
  const makeToStock = policy?.supply_policy === "MAKE_TO_STOCK";
  const recommendedRaw = max(sub(sub(sub(uncovered, proposed), readyToAllocate), makeToStock ? free : ZERO), ZERO);
  const recommended = roundUp(recommendedRaw, policy);
  const capacity = max(sub(uncovered, proposed), ZERO);
  const committed = add(add(reserved, inProduction), proposed);
  const overcommitted = sub(committed, outstanding) > ZERO ? sub(committed, outstanding) : ZERO;
  let status;
  if (cancelledDemand) status = "CANCELLED";
  else if (order.lifecycle_status === "draft" || !onCurrent) status = "ON_HOLD";
  else if (outstanding === ZERO) status = "FULFILLED";
  else if (reserved >= outstanding) status = "READY_FOR_FULFILLMENT";
  else if (uncovered === ZERO) status = inProduction > ZERO ? "IN_PRODUCTION" : "COVERED";
  else if (add(add(reserved, inProduction), add(proposed, readyToAllocate)) > ZERO) status = "PARTIALLY_COVERED";
  else status = "NEEDS_REVIEW";
  const exception = status === "ON_HOLD" ? "The Sales Order was reopened for changes; production waits until it is confirmed again."
    : overcommitted > ZERO && status !== "CANCELLED" ? `Overcommitted by ${q(overcommitted)} ${item.base_uom ?? ""}: release supply no longer needed.`.trim()
    : views.some((row) => row.status === "EXCEPTION") ? "The customer demand was cancelled while manufacturing orders still cover it." : null;
  const changed = demand.planning_status !== status || D(demand.outstanding_quantity) !== outstanding || D(demand.reserved_quantity) !== reserved || D(demand.delivered_quantity) !== delivered
    || D(demand.ordered_quantity) !== ordered || (demand.exception ?? null) !== exception || (demand.fulfillment_warehouse_id ?? null) !== warehouseId
    || String(demand.required_date ?? "") !== String(requiredDate ?? "");
  if (changed) {
    await client.query(
      `UPDATE tenant.manufacturing_sales_demands SET planning_status = $3, ordered_quantity = $4, cancelled_quantity = $5, delivered_quantity = $6, reserved_quantity = $7, outstanding_quantity = $8,
              fulfillment_warehouse_id = $9, required_date = $10, exception = $11, last_evaluated_at = clock_timestamp(), version = version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, demand.id, status, q(ordered), q(cancelled), q(delivered), q(reserved), q(outstanding), warehouseId, requiredDate, exception]);
    if (demand.planning_status !== status) await demandEvent(client, c, demand.id, "STATUS_CHANGED", { summary: `${STATUS_LABEL[demand.planning_status]} → ${STATUS_LABEL[status]}` });
  }
  const bomRevision = await resolveEffectiveBom(client, c.organizationId, demand.item_id).catch(() => null);
  const hasBom = Boolean((await client.query(`SELECT 1 FROM tenant.manufacturing_bom_masters WHERE organization_id = $1 AND finished_item_id = $2 AND archived_at IS NULL`, [c.organizationId, demand.item_id])).rows[0]);
  return {
    demand: { ...demand, planning_status: status, exception, version: changed ? demand.version + 1 : demand.version }, order, line: lineRow, item, policy, warehouseId, requiredDate,
    figures: { ordered, cancelled, delivered, reserved, outstanding, inProduction, proposed, readyToAllocate, uncovered, free, recommended, capacity, overcommitted },
    allocations: views, bom: { status: bomRevision ? "EFFECTIVE" : hasBom ? "NOT_EFFECTIVE" : "MISSING", revisionId: bomRevision },
  };
}

// A recommendation respects the product's minimum batch and quantity increment.
function roundUp(value, policy) {
  if (value === ZERO || !policy) return value;
  let out = value;
  if (policy.minimum_batch_quantity && out < D(policy.minimum_batch_quantity)) out = D(policy.minimum_batch_quantity);
  if (policy.quantity_increment) {
    const step = D(policy.quantity_increment);
    const remainder = out % step;
    if (remainder !== ZERO) out = out - remainder + step;
  }
  return out;
}

export async function loadDemand(client, c, id, { lock = false } = {}) {
  const row = (await client.query(`SELECT * FROM tenant.manufacturing_sales_demands WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [c.organizationId, uuid(id, "Demand")])).rows[0];
  if (!row) throw demandError(404, "MFG_DEMAND_NOT_FOUND");
  return row;
}
// Demand mutations for one line take turns.
export const lockDemand = (client, demandId) => client.query(`SELECT pg_advisory_xact_lock(hashtextextended('manufacturing_demand:' || $1::text, 0))`, [demandId]);
