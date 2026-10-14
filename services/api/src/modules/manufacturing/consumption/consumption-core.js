// Material Consumption — the shared core: permissions, errors, loading a note, production custody by stock identity (what each posted issue
// put in production, less what was used, scrapped and returned — batch by batch and unit by unit), the BOM's expectation for an output
// basis and the variance bands, and the content hash an approval binds to. Inventory's own records stay authoritative: custody is derived
// from the posted issue and return movements, never from a counter typed into Manufacturing.
import { createHash } from "node:crypto";

import { normalizeQuantityToBase } from "../../products/uom.js";
import { explodeRevision } from "../boms/bom-engine.js";
import { D, MO, MoError, STATUS_LABEL, ZERO, add, div, has, lineFigures, loadMaterials, loadOrder, max, min, mul, q, sub, text, uuid } from "../orders/mo-core.js";

export const CONSUMPTION = Object.freeze({ view: "manufacturing.consumption.view", create: "manufacturing.consumption.create", post: "manufacturing.consumption.post",
  approve: "manufacturing.consumption.approve_variance", reverse: "manufacturing.consumption.reverse", export: "manufacturing.consumption.export" });
export const CONSUMPTION_STATUS_LABEL = Object.freeze({ DRAFT: "Draft", PENDING_APPROVAL: "Pending approval", POSTING: "Posting", POSTED: "Posted", CANCELLED: "Cancelled",
  RECOVERY_REQUIRED: "Recovery required" });
export const UNPOSTED = new Set(["DRAFT", "PENDING_APPROVAL"]);
export const BAND_LABEL = Object.freeze({ NO_BASIS: "No output basis", WITHIN: "Within tolerance", UNDER: "Under the BOM", WARNING: "Above the BOM (warning)", APPROVAL: "Needs approval",
  UNPLANNED: "Unplanned usage" });

const MESSAGES = Object.freeze({
  MFG_CONSUMPTION_NOT_FOUND: "The consumption note was not found.",
  MFG_CONSUMPTION_MO_NOT_FOUND: "Manufacturing Order could not be found.",
  MFG_CONSUMPTION_MO_INVALID_STATUS: "This order cannot record consumption right now.",
  MFG_CONSUMPTION_COMPONENT_INVALID: "This component is not authorized for this order.",
  MFG_CONSUMPTION_QTY_INVALID: "Enter a valid consumption quantity.",
  MFG_CONSUMPTION_EXCEEDS_CUSTODY: "Not enough issued material remains available.",
  MFG_CONSUMPTION_ISSUE_NOT_FOUND: "No valid Material Issue was found.",
  MFG_CONSUMPTION_UOM_INVALID: "The material unit is not valid.",
  MFG_CONSUMPTION_BATCH_INVALID: "This batch cannot be consumed.",
  MFG_CONSUMPTION_SERIAL_ALREADY_USED: "This serial number was already used.",
  MFG_CONSUMPTION_LOCATION_MISMATCH: "Material is not in the selected production location.",
  MFG_CONSUMPTION_VARIANCE_APPROVAL: "Additional usage needs approval.",
  MFG_CONSUMPTION_APPROVAL_STALE: "Usage details changed. Request approval again.",
  MFG_CONSUMPTION_APPROVAL_SELF: "Someone other than the person who asked must approve this usage.",
  MFG_CONSUMPTION_ALREADY_POSTED: "This consumption has already been recorded.",
  MFG_CONSUMPTION_STOCK_CHANGED: "Material custody changed. Review quantities.",
  MFG_CONSUMPTION_DOCUMENT_CHANGED: "The note changed. Review it again.",
  MFG_CONSUMPTION_STATE_INVALID: "This action is not available in the note's current status.",
  MFG_CONSUMPTION_CORRECTION_BLOCKED: "The original consumption cannot be reversed through a simple correction.",
  MFG_CONSUMPTION_PERMISSION_DENIED: "You do not have permission for this action.",
  MFG_CONSUMPTION_REASON_REQUIRED: "Give a reason.",
  MFG_CONSUMPTION_EMPTY: "Add at least one material and quantity used.",
});
export const consumptionError = (status, code, message, details) => new MoError(status, code, message ?? MESSAGES[code], details);
export const needConsumption = (c, permission) => { if (!has(c, permission)) throw consumptionError(403, "MFG_CONSUMPTION_PERMISSION_DENIED"); };
export const needConsumptionView = (c) => {
  if (!has(c, MO.view) || (!has(c, CONSUMPTION.view) && !has(c, CONSUMPTION.create))) throw consumptionError(403, "MFG_CONSUMPTION_PERMISSION_DENIED");
};

export async function loadConsumption(client, c, id, { lock = false } = {}) {
  const row = (await client.query(`SELECT * FROM tenant.manufacturing_material_consumptions WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [c.organizationId, uuid(id, "Consumption note")])).rows[0];
  if (!row) throw consumptionError(404, "MFG_CONSUMPTION_NOT_FOUND");
  return row;
}
export async function loadConsumptionLines(client, c, id) {
  return (await client.query(
    `SELECT line.*, item.code AS item_code, item.name AS item_name, item.tracking_type, uom.code AS uom_code, base.code AS base_uom_code
       FROM tenant.manufacturing_material_consumption_lines line JOIN tenant.items item ON item.id = line.item_id JOIN tenant.units_of_measure uom ON uom.id = line.uom_id
       LEFT JOIN tenant.units_of_measure base ON base.id = item.uom_id WHERE line.organization_id = $1 AND line.consumption_id = $2 ORDER BY line.line_number`, [c.organizationId, id])).rows;
}
export async function loadConsumptionOrder(client, c, orderId, options) {
  try { return await loadOrder(client, c, orderId, options); } catch (error) {
    if (error.code === "MFG_MO_NOT_FOUND") throw consumptionError(404, "MFG_CONSUMPTION_MO_NOT_FOUND");
    throw error;
  }
}
// Ordinary consumption happens while the order is in production: a released order may stage material, not use it.
// The closing disposition at completion may also run while the order waits for its short close to be approved.
export function requireInProduction(order, { closing = false } = {}) {
  if (order.status !== "IN_PROGRESS" && !(closing && order.status === "COMPLETION_PENDING")) {
    throw consumptionError(409, "MFG_CONSUMPTION_MO_INVALID_STATUS", order.status === "RELEASED"
      ? `${order.mo_number} is released but production has not started: start production before recording what it used.`
      : `${order.mo_number} is ${STATUS_LABEL[order.status].toLowerCase()}: consumption is recorded while an order is in progress.`);
  }
}
export async function consumptionSettings(client, c) {
  const row = (await client.query(`SELECT * FROM tenant.manufacturing_settings WHERE organization_id = $1`, [c.organizationId])).rows[0] ?? {};
  return { warningPct: D(row.mc_variance_warning_pct ?? 2), approvalPct: D(row.mc_variance_approval_pct ?? 5), selfApproval: Boolean(row.mc_self_approval_allowed) };
}

// ------------------------------------------------------------------ production custody by stock identity
// Every posted issue of the order's material lines (an issue reversed as a posting error is not custody), with the batch or serial unit
// each part carried, its unit cost, the issue note and its production location; and, per identity, what is still in custody: issued less
// used (net of corrections), scrapped and returned.
export async function custodyOf(client, c, order, materials) {
  const ids = materials.map((material) => material.id);
  if (!ids.length) return new Map();
  const issues = (await client.query(
    `SELECT movement.id, movement.material_id, movement.allocations, movement.unit_cost, movement.posted_at, movement.material_issue_id, movement.movement_number, issue.production_location_id,
            issue.issue_number, issue.cost_status
       FROM tenant.manufacturing_order_material_movements movement LEFT JOIN tenant.manufacturing_material_issues issue ON issue.id = movement.material_issue_id
      WHERE movement.organization_id = $1 AND movement.material_id = ANY($2::uuid[]) AND movement.direction = 'ISSUE'
        AND NOT EXISTS (SELECT 1 FROM tenant.manufacturing_material_issue_lines line WHERE line.movement_id = movement.id AND line.reversed_quantity > 0)
      ORDER BY movement.posted_at, movement.movement_number`, [c.organizationId, ids])).rows;
  const returns = (await client.query(
    `SELECT movement.material_id, allocation->>'batchId' AS batch_id, (allocation->>'quantity')::numeric AS quantity
       FROM tenant.manufacturing_order_material_movements movement, jsonb_array_elements(movement.allocations) allocation
      WHERE movement.organization_id = $1 AND movement.material_id = ANY($2::uuid[]) AND movement.direction = 'RETURN' AND movement.material_issue_id IS NULL`, [c.organizationId, ids])).rows;
  // Scrap less what approved scrap reversals gave back to custody (Scrap, 0119).
  const scrap = (await client.query(`SELECT material_id, batch_id, serial_id, quantity FROM tenant.manufacturing_material_scrap WHERE organization_id = $1 AND material_id = ANY($2::uuid[])
      UNION ALL SELECT material_id, batch_id, serial_id, -quantity FROM tenant.manufacturing_material_scrap_reversals WHERE organization_id = $1 AND material_id = ANY($2::uuid[])`,
    [c.organizationId, ids])).rows;
  const used = (await client.query(
    `SELECT line.material_id, allocation.source_movement_id, allocation.batch_id, allocation.serial_id, sum(allocation.quantity) AS quantity
       FROM tenant.manufacturing_material_consumption_allocations allocation JOIN tenant.manufacturing_material_consumption_lines line ON line.id = allocation.consumption_line_id
      WHERE allocation.organization_id = $1 AND line.material_id = ANY($2::uuid[]) GROUP BY 1, 2, 3, 4`, [c.organizationId, ids])).rows;
  const corrected = (await client.query(
    `SELECT line.material_id, (part->>'sourceMovementId')::uuid AS source_movement_id, NULLIF(part->>'batchId', '')::uuid AS batch_id, NULLIF(part->>'serialId', '')::uuid AS serial_id,
            sum((part->>'quantity')::numeric) AS quantity
       FROM tenant.manufacturing_material_consumption_corrections correction JOIN tenant.manufacturing_material_consumption_lines line ON line.id = correction.consumption_line_id,
            jsonb_array_elements(correction.allocations) part
      WHERE correction.organization_id = $1 AND line.material_id = ANY($2::uuid[]) GROUP BY 1, 2, 3, 4`, [c.organizationId, ids])).rows;
  const keyOf = (batchId, serialId) => serialId ?? batchId ?? "-";
  const entryKey = (movementId, batchId, serialId) => `${movementId}|${batchId ?? ""}|${serialId ?? ""}`;
  const usedNet = new Map();
  for (const row of used) usedNet.set(entryKey(row.source_movement_id, row.batch_id, row.serial_id), add(usedNet.get(entryKey(row.source_movement_id, row.batch_id, row.serial_id)) ?? ZERO, D(row.quantity)));
  for (const row of corrected) usedNet.set(entryKey(row.source_movement_id, row.batch_id, row.serial_id), sub(usedNet.get(entryKey(row.source_movement_id, row.batch_id, row.serial_id)) ?? ZERO, D(row.quantity)));
  const out = new Map();
  for (const material of materials) {
    const entries = [];
    for (const movement of issues.filter((row) => row.material_id === material.id)) {
      const parts = Array.isArray(movement.allocations) && movement.allocations.length ? movement.allocations : [];
      for (const part of parts) {
        const batchId = part.batchId ?? null;
        const serialId = part.serialId ?? null;
        const quantity = D(String(part.quantity ?? "0"));
        if (quantity <= ZERO) continue;
        const usedHere = usedNet.get(entryKey(movement.id, batchId, serialId)) ?? ZERO;
        entries.push({ movementId: movement.id, movementNumber: movement.movement_number, issueId: movement.material_issue_id, issueNumber: movement.issue_number,
          productionLocationId: movement.production_location_id, batchId, serialId, quantity, used: usedHere, remaining: max(sub(quantity, usedHere), ZERO),
          unitCost: movement.unit_cost === null ? null : D(movement.unit_cost), costMissing: movement.cost_status === "MISSING", postedAt: movement.posted_at, key: keyOf(batchId, serialId) });
      }
    }
    const pools = new Map();
    const pool = (key) => { if (!pools.has(key)) pools.set(key, { key, issued: ZERO, used: ZERO, scrapped: ZERO, returned: ZERO }); return pools.get(key); };
    for (const entry of entries) { pool(entry.key).issued = add(pool(entry.key).issued, entry.quantity); pool(entry.key).used = add(pool(entry.key).used, entry.used); }
    for (const row of scrap.filter((part) => part.material_id === material.id)) pool(keyOf(row.batch_id, row.serial_id)).scrapped = add(pool(keyOf(row.batch_id, row.serial_id)).scrapped, D(row.quantity));
    for (const row of returns.filter((part) => part.material_id === material.id)) pool(keyOf(row.batch_id, null)).returned = add(pool(keyOf(row.batch_id, null)).returned, D(row.quantity));
    for (const value of pools.values()) value.available = max(sub(sub(sub(value.issued, value.used), value.scrapped), value.returned), ZERO);
    out.set(material.id, { entries, pools, custody: max(lineFigures(material).custody, ZERO) });
  }
  return out;
}

// ------------------------------------------------------------------ lines as entered
// input lines: [{ materialId, quantity, uomId?, batchId?, serialIds?, sourceMovementId?, varianceReason?, notes? }]
export async function resolveConsumptionLines(client, c, order, materials, requested) {
  const lines = Array.isArray(requested) ? requested.filter((row) => row && row.quantity !== undefined && row.quantity !== null && String(row.quantity).trim() !== "") : [];
  if (!lines.length) throw consumptionError(400, "MFG_CONSUMPTION_EMPTY");
  if (lines.length > 200) throw consumptionError(400, "MFG_CONSUMPTION_QTY_INVALID", "One consumption note holds at most 200 lines.");
  const out = [];
  for (const [index, row] of lines.entries()) {
    const material = materials.find((line) => line.id === row.materialId);
    if (!material) throw consumptionError(400, "MFG_CONSUMPTION_COMPONENT_INVALID", `Line ${index + 1}: that material is not on ${order.mo_number}.`);
    const raw = String(row.quantity).trim();
    if (!/^\d+(\.\d+)?$/.test(raw) || !(Number(raw) > 0)) throw consumptionError(400, "MFG_CONSUMPTION_QTY_INVALID", `${material.item_code}: enter a quantity more than zero.`);
    const uomId = row.uomId ? uuid(row.uomId, "Unit") : material.uom_id;
    const converted = await normalizeQuantityToBase(client, c.organizationId, material.component_item_id, uomId, raw, { purpose: "inventory" });
    if (!converted.ok) throw consumptionError(400, ["quantity_invalid", "precision", "serial_fraction", "base_precision"].includes(converted.reason) ? "MFG_CONSUMPTION_QTY_INVALID" : "MFG_CONSUMPTION_UOM_INVALID",
      `${material.item_code}: ${converted.message}`);
    const serialIds = Array.isArray(row.serialIds) ? row.serialIds.filter(Boolean).map((value) => uuid(value, "Serial")) : [];
    if (new Set(serialIds).size !== serialIds.length) throw consumptionError(400, "MFG_CONSUMPTION_SERIAL_ALREADY_USED", `${material.item_code}: a serial number appears twice.`);
    if (material.tracking_type === "serial" && serialIds.length && D(serialIds.length) !== converted.baseQuantity) {
      throw consumptionError(400, "MFG_CONSUMPTION_QTY_INVALID", `${material.item_code}: choose exactly ${q(converted.baseQuantity)} serial number(s); ${serialIds.length} chosen.`);
    }
    if (material.tracking_type !== "serial" && serialIds.length) throw consumptionError(400, "MFG_CONSUMPTION_QTY_INVALID", `${material.item_code} is not serial-tracked.`);
    if (material.tracking_type !== "batch" && row.batchId) throw consumptionError(400, "MFG_CONSUMPTION_BATCH_INVALID", `${material.item_code} is not batch-tracked.`);
    out.push({ material, quantity: raw, uomId, factor: converted.factor, baseQuantity: converted.baseQuantity, batchId: row.batchId ? uuid(row.batchId, "Batch") : null,
      serialIds: serialIds.length ? serialIds : null, sourceMovementId: row.sourceMovementId ? uuid(row.sourceMovementId, "Issue") : null,
      varianceReason: text(row.varianceReason, 500) || null, notes: text(row.notes, 500) || null });
  }
  return out;
}
export function storedConsumptionLines(rows, materials) {
  return rows.map((row) => ({ id: row.id, lineNumber: row.line_number, material: materials.find((material) => material.id === row.material_id), quantity: q(D(row.quantity)), uomId: row.uom_id,
    factor: D(row.conversion_factor), baseQuantity: D(row.base_quantity), batchId: row.batch_id, serialIds: row.serial_ids?.length ? row.serial_ids : null, sourceMovementId: row.source_movement_id,
    varianceReason: row.variance_reason, notes: row.notes }));
}

// ------------------------------------------------------------------ the stock each line uses
// Which issued stock each line uses, without changing anything: a named serial unit or batch, else the oldest issued custody first; never
// more than the identity, or the line, still holds; only from issues to the note's production location (or to no particular location).
// strict throws on the first problem (posting); otherwise problems are collected (preview).
export async function planConsumption(client, c, order, note, lines, { strict = true } = {}) {
  const custody = await custodyOf(client, c, order, [...new Map(lines.map((line) => [line.material.id, line.material])).values()]);
  const takenEntry = new Map();
  const takenPool = new Map();
  const takenLine = new Map();
  const problems = [];
  const planned = [];
  const location = note.production_location_id ?? null;
  for (const line of lines) {
    const result = { plan: [], short: ZERO };
    planned.push(result);
    try {
      const held = custody.get(line.material.id);
      const lineLeft = sub(held.custody, takenLine.get(line.material.id) ?? ZERO);
      if (!held.entries.length) throw consumptionError(409, "MFG_CONSUMPTION_ISSUE_NOT_FOUND", `${line.material.item_code}: nothing has been issued to ${order.mo_number} yet; issue it before recording its use.`);
      if (line.batchId) {
        const batch = (await client.query(`SELECT batch_number, status, expires_on < current_date AS expired, expires_on FROM tenant.stock_batches WHERE organization_id = $1 AND id = $2`, [c.organizationId, line.batchId])).rows[0];
        if (!batch) throw consumptionError(400, "MFG_CONSUMPTION_BATCH_INVALID", `${line.material.item_code}: that batch was not found.`);
        if (batch.status !== "active" || batch.expired) {
          throw consumptionError(409, "MFG_CONSUMPTION_BATCH_INVALID", `${line.material.item_code}: batch ${batch.batch_number} is ${batch.expired ? `expired (${String(batch.expires_on).slice(0, 10)})` : batch.status}; it cannot be used.`);
        }
      }
      let candidates = held.entries.filter((entry) => (!line.batchId || entry.batchId === line.batchId) && (!line.sourceMovementId || entry.movementId === line.sourceMovementId));
      if (line.serialIds) {
        for (const serialId of line.serialIds) {
          const issued = held.entries.filter((entry) => entry.serialId === serialId);
          if (!issued.length) throw consumptionError(409, "MFG_CONSUMPTION_ISSUE_NOT_FOUND", `${line.material.item_code}: that serial unit was not issued to ${order.mo_number}.`);
          const poolLeft = sub(held.pools.get(serialId)?.available ?? ZERO, takenPool.get(`${line.material.id}:${serialId}`) ?? ZERO);
          if (poolLeft < 1_000_000n) throw consumptionError(409, "MFG_CONSUMPTION_SERIAL_ALREADY_USED", `${line.material.item_code}: that serial unit was already used or scrapped.`);
        }
        candidates = held.entries.filter((entry) => line.serialIds.includes(entry.serialId));
      }
      if ((line.batchId || line.sourceMovementId) && !candidates.length) {
        throw consumptionError(409, "MFG_CONSUMPTION_ISSUE_NOT_FOUND", `${line.material.item_code}: ${line.batchId ? "that batch" : "that issue"} was not issued to ${order.mo_number}.`);
      }
      if (line.baseQuantity > lineLeft) throw consumptionError(409, "MFG_CONSUMPTION_EXCEEDS_CUSTODY", `${line.material.item_code}: ${q(lineLeft)} ${line.material.uom_code} is still in production custody; ${q(line.baseQuantity)} cannot be used.`);
      const placed = candidates.filter((entry) => !location || !entry.productionLocationId || entry.productionLocationId === location);
      if (candidates.length && !placed.length) throw consumptionError(409, "MFG_CONSUMPTION_LOCATION_MISMATCH", `${line.material.item_code}: it was issued to another production location.`);
      let left = line.baseQuantity;
      for (const entry of placed) {
        if (left <= ZERO) break;
        const entryLeft = sub(entry.remaining, takenEntry.get(`${entry.movementId}|${entry.batchId}|${entry.serialId}`) ?? ZERO);
        const poolLeft = sub(held.pools.get(entry.key)?.available ?? ZERO, takenPool.get(`${line.material.id}:${entry.key}`) ?? ZERO);
        const take = min(min(entryLeft, poolLeft), left);
        if (take <= ZERO) continue;
        takenEntry.set(`${entry.movementId}|${entry.batchId}|${entry.serialId}`, add(takenEntry.get(`${entry.movementId}|${entry.batchId}|${entry.serialId}`) ?? ZERO, take));
        takenPool.set(`${line.material.id}:${entry.key}`, add(takenPool.get(`${line.material.id}:${entry.key}`) ?? ZERO, take));
        result.plan.push({ ...entry, quantity: take });
        left = sub(left, take);
      }
      if (left > ZERO) {
        result.short = left;
        throw consumptionError(409, "MFG_CONSUMPTION_EXCEEDS_CUSTODY", `${line.material.item_code}: only ${q(sub(line.baseQuantity, left))} ${line.material.uom_code} of ${line.batchId ? "that batch" : "the issued stock"}${location ? " at this location" : ""} is still in custody.`);
      }
      takenLine.set(line.material.id, add(takenLine.get(line.material.id) ?? ZERO, line.baseQuantity));
    } catch (error) {
      if (strict || !(error instanceof MoError)) throw error;
      problems.push({ code: error.code, message: error.message });
    }
  }
  return { lines: planned, problems, custody };
}

// ------------------------------------------------------------------ the BOM's expectation and the variance
// The output the usage is recorded against: the note's own basis, else its production entry's reported quantity.
export async function outputBasis(client, c, note) {
  if (note.output_basis_quantity !== null && note.output_basis_quantity !== undefined) return D(note.output_basis_quantity);
  if (!note.production_entry_id) return null;
  const entry = (await client.query(`SELECT reported_quantity FROM tenant.manufacturing_production_entries WHERE organization_id = $1 AND id = $2`, [c.organizationId, note.production_entry_id])).rows[0];
  return entry ? D(entry.reported_quantity) : null;
}
// What the BOM expects each material to use for `basis` units of output (yield, batches, allowances and rounding included).
export async function expectationFor(client, c, order, basis) {
  if (basis === null || !order.bom_revision_id) return null;
  const explosion = await explodeRevision(client, c.organizationId, order.bom_revision_id, { plannedQuantity: q(basis), policy: "USE_STOCKED_SUBASSEMBLIES" });
  const expected = new Map();
  for (const row of explosion.consumed) expected.set(row.itemId, add(expected.get(row.itemId) ?? ZERO, D(row.required)));
  return expected;
}
// Per line: expected (shared by lines of the same item, first line first), variance, percent and band.
export function variancesOf(lines, expected, settings) {
  const left = expected ? new Map(expected) : null;
  return lines.map((line) => {
    if (!left) return { expected: null, variance: null, pct: null, band: "NO_BASIS" };
    const have = left.get(line.material.component_item_id) ?? ZERO;
    left.set(line.material.component_item_id, ZERO);
    const variance = sub(line.baseQuantity, have);
    if (have === ZERO) return { expected: ZERO, variance, pct: null, band: "UNPLANNED" };
    const pct = div(mul(variance, 100n * 1_000_000n), have);
    const band = variance < ZERO ? "UNDER" : pct <= settings.warningPct ? "WITHIN" : pct <= settings.approvalPct ? "WARNING" : "APPROVAL";
    return { expected: have, variance, pct, band };
  });
}
export const needsApproval = (variances) => variances.some((row) => row.band === "APPROVAL" || row.band === "UNPLANNED");

// What an approval binds to: the order, location, basis and every line's material, base quantity, unit, batch, serials and source.
export function consumptionHash(note, lines) {
  const base = (line) => (line.baseQuantity !== undefined ? q(line.baseQuantity) : q(D(line.base_quantity)));
  const body = JSON.stringify({
    order: note.manufacturing_order_id, location: note.production_location_id ?? null, entry: note.production_entry_id ?? null,
    basis: note.output_basis_quantity === null || note.output_basis_quantity === undefined ? null : q(D(note.output_basis_quantity)),
    lines: lines.map((line) => [line.material_id ?? line.material?.id, base(line), line.uom_id ?? line.uomId, line.batch_id ?? line.batchId ?? null,
      [...(line.serial_ids ?? line.serialIds ?? [])].sort(), line.source_movement_id ?? line.sourceMovementId ?? null]),
  });
  return createHash("sha256").update(body).digest("hex");
}
// The custody versions of the note's materials: an approval given for one state of custody is stale once another posting changes it.
export const versionsOf = (lines) => Object.fromEntries(lines.map((line) => [line.material.id, Number(line.material.version)]));

// The approval's validity now: required (any line needing approval), bound (same content, same custody versions) and decided.
export function approvalOf(note, lines, variances) {
  const required = needsApproval(variances);
  if (!required) return { required: false, valid: true, stale: false, status: note.approval_status };
  const sameContent = note.approval_hash && note.approval_hash === note.content_hash;
  const sameCustody = note.approval_versions && JSON.stringify(note.approval_versions) === JSON.stringify(versionsOf(lines));
  const approved = note.approval_status === "APPROVED";
  const stale = approved && (!sameContent || !sameCustody);
  return { required: true, valid: approved && !stale, stale, status: note.approval_status,
    message: stale ? "Usage details or the material's custody changed since the approval: ask again."
      : approved ? null : "Usage is beyond the BOM's expectation for this output: a supervisor must approve it." };
}

export { D, MO, STATUS_LABEL, ZERO, add, div, has, lineFigures, loadMaterials, max, min, mul, q, sub, text, uuid };
