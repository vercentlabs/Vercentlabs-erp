// Material Issue — the shared core: permissions, errors, loading a note, the stock plan for each line (the order's own reservation first, at
// its location and batch; then, where the company allows it, free usable stock earliest expiry first; serial units one by one) and the
// content hash an approval binds to. Inventory owns stock, reservations, eligibility and valuation; this module only asks it.
import { createHash } from "node:crypto";

import { normalizeQuantityToBase } from "../../products/uom.js";
import { USABLE_ROW } from "../../stock/index.js";
import {
  D, MO, MoError, SOURCE, STATUS_LABEL, ZERO, add, div, has, lineFigures, loadMaterials, loadOrder, max, min, mul, q, sub, text, usableBalances, uuid,
} from "../orders/mo-core.js";
import { heldRefusal } from "../holds/hold-core.js";

export const ISSUE = Object.freeze({ view: "manufacturing.issue.view", reverse: "manufacturing.issue.reverse", export: "manufacturing.issue.export", scrap: "manufacturing.issue.scrap" });
export const ISSUE_STATUS_LABEL = Object.freeze({ DRAFT: "Draft", PENDING_APPROVAL: "Pending approval", READY_TO_POST: "Ready to post", POSTING: "Posting", POSTED: "Posted",
  CANCELLED: "Cancelled", RECOVERY_REQUIRED: "Recovery required" });
export const UNPOSTED = new Set(["DRAFT", "PENDING_APPROVAL", "READY_TO_POST"]);
export const VARIANCE_TYPES = new Set(["EXCESS_USAGE", "DAMAGED_DURING_PRODUCTION", "QUALITY_REPLACEMENT", "PLANNING_CORRECTION", "OTHER"]);
export const ISSUE_REASONS = new Set(["NORMAL", "EXTRA_MATERIAL", "REPLACEMENT", "CORRECTION"]);
// Orders a material issue may be posted against: a released order may stage material before production starts.
export const ISSUABLE = new Set(["RELEASED", "IN_PROGRESS"]);

const MESSAGES = Object.freeze({
  MFG_ISSUE_NOT_FOUND: "The material issue was not found.",
  MFG_ISSUE_MO_NOT_FOUND: "Manufacturing Order could not be found.",
  MFG_ISSUE_MO_STATUS_INVALID: "Materials cannot be issued in this order's current status.",
  MFG_ISSUE_COMPONENT_INVALID: "This material is not authorized for the selected order.",
  MFG_ISSUE_QTY_INVALID: "Enter a valid quantity.",
  MFG_ISSUE_EXCEEDS_REQUIREMENT: "The issue exceeds the authorized material requirement.",
  MFG_ISSUE_APPROVAL_REQUIRED: "A manager must approve the additional material.",
  MFG_ISSUE_APPROVAL_SELF: "Someone other than the person who asked must approve the additional material.",
  MFG_ISSUE_UOM_INVALID: "Select a compatible unit of measurement.",
  MFG_ISSUE_WAREHOUSE_INVALID: "Select an authorized source warehouse.",
  MFG_ISSUE_STOCK_SHORTAGE: "Not enough eligible material is available.",
  MFG_ISSUE_RESERVATION_CONFLICT: "Some of this stock is reserved for another order.",
  MFG_ISSUE_BATCH_INVALID: "The selected batch cannot be issued.",
  MFG_ISSUE_SERIAL_INVALID: "One or more serial numbers are unavailable.",
  MFG_ISSUE_EXPIRED_STOCK: "Expired material cannot be issued.",
  MFG_ISSUE_ALREADY_POSTED: "This Material Issue has already been posted.",
  MFG_ISSUE_DOCUMENT_CHANGED: "The issue changed. Review it again.",
  MFG_ISSUE_STATE_INVALID: "This action is not available in the issue's current status.",
  MFG_ISSUE_INVENTORY_UNAVAILABLE: "Stock posting is unavailable right now.",
  MFG_ISSUE_OUTCOME_UNKNOWN: "Checking whether the previous issue succeeded. Do not submit again.",
  MFG_ISSUE_FINANCE_PENDING: "Materials were issued, but accounting reconciliation is pending.",
  MFG_ISSUE_REVERSAL_BLOCKED: "These materials have already been used or otherwise accounted for.",
  MFG_ISSUE_PERMISSION_DENIED: "You do not have permission for this action.",
  MFG_ISSUE_REASON_REQUIRED: "Give a reason.",
  MFG_ISSUE_EMPTY: "Add at least one material and quantity to issue.",
});
export const issueError = (status, code, message, details) => new MoError(status, code, message ?? MESSAGES[code], details);
export const needIssue = (c, permission) => { if (!has(c, permission)) throw issueError(403, "MFG_ISSUE_PERMISSION_DENIED"); };
// Seeing notes: the order view and either the issue view or the issue permission (a storekeeper who posts them).
export const needIssueView = (c) => {
  if (!has(c, MO.view) || (!has(c, ISSUE.view) && !has(c, MO.issue))) throw issueError(403, "MFG_ISSUE_PERMISSION_DENIED");
};

export async function loadIssue(client, c, id, { lock = false } = {}) {
  const row = (await client.query(`SELECT * FROM tenant.manufacturing_material_issues WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [c.organizationId, uuid(id, "Material issue")])).rows[0];
  if (!row) throw issueError(404, "MFG_ISSUE_NOT_FOUND");
  return row;
}
export async function loadIssueLines(client, c, issueId) {
  return (await client.query(
    `SELECT line.*, item.code AS item_code, item.name AS item_name, item.tracking_type, uom.code AS uom_code, base.code AS base_uom_code
       FROM tenant.manufacturing_material_issue_lines line JOIN tenant.items item ON item.id = line.item_id JOIN tenant.units_of_measure uom ON uom.id = line.uom_id
       LEFT JOIN tenant.units_of_measure base ON base.id = item.uom_id
      WHERE line.organization_id = $1 AND line.material_issue_id = $2 ORDER BY line.line_number`, [c.organizationId, issueId])).rows;
}
// The order, or the issue's own not-found code (never another company's order).
export async function loadIssueOrder(client, c, orderId, options) {
  try { return await loadOrder(client, c, orderId, options); } catch (error) {
    if (error.code === "MFG_MO_NOT_FOUND") throw issueError(404, "MFG_ISSUE_MO_NOT_FOUND");
    throw error;
  }
}
export function requireIssuable(order) {
  const held = heldRefusal(order, "issue");
  if (held) throw issueError(409, "MFG_ISSUE_MO_STATUS_INVALID", held);
  if (!ISSUABLE.has(order.status)) {
    throw issueError(409, "MFG_ISSUE_MO_STATUS_INVALID", `${order.mo_number} is ${STATUS_LABEL[order.status].toLowerCase()}: materials are issued to a released or in-progress order.`);
  }
}
export async function issueSettings(client, c) {
  const row = (await client.query(`SELECT * FROM tenant.manufacturing_settings WHERE organization_id = $1`, [c.organizationId])).rows[0] ?? {};
  return { unreservedAllowed: row.mi_unreserved_issue_allowed ?? true, tolerancePct: D(row.mi_excess_tolerance_pct ?? 0), selfApproval: Boolean(row.mo_variance_self_approval_allowed) };
}

// ------------------------------------------------------------------ lines as entered
// Each requested line resolved against the order: its exact material line, the unit and its exact conversion to the item's base unit, the
// batch, serial units and source location named. input lines: [{ materialId, quantity, uomId?, batchId?, serialIds?, sourceLocationId?, notes? }]
export async function resolveLines(client, c, order, materials, requested) {
  const lines = Array.isArray(requested) ? requested.filter((row) => row && row.quantity !== undefined && row.quantity !== null && String(row.quantity).trim() !== "") : [];
  if (!lines.length) throw issueError(400, "MFG_ISSUE_EMPTY");
  if (lines.length > 200) throw issueError(400, "MFG_ISSUE_QTY_INVALID", "One issue note holds at most 200 lines.");
  const out = [];
  for (const [index, row] of lines.entries()) {
    const material = materials.find((line) => line.id === row.materialId);
    if (!material) throw issueError(400, "MFG_ISSUE_COMPONENT_INVALID", `Line ${index + 1}: that material is not on ${order.mo_number}.`);
    const raw = String(row.quantity).trim();
    if (!/^\d+(\.\d+)?$/.test(raw) || !(Number(raw) > 0)) throw issueError(400, "MFG_ISSUE_QTY_INVALID", `${material.item_code}: enter a quantity more than zero.`);
    const uomId = row.uomId ? uuid(row.uomId, "Unit") : material.uom_id;
    const converted = await normalizeQuantityToBase(client, c.organizationId, material.component_item_id, uomId, raw, { purpose: "inventory" });
    if (!converted.ok) throw issueError(400, converted.reason === "quantity_invalid" || converted.reason === "precision" || converted.reason === "serial_fraction" ? "MFG_ISSUE_QTY_INVALID" : "MFG_ISSUE_UOM_INVALID",
      `${material.item_code}: ${converted.message}`);
    const serialIds = Array.isArray(row.serialIds) ? row.serialIds.filter(Boolean).map((value) => uuid(value, "Serial")) : [];
    if (new Set(serialIds).size !== serialIds.length) throw issueError(400, "MFG_ISSUE_SERIAL_INVALID", `${material.item_code}: a serial number appears twice.`);
    if (material.tracking_type === "serial" && serialIds.length && D(serialIds.length) !== converted.baseQuantity) {
      throw issueError(400, "MFG_ISSUE_SERIAL_INVALID", `${material.item_code}: choose exactly ${q(converted.baseQuantity)} serial number(s); ${serialIds.length} chosen.`);
    }
    if (material.tracking_type !== "serial" && serialIds.length) throw issueError(400, "MFG_ISSUE_SERIAL_INVALID", `${material.item_code} is not serial-tracked.`);
    if (material.tracking_type !== "batch" && row.batchId) throw issueError(400, "MFG_ISSUE_BATCH_INVALID", `${material.item_code} is not batch-tracked.`);
    out.push({ material, quantity: raw, uomId, factor: converted.factor, baseQuantity: converted.baseQuantity, batchId: row.batchId ? uuid(row.batchId, "Batch") : null,
      serialIds: serialIds.length ? serialIds : null, sourceLocationId: row.sourceLocationId ? uuid(row.sourceLocationId, "Location") : null, notes: text(row.notes, 500) || null });
  }
  const keys = new Set();
  for (const line of out) {
    const key = `${line.material.id}:${line.batchId ?? ""}`;
    if (keys.has(key)) throw issueError(400, "MFG_ISSUE_COMPONENT_INVALID", `${line.material.item_code} appears twice${line.batchId ? " for the same batch" : ""}; enter it once.`);
    keys.add(key);
  }
  return out;
}

// Excess over what each material line may still issue, assigned to the note's lines in order (two lines of one material share its room).
export function excessOf(lines, materials) {
  const room = new Map(materials.map((material) => [material.id, lineFigures(material).toIssue]));
  return lines.map((line) => {
    const left = room.get(line.material.id) ?? ZERO;
    const within = min(left, line.baseQuantity);
    room.set(line.material.id, sub(left, within));
    return sub(line.baseQuantity, within);
  });
}
// Excess the company tolerates without an approval: up to its percent of the line's requirement.
export function toleratedExcess(material, settings) {
  return div(mul(lineFigures(material).required, settings.tolerancePct), 100n * 1_000_000n);
}

// What an approval binds to: the order, its source and every line's material, base quantity, unit, batch, serials and location. Takes the
// lines as resolved (camelCase, scaled quantities) or as stored rows (snake_case, numeric text) and hashes both the same way.
export function contentHash(issue, lines) {
  const base = (line) => (line.baseQuantity !== undefined ? q(line.baseQuantity) : q(D(line.base_quantity)));
  const body = JSON.stringify({
    order: issue.manufacturing_order_id, source: issue.source_warehouse_id, location: issue.source_location_id ?? null, production: issue.production_location_id ?? null,
    lines: lines.map((line) => [line.material_id ?? line.material?.id, base(line), line.uom_id ?? line.uomId, line.batch_id ?? line.batchId ?? null,
      [...(line.serial_ids ?? line.serialIds ?? [])].sort(), line.source_location_id ?? line.sourceLocationId ?? null]),
  });
  return createHash("sha256").update(body).digest("hex");
}

// Excess beyond the company's tolerance needs an approval bound to this content and this order's frozen recipe, for no more than it saw.
export function approvalState(issue, lines, excess, materials, settings, order) {
  const over = lines.map((line, index) => ({ line, excess: excess[index], tolerated: toleratedExcess(line.material, settings) }));
  const needing = over.filter((row) => row.excess > row.tolerated);
  if (!needing.length) return { required: false, valid: true, status: issue.approval_status, excess: over.filter((row) => row.excess > ZERO).map((row) => ({ code: row.line.material.item_code, excess: q(row.excess), withinTolerance: true })) };
  const bound = issue.approval_status === "APPROVED" && issue.approval_hash === issue.content_hash && (issue.approval_snapshot_id ?? null) === (order.bom_snapshot_id ?? null);
  const covered = bound && needing.every((row) => row.excess <= row.line.excessApproved);
  return {
    required: true, valid: covered, status: issue.approval_status,
    excess: needing.map((row) => ({ code: row.line.material.item_code, excess: q(row.excess), approved: q(row.line.excessApproved), withinTolerance: false })),
    message: covered ? null : issue.approval_status === "APPROVED"
      ? "The approval no longer matches: the note, the order's recipe or the remaining requirement changed since it was given. Ask again."
      : `Beyond what ${order.mo_number} may still issue: ${needing.map((row) => `${row.line.material.item_code} +${q(row.excess)} ${row.line.material.uom_code}`).join(", ")}. A manager must approve it.`,
  };
}

// ------------------------------------------------------------------ the stock plan
// The order's own active reservations of an item in the source warehouse, earliest expiry first, with whether the reserved balance is still
// usable (a reservation on stock since put on hold or expired is never issued).
export async function orderReservations(client, c, order, itemId, warehouseId) {
  return (await client.query(
    `SELECT reservation.id, reservation.warehouse_location_id, reservation.batch_id, reservation.serial_id, reservation.active_quantity, batch.batch_number, batch.expires_on,
            EXISTS (SELECT 1 FROM tenant.stock_balances balance
                      LEFT JOIN tenant.warehouse_locations location ON location.organization_id = balance.organization_id AND location.id = balance.warehouse_location_id
                      LEFT JOIN tenant.stock_batches batch ON batch.organization_id = balance.organization_id AND batch.id = balance.batch_id
                     WHERE balance.organization_id = reservation.organization_id AND balance.item_id = reservation.item_id AND balance.warehouse_id = reservation.warehouse_id
                       AND balance.warehouse_location_id IS NOT DISTINCT FROM reservation.warehouse_location_id AND balance.batch_id IS NOT DISTINCT FROM reservation.batch_id
                       AND balance.quantity > 0 AND ${USABLE_ROW}) AS usable
       FROM tenant.stock_reservations reservation LEFT JOIN tenant.stock_batches batch ON batch.organization_id = reservation.organization_id AND batch.id = reservation.batch_id
      WHERE reservation.organization_id = $1 AND reservation.reference_type = $2 AND reservation.reference_id = $3 AND reservation.item_id = $4 AND reservation.warehouse_id = $5
        AND reservation.status = 'active' AND reservation.active_quantity > 0
      ORDER BY batch.expires_on NULLS LAST, reservation.created_at`, [c.organizationId, SOURCE, order.id, itemId, warehouseId])).rows;
}

async function checkBatch(client, c, line, warehouseId) {
  const batch = (await client.query(`SELECT id, batch_number, expires_on, expires_on < current_date AS expired, status FROM tenant.stock_batches WHERE organization_id = $1 AND id = $2 AND item_id = $3`,
    [c.organizationId, line.batchId, line.material.component_item_id])).rows[0];
  if (!batch) throw issueError(400, "MFG_ISSUE_BATCH_INVALID", `${line.material.item_code}: that batch is not a batch of this item.`);
  if (batch.expired) throw issueError(409, "MFG_ISSUE_EXPIRED_STOCK", `${line.material.item_code}: batch ${batch.batch_number} expired on ${String(batch.expires_on).slice(0, 10)}.`);
  const usable = (await usableBalances(client, c, line.material.component_item_id, warehouseId)).some((row) => row.batch_id === batch.id);
  if (!usable) throw issueError(409, "MFG_ISSUE_BATCH_INVALID", `${line.material.item_code}: batch ${batch.batch_number} has no usable stock in the source warehouse (held, quarantined or none there).`);
  return batch;
}

// Serial units named for a line: each on hand in the source warehouse, at a usable location, and reserved for this order or for nobody.
async function planSerials(client, c, order, line, warehouseId, settings) {
  const rows = (await client.query(
    `SELECT serial.id, serial.serial_number, serial.status, serial.warehouse_id, serial.warehouse_location_id, COALESCE(location.disposition, 'available') AS disposition,
            reservation.id AS reservation_id, reservation.reference_type, reservation.reference_id
       FROM tenant.stock_serials serial LEFT JOIN tenant.warehouse_locations location ON location.id = serial.warehouse_location_id
       LEFT JOIN tenant.stock_reservations reservation ON reservation.organization_id = serial.organization_id AND reservation.serial_id = serial.id AND reservation.status = 'active'
      WHERE serial.organization_id = $1 AND serial.id = ANY($2::uuid[]) AND serial.item_id = $3`, [c.organizationId, line.serialIds, line.material.component_item_id])).rows;
  if (rows.length !== line.serialIds.length) throw issueError(400, "MFG_ISSUE_SERIAL_INVALID", `${line.material.item_code}: a serial number is not a unit of this item.`);
  const plan = [];
  for (const row of rows) {
    if (row.status !== "available" || row.warehouse_id !== warehouseId) throw issueError(409, "MFG_ISSUE_SERIAL_INVALID", `${line.material.item_code}: serial ${row.serial_number} is not on hand in the source warehouse.`);
    if (row.disposition !== "available") throw issueError(409, "MFG_ISSUE_SERIAL_INVALID", `${line.material.item_code}: serial ${row.serial_number} is held (${row.disposition.replace(/_/g, " ")}).`);
    const own = row.reservation_id && row.reference_type === SOURCE && row.reference_id === order.id;
    if (row.reservation_id && !own) throw issueError(409, "MFG_ISSUE_RESERVATION_CONFLICT", `${line.material.item_code}: serial ${row.serial_number} is reserved for another document.`);
    if (!own && !settings.unreservedAllowed) throw issueError(409, "MFG_ISSUE_STOCK_SHORTAGE", `${line.material.item_code}: serial ${row.serial_number} is not reserved for this order, and the company issues only reserved stock.`);
    plan.push({ source: own ? "RESERVATION" : "FREE", reservationId: own ? row.reservation_id : null, locationId: row.warehouse_location_id, batchId: null, serialId: row.id, serial: row.serial_number, quantity: 1_000_000n });
  }
  return plan;
}

// The stock each line takes, without moving anything: { lines: [{ plan, fromReservation, fromFree, short }], problems }. `strict` throws on
// the first problem (posting); otherwise problems are collected (preview). `used` carries what earlier lines of the same note already took.
export async function planStock(client, c, order, issue, lines, settings, { strict = true } = {}) {
  const warehouseId = issue.source_warehouse_id;
  const reservationLeft = new Map();
  const freeTaken = new Map();
  const problems = [];
  const planned = [];
  const fail = (error) => { if (strict) throw error; problems.push({ code: error.code, message: error.message }); };
  for (const line of lines) {
    const locationFilter = line.sourceLocationId ?? issue.source_location_id ?? null;
    const result = { plan: [], fromReservation: ZERO, fromFree: ZERO, short: ZERO };
    planned.push(result);
    try {
      if (line.material.tracking_type === "serial") {
        if (!line.serialIds?.length) { fail(issueError(400, "MFG_ISSUE_SERIAL_INVALID", `${line.material.item_code} is serial-tracked: choose the serial numbers to issue.`)); result.short = line.baseQuantity; continue; }
        result.plan = await planSerials(client, c, order, line, warehouseId, settings);
        for (const part of result.plan) result[part.source === "RESERVATION" ? "fromReservation" : "fromFree"] += part.quantity;
        continue;
      }
      if (line.batchId) await checkBatch(client, c, line, warehouseId);
      let left = line.baseQuantity;
      for (const reservation of await orderReservations(client, c, order, line.material.component_item_id, warehouseId)) {
        if (left <= ZERO) break;
        if (!reservation.usable || reservation.serial_id) continue;
        if (line.batchId && reservation.batch_id !== line.batchId) continue;
        if (locationFilter && reservation.warehouse_location_id !== locationFilter) continue;
        const have = reservationLeft.has(reservation.id) ? reservationLeft.get(reservation.id) : D(reservation.active_quantity);
        const take = min(have, left);
        if (take <= ZERO) continue;
        reservationLeft.set(reservation.id, sub(have, take));
        result.plan.push({ source: "RESERVATION", reservationId: reservation.id, locationId: reservation.warehouse_location_id, batchId: reservation.batch_id, batch: reservation.batch_number,
          expiresOn: reservation.expires_on, quantity: take, partial: take < D(reservation.active_quantity) || reservationLeft.get(reservation.id) > ZERO });
        result.fromReservation = add(result.fromReservation, take);
        left = sub(left, take);
      }
      if (left > ZERO && settings.unreservedAllowed) {
        for (const balance of await usableBalances(client, c, line.material.component_item_id, warehouseId)) {
          if (left <= ZERO) break;
          if (line.batchId && balance.batch_id !== line.batchId) continue;
          if (locationFilter && balance.warehouse_location_id !== locationFilter) continue;
          const key = `${line.material.component_item_id}:${balance.warehouse_location_id ?? ""}:${balance.batch_id ?? ""}`;
          const free = sub(sub(D(balance.quantity), D(balance.reserved_quantity)), freeTaken.get(key) ?? ZERO);
          if (free <= ZERO) continue;
          const take = min(free, left);
          freeTaken.set(key, add(freeTaken.get(key) ?? ZERO, take));
          result.plan.push({ source: "FREE", reservationId: null, locationId: balance.warehouse_location_id, batchId: balance.batch_id, batch: balance.batch_number, quantity: take });
          result.fromFree = add(result.fromFree, take);
          left = sub(left, take);
        }
      }
      if (left > ZERO) {
        result.short = left;
        const reservedElsewhere = await reservedForOthers(client, c, order, line.material.component_item_id, warehouseId);
        fail(issueError(409, reservedElsewhere > ZERO && !settings.unreservedAllowed ? "MFG_ISSUE_STOCK_SHORTAGE" : reservedElsewhere > ZERO ? "MFG_ISSUE_RESERVATION_CONFLICT" : "MFG_ISSUE_STOCK_SHORTAGE",
          `${line.material.item_code}: ${q(left)} ${line.material.uom_code} more is needed than ${settings.unreservedAllowed ? "this order's reservation and free usable stock" : "this order's reservation (the company issues only reserved stock)"} provide${line.batchId ? " in that batch" : ""}${locationFilter ? " at that location" : ""}`
          + `${reservedElsewhere > ZERO ? `; ${q(reservedElsewhere)} is reserved for other documents` : ""}.`));
      }
    } catch (error) {
      if (strict || !(error instanceof MoError)) throw error;
      problems.push({ code: error.code, message: error.message });
    }
  }
  return { lines: planned, problems };
}
async function reservedForOthers(client, c, order, itemId, warehouseId) {
  const row = (await client.query(`SELECT COALESCE(sum(active_quantity), 0) AS quantity FROM tenant.stock_reservations WHERE organization_id = $1 AND item_id = $2 AND warehouse_id = $3 AND status = 'active'
      AND NOT (reference_type = $4 AND reference_id = $5)`, [c.organizationId, itemId, warehouseId, SOURCE, order.id])).rows[0];
  return D(row.quantity);
}

// Draft lines as stored, in the shape resolveLines produces (to re-plan at preview and posting).
export function storedLines(rows, materials) {
  return rows.map((row) => ({ id: row.id, lineNumber: row.line_number, material: materials.find((material) => material.id === row.material_id), quantity: q(D(row.quantity)), uomId: row.uom_id,
    factor: D(row.conversion_factor), baseQuantity: D(row.base_quantity), batchId: row.batch_id, serialIds: row.serial_ids?.length ? row.serial_ids : null, sourceLocationId: row.source_location_id,
    notes: row.notes, excessApproved: D(row.excess_quantity) }));
}

export { D, MO, SOURCE, STATUS_LABEL, ZERO, add, has, lineFigures, loadMaterials, max, min, q, sub, text, uuid };
