import { randomUUID } from "node:crypto";

import { nextDocumentNumber } from "../../core/platform/numbering/index.js";
import { beginIdempotentOperation, completeIdempotentOperation } from "../../core/idempotency.js";
import { createStockBatch, postStockMovement, receiveSerializedStock, releaseStockReservation, reserveStock } from "../stock/index.js";
import { MfgError, dateOrNull, has, need, positive, recordEvent, text, uuid } from "./common.js";
import { resolveBomForItem } from "./engineering.js";

// Production orders (F155-F156, F162-F167, F172-F173, F176-F179).
//
//   planned -> released (materials reserved) -> in_progress -> completed | cancelled
//
// Materials leave stock when ISSUED (manually, or backflushed when production is reported) and
// accrue to the order as work-in-progress cost; finished goods enter stock
// at the cost absorbed from WIP. Stock effects go through Stock's own functions -- one ledger
// movement per allocation, idempotent -- so the order, the ledger and the balances cannot disagree.
const round = (n) => Math.round(n * 1e6) / 1e6;
const REFERENCE = "manufacturing_work_order";
const asStock = (c) => ({ ...c, permissions: [...new Set([...(c.permissions || []), "stock.view", "stock.receive", "stock.issue", "stock.reserve", "stock.manage"])] });
const seeCost = (c) => has(c, "manufacturing.costing.view");

async function loadOrder(client, c, id, { lock = false } = {}) {
  const { rows } = await client.query(`SELECT * FROM tenant.manufacturing_work_orders WHERE organization_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`, [c.organizationId, uuid(id, "Work order")]);
  if (!rows[0]) throw new MfgError(404, "Work order was not found.", "MFG_WORK_ORDER_NOT_FOUND");
  return rows[0];
}
const requireStatus = (wo, ...allowed) => {
  if (!allowed.includes(wo.status)) throw new MfgError(409, `This work order is ${wo.status}; that action needs it to be ${allowed.join(" or ")}.`, "MFG_WORK_ORDER_STATE_INVALID");
};

async function settingsOf(client, c) {
  const { rows } = await client.query(`SELECT * FROM tenant.manufacturing_settings WHERE organization_id=$1`, [c.organizationId]);
  return { default_wip_warehouse_id: null, default_finished_goods_warehouse_id: null, default_scrap_warehouse_id: null, backflush_materials: false, require_operation_completion: true, allow_overproduction: false, ...(rows[0] || {}), configured: Boolean(rows[0]) };
}

export async function getManufacturingSettings(client, c) {
  need(c, "manufacturing.view");
  return settingsOf(client, c);
}
export async function updateManufacturingSettings(client, c, input = {}) {
  need(c, "manufacturing.settings.manage");
  const current = await settingsOf(client, c);
  const pickWarehouse = async (value, fallback) => {
    if (value === undefined) return fallback;
    if (!value) return null;
    const wh = (await client.query(`SELECT id FROM tenant.warehouses WHERE organization_id=$1 AND id=$2 AND status='active'`, [c.organizationId, uuid(value, "Warehouse")])).rows[0];
    if (!wh) throw new MfgError(404, "Warehouse was not found.", "MFG_WAREHOUSE_NOT_FOUND");
    return wh.id;
  };
  const wip = await pickWarehouse(input.defaultWipWarehouseId, current.default_wip_warehouse_id);
  const fg = await pickWarehouse(input.defaultFinishedGoodsWarehouseId, current.default_finished_goods_warehouse_id);
  const scrap = await pickWarehouse(input.defaultScrapWarehouseId, current.default_scrap_warehouse_id);
  const bool = (v, fallback) => (v === undefined ? fallback : v === true || v === "true");
  const { rows } = await client.query(
    `INSERT INTO tenant.manufacturing_settings(organization_id,default_wip_warehouse_id,default_finished_goods_warehouse_id,default_scrap_warehouse_id,backflush_materials,require_operation_completion,allow_overproduction)
     VALUES($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (organization_id) DO UPDATE SET default_wip_warehouse_id=EXCLUDED.default_wip_warehouse_id,default_finished_goods_warehouse_id=EXCLUDED.default_finished_goods_warehouse_id,default_scrap_warehouse_id=EXCLUDED.default_scrap_warehouse_id,
       backflush_materials=EXCLUDED.backflush_materials,require_operation_completion=EXCLUDED.require_operation_completion,allow_overproduction=EXCLUDED.allow_overproduction,updated_at=now() RETURNING *`,
    [c.organizationId, wip, fg, scrap, bool(input.backflushMaterials, current.backflush_materials), bool(input.requireOperationCompletion, current.require_operation_completion), bool(input.allowOverproduction, current.allow_overproduction)],
  );
  return { ...rows[0], configured: true };
}

// ---------------------------------------------------------------- stock helpers
// Stock is held per (location, batch). A request that names neither draws from whichever balances
// hold it, largest first, so a component sitting in a bin can still be issued.
async function availableBalances(client, c, itemId, warehouseId) {
  return (
    await client.query(
      `SELECT warehouse_location_id,batch_id,quantity,reserved_quantity FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3 AND quantity>reserved_quantity ORDER BY (quantity-reserved_quantity) DESC,warehouse_location_id NULLS FIRST`,
      [c.organizationId, itemId, warehouseId],
    )
  ).rows;
}
async function assertNotSerial(client, c, itemId) {
  const item = (await client.query(`SELECT code,tracking_type FROM tenant.items WHERE organization_id=$1 AND id=$2`, [c.organizationId, itemId])).rows[0];
  if (item?.tracking_type === "serial") throw new MfgError(409, `${item.code} is serial-tracked; serial components are not supported on a bill of materials yet.`, "MFG_SERIAL_COMPONENT_UNSUPPORTED");
}

async function issueFromWarehouse(client, c, { itemId, warehouseId, quantity, workOrderId, reason, key }) {
  await assertNotSerial(client, c, itemId);
  let left = quantity;
  let cost = 0;
  const movements = [];
  const balances = await availableBalances(client, c, itemId, warehouseId);
  for (const [index, balance] of balances.entries()) {
    if (left <= 1e-9) break;
    const take = Math.min(left, Number(balance.quantity) - Number(balance.reserved_quantity));
    const movement = await postStockMovement(client, asStock(c), { movementType: "issue", itemId, warehouseId, warehouseLocationId: balance.warehouse_location_id, batchId: balance.batch_id, quantity: round(take), referenceType: REFERENCE, referenceId: workOrderId, reason, idempotencyKey: key ? `${key}:${index}` : undefined });
    cost += Number(movement.unit_cost) * take;
    movements.push(movement);
    left = round(left - take);
  }
  if (left > 1e-9) throw new MfgError(409, "Insufficient component stock in the material warehouse.", "MFG_INSUFFICIENT_STOCK");
  return { cost: round(cost), movements };
}

// Reservations for one material: drop what the order holds and hold what is still needed.
async function syncReservation(client, c, wo, material, { allowShortage = true } = {}) {
  const held = (await client.query(`SELECT id FROM tenant.stock_reservations WHERE organization_id=$1 AND reference_type=$2 AND reference_id=$3 AND item_id=$4 AND warehouse_id=$5 AND status='active'`, [c.organizationId, REFERENCE, wo.id, material.item_id, material.warehouse_id])).rows;
  for (const r of held) await releaseStockReservation(client, asStock(c), r.id, { status: "released" });
  const netIssued = Number(material.issued_quantity) - Number(material.returned_quantity);
  let remaining = round(Math.max(Number(material.required_quantity) - netIssued, 0));
  let reserved = 0;
  if (remaining <= 0) return { reserved: 0, short: 0 };
  const item = (await client.query(`SELECT tracking_type FROM tenant.items WHERE id=$1`, [material.item_id])).rows[0];
  if (item?.tracking_type === "serial") return { reserved: 0, short: remaining };
  for (const balance of await availableBalances(client, c, material.item_id, material.warehouse_id)) {
    if (remaining <= 1e-9) break;
    const take = round(Math.min(remaining, Number(balance.quantity) - Number(balance.reserved_quantity)));
    if (take <= 0) continue;
    await reserveStock(client, asStock(c), { itemId: material.item_id, warehouseId: material.warehouse_id, warehouseLocationId: balance.warehouse_location_id, batchId: balance.batch_id, quantity: take, referenceType: REFERENCE, referenceId: wo.id, idempotencyKey: `mfg-res:${material.id}:${randomUUID()}` });
    reserved = round(reserved + take);
    remaining = round(remaining - take);
  }
  if (remaining > 1e-9 && !allowShortage) throw new MfgError(409, "Insufficient component stock to reserve.", "MFG_MATERIAL_SHORTAGE");
  return { reserved, short: Math.max(remaining, 0) };
}
async function releaseAllReservations(client, c, wo) {
  const held = (await client.query(`SELECT id FROM tenant.stock_reservations WHERE organization_id=$1 AND reference_type=$2 AND reference_id=$3 AND status='active'`, [c.organizationId, REFERENCE, wo.id])).rows;
  for (const r of held) await releaseStockReservation(client, asStock(c), r.id, { status: "released" });
}

async function addPosting(client, c, wo, { type, itemId, warehouseId, quantity, unitCost, movementId, key, batchId = null, locationId = null, serialId = null }) {
  await client.query(
    `INSERT INTO tenant.manufacturing_production_postings(organization_id,work_order_id,posting_number,posting_type,item_id,warehouse_id,warehouse_location_id,batch_id,serial_id,quantity,unit_cost,stock_movement_id,idempotency_key,posted_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [c.organizationId, wo.id, `MFG-${type.toUpperCase().slice(0, 4)}-${randomUUID().slice(0, 8)}`, type, itemId, warehouseId, locationId, batchId, serialId, quantity, unitCost, movementId ?? null, key ?? `${wo.id}:${type}:${randomUUID()}`, c.userId],
  );
}

async function beginIdem(client, c, operation, key, payload) {
  const k = text(key, 200) || null;
  if (!k) return { idempotency: null, replay: null };
  const idempotency = await beginIdempotentOperation(client, c, { operation, key: k, payload });
  return idempotency.replayed ? { idempotency, replay: { ...idempotency.response, replayed: true } } : { idempotency, replay: null };
}
async function finishIdem(client, c, idempotency, response, aggregateId) {
  if (!idempotency) return;
  await completeIdempotentOperation(client, c, idempotency, { response, aggregateType: REFERENCE, aggregateId });
}

// ---------------------------------------------------------------- production orders (F155, F156, F178, F179)
export async function createProductionOrder(client, c, input = {}) {
  need(c, "manufacturing.work_order.manage");
  const quantity = positive(input.quantity, "Quantity");
  const start = input.plannedStartAt ? new Date(input.plannedStartAt) : null;
  if (start && Number.isNaN(start.getTime())) throw new MfgError(400, "Planned start is not a valid date.", "MFG_DATE_INVALID");
  const end = input.plannedEndAt ? new Date(input.plannedEndAt) : null;
  if (end && Number.isNaN(end.getTime())) throw new MfgError(400, "Planned end is not a valid date.", "MFG_DATE_INVALID");
  if (start && end && end < start) throw new MfgError(400, "Planned end cannot be before planned start.", "MFG_DATE_INVALID");
  const day = start ? start.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const bom = input.bomId
    ? (await client.query(`SELECT * FROM tenant.manufacturing_boms WHERE organization_id=$1 AND id=$2`, [c.organizationId, uuid(input.bomId, "BOM")])).rows[0]
    : await resolveBomForItem(client, c, uuid(input.itemId, "Product"), day);
  if (!bom) throw new MfgError(404, "No active BOM applies to that product on the planned start date.", "MFG_NO_ACTIVE_BOM");
  if (bom.status !== "active") throw new MfgError(409, "Only an active (approved) BOM can be produced from.", "MFG_ACTIVE_BOM_REQUIRED");
  const settings = await settingsOf(client, c);
  const wipId = input.wipWarehouseId || settings.default_wip_warehouse_id;
  const fgId = input.finishedGoodsWarehouseId || settings.default_finished_goods_warehouse_id;
  if (!wipId || !fgId) throw new MfgError(400, "Choose the WIP and finished-goods warehouses (or set defaults in Manufacturing settings).", "MFG_WAREHOUSE_REQUIRED");
  for (const id of [wipId, fgId, input.materialWarehouseId].filter(Boolean)) {
    const wh = (await client.query(`SELECT 1 FROM tenant.warehouses WHERE organization_id=$1 AND id=$2 AND status='active'`, [c.organizationId, uuid(id, "Warehouse")])).rows[0];
    if (!wh) throw new MfgError(404, "Warehouse was not found.", "MFG_WAREHOUSE_NOT_FOUND");
  }
  const materialWh = input.materialWarehouseId || wipId;
  const sourceType = input.sourceType === "make_to_order" ? "make_to_order" : "make_to_stock";
  let sourceId = null;
  let sourceLabel = text(input.sourceLabel, 200) || null;
  if (sourceType === "make_to_order") {
    sourceId = uuid(input.sourceId, "Sales order");
    const order = (await client.query(`SELECT sales_order_number,lifecycle_status FROM tenant.sales_orders WHERE organization_id=$1 AND id=$2`, [c.organizationId, sourceId])).rows[0];
    if (!order) throw new MfgError(404, "Sales order was not found.", "MFG_SALES_ORDER_NOT_FOUND");
    if (["cancelled", "closed", "draft"].includes(order.lifecycle_status)) throw new MfgError(409, `A ${order.lifecycle_status} sales order cannot drive production.`, "MFG_SALES_ORDER_STATE_INVALID");
    sourceLabel = sourceLabel || order.sales_order_number;
  }
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const replay = (await client.query(`SELECT * FROM tenant.manufacturing_work_orders WHERE organization_id=$1 AND content_hash=$2`, [c.organizationId, `idem:${key}`])).rows[0];
    if (replay) return { ...replay, replayed: true };
  }
  const number = await nextDocumentNumber(client, c, { documentType: "manufacturing_work_order", prefix: "WO" });
  const priority = ["low", "normal", "high", "urgent"].includes(input.priority) ? input.priority : "normal";
  const wo = (
    await client.query(
      `INSERT INTO tenant.manufacturing_work_orders(organization_id,work_order_number,item_id,bom_id,quantity_planned,status,source_type,source_id,source_label,priority,planned_start_at,planned_end_at,wip_warehouse_id,finished_goods_warehouse_id,content_hash,created_by,notes)
       VALUES($1,$2,$3,$4,$5,'planned',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [c.organizationId, number, bom.item_id, bom.id, quantity, sourceType, sourceId, sourceLabel, priority, start, end, wipId, fgId, key ? `idem:${key}` : `snap:${bom.id}:${bom.version}:${quantity}`, c.userId, text(input.notes, 2000) || null],
    )
  ).rows[0];
  await client.query(
    `INSERT INTO tenant.manufacturing_work_order_materials(organization_id,work_order_id,bom_component_id,item_id,warehouse_id,required_quantity,issue_method)
     SELECT component.organization_id,$1,component.id,component.item_id,COALESCE(component.warehouse_id,$2::uuid),
            round((component.quantity*($3::numeric/bom.output_quantity)/(1-component.scrap_percent/100))::numeric,6),component.issue_method
       FROM tenant.manufacturing_bom_components component JOIN tenant.manufacturing_boms bom ON bom.id=component.bom_id WHERE component.organization_id=$4 AND component.bom_id=$5`,
    [wo.id, materialWh, quantity, c.organizationId, bom.id],
  );
  await recordEvent(client, c, "work_order", wo.id, "manufacturing.work_order.created", { bomId: bom.id, quantity, sourceType });
  return { ...wo, replayed: false };
}

// Release reserves the components. A shortage stops the release unless the planner accepts it.
export async function releaseProductionOrder(client, c, id, { allowShortage = false } = {}) {
  need(c, "manufacturing.work_order.release");
  const wo = await loadOrder(client, c, id, { lock: true });
  requireStatus(wo, "planned");
  const materials = (await client.query(`SELECT material.*,item.code AS item_code FROM tenant.manufacturing_work_order_materials material JOIN tenant.items item ON item.id=material.item_id WHERE material.organization_id=$1 AND material.work_order_id=$2 ORDER BY material.id`, [c.organizationId, wo.id])).rows;
  const shortages = [];
  for (const material of materials) {
    const { short } = await syncReservation(client, c, wo, material, { allowShortage: true });
    if (short > 1e-9) shortages.push({ itemId: material.item_id, itemCode: material.item_code, missingQuantity: String(short) });
  }
  if (shortages.length && !allowShortage) {
    const error = new MfgError(409, `Component shortage: ${shortages.map((s) => `${s.itemCode} (short ${s.missingQuantity})`).join(", ")}. Receive stock or release with the shortage accepted.`, "MFG_MATERIAL_SHORTAGE");
    error.details = shortages;
    throw error;
  }
  const { rows } = await client.query(`UPDATE tenant.manufacturing_work_orders SET status='released',released_by=$3,released_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, wo.id, c.userId]);
  await recordEvent(client, c, "work_order", wo.id, "manufacturing.work_order.released", { shortages: shortages.length });
  return { ...rows[0], shortages };
}

export async function cancelProductionOrder(client, c, id, reason) {
  need(c, "manufacturing.work_order.manage");
  const wo = await loadOrder(client, c, id, { lock: true });
  requireStatus(wo, "planned", "released", "on_hold");
  if (!text(reason, 1000)) throw new MfgError(400, "A reason is required to cancel a work order.", "MFG_REASON_REQUIRED");
  const netIssued = Number((await client.query(`SELECT COALESCE(sum(issued_quantity-returned_quantity),0) AS q FROM tenant.manufacturing_work_order_materials WHERE organization_id=$1 AND work_order_id=$2`, [c.organizationId, wo.id])).rows[0].q);
  if (netIssued > 0 || Number(wo.quantity_completed) > 0) throw new MfgError(409, "Material has been issued to this order. Return it (or close the order short) instead of cancelling.", "MFG_WORK_ORDER_HAS_ACTIVITY");
  await releaseAllReservations(client, c, wo);
  const { rows } = await client.query(`UPDATE tenant.manufacturing_work_orders SET status='cancelled',cancel_reason=$3,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, wo.id, text(reason, 1000)]);
  await recordEvent(client, c, "work_order", wo.id, "manufacturing.work_order.cancelled", { reason: text(reason, 1000) });
  return rows[0];
}

// Close a started order short: what was made stands; the rest is abandoned and its holds freed.
export async function closeProductionOrder(client, c, id, reason) {
  need(c, "manufacturing.work_order.manage");
  const wo = await loadOrder(client, c, id, { lock: true });
  requireStatus(wo, "released", "in_progress", "on_hold");
  if (!text(reason, 1000)) throw new MfgError(400, "A reason is required to close a work order short.", "MFG_REASON_REQUIRED");
  await releaseAllReservations(client, c, wo);
  const { rows } = await client.query(`UPDATE tenant.manufacturing_work_orders SET status='completed',close_reason=$3,actual_end_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, wo.id, text(reason, 1000)]);
  await recordEvent(client, c, "work_order", wo.id, "manufacturing.work_order.closed_short", { reason: text(reason, 1000), completed: wo.quantity_completed });
  return rows[0];
}

// ---------------------------------------------------------------- material issue / return (F163, F164)
async function loadMaterial(client, c, woId, materialId) {
  const m = (await client.query(`SELECT * FROM tenant.manufacturing_work_order_materials WHERE organization_id=$1 AND work_order_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, woId, uuid(materialId, "Material line")])).rows[0];
  if (!m) throw new MfgError(404, "Material line was not found on this work order.", "MFG_MATERIAL_NOT_FOUND");
  return m;
}

export async function issueMaterials(client, c, id, input = {}) {
  need(c, "manufacturing.production.post");
  const { idempotency, replay } = await beginIdem(client, c, "manufacturing.material.issue", input.idempotencyKey, { id, lines: input.lines });
  if (replay) return replay;
  const wo = await loadOrder(client, c, id, { lock: true });
  requireStatus(wo, "released", "in_progress");
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (!lines.length) throw new MfgError(400, "Choose at least one material to issue.", "MFG_LINES_REQUIRED");
  const key = text(input.idempotencyKey, 200) || randomUUID();
  let total = 0;
  for (const line of lines) {
    const material = await loadMaterial(client, c, wo.id, line.materialId);
    const quantity = positive(line.quantity, "Issue quantity");
    const netIssued = Number(material.issued_quantity) - Number(material.returned_quantity);
    if (netIssued + quantity > Number(material.required_quantity) + 1e-9) throw new MfgError(409, "You cannot issue more than the order requires. Record extra usage as scrap or waste.", "MFG_OVER_ISSUE");
    await releaseStockReservationsOf(client, c, wo, material);
    const issued = await issueFromWarehouse(client, c, { itemId: material.item_id, warehouseId: material.warehouse_id, quantity, workOrderId: wo.id, reason: `Issue to ${wo.work_order_number}`, key: `${key}:${material.id}` });
    const updated = (await client.query(`UPDATE tenant.manufacturing_work_order_materials SET issued_quantity=issued_quantity+$3,issued_cost=issued_cost+$4 WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, material.id, quantity, issued.cost])).rows[0];
    await addPosting(client, c, wo, { type: "material_issue", itemId: material.item_id, warehouseId: material.warehouse_id, quantity, unitCost: round(issued.cost / quantity), movementId: issued.movements[0]?.id, key: `${key}:issue:${material.id}` });
    await syncReservation(client, c, wo, updated, { allowShortage: true });
    total += issued.cost;
  }
  const { rows } = await client.query(`UPDATE tenant.manufacturing_work_orders SET material_cost=material_cost+$3,status='in_progress',actual_start_at=COALESCE(actual_start_at,now()),updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, wo.id, round(total)]);
  const response = { ...rows[0], issuedCost: String(round(total)), replayed: false };
  await finishIdem(client, c, idempotency, response, wo.id);
  return response;
}
async function releaseStockReservationsOf(client, c, wo, material) {
  const held = (await client.query(`SELECT id FROM tenant.stock_reservations WHERE organization_id=$1 AND reference_type=$2 AND reference_id=$3 AND item_id=$4 AND warehouse_id=$5 AND status='active'`, [c.organizationId, REFERENCE, wo.id, material.item_id, material.warehouse_id])).rows;
  for (const r of held) await releaseStockReservation(client, asStock(c), r.id, { status: "released" });
}

export async function returnMaterials(client, c, id, input = {}) {
  need(c, "manufacturing.production.post");
  const { idempotency, replay } = await beginIdem(client, c, "manufacturing.material.return", input.idempotencyKey, { id, lines: input.lines });
  if (replay) return replay;
  const wo = await loadOrder(client, c, id, { lock: true });
  requireStatus(wo, "released", "in_progress", "on_hold");
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (!lines.length) throw new MfgError(400, "Choose at least one material to return.", "MFG_LINES_REQUIRED");
  const key = text(input.idempotencyKey, 200) || randomUUID();
  let total = 0;
  for (const line of lines) {
    const material = await loadMaterial(client, c, wo.id, line.materialId);
    const quantity = positive(line.quantity, "Return quantity");
    const netIssued = Number(material.issued_quantity) - Number(material.returned_quantity);
    if (quantity > netIssued + 1e-9) throw new MfgError(409, "You cannot return more than has been issued.", "MFG_OVER_RETURN");
    if (!text(line.reason, 500)) throw new MfgError(400, "A return needs a reason.", "MFG_REASON_REQUIRED");
    const unitCost = Number(material.issued_quantity) > 0 ? Number(material.issued_cost) / Number(material.issued_quantity) : 0;
    const movement = await postStockMovement(client, asStock(c), { movementType: "receipt", itemId: material.item_id, warehouseId: material.warehouse_id, quantity, unitCost: round(unitCost), referenceType: REFERENCE, referenceId: wo.id, reason: `Return from ${wo.work_order_number}: ${text(line.reason, 300)}`, idempotencyKey: `${key}:ret:${material.id}` });
    const updated = (await client.query(`UPDATE tenant.manufacturing_work_order_materials SET returned_quantity=returned_quantity+$3,returned_cost=returned_cost+$4 WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, material.id, quantity, round(unitCost * quantity)])).rows[0];
    await addPosting(client, c, wo, { type: "material_return", itemId: material.item_id, warehouseId: material.warehouse_id, quantity, unitCost: round(unitCost), movementId: movement.id, key: `${key}:return:${material.id}` });
    await syncReservation(client, c, wo, updated, { allowShortage: true });
    total += unitCost * quantity;
  }
  const { rows } = await client.query(`UPDATE tenant.manufacturing_work_orders SET material_cost=GREATEST(material_cost-$3,0),updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, wo.id, round(total)]);
  const response = { ...rows[0], returnedCost: String(round(total)), replayed: false };
  await finishIdem(client, c, idempotency, response, wo.id);
  return response;
}

// ---------------------------------------------------------------- production report / finished goods (F165, F167, F174, F176, F177)
export async function reportProduction(client, c, id, input = {}) {
  need(c, "manufacturing.production.post");
  const { idempotency, replay } = await beginIdem(client, c, "manufacturing.production.report", input.idempotencyKey, { id, ...input, idempotencyKey: undefined });
  if (replay) return replay;
  const wo = await loadOrder(client, c, id, { lock: true });
  requireStatus(wo, "released", "in_progress");
  const quantity = positive(input.quantity, "Quantity");
  const settings = await settingsOf(client, c);
  if (!settings.allow_overproduction && Number(wo.quantity_completed) + quantity > Number(wo.quantity_planned) + 1e-9) throw new MfgError(409, "Production quantity exceeds the planned quantity.", "MFG_OVERPRODUCTION_BLOCKED");
  const key = text(input.idempotencyKey, 200) || randomUUID();
  const product = (await client.query(`SELECT id,code,tracking_type FROM tenant.items WHERE organization_id=$1 AND id=$2`, [c.organizationId, wo.item_id])).rows[0];
  let batchId = input.batchId ? uuid(input.batchId, "Batch") : null;
  let serialNumbers = null;
  if (product.tracking_type === "batch") {
    if (!batchId) {
      const number = text(input.batchNumber, 120);
      if (!number) throw new MfgError(400, `${product.code} is batch-tracked: give the batch number produced.`, "MFG_BATCH_REQUIRED");
      const existing = (await client.query(`SELECT id FROM tenant.stock_batches WHERE organization_id=$1 AND item_id=$2 AND lower(batch_number)=lower($3)`, [c.organizationId, product.id, number])).rows[0];
      batchId = existing ? existing.id : (await createStockBatch(client, asStock(c), { itemId: product.id, batchNumber: number, manufacturedOn: dateOrNull(input.manufacturedOn, "Manufactured date") || new Date().toISOString().slice(0, 10), expiresOn: input.expiresOn })).id;
    }
  } else if (product.tracking_type === "serial") {
    serialNumbers = [...new Set((Array.isArray(input.serialNumbers) ? input.serialNumbers : String(input.serialNumbers || "").split(/[\s,;]+/)).map((s) => text(s, 120)).filter(Boolean))];
    if (!Number.isInteger(quantity) || serialNumbers.length !== quantity) throw new MfgError(400, `${product.code} is serial-tracked: give exactly ${quantity} serial number(s).`, "MFG_SERIAL_COUNT_MISMATCH");
  }

  // Materials: backflush what is not yet issued for the quantity being reported; manual materials
  // must already have been issued.
  const materials = (await client.query(`SELECT material.*,item.code AS item_code FROM tenant.manufacturing_work_order_materials material JOIN tenant.items item ON item.id=material.item_id WHERE material.organization_id=$1 AND material.work_order_id=$2 ORDER BY material.id FOR UPDATE OF material`, [c.organizationId, wo.id])).rows;
  const share = Math.min((Number(wo.quantity_completed) + quantity + Number(wo.quantity_scrapped)) / Number(wo.quantity_planned), 1);
  const notIssued = [];
  let backflushCost = 0;
  for (const material of materials) {
    const needed = round(Number(material.required_quantity) * share);
    const netIssued = Number(material.issued_quantity) - Number(material.returned_quantity);
    const gap = round(needed - netIssued);
    if (gap <= 1e-9) continue;
    if (material.issue_method === "backflush" || settings.backflush_materials) {
      await releaseStockReservationsOf(client, c, wo, material);
      const issued = await issueFromWarehouse(client, c, { itemId: material.item_id, warehouseId: material.warehouse_id, quantity: gap, workOrderId: wo.id, reason: `Backflush to ${wo.work_order_number}`, key: `${key}:bf:${material.id}` });
      const updated = (await client.query(`UPDATE tenant.manufacturing_work_order_materials SET issued_quantity=issued_quantity+$3,issued_cost=issued_cost+$4 WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, material.id, gap, issued.cost])).rows[0];
      await addPosting(client, c, wo, { type: "material_issue", itemId: material.item_id, warehouseId: material.warehouse_id, quantity: gap, unitCost: round(issued.cost / gap), movementId: issued.movements[0]?.id, key: `${key}:backflush:${material.id}` });
      await syncReservation(client, c, wo, updated, { allowShortage: true });
      backflushCost += issued.cost;
    } else {
      notIssued.push(`${material.item_code} (${gap} more)`);
    }
  }
  if (notIssued.length) throw new MfgError(409, `Issue these materials before reporting production: ${notIssued.join(", ")}.`, "MFG_MATERIAL_NOT_ISSUED");

  // Cost: what has accrued to the order and not yet been absorbed, allocated to this output.
  const fresh = (await client.query(`SELECT material_cost,labor_cost,overhead_cost,subcontract_cost,cost_absorbed FROM tenant.manufacturing_work_orders WHERE id=$1`, [wo.id])).rows[0];
  const accrued = Number(fresh.material_cost) + backflushCost + Number(fresh.labor_cost) + Number(fresh.overhead_cost) + Number(fresh.subcontract_cost);
  const completing = Number(wo.quantity_completed) + quantity >= Number(wo.quantity_planned) - 1e-9;
  const outstanding = Math.max(accrued - Number(fresh.cost_absorbed), 0);
  const absorb = round(completing ? outstanding : Math.min(outstanding, (accrued / Number(wo.quantity_planned)) * quantity));
  const unitCost = input.unitCost === undefined || input.unitCost === "" ? round(absorb / quantity) : Number(input.unitCost);
  if (!Number.isFinite(unitCost) || unitCost < 0) throw new MfgError(400, "Unit cost must be zero or greater.", "MFG_QUANTITY_INVALID");

  let movementId = null;
  const locationId = input.warehouseLocationId ? uuid(input.warehouseLocationId, "Location") : null;
  if (serialNumbers) {
    const received = await receiveSerializedStock(client, asStock(c), { itemId: wo.item_id, warehouseId: wo.finished_goods_warehouse_id, warehouseLocationId: locationId, serialNumbers, unitCost, referenceType: REFERENCE, referenceId: wo.id, reason: `Production ${wo.work_order_number}`, idempotencyKey: `${key}:fg` });
    movementId = received.movement?.id ?? null;
  } else {
    const movement = await postStockMovement(client, asStock(c), { movementType: "receipt", itemId: wo.item_id, warehouseId: wo.finished_goods_warehouse_id, warehouseLocationId: locationId, batchId, quantity, unitCost, referenceType: REFERENCE, referenceId: wo.id, reason: `Production ${wo.work_order_number}`, idempotencyKey: `${key}:fg` });
    movementId = movement.id;
  }
  await addPosting(client, c, wo, { type: "production_receipt", itemId: wo.item_id, warehouseId: wo.finished_goods_warehouse_id, quantity, unitCost, movementId, key: `${key}:receipt`, batchId, locationId });
  const { rows } = await client.query(
    `UPDATE tenant.manufacturing_work_orders SET quantity_completed=quantity_completed+$3,material_cost=material_cost+$4,cost_absorbed=cost_absorbed+$5,status=CASE WHEN $6 THEN 'completed' ELSE 'in_progress' END,
            actual_start_at=COALESCE(actual_start_at,now()),actual_end_at=CASE WHEN $6 THEN now() ELSE actual_end_at END,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [c.organizationId, wo.id, quantity, round(backflushCost), absorb, completing],
  );
  const updated = rows[0];
  if (completing) {
    await releaseAllReservations(client, c, updated);
    await client.query(
      `INSERT INTO tenant.manufacturing_cost_snapshots(organization_id,work_order_id,material_cost,labor_cost,overhead_cost,scrap_cost,total_cost,cost_per_unit,snapshot_type,subcontract_cost) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'completion',$9)`,
      [c.organizationId, wo.id, updated.material_cost, updated.labor_cost, updated.overhead_cost, updated.scrap_cost, round(Number(updated.material_cost) + Number(updated.labor_cost) + Number(updated.overhead_cost) + Number(updated.subcontract_cost)), round((Number(updated.material_cost) + Number(updated.labor_cost) + Number(updated.overhead_cost) + Number(updated.subcontract_cost)) / Math.max(Number(updated.quantity_completed), 1)), updated.subcontract_cost],
    );
  }
  // Make-to-order: the goods just made are held for the sales order that asked for them.
  let reservedForOrder = 0;
  if (wo.source_type === "make_to_order" && wo.source_id && !serialNumbers) {
    const balance = (await client.query(`SELECT warehouse_location_id,batch_id,greatest(quantity-reserved_quantity,0) AS free FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3 AND warehouse_location_id IS NOT DISTINCT FROM $4 AND batch_id IS NOT DISTINCT FROM $5`, [c.organizationId, wo.item_id, wo.finished_goods_warehouse_id, locationId, batchId])).rows[0];
    if (balance && Number(balance.free) >= quantity) {
      await reserveStock(client, asStock(c), { itemId: wo.item_id, warehouseId: wo.finished_goods_warehouse_id, warehouseLocationId: locationId, batchId, quantity, referenceType: "sales_order", referenceId: wo.source_id, idempotencyKey: `${key}:mto` });
      reservedForOrder = quantity;
    }
  }
  await recordEvent(client, c, "work_order", wo.id, "manufacturing.production.reported", { quantity, unitCost, completing });
  const response = { ...updated, unitCost: String(unitCost), reservedForOrder: String(reservedForOrder), replayed: false };
  await finishIdem(client, c, idempotency, response, wo.id);
  return response;
}

// ---------------------------------------------------------------- scrap and waste (F172, F173)
export const SCRAP_REASONS = ["defect", "damage", "setup", "operator_error", "material_fault", "machine_fault", "expired", "other"];

export async function recordScrap(client, c, id, input = {}) {
  need(c, "manufacturing.scrap.post");
  const wo = await loadOrder(client, c, id, { lock: true });
  requireStatus(wo, "released", "in_progress", "on_hold");
  const scope = input.scope === "component" ? "component" : "product";
  const category = input.category === "waste" ? "waste" : "scrap";
  const quantity = positive(input.quantity, "Quantity");
  if (!SCRAP_REASONS.includes(String(input.reasonCode))) throw new MfgError(400, `Reason must be one of: ${SCRAP_REASONS.join(", ")}.`, "MFG_REASON_CODE_INVALID");
  const operationId = input.operationId ? uuid(input.operationId, "Operation") : null;
  let unitCost = 0;
  let itemId = wo.item_id;
  let movementId = null;
  if (scope === "product") {
    if (Number(wo.quantity_scrapped) + Number(wo.quantity_completed) + quantity > Number(wo.quantity_planned) + 1e-9) throw new MfgError(409, "Scrapped plus completed quantity cannot exceed the planned quantity.", "MFG_SCRAP_EXCEEDS_PLAN");
    const accrued = Number(wo.material_cost) + Number(wo.labor_cost) + Number(wo.overhead_cost) + Number(wo.subcontract_cost);
    unitCost = round(accrued / Number(wo.quantity_planned));
    await client.query(`UPDATE tenant.manufacturing_work_orders SET quantity_scrapped=quantity_scrapped+$3,scrap_cost=scrap_cost+$4,updated_at=now() WHERE organization_id=$1 AND id=$2`, [c.organizationId, wo.id, quantity, round(unitCost * quantity)]);
  } else {
    itemId = uuid(input.itemId, "Component");
    const material = (await client.query(`SELECT * FROM tenant.manufacturing_work_order_materials WHERE organization_id=$1 AND work_order_id=$2 AND item_id=$3 FOR UPDATE`, [c.organizationId, wo.id, itemId])).rows[0];
    if (!material) throw new MfgError(404, "That item is not a component of this work order.", "MFG_MATERIAL_NOT_FOUND");
    await releaseStockReservationsOf(client, c, wo, material);
    const issued = await issueFromWarehouse(client, c, { itemId, warehouseId: material.warehouse_id, quantity, workOrderId: wo.id, reason: `${category === "waste" ? "Waste" : "Scrap"} on ${wo.work_order_number} (${input.reasonCode})`, key: `scrap:${wo.id}:${randomUUID()}` });
    unitCost = round(issued.cost / quantity);
    movementId = issued.movements[0]?.id ?? null;
    await client.query(`UPDATE tenant.manufacturing_work_orders SET material_cost=material_cost+$3,scrap_cost=scrap_cost+$3,updated_at=now() WHERE organization_id=$1 AND id=$2`, [c.organizationId, wo.id, issued.cost]);
    await addPosting(client, c, wo, { type: "scrap", itemId, warehouseId: material.warehouse_id, quantity, unitCost, movementId });
    await syncReservation(client, c, wo, material, { allowShortage: true });
  }
  const { rows } = await client.query(
    `INSERT INTO tenant.manufacturing_scrap_records(organization_id,work_order_id,operation_id,item_id,category,scope,quantity,unit_cost,reason_code,note,stock_movement_id,posted_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [c.organizationId, wo.id, operationId, itemId, category, scope, quantity, unitCost, input.reasonCode, text(input.note, 1000) || null, movementId, c.userId],
  );
  await recordEvent(client, c, "work_order", wo.id, "manufacturing.scrap.recorded", { scope, category, quantity });
  return rows[0];
}

// ---------------------------------------------------------------- reads (F155, F156, F166)
export async function listProductionOrders(client, c, { status = null, sourceType = null, limit = 250 } = {}) {
  need(c, "manufacturing.view");
  const values = [c.organizationId];
  let filter = "";
  if (status) { values.push(String(status)); filter += ` AND wo.status=$${values.length}`; }
  if (sourceType) { values.push(String(sourceType)); filter += ` AND wo.source_type=$${values.length}`; }
  values.push(Math.min(Math.max(Number(limit) || 250, 1), 500));
  const { rows } = await client.query(
    `SELECT wo.id,wo.work_order_number,wo.status,wo.priority,wo.source_type,wo.source_label,wo.rework_of_id,wo.quantity_planned::text AS quantity_planned,wo.quantity_completed::text AS quantity_completed,wo.quantity_scrapped::text AS quantity_scrapped,
            wo.planned_start_at,wo.planned_end_at,wo.actual_start_at,wo.actual_end_at,item.code AS item_code,item.name AS item_name,
            (SELECT count(*)::int FROM tenant.manufacturing_work_order_operations o WHERE o.work_order_id=wo.id) AS operation_count,
            (SELECT count(*)::int FROM tenant.manufacturing_work_order_operations o WHERE o.work_order_id=wo.id AND o.status IN ('completed','skipped')) AS operations_done
       FROM tenant.manufacturing_work_orders wo JOIN tenant.items item ON item.id=wo.item_id WHERE wo.organization_id=$1${filter} ORDER BY wo.created_at DESC LIMIT $${values.length}`,
    values,
  );
  return rows;
}

export async function getProductionOrder(client, c, id) {
  need(c, "manufacturing.view");
  const wo = await loadOrder(client, c, id);
  const cost = seeCost(c);
  const item = (await client.query(`SELECT code,name,tracking_type FROM tenant.items WHERE id=$1`, [wo.item_id])).rows[0];
  const bom = (await client.query(`SELECT code,version FROM tenant.manufacturing_boms WHERE id=$1`, [wo.bom_id])).rows[0];
  const materials = (
    await client.query(
      `SELECT material.id,material.item_id,item.code AS item_code,item.name AS item_name,material.warehouse_id,warehouse.name AS warehouse_name,material.issue_method,material.required_quantity::text AS required_quantity,material.issued_quantity::text AS issued_quantity,material.returned_quantity::text AS returned_quantity,
              material.issued_cost::text AS issued_cost,
              COALESCE((SELECT sum(r.active_quantity) FROM tenant.stock_reservations r WHERE r.organization_id=material.organization_id AND r.reference_type='manufacturing_work_order' AND r.reference_id=material.work_order_id AND r.item_id=material.item_id AND r.warehouse_id=material.warehouse_id AND r.status='active'),0)::text AS reserved_quantity,
              COALESCE((SELECT sum(b.quantity-b.reserved_quantity) FROM tenant.stock_balances b WHERE b.organization_id=material.organization_id AND b.item_id=material.item_id AND b.warehouse_id=material.warehouse_id),0)::text AS available_quantity
         FROM tenant.manufacturing_work_order_materials material JOIN tenant.items item ON item.id=material.item_id JOIN tenant.warehouses warehouse ON warehouse.id=material.warehouse_id WHERE material.organization_id=$1 AND material.work_order_id=$2 ORDER BY item.name`,
      [c.organizationId, wo.id],
    )
  ).rows;
  const postings = (await client.query(`SELECT p.posting_type,p.quantity::text AS quantity,p.unit_cost::text AS unit_cost,p.posted_at,item.code AS item_code FROM tenant.manufacturing_production_postings p JOIN tenant.items item ON item.id=p.item_id WHERE p.organization_id=$1 AND p.work_order_id=$2 ORDER BY p.posted_at DESC LIMIT 200`, [c.organizationId, wo.id])).rows;
  const scrap = (await client.query(`SELECT s.id,s.category,s.scope,s.quantity::text AS quantity,s.reason_code,s.note,s.created_at,item.code AS item_code FROM tenant.manufacturing_scrap_records s JOIN tenant.items item ON item.id=s.item_id WHERE s.organization_id=$1 AND s.work_order_id=$2 ORDER BY s.created_at DESC`, [c.organizationId, wo.id])).rows;
  const inspections = (await client.query(`SELECT i.id,i.operation_id,i.result,i.quantity_inspected::text AS quantity_inspected,i.quantity_rejected::text AS quantity_rejected,i.defect_code,i.created_at FROM tenant.manufacturing_inspections i WHERE i.organization_id=$1 AND i.work_order_id=$2 ORDER BY i.created_at DESC`, [c.organizationId, wo.id])).rows;
  const wip = Number(wo.material_cost) + Number(wo.labor_cost) + Number(wo.overhead_cost) + Number(wo.subcontract_cost) - Number(wo.cost_absorbed);
  return {
    ...wo,
    item_code: item.code,
    item_name: item.name,
    tracking_type: item.tracking_type,
    bom_code: bom?.code,
    bom_version: bom?.version,
    materials: cost ? materials : materials.map((m) => ({ ...m, issued_cost: null })),
    postings: cost ? postings : postings.map((p) => ({ ...p, unit_cost: null })),
    scrap,
    inspections,
    hold_reason: wo.hold_reason,
    costs: cost ? { material: wo.material_cost, labor: wo.labor_cost, overhead: wo.overhead_cost, subcontract: wo.subcontract_cost, scrap: wo.scrap_cost, absorbed: wo.cost_absorbed, wip: String(round(Math.max(wip, 0))) } : null,
  };
}

export async function listMaterialReservations(client, c) {
  need(c, "manufacturing.view");
  const { rows } = await client.query(
    `SELECT material.id,wo.id AS work_order_id,wo.work_order_number,wo.status AS work_order_status,item.code AS item_code,item.name AS item_name,warehouse.name AS warehouse_name,material.required_quantity::text AS required_quantity,(material.issued_quantity-material.returned_quantity)::text AS issued_quantity,
            COALESCE((SELECT sum(r.active_quantity) FROM tenant.stock_reservations r WHERE r.organization_id=material.organization_id AND r.reference_type='manufacturing_work_order' AND r.reference_id=wo.id AND r.item_id=material.item_id AND r.warehouse_id=material.warehouse_id AND r.status='active'),0)::text AS reserved_quantity,
            COALESCE((SELECT sum(b.quantity-b.reserved_quantity) FROM tenant.stock_balances b WHERE b.organization_id=material.organization_id AND b.item_id=material.item_id AND b.warehouse_id=material.warehouse_id),0)::text AS free_quantity
       FROM tenant.manufacturing_work_order_materials material JOIN tenant.manufacturing_work_orders wo ON wo.id=material.work_order_id JOIN tenant.items item ON item.id=material.item_id JOIN tenant.warehouses warehouse ON warehouse.id=material.warehouse_id
      WHERE material.organization_id=$1 AND wo.status IN ('planned','released','in_progress','on_hold') ORDER BY wo.work_order_number,item.name`,
    [c.organizationId],
  );
  return rows.map((r) => {
    const need = Math.max(Number(r.required_quantity) - Number(r.issued_quantity), 0);
    return { ...r, outstanding_quantity: String(round(need)), shortage_quantity: String(round(Math.max(need - Number(r.reserved_quantity), 0))) };
  });
}

// Ledger of what moved through production orders: issues, returns, scrap, finished-goods and
// by-product receipts (F164, F167, F174).
export async function listProductionPostings(client, c, { types = null, limit = 250 } = {}) {
  need(c, "manufacturing.view");
  const values = [c.organizationId];
  let filter = "";
  if (types) { values.push(String(types).split(",").map((t) => t.trim()).filter(Boolean)); filter = ` AND p.posting_type=ANY($${values.length}::text[])`; }
  values.push(Math.min(Math.max(Number(limit) || 250, 1), 500));
  const { rows } = await client.query(
    `SELECT p.id,p.posting_type,p.quantity::text AS quantity,p.unit_cost::text AS unit_cost,p.posted_at,p.batch_id,wo.work_order_number,item.code AS item_code,item.name AS item_name,warehouse.name AS warehouse_name
       FROM tenant.manufacturing_production_postings p JOIN tenant.manufacturing_work_orders wo ON wo.id=p.work_order_id JOIN tenant.items item ON item.id=p.item_id JOIN tenant.warehouses warehouse ON warehouse.id=p.warehouse_id
      WHERE p.organization_id=$1${filter} ORDER BY p.posted_at DESC LIMIT $${values.length}`,
    values,
  );
  return seeCost(c) ? rows : rows.map((r) => ({ ...r, unit_cost: null }));
}

export async function listScrapRecords(client, c) {
  need(c, "manufacturing.view");
  const { rows } = await client.query(
    `SELECT s.id,s.category,s.scope,s.quantity::text AS quantity,s.unit_cost::text AS unit_cost,s.reason_code,s.note,s.created_at,wo.work_order_number,item.code AS item_code,item.name AS item_name
       FROM tenant.manufacturing_scrap_records s JOIN tenant.manufacturing_work_orders wo ON wo.id=s.work_order_id JOIN tenant.items item ON item.id=s.item_id WHERE s.organization_id=$1 ORDER BY s.created_at DESC LIMIT 300`,
    [c.organizationId],
  );
  return seeCost(c) ? rows : rows.map((r) => ({ ...r, unit_cost: null }));
}
