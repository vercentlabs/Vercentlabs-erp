// Manufacturing from Sales demand — the planning service: the demand queue, one demand's coverage and recommendation, a guided preview, a
// draft manufacturing order created from one or more demand lines (its proposed allocations written in the same transaction, under a lock
// per line, so two planners never both plan the same shortfall), assigning existing orders' output, releasing and reassigning it,
// reserving received goods (or free stock) for the Sales Order through Sales and Inventory, the product's manufacturing policy, the
// reports, and the production status Sales shows. Physical stock and deliveries stay with Inventory and Sales.
import { reserveSalesOrderLine } from "../../sales/reservations/service.js";
import { assertOrderVisible, orderCan } from "../../sales/orders/access.js";
import { div, idempotent, MO } from "../orders/mo-core.js";
import { createManufacturingOrder, previewManufacturingOrder } from "../orders/mo-lifecycle.js";
import { getManufacturingOrder } from "../orders/mo-read.js";
import {
  D, DEMAND, STATUS_LABEL, ZERO, add, demandError, demandEvent, evaluateDemand, has, loadDemand, lockDemand, max, min, mul, needDemand, q, sub, syncDemands, text, uuid,
} from "./demand-engine.js";

const salesReservationContext = (c) => ({ organizationId: c.organizationId, userId: c.userId ?? null,
  permissions: ["sales.order.view", "sales.order.view_all", "sales.order.reserve", "sales.order.reserve_partial"], roleSlugs: [] });
const dayOf = (value) => (value ? (value instanceof Date ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` : String(value).slice(0, 10)) : null);

// The demand as people see it.
function view(evaluated, c) {
  const { demand, order, line, item, figures, allocations, bom, policy } = evaluated;
  const f = (value) => q(value);
  const today = new Date();
  const required = evaluated.requiredDate ? new Date(`${dayOf(evaluated.requiredDate)}T23:59:59`) : null;
  const latest = allocations.filter((row) => row.status !== "RELEASED").map((row) => new Date(row.planned_end_at)).sort((a, b) => b - a)[0] ?? null;
  const leadDays = policy?.lead_time_days ?? null;
  const warnings = [];
  if (required && required < today && demand.planning_status !== "FULFILLED") warnings.push("The customer's required date has passed.");
  if (required && latest && latest > required) warnings.push("A linked manufacturing order is planned to finish after the required date.");
  if (required && leadDays !== null && figures.recommended > ZERO && new Date(today.getTime() + leadDays * 86_400_000) > required)
    warnings.push(`Production takes about ${leadDays} day(s); new production cannot finish by the required date.`);
  if (bom.status !== "EFFECTIVE") warnings.push(bom.status === "MISSING" ? "Create and approve a BOM for this product." : "The product's BOM has no revision in use now.");
  return {
    id: demand.id, version: demand.version, status: demand.planning_status, statusLabel: STATUS_LABEL[demand.planning_status], exception: demand.exception,
    salesOrder: { id: order.id, number: order.sales_order_number, status: order.lifecycle_status, versionNumber: order.version_number, customer: order.customer, priority: order.priority ?? null },
    line: { id: demand.sales_order_line_id, sequence: demand.line_sequence, quantity: line ? q(D(line.quantity)) : null, uom: line?.uom_code ?? null },
    item: { id: item.id, code: item.code, name: item.name, baseUom: item.base_uom }, warehouseId: evaluated.warehouseId, requiredDate: dayOf(evaluated.requiredDate),
    policy: policy ? { supplyPolicy: policy.supply_policy, leadTimeDays: policy.lead_time_days, minimumBatch: policy.minimum_batch_quantity === null ? null : q(D(policy.minimum_batch_quantity)),
      increment: policy.quantity_increment === null ? null : q(D(policy.quantity_increment)), materialWarehouseId: policy.default_material_warehouse_id,
      manufacturingWarehouseId: policy.default_manufacturing_warehouse_id } : { supplyPolicy: "MAKE_TO_ORDER", leadTimeDays: null, minimumBatch: null, increment: null, materialWarehouseId: null, manufacturingWarehouseId: null },
    quantities: { ordered: f(figures.ordered), cancelled: f(figures.cancelled), delivered: f(figures.delivered), outstanding: f(figures.outstanding), reservedStock: f(figures.reserved),
      inProduction: f(figures.inProduction), proposed: f(figures.proposed), readyToAllocate: f(figures.readyToAllocate), uncovered: f(figures.uncovered), freeStock: f(figures.free),
      recommended: f(figures.recommended), plannable: f(figures.capacity), overcommitted: f(figures.overcommitted) },
    bom, warnings,
    allocations: allocations.map((row) => ({ id: row.id, orderId: row.manufacturing_order_id, orderNumber: row.mo_number, orderStatus: row.mo_status, status: row.status, allocated: q(D(row.allocated_quantity)),
      received: q(D(row.received_quantity)), reserved: q(D(row.reserved_quantity)), fulfilled: q(D(row.fulfilled_quantity)), open: q(row.open ?? ZERO), plannedEndAt: row.planned_end_at,
      releaseReason: row.release_reason, exception: row.exception })),
    can: { plan: has(c, DEMAND.plan), createOrder: has(c, DEMAND.createMo) && has(c, MO.create) && !["CANCELLED", "ON_HOLD", "FULFILLED"].includes(demand.planning_status),
      allocate: has(c, DEMAND.allocate), reallocate: has(c, DEMAND.reallocate), release: has(c, DEMAND.release),
      reserve: (has(c, DEMAND.allocate) || has(c, "sales.order.reserve")) && order.lifecycle_status === "confirmed", setPolicy: has(c, DEMAND.plan) },
  };
}

async function evaluated(client, c, id, { lock = false } = {}) {
  const demand = await loadDemand(client, c, id, { lock });
  await syncDemands(client, c, { orderId: demand.sales_order_id });
  return evaluateDemand(client, c, await loadDemand(client, c, id, { lock }));
}

// ------------------------------------------------------------------ reading
// filters: { status? ("OPEN" default: anything not fulfilled or cancelled), search?, itemId?, warehouseId?, from?, to?, bom? }
export async function listSalesDemand(client, c, filters = {}) {
  needDemand(c, DEMAND.view);
  await syncDemands(client, c);
  const status = text(filters.status, 40) || "OPEN";
  const values = [c.organizationId];
  let where = "";
  if (status === "OPEN") where += ` AND demand.planning_status NOT IN ('FULFILLED', 'CANCELLED')`;
  else if (status !== "all") { values.push(status); where += ` AND demand.planning_status = $${values.length}`; }
  if (filters.itemId) { values.push(uuid(filters.itemId, "Product")); where += ` AND demand.item_id = $${values.length}`; }
  const rows = (await client.query(`SELECT demand.* FROM tenant.manufacturing_sales_demands demand WHERE demand.organization_id = $1${where} ORDER BY demand.required_date NULLS LAST, demand.created_at LIMIT 500`, values)).rows;
  const list = [];
  for (const row of rows) {
    const item = view(await evaluateDemand(client, c, row), c);
    if (status === "OPEN" && ["FULFILLED", "CANCELLED"].includes(item.status)) continue;
    if (status !== "OPEN" && status !== "all" && item.status !== status) continue;
    const search = text(filters.search, 100).toLowerCase();
    if (search && ![item.salesOrder.number, item.salesOrder.customer, item.item.code, item.item.name].some((value) => String(value ?? "").toLowerCase().includes(search))) continue;
    if (filters.warehouseId && item.warehouseId !== filters.warehouseId) continue;
    if (filters.from && (!item.requiredDate || item.requiredDate < filters.from)) continue;
    if (filters.to && (!item.requiredDate || item.requiredDate > filters.to)) continue;
    if (filters.bom && item.bom.status !== filters.bom) continue;
    list.push(item);
  }
  const totals = list.reduce((sum, row) => ({ uncovered: add(sum.uncovered, D(row.quantities.uncovered)), recommended: add(sum.recommended, D(row.quantities.recommended)) }), { uncovered: ZERO, recommended: ZERO });
  return { demands: list, totals: { lines: list.length, uncovered: q(totals.uncovered), recommended: q(totals.recommended) } };
}

export async function getSalesDemand(client, c, id) {
  needDemand(c, DEMAND.view);
  const result = view(await evaluated(client, c, id), c);
  const events = (await client.query(
    `SELECT event.*, actor.full_name AS actor, mo.mo_number FROM tenant.manufacturing_demand_events event LEFT JOIN public.users actor ON actor.id = event.actor_user_id
       LEFT JOIN tenant.manufacturing_orders mo ON mo.id = event.manufacturing_order_id WHERE event.organization_id = $1 AND event.demand_id = $2 ORDER BY event.occurred_at DESC LIMIT 200`,
    [c.organizationId, result.id])).rows;
  // Released orders of the same product into the same warehouse whose output is not all assigned: candidates to cover this demand.
  const candidates = (await client.query(
    `SELECT mo.id, mo.mo_number, mo.status, mo.planned_base_quantity, mo.planned_end_at,
            mo.planned_base_quantity - COALESCE((SELECT sum(allocated_quantity) FROM tenant.manufacturing_demand_allocations allocation WHERE allocation.manufacturing_order_id = mo.id AND allocation.status <> 'RELEASED'), 0) AS free
       FROM tenant.manufacturing_orders mo WHERE mo.organization_id = $1 AND mo.finished_item_id = $2 AND mo.finished_goods_warehouse_id = $3
        AND mo.status IN ('DRAFT', 'AWAITING_APPROVAL', 'RELEASED', 'IN_PROGRESS', 'ON_HOLD') ORDER BY mo.planned_end_at`, [c.organizationId, result.item.id, result.warehouseId])).rows
    .filter((row) => D(row.free) > ZERO);
  return { ...result, history: events.map((row) => ({ action: row.action, summary: row.summary, quantity: row.quantity === null ? null : q(D(row.quantity)), order: row.mo_number, actor: row.actor, at: row.occurred_at })),
    candidateOrders: candidates.map((row) => ({ id: row.id, number: row.mo_number, status: row.status, unassigned: q(D(row.free)), plannedEndAt: row.planned_end_at })) };
}

// ------------------------------------------------------------------ guided creation
// What a draft order from these demand lines would be: the coverage of each line, the recommended quantity, feasibility, the BOM and the
// materials. input: { demandIds, quantity?, plannedStartAt?, plannedEndAt?, materialWarehouseId?, manufacturingWarehouseId? }
export async function previewManufacturingFromSales(client, c, input = {}) {
  needDemand(c, DEMAND.plan);
  const ids = [...new Set((input.demandIds ?? []).map((id) => uuid(id, "Demand")))];
  if (!ids.length) throw demandError(400, "MFG_DEMAND_QTY_EXCEEDS", "Choose the demand to plan.");
  const demands = [];
  for (const id of ids) demands.push(view(await evaluated(client, c, id), c));
  const first = demands[0];
  if (demands.some((row) => row.item.id !== first.item.id || row.warehouseId !== first.warehouseId)) throw demandError(409, "MFG_DEMAND_MO_INELIGIBLE", "One order covers demand for the same product into the same warehouse only.");
  const recommended = demands.reduce((sum, row) => add(sum, D(row.quantities.recommended)), ZERO);
  const quantity = input.quantity ? D(String(input.quantity)) : recommended;
  const start = input.plannedStartAt ?? new Date(Date.now() + 3_600_000).toISOString();
  const lead = first.policy.leadTimeDays ?? 1;
  const end = input.plannedEndAt ?? new Date(new Date(start).getTime() + Math.max(lead, 1) * 86_400_000).toISOString();
  let materials = null;
  let materialError = null;
  if (quantity > ZERO && has(c, MO.create) && first.warehouseId) {
    try {
      materials = await previewManufacturingOrder(client, c, { finishedItemId: first.item.id, plannedQuantity: q(quantity), plannedStartAt: start, plannedEndAt: end,
        manufacturingWarehouseId: input.manufacturingWarehouseId ?? first.policy.manufacturingWarehouseId ?? first.warehouseId,
        materialWarehouseId: input.materialWarehouseId ?? first.policy.materialWarehouseId ?? first.warehouseId, finishedGoodsWarehouseId: first.warehouseId });
    } catch (error) { materialError = error.message; }
  }
  const required = demands.map((row) => row.requiredDate).filter(Boolean).sort()[0] ?? null;
  const warnings = [...new Set(demands.flatMap((row) => row.warnings))];
  if (required && new Date(end) > new Date(`${required}T23:59:59`)) warnings.push(`Planned completion ${end.slice(0, 10)} is after the earliest required date ${required}.`);
  return { demands, recommended: q(recommended), quantity: q(quantity), plannedStartAt: start, plannedEndAt: end, requiredDate: required, warnings, materials, materialError, previewOnly: true };
}

// A draft manufacturing order for demand lines of one product, with a proposed allocation per line — written together, each line locked
// and re-evaluated first, so the lines' plannable quantity is never planned twice. input: { lines: [{ demandId, quantity }], plannedQuantity?,
// plannedStartAt, plannedEndAt, materialWarehouseId?, manufacturingWarehouseId?, priority?, notes?, expectedVersions?: { demandId: salesOrderVersion },
// idempotencyKey }
export async function createManufacturingOrderFromSales(client, c, input = {}) {
  needDemand(c, DEMAND.createMo);
  if (!has(c, MO.create)) throw demandError(403, "MFG_DEMAND_PERMISSION_DENIED", "Creating the manufacturing order also needs permission to create manufacturing orders.");
  const result = await idempotent(client, c, "manufacturing.demand.create_order", input.idempotencyKey, { ...input, idempotencyKey: undefined }, async (key) => {
    const requests = (Array.isArray(input.lines) ? input.lines : []).map((row) => ({ demandId: uuid(row.demandId, "Demand"), quantity: D(String(row.quantity ?? "0")) }));
    if (!requests.length || requests.some((row) => row.quantity <= ZERO)) throw demandError(400, "MFG_DEMAND_QTY_EXCEEDS", "Enter the quantity to plan for each line.");
    requests.sort((a, b) => a.demandId.localeCompare(b.demandId));
    const checked = [];
    for (const request of requests) {
      await lockDemand(client, request.demandId);
      const current = await evaluated(client, c, request.demandId, { lock: true });
      const shown = view(current, c);
      if (current.order.lifecycle_status !== "confirmed") throw demandError(409, "MFG_DEMAND_SALES_NOT_CONFIRMED");
      if (shown.status === "CANCELLED") throw demandError(409, "MFG_DEMAND_LINE_CANCELLED");
      if (current.bom.status === "MISSING") throw demandError(409, "MFG_DEMAND_BOM_MISSING");
      const expected = input.expectedVersions?.[request.demandId];
      if (expected !== undefined && expected !== null && Number(expected) !== Number(current.order.version_number)) throw demandError(409, "MFG_DEMAND_SOURCE_CHANGED", undefined, { demand: shown });
      if (current.figures.capacity === ZERO) throw demandError(409, "MFG_DEMAND_ALREADY_COVERED", `${shown.salesOrder.number} · ${shown.item.code}: stock, production and drafts already cover it.`, { demand: shown });
      if (request.quantity > current.figures.capacity) {
        throw demandError(409, input.expectedPlannable?.[request.demandId] && D(String(input.expectedPlannable[request.demandId])) !== current.figures.capacity ? "MFG_DEMAND_ALLOCATION_CONFLICT" : "MFG_DEMAND_QTY_EXCEEDS",
          `${shown.salesOrder.number} · ${shown.item.code}: ${q(current.figures.capacity)} may still be planned.`, { demand: shown });
      }
      checked.push({ request, current, shown });
    }
    const first = checked[0].shown;
    if (checked.some((row) => row.shown.item.id !== first.item.id)) throw demandError(409, "MFG_DEMAND_MO_INELIGIBLE", "One order covers one product.");
    if (checked.some((row) => row.shown.warehouseId !== first.warehouseId) || !first.warehouseId) throw demandError(409, "MFG_DEMAND_WAREHOUSE_INVALID", "The lines ship from different warehouses (or none).");
    const assigned = checked.reduce((sum, row) => add(sum, row.request.quantity), ZERO);
    const planned = input.plannedQuantity ? D(String(input.plannedQuantity)) : assigned;
    if (planned < assigned) throw demandError(400, "MFG_DEMAND_QTY_EXCEEDS", "The order must make at least what it is assigned to the customer lines.");
    let order;
    try {
      order = await createManufacturingOrder(client, c, { finishedItemId: first.item.id, plannedQuantity: q(planned), uomId: undefined, plannedStartAt: input.plannedStartAt, plannedEndAt: input.plannedEndAt,
        manufacturingWarehouseId: input.manufacturingWarehouseId ?? first.policy.manufacturingWarehouseId ?? first.warehouseId,
        materialWarehouseId: input.materialWarehouseId ?? first.policy.materialWarehouseId ?? first.warehouseId, finishedGoodsWarehouseId: first.warehouseId,
        sourceDemandType: "SALES_ORDER", sourceDemandId: first.salesOrder.id, priority: input.priority ?? (first.salesOrder.priority === "high" ? "HIGH" : undefined),
        notes: text(input.notes, 4000) || `For ${[...new Set(checked.map((row) => row.shown.salesOrder.number))].join(", ")}`, idempotencyKey: `${key}:order` });
    } catch (error) {
      if (error.code === "MFG_MO_BOM_NOT_ELIGIBLE") throw demandError(409, "MFG_DEMAND_BOM_NOT_EFFECTIVE", error.message);
      throw error;
    }
    const allocations = [];
    for (const { request, shown } of checked) {
      const row = (await client.query(
        `INSERT INTO tenant.manufacturing_demand_allocations (organization_id, demand_id, manufacturing_order_id, allocated_quantity, idempotency_key, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [c.organizationId, request.demandId, order.id, q(request.quantity), `${key}:${request.demandId}`, c.userId ?? null])).rows[0];
      await demandEvent(client, c, request.demandId, "ALLOCATED", { allocationId: row.id, orderId: order.id, quantity: request.quantity, summary: `${order.number} planned for ${q(request.quantity)} (proposed while a draft)` });
      allocations.push({ demandId: request.demandId, salesOrder: shown.salesOrder.number, allocationId: row.id, proposed: q(request.quantity), status: "PROPOSED" });
      await evaluateDemand(client, c, await loadDemand(client, c, request.demandId));
    }
    return { orderId: order.id, allocations };
  });
  return { ...result, order: await getManufacturingOrder(client, c, result.orderId), materialReservationStatus: "NOT_STARTED", finishedGoodsAllocationStatus: "NOT_STARTED" };
}

// ------------------------------------------------------------------ allocations
// Assign an existing order's output to a demand (input: { demandId, manufacturingOrderId, quantity, idempotencyKey? }): same product, into the
// demand's warehouse, not more than the demand may still be planned for nor than the order still has unassigned.
export async function allocateManufacturingSupply(client, c, input = {}) {
  needDemand(c, DEMAND.allocate);
  return idempotent(client, c, "manufacturing.demand.allocate", input.idempotencyKey, { ...input, idempotencyKey: undefined }, async (key) => {
    const demandId = uuid(input.demandId, "Demand");
    await lockDemand(client, demandId);
    const current = await evaluated(client, c, demandId, { lock: true });
    const quantity = D(String(input.quantity ?? "0"));
    if (quantity <= ZERO) throw demandError(400, "MFG_DEMAND_QTY_EXCEEDS", "Enter the quantity to assign.");
    if (["CANCELLED", "ON_HOLD", "FULFILLED"].includes(current.demand.planning_status)) throw demandError(409, current.demand.planning_status === "CANCELLED" ? "MFG_DEMAND_LINE_CANCELLED" : "MFG_DEMAND_SALES_NOT_CONFIRMED");
    if (quantity > current.figures.capacity) throw demandError(409, current.figures.capacity === ZERO ? "MFG_DEMAND_ALREADY_COVERED" : "MFG_DEMAND_QTY_EXCEEDS", `${q(current.figures.capacity)} may still be planned for this line.`);
    const mo = (await client.query(`SELECT * FROM tenant.manufacturing_orders WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(input.manufacturingOrderId, "Manufacturing order")])).rows[0];
    if (!mo) throw demandError(404, "MFG_DEMAND_MO_INELIGIBLE", "That manufacturing order was not found.");
    if (mo.finished_item_id !== current.demand.item_id) throw demandError(409, "MFG_DEMAND_MO_INELIGIBLE", "That order makes another product.");
    if (mo.finished_goods_warehouse_id !== current.warehouseId) throw demandError(409, "MFG_DEMAND_MO_INELIGIBLE", "That order delivers its goods to another warehouse.");
    if (["COMPLETED", "CANCELLED"].includes(mo.status)) throw demandError(409, "MFG_DEMAND_MO_INELIGIBLE", `${mo.mo_number} is ${mo.status.toLowerCase()}.`);
    const existing = (await client.query(`SELECT * FROM tenant.manufacturing_demand_allocations WHERE demand_id = $1 AND manufacturing_order_id = $2 AND status <> 'RELEASED' FOR UPDATE`, [demandId, mo.id])).rows[0];
    let allocationId;
    try {
      await client.query("SAVEPOINT demand_allocate");
      if (existing) {
        await client.query(`UPDATE tenant.manufacturing_demand_allocations SET allocated_quantity = allocated_quantity + $3, version = version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, existing.id, q(quantity)]);
        allocationId = existing.id;
      } else {
        allocationId = (await client.query(`INSERT INTO tenant.manufacturing_demand_allocations (organization_id, demand_id, manufacturing_order_id, allocated_quantity, idempotency_key, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [c.organizationId, demandId, mo.id, q(quantity), key, c.userId ?? null])).rows[0].id;
      }
      await client.query("RELEASE SAVEPOINT demand_allocate");
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT demand_allocate");
      if (error.code === "23P01") throw demandError(409, "MFG_DEMAND_MO_INELIGIBLE", `${mo.mo_number}'s output is already assigned to other customer demand.`);
      throw error;
    }
    await demandEvent(client, c, demandId, "ALLOCATED", { allocationId, orderId: mo.id, quantity, summary: `${mo.mo_number} assigned ${q(quantity)}` });
    await evaluateDemand(client, c, await loadDemand(client, c, demandId));
    return { demandId, allocationId };
  }).then(async (outcome) => ({ ...outcome, demand: await getSalesDemand(client, c, outcome.demandId) }));
}

// Give back output assigned to a demand (input: { reason, quantity? } — part of it, or all). Received goods stay where they are.
export async function releaseManufacturingAllocation(client, c, allocationId, input = {}) {
  needDemand(c, DEMAND.release);
  const allocation = (await client.query(`SELECT * FROM tenant.manufacturing_demand_allocations WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(allocationId, "Allocation")])).rows[0];
  if (!allocation) throw demandError(404, "MFG_DEMAND_NOT_FOUND", "That allocation was not found.");
  await lockDemand(client, allocation.demand_id);
  if (allocation.status === "RELEASED") return getSalesDemand(client, c, allocation.demand_id);
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw demandError(400, "MFG_DEMAND_QTY_EXCEEDS", "Say why the supply is released.");
  const releasable = sub(D(allocation.allocated_quantity), D(allocation.received_quantity));
  const amount = input.quantity ? D(String(input.quantity)) : releasable;
  if (amount <= ZERO || amount > releasable) throw demandError(409, "MFG_DEMAND_QTY_EXCEEDS", `${q(releasable)} not yet received may be released; received goods are released from their reservation in Sales.`);
  if (amount === D(allocation.allocated_quantity)) {
    await client.query(`UPDATE tenant.manufacturing_demand_allocations SET status = 'RELEASED', release_reason = $3, released_by = $4, released_at = clock_timestamp(), version = version + 1 WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, allocation.id, reason, c.userId ?? null]);
  } else {
    await client.query(`UPDATE tenant.manufacturing_demand_allocations SET allocated_quantity = allocated_quantity - $3, version = version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, allocation.id, q(amount)]);
  }
  await demandEvent(client, c, allocation.demand_id, "ALLOCATION_RELEASED", { allocationId: allocation.id, orderId: allocation.manufacturing_order_id, quantity: amount, summary: reason });
  await evaluateDemand(client, c, await loadDemand(client, c, allocation.demand_id));
  return getSalesDemand(client, c, allocation.demand_id);
}

// Move assigned, not yet received output to another demand line of the same product and warehouse (input: { toDemandId, quantity, reason }).
export async function reassignManufacturingSupply(client, c, allocationId, input = {}) {
  needDemand(c, DEMAND.reallocate);
  const allocation = (await client.query(`SELECT * FROM tenant.manufacturing_demand_allocations WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(allocationId, "Allocation")])).rows[0];
  if (!allocation || allocation.status === "RELEASED") throw demandError(404, "MFG_DEMAND_NOT_FOUND", "That allocation was not found or is released.");
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw demandError(400, "MFG_DEMAND_QTY_EXCEEDS", "Say why the supply is reassigned.");
  const toId = uuid(input.toDemandId, "Demand");
  const amount = D(String(input.quantity ?? sub(D(allocation.allocated_quantity), D(allocation.received_quantity))));
  const ids = [allocation.demand_id, toId].sort();
  for (const id of ids) await lockDemand(client, id);
  await releaseManufacturingAllocation(client, { ...c, permissions: [...new Set([...(c.permissions ?? []), DEMAND.release])] }, allocation.id, { reason: `Reassigned: ${reason}`, quantity: q(amount) });
  await allocateManufacturingSupply(client, { ...c, permissions: [...new Set([...(c.permissions ?? []), DEMAND.allocate])] }, { demandId: toId, manufacturingOrderId: allocation.manufacturing_order_id, quantity: q(amount) });
  await demandEvent(client, c, toId, "REASSIGNED_IN", { orderId: allocation.manufacturing_order_id, quantity: amount, summary: reason, details: { fromDemandId: allocation.demand_id } });
  return { from: await getSalesDemand(client, c, allocation.demand_id), to: await getSalesDemand(client, c, toId) };
}

// ------------------------------------------------------------------ reservation for the Sales Order
// Reserve stock for the demand's Sales Order line through Sales and Inventory: received output attributed to it first, then (make to stock) free
// stock. Never claims success until Inventory reserved it. input: { quantity?, idempotencyKey? }
export async function reserveDemandForSales(client, c, id, input = {}) {
  if (!has(c, DEMAND.allocate) && !has(c, "sales.order.reserve")) throw demandError(403, "MFG_DEMAND_PERMISSION_DENIED");
  await lockDemand(client, uuid(id, "Demand"));
  const current = await evaluated(client, c, id, { lock: true });
  if (current.order.lifecycle_status !== "confirmed") throw demandError(409, "MFG_DEMAND_SALES_NOT_CONFIRMED");
  const open = max(sub(current.figures.outstanding, current.figures.reserved), ZERO);
  const amount = input.quantity ? min(D(String(input.quantity)), open) : open;
  if (amount <= ZERO) throw demandError(409, "MFG_DEMAND_ALREADY_COVERED", "Everything still to deliver is already reserved.");
  const reserved = await reserveForLine(client, c, current, amount, text(input.idempotencyKey, 200) || `demand-reserve:${current.demand.id}:${Date.now()}`);
  if (reserved.error) throw demandError(409, "MFG_DEMAND_RESERVATION_FAILED", `Inventory: ${reserved.error}`);
  return getSalesDemand(client, c, current.demand.id);
}

// One reservation attempt for a demand's line, inside a savepoint; the reserved base quantity is attributed to the demand's allocations
// with received, unreserved output (oldest first). A refusal leaves everything as it was.
async function reserveForLine(client, c, current, amount, key) {
  const factor = D(String(current.line?.conversion_factor ?? 1)) || D("1");
  let outcome;
  try {
    await client.query("SAVEPOINT demand_reserve");
    const result = await reserveSalesOrderLine(client, salesReservationContext(c), current.order.id, { lineId: current.demand.sales_order_line_id, quantity: q(div(amount, factor)), idempotencyKey: key });
    await client.query("RELEASE SAVEPOINT demand_reserve");
    outcome = result.lines?.[0];
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT demand_reserve");
    await demandEvent(client, c, current.demand.id, "RESERVATION_FAILED", { quantity: amount, summary: error.message });
    return { error: error.message, reserved: ZERO };
  }
  const got = mul(D(String(outcome?.reserved ?? 0)), factor);
  if (got <= ZERO) {
    await demandEvent(client, c, current.demand.id, "RESERVATION_FAILED", { quantity: amount, summary: outcome?.problem ?? "Nothing could be reserved." });
    return { error: outcome?.problem ?? "No stock available.", reserved: ZERO };
  }
  let left = got;
  for (const allocation of current.allocations.filter((row) => row.status !== "RELEASED")) {
    if (left <= ZERO) break;
    const waiting = max(sub(D(allocation.received_quantity), D(allocation.reserved_quantity)), ZERO);
    const take = min(waiting, left);
    if (take <= ZERO) continue;
    await client.query(`UPDATE tenant.manufacturing_demand_allocations SET reserved_quantity = reserved_quantity + $3, version = version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, allocation.id, q(take)]);
    left = sub(left, take);
  }
  await demandEvent(client, c, current.demand.id, "RESERVED_FOR_SALES", { quantity: got, summary: `${q(got)} reserved for ${current.order.sales_order_number}${outcome?.reservations?.length ? ` (${outcome.reservations.join(", ")})` : ""}` });
  await evaluateDemand(client, c, await loadDemand(client, c, current.demand.id));
  return { reserved: got };
}

// Called when a manufacturing order receives finished goods: the receipt is attributed to the order's demand allocations (oldest first, up
// to what each still expects), and each attributed part is reserved for its Sales Order line. A failed reservation leaves the goods
// received and ready to allocate. Output beyond the assigned demand stays unassigned stock.
export async function attributeReceiptToDemand(client, c, order, receiptId, quantity) {
  const allocations = (await client.query(
    `SELECT * FROM tenant.manufacturing_demand_allocations WHERE organization_id = $1 AND manufacturing_order_id = $2 AND status <> 'RELEASED' ORDER BY created_at FOR UPDATE`, [c.organizationId, order.id])).rows;
  let left = D(String(quantity));
  for (const allocation of allocations) {
    if (left <= ZERO) break;
    const expecting = sub(D(allocation.allocated_quantity), D(allocation.received_quantity));
    const take = min(expecting, left);
    if (take <= ZERO) continue;
    left = sub(left, take);
    await client.query(`UPDATE tenant.manufacturing_demand_allocations SET received_quantity = received_quantity + $3, version = version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, allocation.id, q(take)]);
    await demandEvent(client, c, allocation.demand_id, "OUTPUT_RECEIVED", { allocationId: allocation.id, orderId: order.id, quantity: take, sourceType: "manufacturing_goods_receipt", sourceId: receiptId,
      summary: `${order.mo_number}: ${q(take)} received` });
    await syncDemands(client, c, { orderId: (await loadDemand(client, c, allocation.demand_id)).sales_order_id });
    const current = await evaluateDemand(client, c, await loadDemand(client, c, allocation.demand_id));
    if (current.order.lifecycle_status !== "confirmed") continue;
    const open = max(sub(current.figures.outstanding, current.figures.reserved), ZERO);
    const reserveAmount = min(take, open);
    if (reserveAmount > ZERO) await reserveForLine(client, c, current, reserveAmount, `demand-receipt:${receiptId}:${allocation.id}`);
  }
  return { unassigned: q(left) };
}

// ------------------------------------------------------------------ product policy
// input: { supplyPolicy, leadTimeDays?, minimumBatchQuantity?, quantityIncrement?, materialWarehouseId?, manufacturingWarehouseId? }
export async function setManufacturingItemPolicy(client, c, itemId, input = {}) {
  needDemand(c, DEMAND.plan);
  const id = uuid(itemId, "Product");
  const policy = String(input.supplyPolicy ?? "MAKE_TO_ORDER").toUpperCase();
  if (!["MAKE_TO_ORDER", "MAKE_TO_STOCK"].includes(policy)) throw demandError(400, "MFG_DEMAND_ITEM_NOT_MANUFACTURABLE", "Choose make to order or make to stock.");
  const number = (value, label) => {
    if (value === undefined || value === null || value === "") return null;
    if (!(Number(value) > 0)) throw demandError(400, "MFG_DEMAND_QTY_EXCEEDS", `${label} must be more than zero.`);
    return String(value);
  };
  const lead = input.leadTimeDays === undefined || input.leadTimeDays === null || input.leadTimeDays === "" ? null : Number(input.leadTimeDays);
  if (lead !== null && !(Number.isInteger(lead) && lead >= 0 && lead <= 365)) throw demandError(400, "MFG_DEMAND_QTY_EXCEEDS", "Lead time is 0 to 365 days.");
  const item = (await client.query(`SELECT id, item_type, track_inventory FROM tenant.items WHERE organization_id = $1 AND id = $2`, [c.organizationId, id])).rows[0];
  if (!item || item.item_type !== "product" || !item.track_inventory) throw demandError(400, "MFG_DEMAND_ITEM_NOT_MANUFACTURABLE");
  await client.query(
    `INSERT INTO tenant.manufacturing_item_policies (organization_id, item_id, supply_policy, lead_time_days, minimum_batch_quantity, quantity_increment, default_material_warehouse_id,
       default_manufacturing_warehouse_id, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (organization_id, item_id) DO UPDATE SET supply_policy = $3, lead_time_days = $4, minimum_batch_quantity = $5, quantity_increment = $6, default_material_warehouse_id = $7,
       default_manufacturing_warehouse_id = $8, updated_by = $9, updated_at = now()`,
    [c.organizationId, id, policy, lead, number(input.minimumBatchQuantity, "Minimum batch"), number(input.quantityIncrement, "Increment"),
      input.materialWarehouseId ? uuid(input.materialWarehouseId, "Warehouse") : null, input.manufacturingWarehouseId ? uuid(input.manufacturingWarehouseId, "Warehouse") : null, c.userId ?? null]);
  return { itemId: id, supplyPolicy: policy, leadTimeDays: lead };
}

// ------------------------------------------------------------------ reports
// kind: traceability | delivery-risk | excess-production | cancelled-with-orders | exceptions | by-customer
export async function getDemandReport(client, c, kind = "traceability") {
  needDemand(c, DEMAND.view);
  if (kind === "excess-production") {
    const rows = (await client.query(
      `SELECT mo.id, mo.mo_number, mo.status, item.code, mo.received_quantity, mo.accepted_quantity,
              COALESCE((SELECT sum(allocation.allocated_quantity) FROM tenant.manufacturing_demand_allocations allocation WHERE allocation.manufacturing_order_id = mo.id AND allocation.status <> 'RELEASED'), 0) AS assigned
         FROM tenant.manufacturing_orders mo JOIN tenant.items item ON item.id = mo.finished_item_id
        WHERE mo.organization_id = $1 AND mo.source_demand_type = 'SALES_ORDER' AND mo.status NOT IN ('CANCELLED')`, [c.organizationId])).rows;
    return rows.map((row) => ({ orderId: row.id, orderNumber: row.mo_number, status: row.status, item: row.code, accepted: q(D(row.accepted_quantity)), assigned: q(D(row.assigned)),
      excess: q(max(sub(D(row.accepted_quantity), D(row.assigned)), ZERO)) })).filter((row) => D(row.excess) > ZERO);
  }
  const { demands } = await listSalesDemand(client, c, { status: "all" });
  if (kind === "delivery-risk") return demands.filter((row) => row.warnings.some((warning) => /required date|cannot finish/.test(warning)) && !["FULFILLED", "CANCELLED"].includes(row.status));
  if (kind === "cancelled-with-orders") return demands.filter((row) => row.status === "CANCELLED" && row.allocations.some((allocation) => allocation.status !== "RELEASED"));
  if (kind === "exceptions") return demands.filter((row) => row.exception);
  if (kind === "by-customer") {
    const groups = new Map();
    for (const row of demands) {
      const entry = groups.get(row.salesOrder.customer) ?? { customer: row.salesOrder.customer, lines: 0, outstanding: ZERO, uncovered: ZERO, inProduction: ZERO };
      groups.set(row.salesOrder.customer, { ...entry, lines: entry.lines + 1, outstanding: add(entry.outstanding, D(row.quantities.outstanding)), uncovered: add(entry.uncovered, D(row.quantities.uncovered)),
        inProduction: add(entry.inProduction, D(row.quantities.inProduction)) });
    }
    return [...groups.values()].map((row) => ({ ...row, outstanding: q(row.outstanding), uncovered: q(row.uncovered), inProduction: q(row.inProduction) }));
  }
  return demands.flatMap((row) => row.allocations.map((allocation) => ({ demandId: row.id, salesOrder: row.salesOrder.number, customer: row.salesOrder.customer, item: row.item.code,
    orderId: allocation.orderId, orderNumber: allocation.orderNumber, orderStatus: allocation.orderStatus, status: allocation.status, allocated: allocation.allocated, received: allocation.received,
    reserved: allocation.reserved, fulfilled: allocation.fulfilled })));
}

// ------------------------------------------------------------------ what Sales shows
// Production status of a Sales Order's manufactured lines, for anyone who may see the order — no cost.
export async function getSalesManufacturingProgress(client, c, salesOrderId) {
  const id = uuid(salesOrderId, "Sales order");
  if (!orderCan(c, "sales.order.view") && !orderCan(c, "sales.order.view_all") && !has(c, DEMAND.view)) throw demandError(403, "MFG_DEMAND_PERMISSION_DENIED");
  if (!has(c, DEMAND.view)) await assertOrderVisible(client, c, id);
  await syncDemands(client, c, { orderId: id });
  const rows = (await client.query(`SELECT * FROM tenant.manufacturing_sales_demands WHERE organization_id = $1 AND sales_order_id = $2 ORDER BY line_sequence, created_at`, [c.organizationId, id])).rows;
  const lines = [];
  for (const row of rows) {
    const current = view(await evaluateDemand(client, c, row), c);
    lines.push({ demandId: current.id, status: current.status, statusLabel: current.statusLabel, item: current.item, requiredDate: current.requiredDate,
      ordered: current.quantities.ordered, delivered: current.quantities.delivered, reservedStock: current.quantities.reservedStock, inProduction: current.quantities.inProduction,
      planned: current.quantities.proposed, uncovered: current.quantities.uncovered, readyToAllocate: current.quantities.readyToAllocate, warnings: current.warnings.filter((warning) => !/BOM/.test(warning)),
      orders: current.allocations.filter((allocation) => allocation.status !== "RELEASED").map((allocation) => ({ id: allocation.orderId, number: allocation.orderNumber, status: allocation.orderStatus,
        assigned: allocation.allocated, received: allocation.received, plannedEndAt: allocation.plannedEndAt })) });
  }
  return { salesOrderId: id, lines, canPlan: has(c, DEMAND.view) };
}

export { STATUS_LABEL };
