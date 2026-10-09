// Quarantine / Quality-Held Stock: the Quality Hold case — the one Inventory workflow that restricts owned stock until an authorised quality
// decision. Quality hold and quarantine are dispositions: placing stock on hold moves it (Disposition Out / In, one posting) into a location of
// the warehouse whose disposition is quality hold or quarantined, so on hand never changes and Available does. Never a quantity edit.
//
//   Draft            what to hold (lines: item, quantity, where from, batch / serial numbers, where to); no stock effect. Cancelled while a draft.
//   Active           placed: the stock moved into hold, each exact position kept as an allocation. Reservations that relied on the stock are
//                    reallocated to other eligible stock, or released (the source then shows the shortage) — a quality restriction is never
//                    refused to protect a sales promise.
//   Partly resolved  part released to available, escalated to quarantine, moved to damaged — or taken by another document (a purchase return,
//                    a disposal goods issue: quality-hold-control.js records it). Resolved when nothing is left held.
// Goods receipts and sales returns that put stock on hold open an active case for it (no second movement). A case belongs to the company:
// held stock transferred to another warehouse keeps its case. Holding or releasing never changes value, AP, GST or COGS.
import { STOCK_HOLD_PERMISSIONS as P } from "@vercentlabs/permissions";

import { beginIdempotentOperation, completeIdempotentOperation } from "../../core/idempotency.js";
import { lockInventoryItem } from "../../core/inventory-lock.js";
import { archiveFile, listFiles, prepareFileUpload, readFileContent, storeFile } from "../../core/platform/files/index.js";
import { nextDocumentNumber } from "../../core/platform/numbering/index.js";
import { normalizeQuantityToBase } from "../products/uom.js";
import { visibleWarehouseIds } from "./balances.js";
import { StockError } from "./errors.js";
import { moveStockWithinWarehouse, releaseStockReservation, reserveStock } from "./index.js";
import { dispositionAt, openMovementGroup } from "./ledger-posting.js";
import { withActiveBatch } from "./positions.js";
import { heldByCases, holdEvent, recordResolution, refreshHoldStatus } from "./quality-hold-control.js";
import { ledgerLocation, validateWarehouseOperation } from "./warehouses.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EPS = 1e-9;
const round = (value) => Math.round(Number(value) * 1e6) / 1e6;
const privileged = (c) => Boolean(c.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug)));
const can = (c, permission) => privileged(c) || Boolean(c.permissions?.includes(permission));
export class HoldError extends Error {
  constructor(status, message, code = "HOLD_ERROR", details = undefined) {
    super(message);
    this.name = "HoldError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
const need = (c, permission, message) => { if (!can(c, permission)) throw new HoldError(403, message, "PERMISSION_DENIED"); };
const fail = (message, code = "HOLD_INVALID", status = 400, details = undefined) => { throw new HoldError(status, message, code, details); };
const text = (value, max = 1000) => { const out = String(value ?? "").trim(); return out ? out.slice(0, max) : null; };
const uuidOr = (value) => (value && UUID.test(String(value)) ? String(value) : null);
const stockContext = (c) => ({ ...c, permissions: [...new Set([...(c.permissions ?? []), "stock.issue", "stock.receive", "stock.reserve", "stock.view"])] });
const FILE_ENTITY = "stock.inventory_stock_hold";
const FILE_TYPES = Object.freeze({ pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", txt: "text/plain", csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });

export const HOLD_TYPES = Object.freeze([{ id: "quality_hold", label: "Quality Hold", disposition: "quality_hold" }, { id: "quarantine", label: "Quarantine", disposition: "quarantined" }]);
export const HOLD_STATUSES = Object.freeze([{ id: "draft", label: "Draft" }, { id: "active", label: "Active" }, { id: "partially_resolved", label: "Partially resolved" },
  { id: "resolved", label: "Resolved" }, { id: "cancelled", label: "Cancelled" }]);
export const INSPECTION_RESULTS = Object.freeze([{ id: "pass", label: "Pass" }, { id: "fail", label: "Fail" }, { id: "partial_pass", label: "Partial pass" }, { id: "escalate", label: "Escalate" }]);
const DISPOSITION_LABEL = { available: "Available", quality_hold: "Quality hold", quarantined: "Quarantined", damaged: "Damaged" };
const DISPOSITION_OF = { quality_hold: "quality_hold", quarantine: "quarantined" };
const ACTION_LABEL = { placed: "Placed on hold", released: "Released", escalated: "Escalated to quarantine", damaged: "Moved to damaged", purchase_return: "Returned to the supplier",
  disposed: "Disposed of", transferred: "Moved with the stock", adjusted: "Adjusted out", issued: "Issued" };
const DEFAULT_REASONS = [
  ["RECEIVING_INSPECTION", "Receiving inspection", "quality_hold", false, 3], ["QUALITY_CONCERN", "Quality concern", "quality_hold", false, 3],
  ["DAMAGE_SUSPECTED", "Damage suspected", "quality_hold", false, 3], ["CUSTOMER_RETURN_INSPECTION", "Customer return inspection", "quality_hold", false, 3],
  ["EXPIRY_REVIEW", "Expiry review", "quality_hold", false, 7], ["RECALL_OR_COMPLIANCE", "Recall or compliance", "quarantine", false, null],
  ["DOCUMENTATION_PENDING", "Documentation pending", "quality_hold", false, 7], ["OTHER", "Other", "quality_hold", true, null],
];

// ------------------------------------------------------------------ reasons

async function ensureReasons(client, c) {
  const exists = (await client.query(`SELECT 1 FROM tenant.inventory_hold_reasons WHERE organization_id = $1 LIMIT 1`, [c.organizationId])).rows[0];
  if (exists) return;
  for (const [code, name, type, notes, days] of DEFAULT_REASONS)
    await client.query(`INSERT INTO tenant.inventory_hold_reasons (organization_id, code, name, default_hold_type, requires_notes, default_review_days, system) VALUES ($1,$2,$3,$4,$5,$6,true)
      ON CONFLICT (organization_id, code) DO NOTHING`, [c.organizationId, code, name, type, notes, days]);
}
const toReason = (row) => ({ id: row.id, code: row.code, name: row.name, defaultHoldType: row.default_hold_type, requiresNotes: row.requires_notes,
  defaultReviewDays: row.default_review_days, status: row.status, system: row.system, version: row.version });

export async function listHoldReasons(client, c, { includeInactive = false } = {}) {
  need(c, P.view, "You do not have permission to view quality holds.");
  await ensureReasons(client, c);
  const { rows } = await client.query(`SELECT * FROM tenant.inventory_hold_reasons WHERE organization_id = $1 ${includeInactive ? "" : "AND status = 'active'"} ORDER BY system DESC, name`, [c.organizationId]);
  return rows.map(toReason);
}

export async function createHoldReason(client, c, input = {}) {
  need(c, P.manageReasons, "You do not have permission to manage hold reasons.");
  const code = text(input.code, 40)?.toUpperCase().replace(/[^A-Z0-9_]+/g, "_");
  const name = text(input.name, 120);
  if (!code || !name) fail("Give the reason a code and a name.", "HOLD_REASON_INVALID");
  const type = HOLD_TYPES.some((entry) => entry.id === input.defaultHoldType) ? input.defaultHoldType : "quality_hold";
  const days = input.defaultReviewDays === undefined || input.defaultReviewDays === null || input.defaultReviewDays === "" ? null : Number(input.defaultReviewDays);
  if (days !== null && (!Number.isInteger(days) || days < 0 || days > 365)) fail("Review days are a whole number of days (0–365).", "HOLD_REASON_INVALID");
  const row = (await client.query(`INSERT INTO tenant.inventory_hold_reasons (organization_id, code, name, default_hold_type, requires_notes, default_review_days) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (organization_id, code) DO NOTHING RETURNING *`, [c.organizationId, code, name, type, Boolean(input.requiresNotes), days])).rows[0];
  if (!row) fail(`A reason with the code ${code} exists.`, "HOLD_REASON_DUPLICATE", 409);
  return toReason(row);
}

// A reason in use is deactivated, never deleted.
export async function updateHoldReason(client, c, reasonId, input = {}) {
  need(c, P.manageReasons, "You do not have permission to manage hold reasons.");
  const row = (await client.query(`SELECT * FROM tenant.inventory_hold_reasons WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuidOr(reasonId)])).rows[0];
  if (!row) fail("Hold reason not found.", "HOLD_REASON_NOT_FOUND", 404);
  if (input.expectedVersion !== undefined && Number(input.expectedVersion) !== row.version) fail("The reason changed meanwhile. Reload.", "HOLD_REASON_VERSION_CONFLICT", 409);
  const status = input.status === undefined ? row.status : input.status === "inactive" ? "inactive" : "active";
  const updated = (await client.query(
    `UPDATE tenant.inventory_hold_reasons SET name = $3, default_hold_type = $4, requires_notes = $5, default_review_days = $6, status = $7, version = version + 1, updated_at = now()
      WHERE organization_id = $1 AND id = $2 RETURNING *`,
    [c.organizationId, row.id, text(input.name, 120) ?? row.name, HOLD_TYPES.some((entry) => entry.id === input.defaultHoldType) ? input.defaultHoldType : row.default_hold_type,
      input.requiresNotes === undefined ? row.requires_notes : Boolean(input.requiresNotes),
      input.defaultReviewDays === undefined ? row.default_review_days : input.defaultReviewDays === null || input.defaultReviewDays === "" ? null : Number(input.defaultReviewDays), status])).rows[0];
  return toReason(updated);
}

// ------------------------------------------------------------------ where held stock goes

// The warehouse location that holds stock of a disposition: the one chosen (it must hold that disposition), else the warehouse's own
// (QH, QUARANTINE, DAMAGED — created the first time, never allocated).
async function dispositionLocation(client, c, warehouseId, disposition, chosen = null) {
  if (chosen) {
    const id = await ledgerLocation(client, c.organizationId, warehouseId, chosen, { label: "Target location" });
    if ((await dispositionAt(client, c.organizationId, id)) !== disposition)
      fail(`The target location must hold ${DISPOSITION_LABEL[disposition].toLowerCase()} stock.`, "HOLD_TARGET_LOCATION_INVALID");
    return id;
  }
  const existing = (await client.query(
    `SELECT id FROM tenant.warehouse_locations WHERE organization_id = $1 AND warehouse_id = $2 AND status = 'active' AND allow_stock AND disposition = $3 ORDER BY code = $4 DESC, code LIMIT 1`,
    [c.organizationId, warehouseId, disposition, { quality_hold: "QH", quarantined: "QUARANTINE", damaged: "DAMAGED" }[disposition]])).rows[0];
  if (existing) return existing.id;
  const code = { quality_hold: "QH", quarantined: "QUARANTINE", damaged: "DAMAGED" }[disposition];
  const taken = (await client.query(`SELECT 1 FROM tenant.warehouse_locations WHERE organization_id = $1 AND warehouse_id = $2 AND code = $3`, [c.organizationId, warehouseId, code])).rows[0];
  return (await client.query(
    `INSERT INTO tenant.warehouse_locations (organization_id, warehouse_id, name, code, location_type, purpose, disposition, allow_allocation, status, created_by, updated_by)
     VALUES ($1, $2, $3, $4, 'quality', 'quality_hold', $5, false, 'active', $6, $6) RETURNING id`,
    [c.organizationId, warehouseId, `${DISPOSITION_LABEL[disposition]} zone`, taken ? `${code}-ZONE` : code, disposition, c.userId ?? null])).rows[0].id;
}

// ------------------------------------------------------------------ drafts

async function loadHold(client, c, holdId, { lock = false } = {}) {
  if (!UUID.test(String(holdId ?? ""))) fail("Quality hold not found.", "HOLD_NOT_FOUND", 404);
  const row = (await client.query(`SELECT * FROM tenant.inventory_stock_holds WHERE organization_id = $1 AND id = $2 ${lock ? "FOR UPDATE" : ""}`, [c.organizationId, holdId])).rows[0];
  if (!row) fail("Quality hold not found.", "HOLD_NOT_FOUND", 404);
  const visible = await visibleWarehouseIds(client, c);
  if (visible && !visible.includes(row.origin_warehouse_id)) fail("Quality hold not found.", "HOLD_NOT_FOUND", 404);
  return row;
}
async function linesOf(client, c, holdId) {
  return (await client.query(
    `SELECT line.*, item.tracking_type, item.code AS sku, uom.code AS uom_code, base.code AS base_uom_code, source.code AS source_location_code, target.code AS target_location_code,
            batch.batch_number
       FROM tenant.inventory_stock_hold_lines line
       JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
       LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = line.organization_id AND uom.id = line.uom_id
       LEFT JOIN tenant.units_of_measure base ON base.organization_id = item.organization_id AND base.id = item.uom_id
       LEFT JOIN tenant.warehouse_locations source ON source.organization_id = line.organization_id AND source.id = line.source_location_id
       LEFT JOIN tenant.warehouse_locations target ON target.organization_id = line.organization_id AND target.id = line.target_location_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id = line.organization_id AND batch.id = line.batch_id
      WHERE line.organization_id = $1 AND line.hold_id = $2 ORDER BY line.line_number`, [c.organizationId, holdId])).rows;
}

// input: { holdType, reasonId, warehouseId, assignedUserId?, reviewDueOn?, notes?, lines: [{ itemId, quantity, uomId?, sourceLocationId?, batchId?,
// serialIds?, targetLocationId?, notes? }] }
async function readHeader(client, c, input, previous = null) {
  const holdType = input.holdType ?? previous?.hold_type ?? "quality_hold";
  if (!HOLD_TYPES.some((entry) => entry.id === holdType)) fail("Choose Quality Hold or Quarantine.", "HOLD_TYPE_INVALID");
  await ensureReasons(client, c);
  const reasonId = uuidOr(input.reasonId ?? previous?.reason_id);
  const reason = reasonId ? (await client.query(`SELECT * FROM tenant.inventory_hold_reasons WHERE organization_id = $1 AND id = $2 AND status = 'active'`, [c.organizationId, reasonId])).rows[0] : null;
  if (!reason) fail("Choose the reason for the hold.", "HOLD_REASON_REQUIRED");
  const notes = input.notes === undefined ? previous?.notes ?? null : text(input.notes, 4000);
  if (reason.requires_notes && (!notes || notes.length < 5)) fail(`${reason.name} needs notes explaining the hold.`, "HOLD_NOTES_REQUIRED");
  const warehouseId = uuidOr(input.warehouseId ?? previous?.origin_warehouse_id);
  if (!warehouseId) fail("Choose the warehouse.", "HOLD_WAREHOUSE_REQUIRED");
  await validateWarehouseOperation(client, c, warehouseId, null, { label: "Warehouse" });
  const reviewDueOn = input.reviewDueOn === undefined ? previous?.review_due_on ?? (reason.default_review_days === null ? null : (await client.query(`SELECT (current_date + $1::int)::text AS d`, [reason.default_review_days])).rows[0].d)
    : input.reviewDueOn ? String(input.reviewDueOn).slice(0, 10) : null;
  if (reviewDueOn && !DATE.test(String(reviewDueOn).slice(0, 10))) fail("The review due date is not a valid date.", "HOLD_REVIEW_DATE_INVALID");
  const assignedUserId = input.assignedUserId === undefined ? previous?.assigned_user_id ?? null : uuidOr(input.assignedUserId);
  return { holdType, reason, notes, warehouseId, reviewDueOn: reviewDueOn ? String(reviewDueOn).slice(0, 10) : null, assignedUserId };
}

async function readLines(client, c, header, lines) {
  if (!Array.isArray(lines) || !lines.length) fail("Add the stock to hold.", "HOLD_LINES_REQUIRED");
  const out = [];
  for (const [index, raw] of lines.entries()) {
    const label = `Line ${index + 1}`;
    const item = (await client.query(`SELECT id, code, name, uom_id, tracking_type, track_inventory FROM tenant.items WHERE organization_id = $1 AND id = $2`, [c.organizationId, uuidOr(raw.itemId)])).rows[0];
    if (!item || !item.track_inventory) fail(`${label}: choose a stock item.`, "HOLD_ITEM_INVALID");
    const serialIds = [...new Set((raw.serialIds ?? []).filter((id) => UUID.test(String(id))))];
    if (item.tracking_type === "serial" && !serialIds.length) fail(`${label}: choose the serial numbers to hold (a serial number is held whole).`, "HOLD_SERIALS_REQUIRED");
    if (item.tracking_type === "batch" && !uuidOr(raw.batchId)) fail(`${label}: choose the batch to hold.`, "HOLD_BATCH_REQUIRED");
    let baseQuantity;
    let quantity;
    let factor = "1";
    let uomId = item.uom_id;
    if (item.tracking_type === "serial") { baseQuantity = serialIds.length; quantity = serialIds.length; }
    else {
      const unit = await normalizeQuantityToBase(client, c.organizationId, item.id, raw.uomId || item.uom_id, String(raw.quantity ?? ""), { purpose: "inventory" });
      if (!unit.ok) fail(`${label}: ${unit.message}`, unit.code ?? "HOLD_QUANTITY_INVALID");
      baseQuantity = Number(String(unit.baseQuantity !== undefined ? formatScaled(unit.baseQuantity) : raw.quantity));
      quantity = Number(raw.quantity);
      factor = unit.factor !== undefined ? formatScaled(unit.factor) : "1";
      uomId = raw.uomId || item.uom_id;
      if (!(baseQuantity > 0)) fail(`${label}: enter a quantity greater than zero.`, "HOLD_QUANTITY_INVALID");
    }
    const sourceLocationId = await ledgerLocation(client, c.organizationId, header.warehouseId, uuidOr(raw.sourceLocationId), { label: `${label}: From location` });
    const sourceDisposition = await dispositionAt(client, c.organizationId, sourceLocationId);
    const holdDisposition = DISPOSITION_OF[header.holdType];
    if (sourceDisposition === "damaged") fail(`${label}: damaged stock is disposed of or returned, not put on hold.`, "HOLD_SOURCE_DISPOSITION_INVALID");
    if (sourceDisposition === holdDisposition) fail(`${label}: that stock is already ${DISPOSITION_LABEL[holdDisposition].toLowerCase()}.`, "HOLD_SOURCE_DISPOSITION_INVALID");
    if (sourceDisposition === "quarantined") fail(`${label}: quarantined stock is released or moved through its own hold.`, "HOLD_SOURCE_DISPOSITION_INVALID");
    const targetLocationId = raw.targetLocationId ? await dispositionLocation(client, c, header.warehouseId, holdDisposition, uuidOr(raw.targetLocationId)) : null;
    out.push({ item, serialIds, batchId: uuidOr(raw.batchId), quantity, baseQuantity: round(baseQuantity), factor, uomId, sourceLocationId, targetLocationId, sourceDisposition,
      holdDisposition, notes: text(raw.notes, 1000) });
  }
  return out;
}
const formatScaled = (value) => {
  if (typeof value !== "bigint") return String(value);
  const negative = value < 0n;
  const unsigned = negative ? -value : value;
  return `${negative ? "-" : ""}${unsigned / 1000000n}.${String(unsigned % 1000000n).padStart(6, "0")}`;
};

async function writeLines(client, c, holdId, lines) {
  await client.query(`DELETE FROM tenant.inventory_stock_hold_lines WHERE organization_id = $1 AND hold_id = $2`, [c.organizationId, holdId]);
  for (const [index, line] of lines.entries())
    await client.query(
      `INSERT INTO tenant.inventory_stock_hold_lines (organization_id, hold_id, line_number, item_id, sku_snapshot, item_name_snapshot, warehouse_id, source_location_id, target_location_id,
         batch_id, serial_ids, uom_id, conversion_factor, transaction_quantity, original_base_quantity, unresolved_base_quantity, source_disposition, hold_disposition, notes)
       SELECT $1,$2,$3,$4,$5,$6,hold.origin_warehouse_id,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15,$16,$17 FROM tenant.inventory_stock_holds hold WHERE hold.organization_id = $1 AND hold.id = $2`,
      [c.organizationId, holdId, index + 1, line.item.id, line.item.code, line.item.name, line.sourceLocationId, line.targetLocationId, line.batchId, line.serialIds, line.uomId, line.factor,
        line.quantity, line.baseQuantity, line.sourceDisposition, line.holdDisposition, line.notes]);
}

export async function createStockHold(client, c, input = {}) {
  need(c, P.create, "You do not have permission to create quality holds.");
  const header = await readHeader(client, c, input);
  const lines = await readLines(client, c, header, input.lines);
  const number = await nextDocumentNumber(client, c, { documentType: "inventory_stock_hold", prefix: "QH" });
  const hold = (await client.query(
    `INSERT INTO tenant.inventory_stock_holds (organization_id, document_number, hold_type, reason_id, origin_warehouse_id, assigned_user_id, review_due_on, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [c.organizationId, number, header.holdType, header.reason.id, header.warehouseId, header.assignedUserId, header.reviewDueOn, header.notes, c.userId ?? null])).rows[0];
  await writeLines(client, c, hold.id, lines);
  await holdEvent(client, c, hold.id, "created", `Hold created: ${lines.length} line${lines.length === 1 ? "" : "s"} (${header.reason.name})`);
  return getStockHold(client, c, hold.id);
}

export async function updateDraftStockHold(client, c, holdId, input = {}) {
  need(c, P.editDraft, "You do not have permission to change draft quality holds.");
  const row = await loadHold(client, c, holdId, { lock: true });
  if (row.status !== "draft") fail("Only a draft is changed. A placed hold is released, escalated or resolved.", "HOLD_NOT_DRAFT", 409);
  if (input.expectedVersion !== undefined && Number(input.expectedVersion) !== row.version) fail("The hold changed meanwhile. Reload.", "HOLD_VERSION_CONFLICT", 409);
  const header = await readHeader(client, c, input, row);
  await client.query(`UPDATE tenant.inventory_stock_holds SET hold_type = $3, reason_id = $4, origin_warehouse_id = $5, assigned_user_id = $6, review_due_on = $7, notes = $8, version = version + 1,
      updated_at = now() WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, header.holdType, header.reason.id, header.warehouseId, header.assignedUserId, header.reviewDueOn, header.notes]);
  if (input.lines !== undefined) await writeLines(client, c, row.id, await readLines(client, c, header, input.lines));
  if (header.reason.id !== row.reason_id) await holdEvent(client, c, row.id, "reason_changed", `Reason changed to ${header.reason.name}`);
  await holdEvent(client, c, row.id, "updated", "Draft changed");
  return getStockHold(client, c, row.id);
}

export async function cancelStockHold(client, c, holdId, input = {}) {
  need(c, P.editDraft, "You do not have permission to cancel draft quality holds.");
  const row = await loadHold(client, c, holdId, { lock: true });
  if (row.status === "cancelled") return getStockHold(client, c, row.id);
  if (row.status !== "draft") fail("A placed hold is never cancelled: release or resolve the stock.", "HOLD_NOT_DRAFT", 409);
  await client.query(`UPDATE tenant.inventory_stock_holds SET status = 'cancelled', cancelled_by = $3, cancelled_at = now(), cancel_reason = $4, version = version + 1, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, c.userId ?? null, text(input.reason, 500)]);
  await holdEvent(client, c, row.id, "cancelled", `Draft cancelled${text(input.reason, 200) ? `: ${text(input.reason, 200)}` : ""}`);
  return getStockHold(client, c, row.id);
}

// ------------------------------------------------------------------ validation and placing

// What placing the hold would do, line by line, against stock as it is now: the stock there, what other holds already hold, the reservations
// that rely on it (released or reallocated when the hold is placed). errors block placing.
async function assess(client, c, row, lines) {
  const errors = [];
  const conflicts = [];
  const add = (message, code, details) => errors.push({ message, code, ...(details ? { details } : {}) });
  if (row.status !== "draft") add(`The hold is ${row.status}.`, "HOLD_NOT_DRAFT");
  const placePermission = row.hold_type === "quarantine" ? P.placeQuarantine : P.place;
  if (!can(c, placePermission)) add(row.hold_type === "quarantine" ? "You do not have permission to place stock in quarantine." : "You do not have permission to place stock on quality hold.", "PERMISSION_DENIED");
  for (const line of lines) {
    const label = `Line ${line.line_number} (${line.sku})`;
    if (line.tracking_type === "batch" && !can(c, P.batch)) add(`${label}: you do not have permission to hold batch stock.`, "PERMISSION_DENIED");
    if (line.tracking_type === "serial" && !can(c, P.serial)) add(`${label}: you do not have permission to hold serial-numbered stock.`, "PERMISSION_DENIED");
    const position = (await client.query(
      `SELECT COALESCE(sum(quantity), 0) AS quantity, COALESCE(sum(reserved_quantity), 0) AS reserved FROM tenant.stock_balances WHERE organization_id = $1 AND item_id = $2 AND warehouse_id = $3
          AND warehouse_location_id IS NOT DISTINCT FROM $4 AND batch_id IS NOT DISTINCT FROM $5`,
      [c.organizationId, line.item_id, line.warehouse_id, line.source_location_id, line.batch_id])).rows[0];
    const where = `${line.source_location_code ?? "MAIN"}${line.batch_number ? ` / batch ${line.batch_number}` : ""}`;
    const onHand = Number(position.quantity);
    const alreadyHeld = await heldByCases(client, c.organizationId, { itemId: line.item_id, warehouseId: line.warehouse_id, locationId: line.source_location_id, batchId: line.batch_id });
    const need_ = Number(line.original_base_quantity);
    if (onHand - alreadyHeld + EPS < need_)
      add(`${label}: only ${round(Math.max(onHand - alreadyHeld, 0))} ${line.base_uom_code ?? ""} can be held at ${where}${alreadyHeld ? ` (${round(alreadyHeld)} already on another hold)` : ""}; ${need_} was asked.`.replace("  ", " "),
        "HOLD_EXCEEDS_STOCK", { onHand, alreadyHeld, requested: need_ });
    if (line.tracking_type === "serial") {
      const serials = (await client.query(`SELECT id, serial_number, status, warehouse_id, warehouse_location_id FROM tenant.stock_serials WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
        [c.organizationId, line.serial_ids])).rows;
      for (const serial of serials)
        if (serial.status !== "available" || serial.warehouse_id !== line.warehouse_id || (serial.warehouse_location_id ?? null) !== (line.source_location_id ?? null))
          add(`${label}: serial ${serial.serial_number} is not in stock at ${where}.`, "HOLD_SERIAL_NOT_IN_STOCK");
      if (serials.length !== line.serial_ids.length) add(`${label}: a serial number was not found.`, "HOLD_SERIAL_NOT_IN_STOCK");
    }
    // Reservations that rely on this stock: what is not reserved can be held as it is; beyond that, reservations give way.
    const reserved = Number(position.reserved);
    const free = onHand - reserved;
    const serialReserved = line.tracking_type === "serial" ? (await client.query(
      `SELECT reservation.id, reservation.reservation_number, reservation.active_quantity, reservation.reference_type, reservation.serial_id FROM tenant.stock_reservations reservation
        WHERE reservation.organization_id = $1 AND reservation.serial_id = ANY($2::uuid[]) AND reservation.status = 'active'`, [c.organizationId, line.serial_ids])).rows : [];
    const shortfall = round(Math.max(need_ - free, 0));
    if (line.source_disposition === "available" && (shortfall > EPS || serialReserved.length)) {
      const affected = serialReserved.length ? serialReserved : (await client.query(
        `SELECT id, reservation_number, active_quantity, reference_type, serial_id FROM tenant.stock_reservations WHERE organization_id = $1 AND item_id = $2 AND warehouse_id = $3
            AND warehouse_location_id IS NOT DISTINCT FROM $4 AND batch_id IS NOT DISTINCT FROM $5 AND status = 'active' ORDER BY created_at DESC`,
        [c.organizationId, line.item_id, line.warehouse_id, line.source_location_id, line.batch_id])).rows;
      conflicts.push({ lineId: line.id, lineNumber: line.line_number, sku: line.sku, shortfall: serialReserved.length ? serialReserved.length : shortfall,
        reservations: affected.map((entry) => ({ id: entry.id, number: entry.reservation_number, quantity: round(entry.active_quantity), source: entry.reference_type, serialId: entry.serial_id })) });
      if (!can(c, P.resolveReservations))
        add(`${label}: ${serialReserved.length ? "a serial number is reserved" : `${shortfall} of it is reserved`} (${affected.map((entry) => entry.reservation_number).join(", ")}). Someone allowed to resolve reservation conflicts must place this hold.`,
          "HOLD_RESERVATION_CONFLICT");
    }
  }
  return { ready: errors.length === 0, errors, reservationConflicts: conflicts };
}

export async function validateStockHold(client, c, holdId) {
  need(c, P.view, "You do not have permission to view quality holds.");
  const row = await loadHold(client, c, holdId);
  return assess(client, c, row, await linesOf(client, c, row.id));
}

// Placing a hold: under the hold's and the items' locks, checked again, every reservation conflict resolved (released, then re-reserved on
// other eligible stock where there is some), the stock moved into hold (one posting), its exact positions recorded. All or nothing.
export async function placeStockOnHold(client, c, holdId, input = {}) {
  const row = await loadHold(client, c, holdId, { lock: true });
  if (["active", "partially_resolved", "resolved"].includes(row.status)) return { ...(await getStockHold(client, c, row.id)), replayed: true };
  const lines = await linesOf(client, c, row.id);
  for (const itemId of [...new Set(lines.map((line) => line.item_id))].sort()) await lockInventoryItem(client, c, itemId);
  const check = await assess(client, c, row, lines);
  if (!check.ready) {
    const code = check.errors.every((entry) => entry.code === check.errors[0].code) ? check.errors[0].code : "HOLD_NOT_READY";
    throw new HoldError(code === "PERMISSION_DENIED" ? 403 : 409, check.errors[0].message, code, { errors: check.errors, reservationConflicts: check.reservationConflicts });
  }
  const stock = stockContext(c);
  const group = await openMovementGroup(client, c, { sourceType: "inventory_stock_hold", sourceId: row.id, sourceNumber: row.document_number, operation: "disposition_move",
    postingKey: `inventory_stock_hold:${row.id}:place` });
  const reason = (await client.query(`SELECT name FROM tenant.inventory_hold_reasons WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.reason_id])).rows[0]?.name;
  for (const line of lines) {
    const conflict = check.reservationConflicts.find((entry) => entry.lineId === line.id);
    const released = conflict ? await giveWay(client, c, row, line, conflict) : [];
    const target = await dispositionLocation(client, c, line.warehouse_id, line.hold_disposition, line.target_location_id);
    // An expired or blocked batch is held as it is: activated for the move only, its status restored straight after.
    const moved = await withActiveBatch(client, c, line.batch_id, () => moveStockWithinWarehouse(client, stock, { itemId: line.item_id, warehouseId: line.warehouse_id, fromLocationId: line.source_location_id, toLocationId: target,
      batchId: line.batch_id, serialIds: line.serial_ids.length ? line.serial_ids : undefined, quantity: String(line.original_base_quantity), referenceType: "inventory_stock_hold", referenceId: row.id,
      reason: `${row.document_number} · ${reason ?? "quality hold"}`, idempotencyKey: `qh:${row.id}:place:${line.id}`, holdOperation: true, groupId: group.id }));
    const inLegs = moved.movements.filter((movement) => Number(movement.quantity) > 0);
    const units = line.serial_ids.length ? line.serial_ids.map((serialId) => ({ serialId, quantity: 1, movement: inLegs.find((movement) => movement.serial_id === serialId) }))
      : [{ serialId: null, quantity: Number(line.original_base_quantity), movement: inLegs[0] }];
    for (const unit of units) {
      const allocation = (await client.query(
        `INSERT INTO tenant.inventory_stock_hold_allocations (organization_id, hold_id, line_id, item_id, warehouse_id, location_id, batch_id, serial_id, held_base_quantity, current_disposition)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [c.organizationId, row.id, line.id, line.item_id, line.warehouse_id, target, line.batch_id, unit.serialId, unit.quantity, line.hold_disposition])).rows[0];
      await recordResolution(client, c, { holdId: row.id, lineId: line.id, allocationId: allocation.id, action: "placed", quantity: unit.quantity, fromDisposition: line.source_disposition,
        toDisposition: line.hold_disposition, fromLocationId: line.source_location_id, toLocationId: target, movementId: unit.movement?.id ?? null, documentType: "inventory_stock_hold",
        documentId: row.id, documentNumber: row.document_number });
    }
    // What was released for the hold is reserved again from other eligible stock where there is some.
    for (const entry of released) await reReserve(client, c, row, entry);
  }
  await client.query(`UPDATE tenant.inventory_stock_holds SET status = 'active', activated_by = $3, activated_at = now(), movement_group_id = $4, version = version + 1, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, c.userId ?? null, group.id]);
  const total = lines.reduce((sum, line) => sum + Number(line.original_base_quantity), 0);
  await holdEvent(client, c, row.id, "activated", `Placed on ${row.hold_type === "quarantine" ? "quarantine" : "quality hold"}: ${round(total)} across ${lines.length} line${lines.length === 1 ? "" : "s"}`,
    { groupId: group.id, notes: text(input.notes, 500) });
  return { ...(await getStockHold(client, c, row.id)), replayed: false };
}

// Releases what the hold needs from the reservations on a line's stock (a reserved serial number: that serial's reservation); returns what was
// released, to be reserved again elsewhere.
async function giveWay(client, c, row, line, conflict) {
  const ctx = stockContext(c);
  let left = conflict.shortfall;
  const released = [];
  for (const reservation of conflict.reservations) {
    if (left <= EPS) break;
    const amount = round(Math.min(left, reservation.quantity));
    const full = (await client.query(`SELECT * FROM tenant.stock_reservations WHERE organization_id = $1 AND id = $2`, [c.organizationId, reservation.id])).rows[0];
    await releaseStockReservation(client, ctx, reservation.id, { status: "released", quantity: amount, reasonCode: "quality_hold", reason: `${row.document_number}: stock placed on hold` });
    released.push({ reservation: full, quantity: amount, lineId: line.id });
    left = round(left - amount);
    await holdEvent(client, c, row.id, "reservation_released", `Reservation ${reservation.number} gave up ${amount} to the hold`, { reservationId: reservation.id, quantity: amount });
  }
  return released;
}

async function reReserve(client, c, row, { reservation, quantity }) {
  const ctx = stockContext(c);
  await client.query("SAVEPOINT hold_rereserve");
  try {
    let serialId = null;
    if (reservation.serial_id) {
      serialId = (await client.query(
        `SELECT serial.id FROM tenant.stock_serials serial JOIN tenant.stock_balances balance ON balance.organization_id = serial.organization_id AND balance.item_id = serial.item_id
             AND balance.warehouse_id = serial.warehouse_id AND balance.warehouse_location_id IS NOT DISTINCT FROM serial.warehouse_location_id AND balance.batch_id IS NOT DISTINCT FROM serial.batch_id
           LEFT JOIN tenant.warehouse_locations location ON location.organization_id = serial.organization_id AND location.id = serial.warehouse_location_id
          WHERE serial.organization_id = $1 AND serial.item_id = $2 AND serial.warehouse_id = $3 AND serial.status = 'available' AND COALESCE(location.disposition, 'available') = 'available'
            AND NOT EXISTS (SELECT 1 FROM tenant.stock_reservations held WHERE held.organization_id = serial.organization_id AND held.serial_id = serial.id AND held.status = 'active')
          ORDER BY serial.serial_number LIMIT 1`, [c.organizationId, reservation.item_id, reservation.warehouse_id])).rows[0]?.id ?? null;
      if (!serialId) throw new StockError(409, "No other serial number to reserve.", "STOCK_RESERVATION_INSUFFICIENT");
    }
    const parent = reservation.inventory_reservation_id
      ? (await client.query(`SELECT source_line_id FROM tenant.inventory_reservations WHERE organization_id = $1 AND id = $2`, [c.organizationId, reservation.inventory_reservation_id])).rows[0] : null;
    const created = await reserveStock(client, ctx, { itemId: reservation.item_id, warehouseId: reservation.warehouse_id, serialId, quantity: serialId ? 1 : quantity,
      referenceType: reservation.reference_type, referenceId: reservation.reference_id, salesOrderId: reservation.sales_order_id, salesOrderLineId: reservation.sales_order_line_id,
      salesQuantity: reservation.sales_quantity, salesUom: reservation.sales_uom, expiresAt: reservation.expires_at, sourceLineId: parent?.source_line_id ?? undefined });
    await client.query("RELEASE SAVEPOINT hold_rereserve");
    await holdEvent(client, c, row.id, "reservation_reallocated", `Reservation ${reservation.reservation_number} reallocated to ${created.reservation_number} (${quantity})`,
      { from: reservation.id, to: created.id, quantity });
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT hold_rereserve");
    if (!(error instanceof StockError)) throw error;
    await holdEvent(client, c, row.id, "reservation_short", `Reservation ${reservation.reservation_number} could not be reallocated: ${quantity} left short for its source to resolve`,
      { reservationId: reservation.id, quantity, reason: error.code });
  }
}

// ------------------------------------------------------------------ resolving

// input: { action: release | escalate | damage, entries?: [{ allocationId, quantity? }] (none: everything still held), targetLocationId?,
// reason, decision?: pass | fail | partial_pass | escalate, idempotencyKey? }. Release to available needs the release permission (quarantined
// stock: the stronger one); part of a hold, the partial-release permission too.
export async function resolveStockHold(client, c, holdId, input = {}) {
  const action = String(input.action ?? "");
  if (!["release", "escalate", "damage"].includes(action)) fail("Release, escalate or move to damaged.", "HOLD_ACTION_INVALID");
  const reason = text(input.reason, 1000);
  if (!reason) fail("Give the reason (the quality decision).", "HOLD_REASON_REQUIRED");
  const token = await beginIdempotentOperation(client, c, { operation: `stock.hold.${action}`, key: text(input.idempotencyKey, 200), payload: { holdId, ...input, idempotencyKey: undefined } });
  if (token.replayed) return { ...token.response, replayed: true };
  const row = await loadHold(client, c, holdId, { lock: true });
  if (!["active", "partially_resolved"].includes(row.status)) fail(`The hold is ${row.status}: nothing is held.`, "HOLD_NOT_ACTIVE", 409);
  const allocations = (await client.query(
    `SELECT allocation.*, allocation.held_base_quantity - allocation.resolved_base_quantity AS remaining, line.line_number, line.source_location_id AS line_source_location_id, item.tracking_type
       FROM tenant.inventory_stock_hold_allocations allocation
       JOIN tenant.inventory_stock_hold_lines line ON line.organization_id = allocation.organization_id AND line.id = allocation.line_id
       JOIN tenant.items item ON item.organization_id = allocation.organization_id AND item.id = allocation.item_id
      WHERE allocation.organization_id = $1 AND allocation.hold_id = $2 AND allocation.status = 'active' ORDER BY line.line_number, allocation.created_at FOR UPDATE OF allocation`,
    [c.organizationId, row.id])).rows;
  const wanted = Array.isArray(input.entries) && input.entries.length ? input.entries : allocations.map((allocation) => ({ allocationId: allocation.id }));
  const plan = wanted.map((entry, index) => {
    const allocation = allocations.find((candidate) => candidate.id === entry.allocationId);
    if (!allocation) fail(`Entry ${index + 1}: that held stock is not on this hold (or no longer held).`, "HOLD_ALLOCATION_INVALID");
    const quantity = entry.quantity === undefined || entry.quantity === null || entry.quantity === "" ? Number(allocation.remaining) : Number(entry.quantity);
    if (!(quantity > 0) || quantity > Number(allocation.remaining) + EPS) fail(`Entry ${index + 1}: up to ${round(allocation.remaining)} is held there.`, "HOLD_QUANTITY_INVALID");
    if (allocation.serial_id && quantity !== 1) fail(`Entry ${index + 1}: a serial number is released whole.`, "HOLD_SERIAL_PARTIAL");
    return { allocation, quantity: round(quantity) };
  });
  const partial = plan.length < allocations.length || plan.some((entry) => entry.quantity + EPS < Number(entry.allocation.remaining));
  for (const { allocation } of plan) {
    if (action === "release") need(c, allocation.current_disposition === "quarantined" ? P.releaseQuarantine : P.release,
      allocation.current_disposition === "quarantined" ? "Releasing quarantined stock needs the Release quarantined stock permission." : "You do not have permission to release quality-held stock.");
    if (action === "escalate") {
      need(c, P.escalate, "You do not have permission to escalate holds to quarantine.");
      if (allocation.current_disposition !== "quality_hold") fail("Only quality-held stock is escalated to quarantine.", "HOLD_ESCALATE_INVALID", 409);
    }
    if (action === "damage") need(c, P.damage, "You do not have permission to move held stock to damaged.");
    if (allocation.tracking_type === "batch") need(c, P.batch, "You do not have permission to handle held batch stock.");
    if (allocation.tracking_type === "serial") need(c, P.serial, "You do not have permission to handle held serial-numbered stock.");
  }
  if (action === "release" && partial) need(c, P.partialRelease, "You do not have permission to release part of a hold.");
  const stock = stockContext(c);
  const group = await openMovementGroup(client, c, { sourceType: "inventory_stock_hold", sourceId: row.id, sourceNumber: row.document_number, operation: "disposition_move",
    postingKey: `inventory_stock_hold:${row.id}:${action}:${crypto.randomUUID()}` });
  const toDisposition = { release: "available", escalate: "quarantined", damage: "damaged" }[action];
  const resolutionAction = { release: "released", escalate: "escalated", damage: "damaged" }[action];
  for (const { allocation, quantity } of plan) {
    await lockInventoryItem(client, c, allocation.item_id);
    let target;
    if (action === "release") {
      const chosen = uuidOr(input.targetLocationId) ?? (allocation.line_source_location_id && (await dispositionAt(client, c.organizationId, allocation.line_source_location_id)) === "available"
        ? allocation.line_source_location_id : null);
      target = await ledgerLocation(client, c.organizationId, allocation.warehouse_id, chosen, { label: "Release to" });
      if ((await dispositionAt(client, c.organizationId, target)) !== "available") fail("Release into a location that holds available stock.", "HOLD_TARGET_LOCATION_INVALID");
    } else target = await dispositionLocation(client, c, allocation.warehouse_id, toDisposition, uuidOr(input.targetLocationId));
    const moved = await withActiveBatch(client, c, allocation.batch_id, () => moveStockWithinWarehouse(client, stock, { itemId: allocation.item_id, warehouseId: allocation.warehouse_id, fromLocationId: allocation.location_id, toLocationId: target,
      batchId: allocation.batch_id, serialIds: allocation.serial_id ? [allocation.serial_id] : undefined, quantity: String(quantity), referenceType: "inventory_stock_hold", referenceId: row.id,
      reason: `${row.document_number} · ${ACTION_LABEL[resolutionAction]}: ${reason}`, holdOperation: true, groupId: group.id,
      idempotencyKey: `qh:${row.id}:${action}:${allocation.id}:${round(allocation.resolved_base_quantity)}:${quantity}` }));
    const inLeg = moved.movements.find((movement) => Number(movement.quantity) > 0);
    const full = quantity + EPS >= Number(allocation.remaining);
    await client.query(`UPDATE tenant.inventory_stock_hold_allocations SET resolved_base_quantity = resolved_base_quantity + $3, status = CASE WHEN $4 THEN $5 ELSE status END, version = version + 1,
        updated_at = now() WHERE organization_id = $1 AND id = $2`, [c.organizationId, allocation.id, quantity, full, action === "escalate" ? "moved" : "resolved"]);
    await recordResolution(client, c, { holdId: row.id, lineId: allocation.line_id, allocationId: allocation.id, action: resolutionAction, quantity, fromDisposition: allocation.current_disposition,
      toDisposition, fromLocationId: allocation.location_id, toLocationId: target, movementId: inLeg?.id ?? null, documentType: "inventory_stock_hold", documentId: row.id,
      documentNumber: row.document_number, reason });
    if (action === "escalate")
      await client.query(
        `INSERT INTO tenant.inventory_stock_hold_allocations (organization_id, hold_id, line_id, item_id, warehouse_id, location_id, batch_id, serial_id, held_base_quantity, current_disposition,
           carried_from_allocation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'quarantined',$10)`,
        [c.organizationId, row.id, allocation.line_id, allocation.item_id, allocation.warehouse_id, target, allocation.batch_id, allocation.serial_id, quantity, allocation.id]);
    else await client.query(`UPDATE tenant.inventory_stock_hold_lines SET unresolved_base_quantity = greatest(unresolved_base_quantity - $3, 0), version = version + 1, updated_at = now()
        WHERE organization_id = $1 AND id = $2`, [c.organizationId, allocation.line_id, quantity]);
  }
  const total = round(plan.reduce((sum, entry) => sum + entry.quantity, 0));
  if (action === "escalate") await client.query(`UPDATE tenant.inventory_stock_holds SET hold_type = 'quarantine', version = version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, row.id]);
  if (input.decision && INSPECTION_RESULTS.some((entry) => entry.id === input.decision))
    await client.query(`UPDATE tenant.inventory_stock_holds SET inspection_result = $3, decision_by = $4, decision_at = now(), version = version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, row.id, input.decision, c.userId ?? null]);
  await refreshHoldStatus(client, c, row.id);
  await holdEvent(client, c, row.id, resolutionAction, `${ACTION_LABEL[resolutionAction]}: ${total}${partial ? " (part of the hold)" : ""} — ${reason}`, { groupId: group.id, total });
  const response = { ...(await getStockHold(client, c, row.id)), replayed: false };
  await completeIdempotentOperation(client, c, token, { response: { id: row.id }, aggregateType: "inventory_stock_hold", aggregateId: row.id });
  return response;
}

// Review metadata: reviewer, due date, inspection notes and the decision (the decision itself moves no stock).
export async function recordHoldReview(client, c, holdId, input = {}) {
  const row = await loadHold(client, c, holdId, { lock: true });
  if (!can(c, P.place) && !can(c, P.placeQuarantine) && !can(c, P.release)) need(c, P.editDraft, "You do not have permission to review quality holds.");
  if (row.status === "cancelled") fail("A cancelled hold is not reviewed.", "HOLD_NOT_ACTIVE", 409);
  if (input.inspectionResult && !INSPECTION_RESULTS.some((entry) => entry.id === input.inspectionResult)) fail("Pass, fail, partial pass or escalate.", "HOLD_DECISION_INVALID");
  const due = input.reviewDueOn === undefined ? row.review_due_on : input.reviewDueOn ? String(input.reviewDueOn).slice(0, 10) : null;
  if (due && !DATE.test(String(due).slice(0, 10))) fail("The review due date is not a valid date.", "HOLD_REVIEW_DATE_INVALID");
  const notes = input.inspectionNotes === undefined ? row.inspection_notes : text(input.inspectionNotes, 4000);
  await client.query(
    `UPDATE tenant.inventory_stock_holds SET assigned_user_id = $3, review_due_on = $4, inspection_notes = $5, inspection_result = COALESCE($6, inspection_result),
            decision_by = CASE WHEN $6::text IS NULL THEN decision_by ELSE $7::uuid END, decision_at = CASE WHEN $6::text IS NULL THEN decision_at ELSE now() END, version = version + 1, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, row.id, input.assignedUserId === undefined ? row.assigned_user_id : uuidOr(input.assignedUserId), due, notes, input.inspectionResult ?? null, c.userId ?? null]);
  if (input.inspectionNotes !== undefined) await holdEvent(client, c, row.id, "inspection_note", `Inspection notes: ${text(input.inspectionNotes, 300) ?? "cleared"}`);
  if (input.inspectionResult) await holdEvent(client, c, row.id, "inspection_decision", `Inspection decision: ${INSPECTION_RESULTS.find((entry) => entry.id === input.inspectionResult).label}`);
  if (input.assignedUserId !== undefined || input.reviewDueOn !== undefined) await holdEvent(client, c, row.id, "review_assigned", "Reviewer or review date changed");
  return getStockHold(client, c, row.id);
}

// ------------------------------------------------------------------ stock already held by its document

// A goods receipt or sales return that put stock on hold, or held stock that has no case yet: an active case for exactly that stock, no
// movement. positions: [{ itemId, locationId, batchId?, serialId?, quantity }]. Idempotent per source line.
export async function registerHeldStock(client, c, input = {}, { internal = false } = {}) {
  if (!internal) need(c, P.create, "You do not have permission to create quality holds.");
  const positions = (input.positions ?? []).filter((position) => Number(position.quantity) > 0);
  if (!positions.length) return null;
  if (input.sourceLineId) {
    const existing = (await client.query(`SELECT id FROM tenant.inventory_stock_holds WHERE organization_id = $1 AND source_document_type = $2 AND source_line_id = $3`,
      [c.organizationId, input.sourceType, input.sourceLineId])).rows[0];
    if (existing) return existing.id;
  }
  await ensureReasons(client, c);
  const reason = (await client.query(`SELECT * FROM tenant.inventory_hold_reasons WHERE organization_id = $1 AND (id = $2 OR code = $3) ORDER BY id = $2 DESC LIMIT 1`,
    [c.organizationId, uuidOr(input.reasonId), input.reasonCode ?? "QUALITY_CONCERN"])).rows[0];
  const first = positions[0];
  const disposition = await dispositionAt(client, c.organizationId, first.locationId ?? null);
  if (!["quality_hold", "quarantined"].includes(disposition)) return null;
  if (!internal) {
    for (const position of positions) {
      const onHand = Number((await client.query(`SELECT COALESCE(sum(quantity), 0) AS q FROM tenant.stock_balances WHERE organization_id = $1 AND item_id = $2 AND warehouse_id = $3
          AND warehouse_location_id IS NOT DISTINCT FROM $4 AND batch_id IS NOT DISTINCT FROM $5`, [c.organizationId, position.itemId, input.warehouseId, position.locationId ?? null, position.batchId ?? null])).rows[0].q);
      const held = await heldByCases(client, c.organizationId, { itemId: position.itemId, warehouseId: input.warehouseId, locationId: position.locationId ?? null, batchId: position.batchId ?? null });
      if (onHand - held + EPS < Number(position.quantity)) fail(`Only ${round(Math.max(onHand - held, 0))} of that held stock has no case.`, "HOLD_EXCEEDS_STOCK", 409);
    }
  }
  const number = await nextDocumentNumber(client, c, { documentType: "inventory_stock_hold", prefix: "QH" });
  const due = reason.default_review_days === null ? null : (await client.query(`SELECT (current_date + $1::int)::text AS d`, [reason.default_review_days])).rows[0].d;
  const hold = (await client.query(
    `INSERT INTO tenant.inventory_stock_holds (organization_id, document_number, hold_type, reason_id, source_document_type, source_document_id, source_document_number, source_line_id,
       origin_warehouse_id, review_due_on, notes, status, created_by, activated_by, activated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',$12,$12,now()) RETURNING *`,
    [c.organizationId, number, disposition === "quarantined" ? "quarantine" : "quality_hold", reason.id, input.sourceType ?? "existing_stock", input.sourceId ?? null, input.sourceNumber ?? null,
      input.sourceLineId ?? null, input.warehouseId, due, text(input.notes, 2000), c.userId ?? null])).rows[0];
  const byItem = new Map();
  for (const position of positions) byItem.set(position.itemId, [...(byItem.get(position.itemId) ?? []), position]);
  let lineNumber = 0;
  for (const [itemId, entries] of byItem) {
    const item = (await client.query(`SELECT id, code, name, uom_id FROM tenant.items WHERE organization_id = $1 AND id = $2`, [c.organizationId, itemId])).rows[0];
    const total = round(entries.reduce((sum, entry) => sum + Number(entry.quantity), 0));
    const line = (await client.query(
      `INSERT INTO tenant.inventory_stock_hold_lines (organization_id, hold_id, line_number, item_id, sku_snapshot, item_name_snapshot, warehouse_id, source_location_id, batch_id, serial_ids, uom_id,
         transaction_quantity, original_base_quantity, unresolved_base_quantity, source_disposition, hold_disposition)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$12,$13,$13) RETURNING id`,
      [c.organizationId, hold.id, ++lineNumber, item.id, item.code, item.name, input.warehouseId, entries[0].locationId ?? null, entries[0].batchId ?? null,
        entries.map((entry) => entry.serialId).filter(Boolean), item.uom_id, total, disposition])).rows[0];
    for (const entry of entries)
      await client.query(
        `INSERT INTO tenant.inventory_stock_hold_allocations (organization_id, hold_id, line_id, item_id, warehouse_id, location_id, batch_id, serial_id, held_base_quantity, current_disposition)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [c.organizationId, hold.id, line.id, item.id, input.warehouseId, entry.locationId ?? null, entry.batchId ?? null, entry.serialId ?? null, round(entry.quantity), disposition]);
  }
  await holdEvent(client, c, hold.id, "activated", `Opened for stock ${input.sourceNumber ? `${input.sourceNumber} put` : "already"} on ${disposition === "quarantined" ? "quarantine" : "quality hold"}`,
    { sourceType: input.sourceType, sourceId: input.sourceId });
  return hold.id;
}

// ------------------------------------------------------------------ reading

const HOLD_SELECT = `
  SELECT hold.*, reason.name AS reason_name, reason.code AS reason_code, warehouse.code AS warehouse_code, warehouse.name AS warehouse_name, reviewer.full_name AS assigned_user_name,
         creator.full_name AS created_by_name, activator.full_name AS activated_by_name,
         (SELECT COALESCE(sum(line.unresolved_base_quantity), 0) FROM tenant.inventory_stock_hold_lines line WHERE line.organization_id = hold.organization_id AND line.hold_id = hold.id) AS unresolved,
         (SELECT COALESCE(sum(line.original_base_quantity), 0) FROM tenant.inventory_stock_hold_lines line WHERE line.organization_id = hold.organization_id AND line.hold_id = hold.id) AS original,
         (SELECT string_agg(DISTINCT line.sku_snapshot, ', ') FROM tenant.inventory_stock_hold_lines line WHERE line.organization_id = hold.organization_id AND line.hold_id = hold.id) AS skus,
         (SELECT string_agg(DISTINCT current_warehouse.code, ', ') FROM tenant.inventory_stock_hold_allocations allocation
            JOIN tenant.warehouses current_warehouse ON current_warehouse.organization_id = allocation.organization_id AND current_warehouse.id = allocation.warehouse_id
           WHERE allocation.organization_id = hold.organization_id AND allocation.hold_id = hold.id AND allocation.status = 'active') AS current_warehouses
    FROM tenant.inventory_stock_holds hold
    JOIN tenant.inventory_hold_reasons reason ON reason.organization_id = hold.organization_id AND reason.id = hold.reason_id
    JOIN tenant.warehouses warehouse ON warehouse.organization_id = hold.organization_id AND warehouse.id = hold.origin_warehouse_id
    LEFT JOIN public.users reviewer ON reviewer.id = hold.assigned_user_id
    LEFT JOIN public.users creator ON creator.id = hold.created_by
    LEFT JOIN public.users activator ON activator.id = hold.activated_by`;

const SOURCE_HREF = { goods_receipt: (id) => `/procurement/goods-receipts/${id}`, sales_return: (id) => `/sales/returns/${id}` };
function headerOf(row) {
  const overdue = Boolean(row.review_due_on) && ["active", "partially_resolved"].includes(row.status) && String(row.review_due_on instanceof Date ? row.review_due_on.toISOString() : row.review_due_on).slice(0, 10) < new Date().toISOString().slice(0, 10);
  return {
    id: row.id, number: row.document_number, holdType: row.hold_type, holdTypeLabel: HOLD_TYPES.find((entry) => entry.id === row.hold_type)?.label, status: row.status,
    statusLabel: HOLD_STATUSES.find((entry) => entry.id === row.status)?.label, reasonId: row.reason_id, reason: row.reason_name, reasonCode: row.reason_code,
    source: { type: row.source_document_type, id: row.source_document_id, number: row.source_document_number, href: row.source_document_id && SOURCE_HREF[row.source_document_type] ? SOURCE_HREF[row.source_document_type](row.source_document_id) : null },
    originWarehouseId: row.origin_warehouse_id, originWarehouse: row.warehouse_code, originWarehouseName: row.warehouse_name, currentWarehouses: row.current_warehouses ?? null,
    assignedUserId: row.assigned_user_id, assignedUserName: row.assigned_user_name ?? null, reviewDueOn: row.review_due_on ? String(row.review_due_on instanceof Date ? row.review_due_on.toISOString() : row.review_due_on).slice(0, 10) : null,
    overdue, inspectionResult: row.inspection_result, inspectionNotes: row.inspection_notes, decisionAt: row.decision_at, notes: row.notes, skus: row.skus ?? null,
    heldQuantity: round(row.unresolved), originalQuantity: round(row.original), createdAt: row.created_at, createdByName: row.created_by_name ?? null, activatedAt: row.activated_at,
    activatedByName: row.activated_by_name ?? null, resolvedAt: row.resolved_at, cancelledAt: row.cancelled_at, cancelReason: row.cancel_reason, version: row.version,
  };
}

// filters: view (active | quality_hold | quarantine | overdue | partially_resolved | resolved | draft | cancelled | all), search, warehouseId, itemId, reasonId
export async function listStockHolds(client, c, filters = {}) {
  need(c, P.view, "You do not have permission to view quality holds.");
  const values = [c.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = ["hold.organization_id = $1"];
  const view = filters.view ?? "active";
  if (view === "active") where.push("hold.status IN ('active', 'partially_resolved')");
  else if (view === "quality_hold" || view === "quarantine") where.push(`hold.status IN ('active', 'partially_resolved') AND hold.hold_type = ${bind(view)}`);
  else if (view === "overdue") where.push("hold.status IN ('active', 'partially_resolved') AND hold.review_due_on < current_date");
  else if (HOLD_STATUSES.some((entry) => entry.id === view)) where.push(`hold.status = ${bind(view)}`);
  const visible = await visibleWarehouseIds(client, c);
  if (visible) where.push(`hold.origin_warehouse_id = ANY(${bind(visible)}::uuid[])`);
  if (uuidOr(filters.warehouseId)) where.push(`(hold.origin_warehouse_id = ${bind(filters.warehouseId)} OR EXISTS (SELECT 1 FROM tenant.inventory_stock_hold_allocations allocation
      WHERE allocation.organization_id = hold.organization_id AND allocation.hold_id = hold.id AND allocation.status = 'active' AND allocation.warehouse_id = $${values.length}))`);
  if (uuidOr(filters.itemId)) where.push(`EXISTS (SELECT 1 FROM tenant.inventory_stock_hold_lines line WHERE line.organization_id = hold.organization_id AND line.hold_id = hold.id AND line.item_id = ${bind(filters.itemId)})`);
  if (uuidOr(filters.reasonId)) where.push(`hold.reason_id = ${bind(filters.reasonId)}`);
  const term = text(filters.search, 120);
  if (term) where.push(`(lower(hold.document_number) LIKE ${bind(`%${term.toLowerCase()}%`)} OR EXISTS (SELECT 1 FROM tenant.inventory_stock_hold_lines line WHERE line.organization_id = hold.organization_id
      AND line.hold_id = hold.id AND lower(concat_ws(' ', line.sku_snapshot, line.item_name_snapshot)) LIKE $${values.length}) OR lower(COALESCE(hold.source_document_number, '')) LIKE $${values.length})`);
  const { rows } = await client.query(`${HOLD_SELECT} WHERE ${where.join(" AND ")} ORDER BY hold.created_at DESC LIMIT 500`, values);
  return { rows: rows.map(headerOf), canCreate: can(c, P.create) };
}

export async function getStockHold(client, c, holdId) {
  need(c, P.view, "You do not have permission to view quality holds.");
  const base = await loadHold(client, c, holdId);
  const row = (await client.query(`${HOLD_SELECT} WHERE hold.organization_id = $1 AND hold.id = $2`, [c.organizationId, base.id])).rows[0];
  const lines = await linesOf(client, c, base.id);
  const allocations = (await client.query(
    `SELECT allocation.*, warehouse.code AS warehouse_code, COALESCE(location.code, 'MAIN') AS location_code, batch.batch_number, batch.expires_on, serial.serial_number
       FROM tenant.inventory_stock_hold_allocations allocation
       JOIN tenant.warehouses warehouse ON warehouse.organization_id = allocation.organization_id AND warehouse.id = allocation.warehouse_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = allocation.organization_id AND location.id = allocation.location_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id = allocation.organization_id AND batch.id = allocation.batch_id
       LEFT JOIN tenant.stock_serials serial ON serial.organization_id = allocation.organization_id AND serial.id = allocation.serial_id
      WHERE allocation.organization_id = $1 AND allocation.hold_id = $2 ORDER BY allocation.created_at`, [c.organizationId, base.id])).rows;
  const resolutions = (await client.query(
    `SELECT resolution.*, actor.full_name AS actor_name, source.code AS from_location_code, target.code AS to_location_code, movement.movement_number
       FROM tenant.inventory_stock_hold_resolutions resolution
       LEFT JOIN public.users actor ON actor.id = resolution.created_by
       LEFT JOIN tenant.warehouse_locations source ON source.organization_id = resolution.organization_id AND source.id = resolution.from_location_id
       LEFT JOIN tenant.warehouse_locations target ON target.organization_id = resolution.organization_id AND target.id = resolution.to_location_id
       LEFT JOIN tenant.stock_movements movement ON movement.organization_id = resolution.organization_id AND movement.id = resolution.movement_id
      WHERE resolution.organization_id = $1 AND resolution.hold_id = $2 ORDER BY resolution.created_at`, [c.organizationId, base.id])).rows;
  const history = can(c, P.viewHistory) ? (await client.query(
    `SELECT event.*, actor.full_name AS actor_name FROM tenant.inventory_stock_hold_events event LEFT JOIN public.users actor ON actor.id = event.actor_user_id
      WHERE event.organization_id = $1 AND event.hold_id = $2 ORDER BY event.created_at`, [c.organizationId, base.id])).rows : [];
  const value = can(c, P.viewValue) ? Number((await client.query(
    `SELECT COALESCE(sum((allocation.held_base_quantity - allocation.resolved_base_quantity) * CASE WHEN balance.base_quantity > 0 THEN balance.inventory_value / balance.base_quantity ELSE COALESCE(balance.moving_average_cost, 0) END), 0) AS v
       FROM tenant.inventory_stock_hold_allocations allocation LEFT JOIN tenant.inventory_valuation_balances balance ON balance.organization_id = allocation.organization_id
            AND balance.warehouse_id = allocation.warehouse_id AND balance.item_id = allocation.item_id
      WHERE allocation.organization_id = $1 AND allocation.hold_id = $2 AND allocation.status = 'active'`, [c.organizationId, base.id])).rows[0].v) : undefined;
  const active = ["active", "partially_resolved"].includes(base.status);
  const held = allocations.filter((allocation) => allocation.status === "active");
  return {
    hold: { ...headerOf(row), ...(value === undefined ? {} : { heldValue: Math.round(value * 100) / 100 }) },
    lines: lines.map((line) => ({ id: line.id, lineNumber: line.line_number, itemId: line.item_id, sku: line.sku_snapshot, itemName: line.item_name_snapshot, trackingType: line.tracking_type,
      warehouseId: line.warehouse_id, sourceLocationId: line.source_location_id, sourceLocation: line.source_location_code ?? "MAIN", targetLocationId: line.target_location_id,
      targetLocation: line.target_location_code, batchId: line.batch_id, batch: line.batch_number, serialIds: line.serial_ids, quantity: round(line.transaction_quantity), uom: line.uom_code,
      baseUom: line.base_uom_code, baseQuantity: round(line.original_base_quantity), unresolved: round(line.unresolved_base_quantity), sourceDisposition: line.source_disposition,
      holdDisposition: line.hold_disposition, notes: line.notes })),
    allocations: allocations.map((allocation) => ({ id: allocation.id, lineId: allocation.line_id, itemId: allocation.item_id, warehouseId: allocation.warehouse_id, warehouse: allocation.warehouse_code,
      locationId: allocation.location_id, location: allocation.location_code, batch: allocation.batch_number, expiresOn: allocation.expires_on, serial: allocation.serial_number,
      held: round(allocation.held_base_quantity), resolved: round(allocation.resolved_base_quantity), remaining: round(allocation.held_base_quantity - allocation.resolved_base_quantity),
      disposition: allocation.current_disposition, dispositionLabel: DISPOSITION_LABEL[allocation.current_disposition], status: allocation.status })),
    resolutions: resolutions.map((entry) => ({ id: entry.id, action: entry.action, label: ACTION_LABEL[entry.action] ?? entry.action, quantity: round(entry.quantity), from: entry.from_disposition,
      to: entry.to_disposition, fromLocation: entry.from_location_code, toLocation: entry.to_location_code, movement: entry.movement_number, movementId: entry.movement_id,
      document: entry.document_number ? { type: entry.document_type, id: entry.document_id, number: entry.document_number } : null, reason: entry.reason, by: entry.actor_name ?? null, at: entry.created_at })),
    history: history.map((entry) => ({ type: entry.event_type, summary: entry.summary, at: entry.created_at, actor: entry.actor_name ?? null })),
    capabilities: {
      edit: base.status === "draft" && can(c, P.editDraft), cancel: base.status === "draft" && can(c, P.editDraft), place: base.status === "draft" && can(c, base.hold_type === "quarantine" ? P.placeQuarantine : P.place),
      release: active && held.length > 0 && (can(c, P.release) || can(c, P.releaseQuarantine)), releaseQuarantine: can(c, P.releaseQuarantine), partialRelease: can(c, P.partialRelease),
      escalate: active && held.some((allocation) => allocation.current_disposition === "quality_hold") && can(c, P.escalate), damage: active && held.length > 0 && can(c, P.damage),
      review: base.status !== "cancelled" && (can(c, P.place) || can(c, P.placeQuarantine) || can(c, P.release) || can(c, P.editDraft)), files: can(c, P.create), seesValue: can(c, P.viewValue),
      purchaseReturn: active && base.source_document_type === "goods_receipt", dispose: active,
    },
  };
}

export async function getHoldOptions(client, c) {
  need(c, P.view, "You do not have permission to view quality holds.");
  const visible = await visibleWarehouseIds(client, c);
  const warehouses = (await client.query(
    `SELECT warehouse.id, warehouse.code, warehouse.name, warehouse.is_default FROM tenant.warehouses warehouse WHERE warehouse.organization_id = $1 AND warehouse.status = 'active'
        AND warehouse.system_role IS NULL AND ($2::uuid[] IS NULL OR warehouse.id = ANY($2::uuid[])) ORDER BY warehouse.code`, [c.organizationId, visible])).rows;
  const locations = (await client.query(
    `SELECT id, warehouse_id, code, name, disposition, is_default_storage FROM tenant.warehouse_locations WHERE organization_id = $1 AND status = 'active' AND allow_stock ORDER BY code`,
    [c.organizationId])).rows;
  const users = (await client.query(
    `SELECT DISTINCT person.id, person.full_name FROM public.users person JOIN public.organization_memberships membership ON membership.user_id = person.id
      WHERE membership.organization_id = $1 AND membership.status = 'active' ORDER BY person.full_name`, [c.organizationId])).rows;
  return {
    holdTypes: HOLD_TYPES, statuses: HOLD_STATUSES, inspectionResults: INSPECTION_RESULTS, reasons: await listHoldReasons(client, c),
    warehouses: warehouses.map((warehouse) => ({ id: warehouse.id, code: warehouse.code, name: warehouse.name, isDefault: warehouse.is_default,
      locations: locations.filter((location) => location.warehouse_id === warehouse.id).map((location) => ({ id: location.id, code: location.code, name: location.name, disposition: location.disposition,
        isMain: location.is_default_storage })) })),
    reviewers: users.map((user) => ({ id: user.id, name: user.full_name })),
    capabilities: { create: can(c, P.create), place: can(c, P.place), placeQuarantine: can(c, P.placeQuarantine), manageReasons: can(c, P.manageReasons), resolveReservations: can(c, P.resolveReservations) },
  };
}

// Held stock by position (item, warehouse, location, batch) and disposition, with how much of it a hold case explains — anything held that no
// case explains is shown, never hidden. filters: warehouseId, itemId, disposition.
export async function listHeldStock(client, c, filters = {}) {
  need(c, P.view, "You do not have permission to view quality holds.");
  const values = [c.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = ["balance.organization_id = $1", "balance.quantity <> 0", "location.disposition IN ('quality_hold', 'quarantined', 'damaged')"];
  const visible = await visibleWarehouseIds(client, c);
  if (visible) where.push(`balance.warehouse_id = ANY(${bind(visible)}::uuid[])`);
  if (uuidOr(filters.warehouseId)) where.push(`balance.warehouse_id = ${bind(filters.warehouseId)}`);
  if (uuidOr(filters.itemId)) where.push(`balance.item_id = ${bind(filters.itemId)}`);
  if (["quality_hold", "quarantined", "damaged"].includes(filters.disposition)) where.push(`location.disposition = ${bind(filters.disposition)}`);
  const { rows } = await client.query(
    `SELECT balance.item_id, balance.warehouse_id, balance.warehouse_location_id, balance.batch_id, balance.quantity, location.disposition, location.code AS location_code, item.code AS sku,
            item.name AS item_name, warehouse.code AS warehouse_code, batch.batch_number,
            (SELECT COALESCE(sum(allocation.held_base_quantity - allocation.resolved_base_quantity), 0) FROM tenant.inventory_stock_hold_allocations allocation
              WHERE allocation.organization_id = balance.organization_id AND allocation.item_id = balance.item_id AND allocation.warehouse_id = balance.warehouse_id
                AND allocation.location_id IS NOT DISTINCT FROM balance.warehouse_location_id AND allocation.batch_id IS NOT DISTINCT FROM balance.batch_id AND allocation.status = 'active') AS explained,
            (SELECT string_agg(DISTINCT hold.document_number, ', ') FROM tenant.inventory_stock_hold_allocations allocation
               JOIN tenant.inventory_stock_holds hold ON hold.organization_id = allocation.organization_id AND hold.id = allocation.hold_id
              WHERE allocation.organization_id = balance.organization_id AND allocation.item_id = balance.item_id AND allocation.warehouse_id = balance.warehouse_id
                AND allocation.location_id IS NOT DISTINCT FROM balance.warehouse_location_id AND allocation.batch_id IS NOT DISTINCT FROM balance.batch_id AND allocation.status = 'active') AS holds
       FROM tenant.stock_balances balance
       JOIN tenant.warehouse_locations location ON location.organization_id = balance.organization_id AND location.id = balance.warehouse_location_id
       JOIN tenant.items item ON item.organization_id = balance.organization_id AND item.id = balance.item_id
       JOIN tenant.warehouses warehouse ON warehouse.organization_id = balance.organization_id AND warehouse.id = balance.warehouse_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id = balance.organization_id AND batch.id = balance.batch_id
      WHERE ${where.join(" AND ")} ORDER BY item.code, warehouse.code, location.code`, values);
  const out = rows.map((row) => ({ itemId: row.item_id, sku: row.sku, itemName: row.item_name, warehouseId: row.warehouse_id, warehouse: row.warehouse_code, locationId: row.warehouse_location_id,
    location: row.location_code, batchId: row.batch_id, batch: row.batch_number, disposition: row.disposition, dispositionLabel: DISPOSITION_LABEL[row.disposition], onHand: round(row.quantity),
    explained: round(row.explained), unexplained: row.disposition === "damaged" ? 0 : round(Math.max(Number(row.quantity) - Number(row.explained), 0)), holds: row.holds ?? null }));
  return { rows: out, unexplained: out.filter((row) => row.unexplained > EPS).length };
}

// ------------------------------------------------------------------ attachments

export async function prepareStockHoldFileUpload({ fileName, bytes }, env = process.env) {
  const extension = (/\.([a-z0-9]{1,10})$/i.exec(String(fileName ?? ""))?.[1] ?? "").toLowerCase();
  if (!FILE_TYPES[extension]) throw new HoldError(400, "Upload a PDF, image, text, spreadsheet or Word file.", "HOLD_FILE_TYPE");
  return prepareFileUpload({ fileName, mimeType: FILE_TYPES[extension], bytes, maximumBytes: 10 * 1024 * 1024, allowedTypes: [...new Set(Object.values(FILE_TYPES))] }, env);
}
const toFile = (entry) => ({ id: entry.id, fileName: entry.file_name ?? entry.fileName, mimeType: entry.mime_type ?? entry.mimeType, sizeBytes: Number(entry.size_bytes ?? entry.sizeBytes ?? 0),
  uploadedAt: entry.created_at ?? entry.createdAt });
export async function listStockHoldFiles(client, c, holdId) {
  need(c, P.view, "You do not have permission to view quality holds.");
  const row = await loadHold(client, c, holdId);
  return (await listFiles(client, { organizationId: c.organizationId, entityType: FILE_ENTITY, entityId: row.id })).map(toFile);
}
export async function uploadStockHoldFile(client, c, holdId, input = {}, options = {}) {
  need(c, P.create, "You do not have permission to add files to quality holds.");
  const row = await loadHold(client, c, holdId);
  const file = await storeFile(client, { organizationId: c.organizationId, entityType: FILE_ENTITY, entityId: row.id, prepared: input.prepared, uploadedBy: c.userId ?? null }, options);
  await holdEvent(client, c, row.id, "file_added", `File added: ${file.fileName}`, { fileId: file.id });
  return toFile(file);
}
export async function removeStockHoldFile(client, c, holdId, fileId) {
  need(c, P.editDraft, "You do not have permission to remove files from quality holds.");
  const row = await loadHold(client, c, holdId);
  if (row.status !== "draft") throw new HoldError(409, "A placed hold keeps its evidence.", "HOLD_NOT_DRAFT");
  await archiveFile(client, { organizationId: c.organizationId, entityType: FILE_ENTITY, entityId: row.id, fileId: uuidOr(fileId), actorUserId: c.userId ?? null });
  await holdEvent(client, c, row.id, "file_removed", "File removed", { fileId });
  return { removed: true };
}
export async function readStockHoldFile(client, c, holdId, fileId, options = {}) {
  need(c, P.view, "You do not have permission to view quality holds.");
  const row = await loadHold(client, c, holdId);
  const file = (await client.query(`SELECT id, file_name, mime_type FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND archived_at IS NULL`,
    [c.organizationId, FILE_ENTITY, row.id, uuidOr(fileId)])).rows[0];
  if (!file) throw new HoldError(404, "File not found.", "HOLD_FILE_NOT_FOUND");
  const content = await readFileContent(client, { organizationId: c.organizationId, entityType: FILE_ENTITY, entityId: row.id, fileId: file.id }, options);
  return { fileName: file.file_name, mimeType: file.mime_type, body: content.body };
}

// A completed inspection of held stock (a goods receipt's incoming inspection): its outcome on the hold that holds that stock — the stock stays
// held until someone releases, escalates or disposes of it. Called by Quality.
export async function noteInspectionOnHold(client, c, { sourceDocumentId, itemId, result, inspectionNumber, accepted = null, rejected = null }) {
  const hold = (await client.query(
    `SELECT hold.id FROM tenant.inventory_stock_holds hold WHERE hold.organization_id = $1 AND hold.source_document_id = $2 AND hold.status IN ('active', 'partially_resolved')
        AND EXISTS (SELECT 1 FROM tenant.inventory_stock_hold_lines line WHERE line.organization_id = hold.organization_id AND line.hold_id = hold.id AND line.item_id = $3)
      ORDER BY hold.created_at LIMIT 1`, [c.organizationId, sourceDocumentId, itemId])).rows[0];
  if (!hold || !INSPECTION_RESULTS.some((entry) => entry.id === result)) return null;
  await client.query(`UPDATE tenant.inventory_stock_holds SET inspection_result = $3, decision_by = $4, decision_at = now(), version = version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, hold.id, result, c.userId ?? null]);
  await holdEvent(client, c, hold.id, "inspection_decision", `Inspection ${inspectionNumber}: ${INSPECTION_RESULTS.find((entry) => entry.id === result).label}${accepted !== null ? ` (accepted ${accepted}, rejected ${rejected})` : ""}`);
  return hold.id;
}
