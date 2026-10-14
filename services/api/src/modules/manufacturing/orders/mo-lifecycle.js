// Manufacturing Orders — the lifecycle: create and edit a draft (its materials planned from the BOM revision effective on the planned start),
// validate, submit, approve or send back, release (the recipe frozen into a BOM snapshot, the materials fixed from it), hold and resume,
// cancel. Drafts reserve and move nothing.
import { normalizeQuantityToBase } from "../../products/uom.js";
import { effectiveWindowAt, estimateCost, explodeRevision, loadItem, resolveEffectiveBom } from "../boms/bom-engine.js";
import { snapshotBomForProduction } from "../boms/bom-service.js";
import {
  D, EXECUTING, MO, STATUS_LABEL, ZERO, add, event, has, idempotent, loadMaterials, loadOrder, moError, money, mul, needMo, nextNumber, q, releaseReservations, requireStatus, setStatus,
  settingsOf, sub, text, timestamp, uuid, versionCheck,
} from "./mo-core.js";
import { getManufacturingOrder, materialView } from "./mo-read.js";

const SOURCES = new Set(["MANUAL", "SALES_ORDER", "PLANNING", "PARENT_ORDER"]);
const PRIORITIES = new Set(["LOW", "NORMAL", "HIGH"]);
const HOLD_CATEGORIES = new Set(["MATERIAL_SHORTAGE", "QUALITY_ISSUE", "EQUIPMENT_DOWNTIME", "PRIORITY_CHANGE", "COST_VARIANCE", "QUANTITY_VARIANCE", "OTHER"]);
const bomContext = (c) => ({ ...c, permissions: [...new Set([...(c.permissions ?? []), "manufacturing.bom.view", "manufacturing.bom.mo_use", "manufacturing.bom.cost_view"])] });

// ------------------------------------------------------------------ planning
// The header from input (with the existing draft as the default), checked for shape and meaning.
async function headerOf(client, c, input, existing = null) {
  const pick = (key, column) => (input[key] !== undefined ? input[key] : existing?.[column]);
  const itemId = uuid(pick("finishedItemId", "finished_item_id"), "Product");
  const item = await loadItem(client, c.organizationId, itemId);
  if (!item || item.item_type !== "product" || !item.track_inventory || item.is_variant_template || item.status !== "active" || item.lifecycle_status === "inactive") {
    throw moError(400, "MFG_MO_PRODUCT_INVALID", item ? `${item.code} · ${item.name} cannot be manufactured: it must be an active, stocked product.` : undefined);
  }
  const plannedQuantity = quantity(pick("plannedQuantity", "planned_quantity"));
  const uomId = uuid(pick("uomId", "output_uom_id") ?? item.uom_id, "Unit");
  const base = await normalizeQuantityToBase(client, c.organizationId, item.id, uomId, plannedQuantity, { allowInactive: false });
  if (!base.ok) throw moError(400, "MFG_MO_QUANTITY_INVALID", `Planned quantity: ${base.message}`);
  if (item.tracking_type === "serial" && D(base.baseQuantity) % 1_000_000n !== ZERO) throw moError(400, "MFG_MO_QUANTITY_INVALID", `${item.code} is serial-tracked: plan whole units.`);
  const start = timestamp(pick("plannedStartAt", "planned_start_at"), "Planned start");
  const end = timestamp(pick("plannedEndAt", "planned_end_at"), "Planned completion");
  if (!start || !end) throw moError(400, "MFG_MO_DATES_INVALID", "Enter the planned start and completion.");
  if (new Date(end) < new Date(start)) throw moError(400, "MFG_MO_DATES_INVALID");
  const warehouses = {};
  for (const [key, column, label] of [["manufacturingWarehouseId", "manufacturing_warehouse_id", "Manufacturing location"], ["materialWarehouseId", "material_warehouse_id", "Material issue warehouse"],
    ["finishedGoodsWarehouseId", "finished_goods_warehouse_id", "Finished goods warehouse"]]) {
    const id = pick(key, column);
    if (!id) throw moError(400, "MFG_MO_WAREHOUSE_INVALID", `Choose the ${label.toLowerCase()}.`);
    const row = (await client.query(`SELECT id, code, status FROM tenant.warehouses WHERE organization_id = $1 AND id = $2`, [c.organizationId, uuid(id, label)])).rows[0];
    if (!row || row.status !== "active") throw moError(400, "MFG_MO_WAREHOUSE_INVALID", `${label}: choose an active warehouse.`);
    warehouses[column] = row.id;
  }
  const sourceType = String(pick("sourceDemandType", "source_demand_type") ?? "MANUAL").toUpperCase();
  if (!SOURCES.has(sourceType)) throw moError(400, "MFG_MO_VALIDATION_FAILED", "Choose where the demand comes from: manual, a sales order, planning or a parent order.");
  let sourceId = pick("sourceDemandId", "source_demand_id") ?? null;
  let sourceReference = text(pick("sourceReference", "source_reference"), 200) || null;
  if (sourceType === "SALES_ORDER") {
    const order = sourceId ? (await client.query(`SELECT id, sales_order_number FROM tenant.sales_orders WHERE organization_id = $1 AND id = $2`, [c.organizationId, uuid(sourceId, "Sales order")])).rows[0] : null;
    if (!order) throw moError(400, "MFG_MO_VALIDATION_FAILED", "Choose the sales order this production is for.");
    sourceId = order.id;
    sourceReference = order.sales_order_number;
  } else if (sourceType === "MANUAL") sourceId = null;
  const priority = String(pick("priority", "priority") ?? "NORMAL").toUpperCase();
  if (!PRIORITIES.has(priority)) throw moError(400, "MFG_MO_VALIDATION_FAILED", "Priority is low, normal or high.");
  const owner = pick("productionOwnerId", "production_owner_id");
  // The revision: the one named, if it is the revision effective on the planned start; otherwise the effective one.
  const named = pick("bomRevisionId", "bom_revision_id");
  const effective = await effectiveWindowAt(client, c.organizationId, item.id, start).catch(() => null);
  if (!effective) throw moError(409, "MFG_MO_BOM_NOT_ELIGIBLE", `${item.code} has no approved BOM revision effective on ${start.slice(0, 10)}. Activate or schedule one first.`);
  if (named && named !== effective.revision_id) {
    throw moError(409, "MFG_MO_BOM_NOT_ELIGIBLE", `That BOM revision is not the one effective on ${start.slice(0, 10)}; revision ${effective.revision_number} is. Only the effective revision is used.`);
  }
  return {
    item, finished_item_id: item.id, planned_quantity: plannedQuantity, output_uom_id: uomId, planned_base_quantity: q(D(base.baseQuantity)), bom_id: effective.bom_id, bom_revision_id: effective.revision_id,
    planned_start_at: start, planned_end_at: end, ...warehouses, source_demand_type: sourceType, source_demand_id: sourceId, source_reference: sourceReference, priority,
    notes: text(pick("notes", "notes"), 4000) || null, production_owner_id: owner ? uuid(owner, "Production owner") : null,
  };
}
const quantity = (value) => {
  const raw = String(value ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(raw) || !(Number(raw) > 0)) throw moError(400, "MFG_MO_QUANTITY_INVALID");
  return raw;
};

// The planned materials: the revision exploded for the planned quantity (expected yield, batches, allowances, units), subassemblies consumed
// as stocked items (each made on its own order), with the estimated cost from Inventory valuation.
async function planMaterials(client, c, head) {
  const explosion = await explodeRevision(client, c.organizationId, head.bom_revision_id, { plannedQuantity: head.planned_quantity, uomId: head.output_uom_id, policy: "USE_STOCKED_SUBASSEMBLIES",
    at: head.planned_start_at });
  const cost = await estimateCost(client, bomContext(c), explosion, head.material_warehouse_id);
  const rates = new Map(cost.lines.map((line) => [line.itemId, line.unitCost === null ? null : D(line.unitCost)]));
  const lines = explosion.lines.filter((line) => line.level === 1).map((line, index) => {
    const required = D(line.required);
    const rate = rates.get(line.itemId) ?? null;
    return { lineNumber: index + 1, bomLineId: line.lineId, lineageId: line.lineageId ?? null, itemId: line.itemId, uomId: line.baseUomId, kind: line.kind === "subassembly" ? "SUBASSEMBLY" : "MATERIAL",
      planned: q(required), estimatedUnitCost: rate === null ? null : q(rate), estimatedCost: rate === null ? null : money(mul(required, rate)) };
  });
  const complete = lines.every((line) => line.estimatedCost !== null);
  return { explosion, lines, estimated: complete ? money(lines.reduce((sum, line) => add(sum, D(line.estimatedCost)), ZERO)) : null, missingCost: lines.filter((line) => line.estimatedCost === null).length };
}

async function writeMaterials(client, c, orderId, lines) {
  await client.query(`DELETE FROM tenant.manufacturing_order_materials WHERE organization_id = $1 AND manufacturing_order_id = $2`, [c.organizationId, orderId]);
  for (const line of lines) {
    await client.query(
      `INSERT INTO tenant.manufacturing_order_materials (organization_id, manufacturing_order_id, line_number, origin, bom_line_id, lineage_id, component_item_id, uom_id, kind, planned_quantity,
         estimated_unit_cost, estimated_cost) VALUES ($1,$2,$3,'RECIPE',$4,$5,$6,$7,$8,$9,$10,$11)`,
      [c.organizationId, orderId, line.lineNumber, line.bomLineId, line.lineageId, line.itemId, line.uomId, line.kind, line.planned, line.estimatedUnitCost, line.estimatedCost]);
  }
}

// A draft's figures without saving anything: the materials, availability in the material warehouse, the estimate and the revision used.
export async function previewManufacturingOrder(client, c, input = {}) {
  needMo(c, MO.create);
  const head = await headerOf(client, c, input);
  const plan = await planMaterials(client, c, head);
  const fake = { id: "00000000-0000-4000-8000-000000000000", material_warehouse_id: head.material_warehouse_id };
  const rows = [];
  for (const line of plan.lines) {
    const item = await loadItem(client, c.organizationId, line.itemId);
    rows.push({ id: String(line.lineNumber), line_number: line.lineNumber, origin: "RECIPE", kind: line.kind, component_item_id: line.itemId, item_code: item.code, item_name: item.name,
      tracking_type: item.tracking_type, uom_id: line.uomId, uom_code: item.uom_code, planned_quantity: line.planned, authorized_extra_quantity: "0", issued_quantity: "0", returned_quantity: "0",
      consumed_quantity: "0", issued_cost: "0", returned_cost: "0", estimated_unit_cost: line.estimatedUnitCost, estimated_cost: line.estimatedCost });
  }
  const materials = await materialView(client, c, fake, rows);
  const revision = (await client.query(`SELECT revision.revision_number, master.bom_number FROM tenant.manufacturing_bom_revisions revision JOIN tenant.manufacturing_bom_masters master ON master.id = revision.bom_id
     WHERE revision.id = $1`, [head.bom_revision_id])).rows[0];
  return { bom: { id: head.bom_id, revisionId: head.bom_revision_id, number: revision.bom_number, revisionNumber: revision.revision_number }, plannedBaseQuantity: head.planned_base_quantity,
    baseUom: head.item.uom_code, materials, estimatedMaterialCost: has(c, MO.costView) ? plan.estimated : null, assumptions: plan.explosion.assumptions, issues: plan.explosion.issues, previewOnly: true };
}

// ------------------------------------------------------------------ create / edit
export async function createManufacturingOrder(client, c, input = {}) {
  needMo(c, MO.create);
  const result = await idempotent(client, c, "manufacturing.order.create", input.idempotencyKey, { ...input, idempotencyKey: undefined }, async (key) => {
    const head = await headerOf(client, c, input);
    if (input.parentOrderId) {
      const parent = await loadOrder(client, c, input.parentOrderId);
      head.source_demand_type = "PARENT_ORDER";
      head.source_demand_id = parent.id;
      head.source_reference = parent.mo_number;
    }
    const plan = await planMaterials(client, c, head);
    const number = await nextNumber(client, c, "manufacturing_order");
    const row = (await client.query(
      `INSERT INTO tenant.manufacturing_orders (organization_id, mo_number, finished_item_id, planned_quantity, output_uom_id, planned_base_quantity, bom_id, bom_revision_id, manufacturing_warehouse_id,
         material_warehouse_id, finished_goods_warehouse_id, planned_start_at, planned_end_at, source_demand_type, source_demand_id, source_reference, parent_order_id, parent_material_id, priority, notes,
         production_owner_id, estimated_material_cost, idempotency_key, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING *`,
      [c.organizationId, number, head.finished_item_id, head.planned_quantity, head.output_uom_id, head.planned_base_quantity, head.bom_id, head.bom_revision_id, head.manufacturing_warehouse_id,
        head.material_warehouse_id, head.finished_goods_warehouse_id, head.planned_start_at, head.planned_end_at, head.source_demand_type, head.source_demand_id, head.source_reference,
        input.parentOrderId ? uuid(input.parentOrderId, "Parent order") : null, input.parentMaterialId ? uuid(input.parentMaterialId, "Parent material") : null, head.priority, head.notes,
        head.production_owner_id, plan.estimated, key, c.userId ?? null])).rows[0];
    await writeMaterials(client, c, row.id, plan.lines);
    await event(client, c, row.id, "CREATED", { to: "DRAFT", summary: `${row.mo_number} for ${head.planned_base_quantity} ${head.item.uom_code} of ${head.item.code}`,
      details: { bomRevisionId: head.bom_revision_id, materials: plan.lines.length } });
    return { orderId: row.id };
  });
  return getManufacturingOrder(client, c, result.orderId);
}

// input: { expectedVersion, any header field }. Quantity, date or revision changes re-plan the materials.
export async function updateManufacturingOrderDraft(client, c, id, input = {}) {
  needMo(c, MO.editDraft);
  const order = await loadOrder(client, c, id, { lock: true });
  requireStatus(order, "DRAFT");
  versionCheck(order, input.expectedVersion);
  if (input.finishedItemId && input.finishedItemId !== order.finished_item_id) throw moError(400, "MFG_MO_VALIDATION_FAILED", "A draft keeps its product; cancel it and create another order.");
  const head = await headerOf(client, c, input, order);
  const plan = await planMaterials(client, c, head);
  await client.query(
    `UPDATE tenant.manufacturing_orders SET planned_quantity = $3, output_uom_id = $4, planned_base_quantity = $5, bom_id = $6, bom_revision_id = $7, manufacturing_warehouse_id = $8, material_warehouse_id = $9,
            finished_goods_warehouse_id = $10, planned_start_at = $11, planned_end_at = $12, source_demand_type = $13, source_demand_id = $14, source_reference = $15, priority = $16, notes = $17,
            production_owner_id = $18, estimated_material_cost = $19, version = version + 1 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, order.id, head.planned_quantity, head.output_uom_id, head.planned_base_quantity, head.bom_id, head.bom_revision_id, head.manufacturing_warehouse_id, head.material_warehouse_id,
      head.finished_goods_warehouse_id, head.planned_start_at, head.planned_end_at, head.source_demand_type, head.source_demand_id, head.source_reference, head.priority, head.notes,
      head.production_owner_id, plan.estimated]);
  await writeMaterials(client, c, order.id, plan.lines);
  await event(client, c, order.id, "EDITED", { from: "DRAFT", to: "DRAFT", summary: "Draft edited; materials re-planned", details: { plannedBaseQuantity: head.planned_base_quantity, bomRevisionId: head.bom_revision_id } });
  return getManufacturingOrder(client, c, order.id);
}

// ------------------------------------------------------------------ validation and review
// Every problem with the order: errors block submitting and releasing; warnings (a shortage, a missing cost) are shown.
export async function validateOrder(client, c, order) {
  const issues = [];
  const error = (code, message) => issues.push({ severity: "error", code, message });
  const warning = (code, message) => issues.push({ severity: "warning", code, message });
  try { await headerOf(client, c, {}, order); } catch (failure) { error(failure.code ?? "MFG_MO_VALIDATION_FAILED", failure.message); }
  const materials = await materialView(client, c, order);
  if (!materials.length) error("MFG_MO_VALIDATION_FAILED", "The order has no materials; check the BOM revision.");
  for (const line of materials) {
    const item = await loadItem(client, c.organizationId, line.itemId);
    if (item.status !== "active" || item.lifecycle_status === "inactive") error("MFG_MO_VALIDATION_FAILED", `${line.code}: the material is inactive.`);
    if (D(line.shortage) > ZERO) warning("MFG_MO_SHORTAGE", `${line.code}: ${line.shortage} ${line.uom} short in the material warehouse.`);
    if (line.estimatedCost === null && line.origin === "RECIPE") warning("MFG_MO_COST_MISSING", `${line.code}: no cost known yet.`);
  }
  return { valid: !issues.some((issue) => issue.severity === "error"), issues };
}
export async function validateManufacturingOrder(client, c, id) {
  needMo(c, MO.view);
  return validateOrder(client, c, await loadOrder(client, c, id));
}
async function mustBeValid(client, c, order) {
  const result = await validateOrder(client, c, order);
  if (!result.valid) throw moError(409, "MFG_MO_VALIDATION_FAILED", result.issues.find((issue) => issue.severity === "error").message, { issues: result.issues });
  return result;
}

export async function submitManufacturingOrder(client, c, id, input = {}) {
  needMo(c, MO.submit);
  const order = await loadOrder(client, c, id, { lock: true });
  if (order.status === "AWAITING_APPROVAL") return getManufacturingOrder(client, c, order.id);
  requireStatus(order, "DRAFT");
  versionCheck(order, input.expectedVersion);
  await mustBeValid(client, c, order);
  await setStatus(client, c, order, "AWAITING_APPROVAL", { submitted_by: c.userId ?? null, submitted_at: new Date(), returned_reason: null, approved_by: null, approved_at: null },
    { action: "SUBMITTED", summary: text(input.note, 500) || null });
  return getManufacturingOrder(client, c, order.id);
}

// Back to draft for changes (input: { reason }).
export async function returnManufacturingOrder(client, c, id, input = {}) {
  needMo(c, MO.approve);
  const order = await loadOrder(client, c, id, { lock: true });
  requireStatus(order, "AWAITING_APPROVAL");
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw moError(400, "MFG_MO_REASON_REQUIRED", "Say what needs to change.");
  await setStatus(client, c, order, "DRAFT", { returned_reason: reason, approved_by: null, approved_at: null }, { action: "RETURNED", summary: reason });
  return getManufacturingOrder(client, c, order.id);
}

// Approval by someone other than the submitter (unless the company allows it); someone who may also release releases it at once.
// input: { note?, reserveMaterials? }
export async function approveManufacturingOrder(client, c, id, input = {}) {
  needMo(c, MO.approve);
  const order = await loadOrder(client, c, id, { lock: true });
  if (order.status !== "AWAITING_APPROVAL") {
    if (order.approved_at) return getManufacturingOrder(client, c, order.id);
    requireStatus(order, "AWAITING_APPROVAL");
  }
  versionCheck(order, input.expectedVersion);
  const settings = await settingsOf(client, c);
  if (order.submitted_by && order.submitted_by === c.userId && !settings.selfApproval) throw moError(409, "MFG_MO_APPROVAL_SELF");
  await mustBeValid(client, c, order);
  await client.query(`UPDATE tenant.manufacturing_orders SET approved_by = $3, approved_at = now(), approval_note = $4, version = version + 1 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, order.id, c.userId ?? null, text(input.note, 1000) || null]);
  await event(client, c, order.id, "APPROVED", { from: order.status, to: order.status, summary: text(input.note, 1000) || null });
  if (has(c, MO.release)) return releaseManufacturingOrder(client, c, order.id, { reserveMaterials: input.reserveMaterials });
  return getManufacturingOrder(client, c, order.id);
}

// Release: the revision effective on the planned start is frozen into a BOM snapshot (with its pinned subassemblies, units and estimate),
// the materials are fixed from it, and production is authorised. input: { reserveMaterials? }
export async function releaseManufacturingOrder(client, c, id, input = {}) {
  needMo(c, MO.release);
  const order = await loadOrder(client, c, id, { lock: true });
  if (EXECUTING.has(order.status)) return getManufacturingOrder(client, c, order.id);
  requireStatus(order, "AWAITING_APPROVAL");
  if (!order.approved_at) throw moError(409, "MFG_MO_STATE_INVALID", "Approve the order before releasing it.");
  await mustBeValid(client, c, order);
  const policy = await settingsOf(client, c);
  if (!policy.releaseWithShortages) {
    const short = (await materialView(client, c, order)).filter((row) => D(row.shortage) > ZERO);
    if (short.length) throw moError(409, "MFG_MATERIAL_SHORTAGE", `The company releases orders only with materials available: short ${short.map((row) => `${row.code} ${row.shortage}`).join(", ")}.`);
  }
  let snapshot;
  try {
    snapshot = await snapshotBomForProduction(client, bomContext(c), { revisionId: order.bom_revision_id, plannedQuantity: q(D(order.planned_quantity)), uomId: order.output_uom_id,
      productionDate: new Date(order.planned_start_at).toISOString(), policy: "USE_STOCKED_SUBASSEMBLIES", warehouseId: order.material_warehouse_id, sourceType: "manufacturing_order",
      sourceId: order.id, sourceReference: order.mo_number, idempotencyKey: `mo-release:${order.id}` });
  } catch (error) {
    throw moError(error.status ?? 409, error.code?.startsWith("MFG_BOM") ? "MFG_MO_BOM_NOT_ELIGIBLE" : error.code ?? "MFG_MO_BOM_NOT_ELIGIBLE", `BOM: ${error.message}`);
  }
  const rates = new Map((snapshot.costEstimate?.lines ?? []).map((line) => [line.itemId, line.unitCost === null ? null : D(line.unitCost)]));
  const lines = snapshot.snapshot.lines.filter((line) => line.level === 1).map((line, index) => {
    const rate = rates.get(line.itemId) ?? null;
    return { lineNumber: index + 1, bomLineId: line.lineId, lineageId: line.lineageId ?? null, itemId: line.itemId, uomId: line.baseUomId, kind: line.kind === "subassembly" ? "SUBASSEMBLY" : "MATERIAL",
      planned: line.required, estimatedUnitCost: rate === null ? null : q(rate), estimatedCost: rate === null ? null : money(mul(D(line.required), rate)) };
  });
  await writeMaterials(client, c, order.id, lines);
  const estimated = lines.every((line) => line.estimatedCost !== null) ? money(lines.reduce((sum, line) => add(sum, D(line.estimatedCost)), ZERO)) : null;
  await setStatus(client, c, order, "RELEASED", { bom_snapshot_id: snapshot.id, released_by: c.userId ?? null, released_at: new Date(), estimated_material_cost: estimated },
    { action: "RELEASED", summary: `Recipe frozen (snapshot ${snapshot.contentHash.slice(0, 12)})`, details: { snapshotId: snapshot.id, materials: lines.length } });
  if (input.reserveMaterials && has(c, MO.reserve)) {
    const { reserveManufacturingMaterials } = await import("./mo-execution.js");
    return reserveManufacturingMaterials(client, c, order.id, { idempotencyKey: `mo-release-reserve:${order.id}`, allowPartial: input.allowPartial ?? true });
  }
  return getManufacturingOrder(client, c, order.id);
}

// ------------------------------------------------------------------ hold, resume, cancel
// input: { category, reason }. Blocks issues, production and receipts; reservations and what is in production stay as they are.
export async function holdManufacturingOrder(client, c, id, input = {}) {
  needMo(c, MO.hold);
  const order = await loadOrder(client, c, id, { lock: true });
  if (order.status === "ON_HOLD") return getManufacturingOrder(client, c, order.id);
  requireStatus(order, "RELEASED", "IN_PROGRESS");
  const category = String(input.category ?? "OTHER").toUpperCase();
  if (!HOLD_CATEGORIES.has(category)) throw moError(400, "MFG_MO_VALIDATION_FAILED", "Choose why the order is held.");
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw moError(400, "MFG_MO_REASON_REQUIRED", "Say why the order is held.");
  await client.query(`INSERT INTO tenant.manufacturing_order_exceptions (organization_id, manufacturing_order_id, category, reason, source_type, raised_by) VALUES ($1,$2,$3,$4,'hold',$5)`,
    [c.organizationId, order.id, category, reason, c.userId ?? null]);
  await setStatus(client, c, order, "ON_HOLD", { held_from_status: order.status, hold_reason: reason, hold_category: category }, { action: "HELD", summary: `${category.toLowerCase().replace(/_/g, " ")}: ${reason}` });
  return getManufacturingOrder(client, c, order.id);
}

export async function resumeManufacturingOrder(client, c, id, input = {}) {
  needMo(c, MO.hold);
  const order = await loadOrder(client, c, id, { lock: true });
  requireStatus(order, "ON_HOLD");
  const note = text(input.note, 1000) || "Resumed";
  await client.query(`UPDATE tenant.manufacturing_order_exceptions SET status = 'RESOLVED', resolved_by = $3, resolved_at = clock_timestamp(), resolution = $4
      WHERE organization_id = $1 AND manufacturing_order_id = $2 AND source_type = 'hold' AND status = 'OPEN'`, [c.organizationId, order.id, c.userId ?? null, note]);
  await setStatus(client, c, order, order.held_from_status, { held_from_status: null, hold_reason: null, hold_category: null }, { action: "RESUMED", summary: note });
  return getManufacturingOrder(client, c, order.id);
}

// A draft or unreleased order is cancelled outright; a released one once its reservations are given back, provided nothing was issued,
// produced or received (otherwise return the material or close it short).
export async function cancelManufacturingOrder(client, c, id, input = {}) {
  needMo(c, MO.cancel);
  const order = await loadOrder(client, c, id, { lock: true });
  if (order.status === "CANCELLED") return getManufacturingOrder(client, c, order.id);
  requireStatus(order, "DRAFT", "AWAITING_APPROVAL", "RELEASED", "IN_PROGRESS", "ON_HOLD");
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw moError(400, "MFG_MO_REASON_REQUIRED", "Say why the order is cancelled.");
  const materials = await loadMaterials(client, c, order.id);
  const inProduction = materials.filter((line) => sub(D(line.issued_quantity), D(line.returned_quantity)) > ZERO);
  if (inProduction.length || D(order.reported_quantity) > ZERO || D(order.received_quantity) > ZERO) {
    throw moError(409, "MFG_MO_CANCEL_BLOCKED", inProduction.length
      ? `Material is in production (${inProduction.map((line) => line.item_code).join(", ")}): return it first, or close the order short.`
      : "Output has been recorded on this order: complete it short instead of cancelling.");
  }
  await releaseReservations(client, c, order);
  await client.query(`UPDATE tenant.manufacturing_order_exceptions SET status = 'RESOLVED', resolved_by = $3, resolved_at = clock_timestamp(), resolution = 'Order cancelled'
      WHERE organization_id = $1 AND manufacturing_order_id = $2 AND status = 'OPEN'`, [c.organizationId, order.id, c.userId ?? null]);
  await setStatus(client, c, order, "CANCELLED", { cancel_reason: reason, cancelled_by: c.userId ?? null, cancelled_at: new Date() }, { action: "CANCELLED", summary: reason });
  return getManufacturingOrder(client, c, order.id);
}

export { STATUS_LABEL };
