// Stock Adjustments: the one Inventory document that corrects recorded stock to what physically exists — a count found 96 where the books said
// 100, a recount found 3 more, a migration loaded the wrong quantity. Never a receipt, delivery, return, transfer, consumption or disposition
// change: those keep their own documents, so the ledger always says why stock moved.
//
// One document is one company and one warehouse, with a structured reason. Each line is one item at one location in one disposition, entered
// either as what was counted (the system quantity and the position's last movement are captured with the count; if stock moves there before
// posting the count is stale and must be redone) or as a signed difference, in any of the item's units (kept with the conversion), with the
// batches or serial numbers concerned. A draft moves nothing. Posting, under locks, re-checks everything against current stock, resolves the
// reservations a shortage would break (released or reallocated in the same transaction — never an impossible balance), posts Adjustment In /
// Out through the Stock Ledger (stock found at an authorized cost, stock lost at the valuation engine's cost) and the gain / loss journal, once.
// A posted adjustment is never edited; a posting mistake is reversed whole, and a later discrepancy is a new adjustment.
import { STOCK_ADJUSTMENT_PERMISSIONS as P } from "@vercentlabs/permissions";

import { add, decimal, formatDecimal, roundMoney, sub } from "../../core/decimal.js";
import { lockInventoryItem } from "../../core/inventory-lock.js";
import { archiveFile, listFiles, prepareFileUpload, readFileContent, storeFile } from "../../core/platform/files/index.js";
import { nextDocumentNumber } from "../../core/platform/numbering/index.js";
import { AccountingError } from "../accounting/core.js";
import { createJournalEntry, getAccountMapping, getPrimaryLedger, postJournalEntry } from "../accounting/index.js";
import { normalizeQuantityToBase } from "../products/uom.js";
import { visibleWarehouseIds } from "./balances.js";
import { StockError } from "./errors.js";
import { carryNegativeStock, isNegativeStockCode } from "./negative-stock-control.js";
import { postStockMovement, reallocateStockReservation, releaseStockReservation, reverseStockMovements } from "./index.js";
import { currentValuationRate, valuationOfMovements } from "./valuation-engine.js";
import { getStockLedger } from "./ledger.js";
import { dispositionAt, openMovementGroup } from "./ledger-posting.js";
import { itemPositions, withActiveBatch } from "./positions.js";
import { ledgerLocation, validateWarehouseOperation } from "./warehouses.js";

export class AdjustmentError extends Error {
  constructor(status, message, code = "ADJUSTMENT_ERROR", details = undefined) {
    super(message);
    this.name = "AdjustmentError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const ADJUSTMENT_DISPOSITIONS = Object.freeze([
  { id: "available", label: "Available" }, { id: "quality_hold", label: "Quality hold" }, { id: "quarantined", label: "Quarantined" }, { id: "damaged", label: "Damaged" },
  { id: "expired", label: "Expired / blocked batch" },
]);
export const VALUATION_SOURCES = Object.freeze([
  { id: "current_valuation_cost", label: "Current valuation cost" }, { id: "manual_authorized_cost", label: "Authorized cost entered" },
  { id: "zero_cost_authorized", label: "Zero cost (authorized)" },
]);
// The reasons every company starts with (migration 0071 seeds the same). Consumption, maintenance, returns and transfers are not reasons here:
// they have their own documents.
const SYSTEM_REASONS = Object.freeze([
  ["PHYSICAL_COUNT_GAIN", "Physical count gain", "A count found more than the books show.", "increase", false],
  ["PHYSICAL_COUNT_LOSS", "Physical count loss", "A count found less than the books show.", "decrease", false],
  ["DATA_CORRECTION", "Data correction", "A recording error corrected; explain it in the notes.", "both", true],
  ["MIGRATION_CORRECTION", "Migration correction", "A quantity loaded wrongly from the previous system; explain it in the notes.", "both", true],
  ["TRACKING_CORRECTION", "Tracking correction", "A batch or serial number quantity corrected through controlled movements.", "both", false],
  ["OTHER", "Other", "Any other discrepancy; explain it in the notes.", "both", true],
]);
const FILE_ENTITY = "stock.inventory_adjustment";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZERO = 0n;
const UNIT = 1000000n;

const privileged = (c) => Boolean(c.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug)));
const can = (c, permission) => privileged(c) || Boolean(c.permissions?.includes(permission));
const need = (c, permission, message) => { if (!can(c, permission)) throw new AdjustmentError(403, message, "PERMISSION_DENIED"); };
const text = (value, max = 500) => { const out = String(value ?? "").trim(); return out ? out.slice(0, max) : null; };
const has = (input, key) => Object.prototype.hasOwnProperty.call(input ?? {}, key);
const fail = (field, message, code = "ADJUSTMENT_VALIDATION", status = 400) => { throw new AdjustmentError(status, message, code, { issues: [{ field, message }] }); };
const uuid = (value, label) => { const id = String(value ?? "").trim(); if (!UUID.test(id)) fail(label, `${label} is not valid.`); return id; };
const optionalUuid = (value, label) => (value === undefined || value === null || value === "" ? null : uuid(value, label));
const dec = (value) => { const out = formatDecimal(value).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ""); return out === "-0" ? "0" : out; };
const signedDec = (value) => (value > ZERO ? `+${dec(value)}` : dec(value));
const n = (value) => Math.round(Number(value ?? 0) * 1e6) / 1e6;
const absolute = (value) => (value < ZERO ? -value : value);
const dayOf = (value) => (value instanceof Date
  ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` : value ? String(value).slice(0, 10) : null);
const stockContext = (c) => ({ ...c, permissions: [...new Set([...(c.permissions ?? []), "stock.adjust", "stock.issue", "stock.receive", "stock.reserve", "stock.reservation.reallocate", "stock.view"])] });
const accountingContext = (c) => ({ ...c, permissions: [...(c.permissions ?? []), "accounting.view", "accounting.journal.create"] });
const today = async (client) => (await client.query(`SELECT current_date::text AS d`)).rows[0].d;
// A non-negative quantity typed by a person (or a signed one for a difference).
const quantityText = (value, { signed = false } = {}) => {
  const raw = String(value ?? "").trim().replace(/^\+/, "");
  return (signed ? /^-?\d+(\.\d+)?$/ : /^\d+(\.\d+)?$/).test(raw) ? raw : null;
};

async function stocked(work, label) {
  try { return await work(); } catch (error) {
    if (error instanceof StockError) {
      // Negative-Stock Control's refusals keep their code, facts and audit: an adjustment never takes stock below zero or out of a reservation.
      if (isNegativeStockCode(error.code)) throw carryNegativeStock(error, new AdjustmentError(error.status ?? 409, `${label}: ${error.message}`, error.code, error.details));
      throw new AdjustmentError(error.status ?? 409, `${label}: ${error.message}`, error.code ?? "ADJUSTMENT_STOCK_FAILED");
    }
    if (String(error?.code ?? "").startsWith("WAREHOUSE_")) throw new AdjustmentError(error.status ?? 409, `${label}: ${error.message}`, error.code);
    throw error;
  }
}
async function accounted(work) {
  try { return await work(); } catch (error) {
    if (error instanceof AccountingError) throw new AdjustmentError(error.status ?? 409, `Finance: ${error.message}`, "ADJUSTMENT_FINANCE_FAILED");
    throw error;
  }
}
async function event(client, c, adjustmentId, eventType, summary, details = {}) {
  await client.query(`INSERT INTO tenant.inventory_adjustment_events (organization_id, adjustment_id, event_type, summary, details, actor_user_id) VALUES ($1, $2, $3, $4, $5, $6)`,
    [c.organizationId, adjustmentId, eventType, String(summary).slice(0, 1000), JSON.stringify(details), c.userId ?? null]);
}
async function periodOf(client, c, day) {
  return (await client.query(
    `SELECT name, status FROM tenant.fiscal_periods WHERE organization_id = $1 AND $2::date BETWEEN start_date AND end_date ORDER BY period_type = 'standard' DESC, start_date DESC LIMIT 1`,
    [c.organizationId, day])).rows[0] ?? null;
}

// ------------------------------------------------------------------ reasons

async function ensureReasons(client, c) {
  const exists = (await client.query(`SELECT 1 FROM tenant.inventory_adjustment_reasons WHERE organization_id = $1 LIMIT 1`, [c.organizationId])).rows[0];
  if (exists) return;
  for (const [code, name, description, direction, notes] of SYSTEM_REASONS)
    await client.query(
      `INSERT INTO tenant.inventory_adjustment_reasons (organization_id, code, name, description, direction_policy, requires_notes, is_system)
       VALUES ($1, $2, $3, $4, $5, $6, true) ON CONFLICT (organization_id, code) DO NOTHING`, [c.organizationId, code, name, description, direction, notes]);
}
const accountLabel = (code, name) => (code ? `${code} · ${name}` : null);
const toReason = (row) => ({
  id: row.id, code: row.code, name: row.name, description: row.description, directionPolicy: row.direction_policy, requiresNotes: row.requires_notes,
  gainAccountId: row.gain_account_id, gainAccount: accountLabel(row.gain_code, row.gain_name), lossAccountId: row.loss_account_id, lossAccount: accountLabel(row.loss_code, row.loss_name),
  isSystem: row.is_system, status: row.status, version: row.version,
});
const REASON_SELECT = `SELECT reason.*, gain.code AS gain_code, gain.name AS gain_name, loss.code AS loss_code, loss.name AS loss_name FROM tenant.inventory_adjustment_reasons reason
  LEFT JOIN tenant.accounting_accounts gain ON gain.id = reason.gain_account_id LEFT JOIN tenant.accounting_accounts loss ON loss.id = reason.loss_account_id`;

export async function listAdjustmentReasons(client, c, { includeInactive = false } = {}) {
  need(c, P.view, "You do not have permission to view stock adjustments.");
  await ensureReasons(client, c);
  const { rows } = await client.query(`${REASON_SELECT} WHERE reason.organization_id = $1 AND ($2 OR reason.status = 'active') ORDER BY reason.is_system DESC, reason.name`,
    [c.organizationId, Boolean(includeInactive)]);
  return rows.map(toReason);
}

async function readReason(client, c, input, current = null) {
  const keep = (key, fallback) => (has(input, key) ? input[key] : fallback);
  const name = text(keep("name", current?.name), 80);
  if (!name) fail("name", "Enter the reason's name.");
  const directionPolicy = keep("directionPolicy", current?.direction_policy ?? "both");
  if (!["increase", "decrease", "both"].includes(directionPolicy)) fail("directionPolicy", "The reason increases stock, decreases it, or both.");
  const account = async (key, column, label) => {
    const id = optionalUuid(keep(key, current?.[column]), label);
    if (id && !(await client.query(`SELECT 1 FROM tenant.accounting_accounts WHERE organization_id = $1 AND id = $2 AND NOT is_group`, [c.organizationId, id])).rows[0])
      fail(key, `The ${label.toLowerCase()} was not found.`, "ADJUSTMENT_VALIDATION", 404);
    return id;
  };
  return { name, description: text(keep("description", current?.description), 500), directionPolicy, requiresNotes: Boolean(keep("requiresNotes", current?.requires_notes ?? false)),
    gainAccountId: await account("gainAccountId", "gain_account_id", "Gain account"), lossAccountId: await account("lossAccountId", "loss_account_id", "Loss account") };
}

export async function createAdjustmentReason(client, c, input = {}) {
  need(c, P.manageReasons, "You do not have permission to manage stock adjustment reasons.");
  await ensureReasons(client, c);
  const code = String(input.code ?? "").trim().toUpperCase().replace(/[^A-Z0-9_]+/g, "_");
  if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(code)) fail("code", "Use 2–40 letters, digits or underscores, starting with a letter, such as CYCLE_COUNT_GAIN.");
  if (SYSTEM_REASONS.some(([system]) => system === code)) fail("code", "That code belongs to a system reason.", "ADJUSTMENT_REASON_EXISTS", 409);
  const values = await readReason(client, c, input);
  const row = (await client.query(
    `INSERT INTO tenant.inventory_adjustment_reasons (organization_id, code, name, description, direction_policy, requires_notes, gain_account_id, loss_account_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (organization_id, code) DO NOTHING RETURNING id`,
    [c.organizationId, code, values.name, values.description, values.directionPolicy, values.requiresNotes, values.gainAccountId, values.lossAccountId, c.userId ?? null])).rows[0];
  if (!row) fail("code", `Reason ${code} already exists.`, "ADJUSTMENT_REASON_EXISTS", 409);
  return toReason((await client.query(`${REASON_SELECT} WHERE reason.id = $1`, [row.id])).rows[0]);
}

// input: name, description, directionPolicy, requiresNotes, gainAccountId, lossAccountId, status (active | inactive), expectedVersion. A reason is
// never deleted (documents keep it); it is deactivated. A system reason keeps its direction.
export async function updateAdjustmentReason(client, c, reasonId, input = {}) {
  need(c, P.manageReasons, "You do not have permission to manage stock adjustment reasons.");
  const row = (await client.query(`SELECT * FROM tenant.inventory_adjustment_reasons WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(reasonId, "Reason")])).rows[0];
  if (!row) throw new AdjustmentError(404, "Stock adjustment reason not found.", "ADJUSTMENT_REASON_NOT_FOUND");
  if (input.expectedVersion !== undefined && input.expectedVersion !== null && Number(input.expectedVersion) !== row.version)
    throw new AdjustmentError(409, "Someone else changed this reason. Reload it.", "ADJUSTMENT_VERSION_CONFLICT");
  const values = await readReason(client, c, input, row);
  if (row.is_system && values.directionPolicy !== row.direction_policy) fail("directionPolicy", "A system reason keeps its direction.");
  const status = has(input, "status") ? input.status : row.status;
  if (!["active", "inactive"].includes(status)) fail("status", "Status is active or inactive.");
  await client.query(
    `UPDATE tenant.inventory_adjustment_reasons SET name = $3, description = $4, direction_policy = $5, requires_notes = $6, gain_account_id = $7, loss_account_id = $8, status = $9,
            version = version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, row.id, values.name, values.description, values.directionPolicy, values.requiresNotes, values.gainAccountId, values.lossAccountId, status]);
  return toReason((await client.query(`${REASON_SELECT} WHERE reason.id = $1`, [row.id])).rows[0]);
}

// ------------------------------------------------------------------ the system stock a count is compared with

// The recorded stock of one position (a location, and a batch or every batch there) and the last movement that changed it: what a count is
// compared with, and how a stale count is recognized (a movement there since).
async function scopeSnapshot(client, c, { itemId, warehouseId, locationId, batchId, everyBatch = false }) {
  const values = [c.organizationId, itemId, warehouseId, locationId ?? null];
  const batch = everyBatch ? "" : ` AND batch_id IS NOT DISTINCT FROM $${values.push(batchId ?? null)}`;
  const where = `organization_id = $1 AND item_id = $2 AND warehouse_id = $3 AND warehouse_location_id IS NOT DISTINCT FROM $4${batch}`;
  const balance = (await client.query(`SELECT COALESCE(sum(quantity), 0) AS quantity, COALESCE(sum(reserved_quantity), 0) AS reserved, max(version) AS version,
      max(average_cost) FILTER (WHERE quantity > 0) AS average_cost FROM tenant.stock_balances WHERE ${where}`, values)).rows[0];
  const last = (await client.query(`SELECT id FROM tenant.stock_movements WHERE ${where} ORDER BY ledger_sequence DESC LIMIT 1`, values)).rows[0];
  return { quantity: decimal(balance.quantity), reserved: decimal(balance.reserved), version: balance.version === null ? null : Number(balance.version),
    lastMovementId: last?.id ?? null, averageCost: balance.average_cost === null ? null : Number(balance.average_cost) };
}

// The serial numbers in stock at a location.
async function serialsAt(client, c, { itemId, warehouseId, locationId }) {
  return (await client.query(
    `SELECT serial.id, serial.serial_number, serial.batch_id,
            (SELECT reservation.id FROM tenant.stock_reservations reservation WHERE reservation.organization_id = serial.organization_id AND reservation.serial_id = serial.id
               AND reservation.status = 'active' LIMIT 1) AS reservation_id
       FROM tenant.stock_serials serial
      WHERE serial.organization_id = $1 AND serial.item_id = $2 AND serial.warehouse_id = $3 AND serial.status = 'available'
        AND (serial.warehouse_location_id IS NOT DISTINCT FROM $4 OR (serial.warehouse_location_id IS NOT NULL AND $4::uuid IS NULL
             AND EXISTS (SELECT 1 FROM tenant.warehouse_locations location WHERE location.id = serial.warehouse_location_id AND location.is_default_storage)))
      ORDER BY serial.serial_number`, [c.organizationId, itemId, warehouseId, locationId ?? null])).rows;
}

// For the line editor: an item's stock in a warehouse — positions (location, batch, disposition, on hand, reserved, available), serial numbers.
export async function getAdjustmentStock(client, c, { warehouseId, itemId } = {}) {
  need(c, P.view, "You do not have permission to view stock adjustments.");
  const warehouse = uuid(warehouseId, "Warehouse");
  const visible = await visibleWarehouseIds(client, c);
  if (visible && !visible.includes(warehouse)) throw new AdjustmentError(403, "You may not work in this warehouse.", "WAREHOUSE_FORBIDDEN");
  return itemPositions(client, c, { warehouseId: warehouse, itemId: uuid(itemId, "Item") });
}

// ------------------------------------------------------------------ drafts

async function loadAdjustment(client, c, adjustmentId, { lock = false } = {}) {
  const row = (await client.query(`SELECT * FROM tenant.inventory_adjustments WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [c.organizationId, uuid(adjustmentId, "Stock adjustment")])).rows[0];
  const visible = row ? await visibleWarehouseIds(client, c) : null;
  if (!row || (visible && !visible.includes(row.warehouse_id))) throw new AdjustmentError(404, "Stock adjustment not found.", "ADJUSTMENT_NOT_FOUND");
  return row;
}

async function readHeader(client, c, input, current = null) {
  const keep = (key, column) => (has(input, key) ? input[key] : current?.[column] ?? null);
  const warehouseId = optionalUuid(keep("warehouseId", "warehouse_id"), "Warehouse");
  if (!warehouseId) fail("warehouseId", "Choose the warehouse whose stock is corrected.");
  await stocked(() => validateWarehouseOperation(client, c, warehouseId, "adjust", { label: "Warehouse" }), "Warehouse");
  const now = await today(client);
  const raw = keep("adjustmentDate", "adjustment_date");
  const adjustmentDate = text(raw instanceof Date ? dayOf(raw) : raw, 10) ?? now;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(adjustmentDate) || Number.isNaN(Date.parse(adjustmentDate))) fail("adjustmentDate", "The adjustment date is not a valid date.");
  if (adjustmentDate > now) fail("adjustmentDate", "The adjustment date cannot be in the future.");
  await ensureReasons(client, c);
  const reasonId = optionalUuid(keep("reasonId", "reason_id"), "Reason");
  if (!reasonId) fail("reasonId", "Choose why the stock is corrected.");
  const reason = (await client.query(`SELECT * FROM tenant.inventory_adjustment_reasons WHERE organization_id = $1 AND id = $2`, [c.organizationId, reasonId])).rows[0];
  if (!reason || (reason.status !== "active" && reason.id !== current?.reason_id)) fail("reasonId", "Choose an active reason.", "ADJUSTMENT_REASON_INVALID", 409);
  return { warehouseId, adjustmentDate, reason, reference: text(keep("reference", "reference"), 120), countReference: text(keep("countReference", "count_reference"), 120),
    notes: text(keep("notes", "notes"), 2000) };
}

// lines: [{ lineId?, itemId, locationId?, disposition?, entryMode: counted | difference, uomId?, countedQuantity? | difference?,
//   batches?: [{ batchId? | newBatchNumber, newExpiresOn?, counted? | difference? }] (in the line's unit),
//   missingSerialIds? (or presentSerialIds?) + foundSerialNumbers? (counted) | serialsOut? + serialsIn? (difference), valuationSource?, unitCost?, costNote?, notes? }]
// A counted line keeps the system quantity it was counted against while its count is unchanged; a new count captures the stock again.
async function readLines(client, c, warehouseId, inputLines, existing = []) {
  if (!Array.isArray(inputLines) || !inputLines.length) fail("lines", "Add the items whose stock is corrected.", "ADJUSTMENT_EMPTY");
  if (inputLines.length > 500) fail("lines", "A stock adjustment holds at most 500 lines.");
  const out = [];
  const seen = new Set();
  for (const [index, entry] of inputLines.entries()) {
    const label = `Line ${index + 1}`;
    const item = (await client.query(`SELECT id, code, name, item_type, track_inventory, tracking_type, uom_id FROM tenant.items WHERE organization_id = $1 AND id = $2
        AND lifecycle_status IN ('active', 'inactive')`, [c.organizationId, uuid(entry.itemId, `${label} item`)])).rows[0];
    if (!item) fail("itemId", `${label}: item not found.`, "ADJUSTMENT_VALIDATION", 404);
    // Only stock has a perpetual quantity to correct: a service or a non-stock item has none.
    if (!item.track_inventory) fail("itemId", `${label}: ${item.name} is not a stock item; only inventory-tracked items are adjusted.`, "ADJUSTMENT_ITEM_NOT_STOCKED", 409);
    const locationId = await stocked(() => ledgerLocation(client, c.organizationId, warehouseId, optionalUuid(entry.locationId, `${label} location`), { label: `${label} location` }), label);
    const disposition = text(entry.disposition, 20) ?? "available";
    if (!ADJUSTMENT_DISPOSITIONS.some((option) => option.id === disposition)) fail("disposition", `${label}: unknown disposition.`);
    const mode = entry.entryMode === "difference" ? "difference" : "counted";
    const key = `${item.id}:${locationId ?? "main"}:${disposition}`;
    if (seen.has(key)) fail("lines", `${label}: ${item.code} at this location is already on line ${[...seen].indexOf(key) + 1}; one line per item and location.`, "ADJUSTMENT_LINE_DUPLICATE");
    seen.add(key);
    // Batch and serial quantities are entered in the line's unit too; a serial number is one base unit, so serial lines are in the base unit.
    const uomId = item.tracking_type === "serial" ? item.uom_id : optionalUuid(entry.uomId, `${label} unit`) ?? item.uom_id;
    const unit = await normalizeQuantityToBase(client, c.organizationId, item.id, uomId, "1", { purpose: "inventory" });
    if (!unit.ok) fail("uomId", `${label}: ${unit.message}`, unit.code ?? "ADJUSTMENT_UOM_INVALID", 409);
    const factor = decimal(unit.factor);
    const toBase = (value) => roundMoney((decimal(value) * factor) / UNIT, 6);
    const previous = existing.find((line) => line.id === entry.lineId) ?? existing.find((line) => line.item_id === item.id && (line.location_id ?? null) === (locationId ?? null)
      && line.disposition === disposition);
    const reasonId = optionalUuid(entry.reasonId, `${label} reason`);
    if (reasonId && !(await client.query(`SELECT 1 FROM tenant.inventory_adjustment_reasons WHERE organization_id = $1 AND id = $2 AND status = 'active'`, [c.organizationId, reasonId])).rows[0])
      fail("reasonId", `${label}: choose an active reason.`, "ADJUSTMENT_REASON_INVALID", 409);
    const line = { item, locationId, disposition, mode, uomId, factor, lots: [], serials: [], notes: text(entry.notes, 500), countedAt: null, reasonId,
      valuationSource: null, unitCost: null, costNote: text(entry.costNote, 500) };

    if (item.tracking_type === "batch") {
      const batches = Array.isArray(entry.batches) ? entry.batches.filter((lot) => lot && (lot.batchId || lot.batchNumber || lot.newBatchNumber)) : [];
      if (!batches.length) fail("batches", `${label}: enter the batch (or batches) whose stock is corrected.`, "ADJUSTMENT_BATCH_REQUIRED");
      for (const lot of batches) {
        let batch = null;
        let newBatchNumber = null;
        if (lot.batchId || lot.batchNumber) {
          batch = (await client.query(`SELECT id, batch_number FROM tenant.stock_batches WHERE organization_id = $1 AND item_id = $2 AND (id::text = $3 OR lower(batch_number) = lower($3))`,
            [c.organizationId, item.id, String(lot.batchId ?? lot.batchNumber)])).rows[0];
          if (!batch) fail("batches", `${label}: batch ${lot.batchNumber ?? lot.batchId} not found for ${item.name}.`, "ADJUSTMENT_BATCH_INVALID", 404);
        } else {
          newBatchNumber = text(lot.newBatchNumber, 80);
          // A genuinely new lot is created on posting; an existing batch number is that batch, never a second identity.
          const clash = (await client.query(`SELECT id FROM tenant.stock_batches WHERE organization_id = $1 AND item_id = $2 AND lower(batch_number) = lower($3)`,
            [c.organizationId, item.id, newBatchNumber])).rows[0];
          if (clash) fail("batches", `${label}: batch ${newBatchNumber} already exists; choose it instead of creating it again.`, "ADJUSTMENT_BATCH_EXISTS", 409);
        }
        const id = batch?.id ?? null;
        if (line.lots.some((existingLot) => (id && existingLot.batchId === id) || (newBatchNumber && existingLot.newBatchNumber?.toLowerCase() === newBatchNumber.toLowerCase())))
          fail("batches", `${label}: batch ${batch?.batch_number ?? newBatchNumber} is entered twice.`, "ADJUSTMENT_BATCH_DUPLICATE");
        const expires = text(lot.newExpiresOn, 10);
        if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) fail("batches", `${label}: the expiry of batch ${newBatchNumber} is not a valid date.`);
        const prior = previous?.lots?.find((entryLot) => (id && entryLot.batch_id === id) || (newBatchNumber && entryLot.new_batch_number?.toLowerCase() === newBatchNumber.toLowerCase()));
        if (mode === "counted") {
          const counted = quantityText(lot.counted);
          if (counted === null) fail("batches", `${label}: enter what was counted of batch ${batch?.batch_number ?? newBatchNumber}.`, "ADJUSTMENT_QUANTITY_INVALID");
          const countedBase = toBase(counted);
          const keepSnapshot = prior && prior.counted_base_quantity !== null && decimal(prior.counted_base_quantity) === countedBase && previous.entry_mode === "counted";
          const snapshot = keepSnapshot ? { quantity: decimal(prior.system_base_quantity), lastMovementId: prior.last_movement_snapshot }
            : id ? await scopeSnapshot(client, c, { itemId: item.id, warehouseId, locationId, batchId: id }) : { quantity: ZERO, lastMovementId: null };
          if (!keepSnapshot) line.countedAt = "now";
          line.lots.push({ batchId: id, batchNumber: batch?.batch_number ?? newBatchNumber, newBatchNumber, newExpiresOn: expires, system: snapshot.quantity,
            lastMovementId: snapshot.lastMovementId, counted: countedBase, delta: countedBase - snapshot.quantity });
        } else {
          const difference = quantityText(lot.difference, { signed: true });
          if (difference === null || decimal(difference) === ZERO) fail("batches", `${label}: enter the difference for batch ${batch?.batch_number ?? newBatchNumber} (such as -3 or +5).`, "ADJUSTMENT_QUANTITY_INVALID");
          const current = id ? await scopeSnapshot(client, c, { itemId: item.id, warehouseId, locationId, batchId: id }) : { quantity: ZERO, lastMovementId: null };
          line.lots.push({ batchId: id, batchNumber: batch?.batch_number ?? newBatchNumber, newBatchNumber, newExpiresOn: expires, system: current.quantity, lastMovementId: current.lastMovementId,
            counted: null, delta: toBase(difference) });
        }
        if (newBatchNumber && line.lots[line.lots.length - 1].delta <= ZERO) fail("batches", `${label}: a new batch can only be found (a positive difference).`, "ADJUSTMENT_BATCH_INVALID");
      }
      line.system = line.lots.reduce((sum, lot) => add(sum, lot.system), ZERO);
      line.delta = line.lots.reduce((sum, lot) => add(sum, lot.delta), ZERO);
      line.counted = mode === "counted" ? line.lots.reduce((sum, lot) => add(sum, lot.counted), ZERO) : null;
      line.enteredCount = mode === "counted" ? roundMoney((line.counted * UNIT) / factor, 6) : null;
      line.enteredDifference = mode === "difference" ? roundMoney((line.delta * UNIT) / factor, 6) : null;
      line.lastMovementId = null;
      line.version = null;
    } else if (item.tracking_type === "serial") {
      const inStock = await serialsAt(client, c, { itemId: item.id, warehouseId, locationId });
      const lookup = async (values, labelText) => {
        const wanted = [...new Set((Array.isArray(values) ? values : String(values ?? "").split(/[\s,;]+/)).map((value) => String(value).trim()).filter(Boolean))];
        if (!wanted.length) return [];
        const rows = (await client.query(`SELECT id, serial_number, status, warehouse_id, missing_since FROM tenant.stock_serials WHERE organization_id = $1 AND item_id = $2
            AND (id::text = ANY($3::text[]) OR lower(serial_number) = ANY($4::text[]))`, [c.organizationId, item.id, wanted, wanted.map((value) => value.toLowerCase())])).rows;
        if (rows.length !== wanted.length) fail("serials", `${label}: a ${labelText} serial number was not found for ${item.name}.`, "ADJUSTMENT_SERIAL_INVALID", 404);
        return rows;
      };
      // Found: a new serial number (registered on posting) or one adjusted out as missing earlier; never one already in stock or sold.
      const found = async (values) => {
        const names = [...new Set((Array.isArray(values) ? values : String(values ?? "").split(/[\s,;]+/)).map((value) => String(value).trim()).filter(Boolean))];
        if (names.length !== (Array.isArray(values) ? values.map((value) => String(value).trim()).filter(Boolean).length : names.length))
          fail("serials", `${label}: a found serial number is entered twice.`, "ADJUSTMENT_SERIAL_DUPLICATE");
        const result = [];
        for (const name of names) {
          const known = (await client.query(`SELECT id, serial_number, status, missing_since FROM tenant.stock_serials WHERE organization_id = $1 AND lower(serial_number) = lower($2)`,
            [c.organizationId, name])).rows[0];
          if (known?.status === "available") fail("serials", `${label}: serial ${known.serial_number} is already in stock; it cannot be found again.`, "ADJUSTMENT_SERIAL_DUPLICATE", 409);
          if (known && !known.missing_since) fail("serials", `${label}: serial ${known.serial_number} left stock through a document (sold or issued); bring it back through that document's return.`,
            "ADJUSTMENT_SERIAL_DUPLICATE", 409);
          if (known && (await client.query(`SELECT 1 FROM tenant.stock_serials WHERE id = $1 AND item_id <> $2`, [known.id, item.id])).rows[0])
            fail("serials", `${label}: serial ${known.serial_number} belongs to another item.`, "ADJUSTMENT_SERIAL_DUPLICATE", 409);
          result.push({ serialId: known?.id ?? null, serialNumber: known?.serial_number ?? name });
        }
        return result;
      };
      let outSerials;
      let inSerials;
      if (mode === "counted") {
        // What was found present: named directly, or everything recorded here except the serial numbers ticked missing.
        const missing = new Set((await lookup(entry.missingSerialIds ?? [], "missing")).map((row) => row.id));
        const present = entry.presentSerialIds ? await lookup(entry.presentSerialIds, "present")
          : inStock.filter((serial) => !missing.has(serial.id)).map((serial) => ({ id: serial.id, serial_number: serial.serial_number }));
        const presentIds = new Set(present.map((row) => row.id));
        if (present.some((row) => !inStock.some((serial) => serial.id === row.id))) fail("serials", `${label}: a serial number marked present is not recorded at this location.`, "ADJUSTMENT_SERIAL_INVALID", 409);
        outSerials = inStock.filter((serial) => !presentIds.has(serial.id)).map((serial) => ({ serialId: serial.id, serialNumber: serial.serial_number }));
        inSerials = await found(entry.foundSerialNumbers ?? []);
        const keepSnapshot = previous?.entry_mode === "counted" && previous.counted_base_quantity !== null
          && decimal(previous.counted_base_quantity) === BigInt(present.length + inSerials.length) * UNIT;
        const snapshot = keepSnapshot ? { quantity: decimal(previous.system_base_quantity), lastMovementId: previous.last_movement_snapshot, version: previous.balance_version_snapshot }
          : await scopeSnapshot(client, c, { itemId: item.id, warehouseId, locationId, everyBatch: true });
        if (!keepSnapshot) line.countedAt = "now";
        line.system = snapshot.quantity;
        line.lastMovementId = snapshot.lastMovementId;
        line.version = snapshot.version;
        line.counted = BigInt(present.length + inSerials.length) * UNIT;
        line.enteredCount = line.counted;
      } else {
        const out = await lookup(entry.serialsOut ?? [], "missing");
        if (out.some((row) => !inStock.some((serial) => serial.id === row.id))) fail("serials", `${label}: a serial number marked missing is not recorded at this location.`, "ADJUSTMENT_SERIAL_INVALID", 409);
        outSerials = out.map((row) => ({ serialId: row.id, serialNumber: row.serial_number }));
        inSerials = await found(entry.serialsIn ?? []);
        if (!outSerials.length && !inSerials.length) fail("serials", `${label}: choose the serial numbers missing or found.`, "ADJUSTMENT_SERIALS_REQUIRED");
        const current = await scopeSnapshot(client, c, { itemId: item.id, warehouseId, locationId, everyBatch: true });
        line.system = current.quantity;
        line.lastMovementId = current.lastMovementId;
        line.version = current.version;
        line.counted = null;
      }
      line.serials = [...outSerials.map((serial) => ({ ...serial, direction: "out" })), ...inSerials.map((serial) => ({ ...serial, direction: "in" }))];
      line.delta = BigInt(inSerials.length - outSerials.length) * UNIT;
      line.enteredDifference = mode === "difference" ? line.delta : null;
    } else {
      if (mode === "counted") {
        const counted = quantityText(entry.countedQuantity);
        if (counted === null) fail("countedQuantity", `${label}: enter the quantity physically counted.`, "ADJUSTMENT_QUANTITY_INVALID");
        const countedBase = toBase(counted);
        const keepSnapshot = previous?.entry_mode === "counted" && previous.counted_base_quantity !== null && decimal(previous.counted_base_quantity) === countedBase;
        const snapshot = keepSnapshot ? { quantity: decimal(previous.system_base_quantity), lastMovementId: previous.last_movement_snapshot, version: previous.balance_version_snapshot }
          : await scopeSnapshot(client, c, { itemId: item.id, warehouseId, locationId, batchId: null });
        if (!keepSnapshot) line.countedAt = "now";
        else line.countedAt = previous.counted_at;
        line.system = snapshot.quantity;
        line.lastMovementId = snapshot.lastMovementId;
        line.version = snapshot.version;
        line.counted = countedBase;
        line.enteredCount = decimal(counted);
        line.delta = countedBase - snapshot.quantity;
      } else {
        const difference = quantityText(entry.difference, { signed: true });
        if (difference === null || decimal(difference) === ZERO) fail("difference", `${label}: enter the difference (such as -3 or +5).`, "ADJUSTMENT_QUANTITY_INVALID");
        const current = await scopeSnapshot(client, c, { itemId: item.id, warehouseId, locationId, batchId: null });
        line.system = current.quantity;
        line.lastMovementId = current.lastMovementId;
        line.version = current.version;
        line.counted = null;
        line.enteredDifference = decimal(difference);
        line.delta = toBase(difference);
      }
    }
    if (line.countedAt === null && mode === "counted" && previous?.counted_at) line.countedAt = previous.counted_at;
    // Stock found needs a cost basis: the current valuation cost by default; an entered cost or zero cost only with their permissions.
    const source = text(entry.valuationSource, 40) ?? "current_valuation_cost";
    if (!VALUATION_SOURCES.some((option) => option.id === source)) fail("valuationSource", `${label}: unknown cost basis.`);
    if (source === "manual_authorized_cost") {
      need(c, P.manualCost, `${label}: you do not have permission to enter the cost of stock found.`);
      const cost = quantityText(entry.unitCost);
      if (cost === null || decimal(cost) <= ZERO) fail("unitCost", `${label}: enter the authorized unit cost (per base unit). Zero cost is its own choice.`, "ADJUSTMENT_COST_REQUIRED");
      if (!line.costNote) fail("costNote", `${label}: say where the cost comes from.`, "ADJUSTMENT_COST_REQUIRED");
      line.unitCost = decimal(cost);
    }
    if (source === "zero_cost_authorized") {
      need(c, P.zeroCost, `${label}: you do not have permission to add stock at zero cost.`);
      if (!line.costNote) fail("costNote", `${label}: say why the stock found has no cost.`, "ADJUSTMENT_COST_REQUIRED");
    }
    line.valuationSource = source;
    out.push(line);
  }
  return out;
}

async function writeLines(client, c, adjustmentId, lines) {
  await client.query(`DELETE FROM tenant.inventory_adjustment_lines WHERE organization_id = $1 AND adjustment_id = $2`, [c.organizationId, adjustmentId]);
  for (const [index, line] of lines.entries()) {
    const id = (await client.query(
      `INSERT INTO tenant.inventory_adjustment_lines (organization_id, adjustment_id, line_number, item_id, item_snapshot, location_id, disposition, entry_mode, system_base_quantity,
         balance_version_snapshot, last_movement_snapshot, counted_at, uom_id, conversion_factor, counted_quantity, counted_base_quantity, entered_difference, adjustment_base_quantity,
         valuation_source, manual_unit_cost, cost_note, notes, reason_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CASE WHEN $12::text = 'now' THEN now() ELSE $12::timestamptz END, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23) RETURNING id`,
      [c.organizationId, adjustmentId, index + 1, line.item.id, JSON.stringify({ code: line.item.code, name: line.item.name, trackingType: line.item.tracking_type }), line.locationId,
        line.disposition, line.mode, formatDecimal(line.system), line.version ?? null, line.lastMovementId ?? null,
        line.countedAt instanceof Date ? line.countedAt.toISOString() : line.countedAt, line.uomId, formatDecimal(line.factor),
        line.mode === "counted" ? formatDecimal(line.enteredCount) : null, line.mode === "counted" ? formatDecimal(line.counted) : null,
        line.mode === "difference" ? formatDecimal(line.enteredDifference) : null, formatDecimal(line.delta), line.valuationSource,
        line.unitCost === null ? null : formatDecimal(line.unitCost), line.costNote, line.notes, line.reasonId ?? null])).rows[0].id;
    for (const lot of line.lots)
      await client.query(
        `INSERT INTO tenant.inventory_adjustment_lot_allocations (organization_id, adjustment_line_id, batch_id, new_batch_number, new_expires_on, system_base_quantity, last_movement_snapshot,
           counted_base_quantity, adjustment_base_quantity) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [c.organizationId, id, lot.batchId, lot.newBatchNumber, lot.newExpiresOn, formatDecimal(lot.system), lot.lastMovementId, lot.counted === null ? null : formatDecimal(lot.counted),
          formatDecimal(lot.delta)]);
    for (const serial of line.serials)
      await client.query(`INSERT INTO tenant.inventory_adjustment_serials (organization_id, adjustment_line_id, direction, serial_id, serial_number) VALUES ($1, $2, $3, $4, $5)`,
        [c.organizationId, id, serial.direction, serial.serialId, serial.serialNumber]);
  }
}

async function lineRows(client, c, adjustmentId) {
  const lines = (await client.query(
    `SELECT line.*, item.code AS sku, item.name AS item_name, item.tracking_type, item.track_inventory, item.standard_cost, item.uom_id AS base_uom_id, uom.code AS uom_code,
            base.code AS base_uom_code, location.code AS location_code, location.name AS location_name
       FROM tenant.inventory_adjustment_lines line
       JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
       LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = line.organization_id AND uom.id = line.uom_id
       LEFT JOIN tenant.units_of_measure base ON base.organization_id = item.organization_id AND base.id = item.uom_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = line.organization_id AND location.id = line.location_id
      WHERE line.organization_id = $1 AND line.adjustment_id = $2 ORDER BY line.line_number`, [c.organizationId, adjustmentId])).rows;
  const ids = lines.map((line) => line.id);
  const lots = (await client.query(
    `SELECT allocation.*, batch.batch_number, batch.expires_on, batch.status AS batch_status FROM tenant.inventory_adjustment_lot_allocations allocation
       LEFT JOIN tenant.stock_batches batch ON batch.id = allocation.batch_id
      WHERE allocation.organization_id = $1 AND allocation.adjustment_line_id = ANY($2::uuid[]) ORDER BY COALESCE(batch.batch_number, allocation.new_batch_number)`, [c.organizationId, ids])).rows;
  const serials = (await client.query(`SELECT * FROM tenant.inventory_adjustment_serials WHERE organization_id = $1 AND adjustment_line_id = ANY($2::uuid[]) ORDER BY direction DESC, serial_number`,
    [c.organizationId, ids])).rows;
  return lines.map((line) => ({ ...line, lots: lots.filter((lot) => lot.adjustment_line_id === line.id), serials: serials.filter((serial) => serial.adjustment_line_id === line.id) }));
}

const describe = (lines) => {
  const up = lines.filter((line) => line.delta > ZERO).length;
  const down = lines.filter((line) => line.delta < ZERO).length;
  return `${lines.length} line${lines.length === 1 ? "" : "s"}${up ? ` · ${up} up` : ""}${down ? ` · ${down} down` : ""}`;
};

// createInventoryAdjustment. input: { warehouseId, adjustmentDate?, reasonId, reference?, countReference?, notes?, lines, idempotencyKey? }. A draft
// is saved even if stock, tracking or cost are not final yet: posting decides. options.physicalCountId: set only by a stock count posting its variances.
export async function createInventoryAdjustment(client, c, input = {}, options = {}) {
  need(c, P.create, "You do not have permission to create stock adjustments.");
  const key = text(input.idempotencyKey, 200);
  if (key) {
    const done = (await client.query(`SELECT id FROM tenant.inventory_adjustments WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { ...(await getInventoryAdjustment(client, c, done.id)), replayed: true };
  }
  const header = await readHeader(client, c, input);
  if (input.lines?.some?.((line) => line?.entryMode !== "difference")) need(c, P.count, "You do not have permission to enter physical counts.");
  const lines = await readLines(client, c, header.warehouseId, input.lines);
  const number = await nextDocumentNumber(client, c, { documentType: "inventory_adjustment", at: new Date(`${header.adjustmentDate}T12:00:00Z`) });
  const id = (await client.query(
    `INSERT INTO tenant.inventory_adjustments (organization_id, document_number, warehouse_id, adjustment_date, reason_id, reference, count_reference, physical_count_id, notes, idempotency_key,
       created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11) RETURNING id`,
    [c.organizationId, number, header.warehouseId, header.adjustmentDate, header.reason.id, header.reference, header.countReference, options.physicalCountId ?? null, header.notes, key,
      c.userId ?? null])).rows[0].id;
  await writeLines(client, c, id, lines);
  await event(client, c, id, "created", `Drafted: ${describe(lines)} · ${header.reason.name}`, { lines: lines.length });
  const counted = lines.filter((line) => line.mode === "counted");
  if (counted.length) await event(client, c, id, "snapshot", `System stock captured for ${counted.length} counted line${counted.length === 1 ? "" : "s"}`);
  return { ...(await getInventoryAdjustment(client, c, id)), replayed: false };
}

// updateDraftAdjustment: any header field and the lines (replaced as a whole), with expectedVersion. Counted quantities that did not change keep the
// system stock they were counted against; changed ones capture it again.
export async function updateDraftAdjustment(client, c, adjustmentId, input = {}) {
  need(c, P.edit, "You do not have permission to edit stock adjustments.");
  const row = await loadAdjustment(client, c, adjustmentId, { lock: true });
  if (row.status !== "draft") throw new AdjustmentError(409, "Only a draft stock adjustment is edited; a posted one is reversed or corrected by a new adjustment.", "ADJUSTMENT_POSTED");
  if (input.expectedVersion !== undefined && input.expectedVersion !== null && Number(input.expectedVersion) !== row.version)
    throw new AdjustmentError(409, "Someone else changed this stock adjustment. Reload it and enter your change again.", "ADJUSTMENT_VERSION_CONFLICT");
  const header = await readHeader(client, c, input, row);
  const changes = [];
  if (header.reason.id !== row.reason_id) changes.push(`reason → ${header.reason.name}`);
  if (header.warehouseId !== row.warehouse_id) changes.push("warehouse changed");
  if (Array.isArray(input.lines)) {
    if (input.lines.some((line) => line?.entryMode !== "difference")) need(c, P.count, "You do not have permission to enter physical counts.");
    const before = header.warehouseId === row.warehouse_id ? await lineRows(client, c, row.id) : [];
    const lines = await readLines(client, c, header.warehouseId, input.lines, before);
    await writeLines(client, c, row.id, lines);
    const recaptured = lines.filter((line) => line.countedAt === "now").length;
    changes.push(`lines: ${describe(lines)}`);
    if (recaptured) await event(client, c, row.id, "snapshot", `System stock captured again for ${recaptured} recounted line${recaptured === 1 ? "" : "s"}`);
  } else if (header.warehouseId !== row.warehouse_id) fail("lines", "Re-enter the lines for the new warehouse (its locations and stock differ).");
  await client.query(
    `UPDATE tenant.inventory_adjustments SET warehouse_id = $3, adjustment_date = $4, reason_id = $5, reference = $6, count_reference = $7, notes = $8, version = version + 1, updated_by = $9,
            updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, row.id, header.warehouseId, header.adjustmentDate, header.reason.id, header.reference, header.countReference, header.notes, c.userId ?? null]);
  await event(client, c, row.id, "updated", changes.length ? `Draft changed: ${changes.join(", ")}` : "Draft changed");
  return getInventoryAdjustment(client, c, row.id);
}

// Recheck stock after a recount: the counted lines are compared with the stock recorded now (the person confirms the counts still hold).
export async function refreshAdjustmentSnapshot(client, c, adjustmentId) {
  need(c, P.count, "You do not have permission to enter physical counts.");
  const row = await loadAdjustment(client, c, adjustmentId, { lock: true });
  if (row.status !== "draft") throw new AdjustmentError(409, "Only a draft's counts are rechecked.", "ADJUSTMENT_POSTED");
  const lines = await lineRows(client, c, row.id);
  let refreshed = 0;
  for (const line of lines.filter((entry) => entry.entry_mode === "counted")) {
    if (line.tracking_type === "batch") {
      let delta = ZERO;
      let system = ZERO;
      for (const lot of line.lots) {
        const snapshot = lot.batch_id ? await scopeSnapshot(client, c, { itemId: line.item_id, warehouseId: row.warehouse_id, locationId: line.location_id, batchId: lot.batch_id })
          : { quantity: ZERO, lastMovementId: null };
        const lotDelta = decimal(lot.counted_base_quantity) - snapshot.quantity;
        await client.query(`UPDATE tenant.inventory_adjustment_lot_allocations SET system_base_quantity = $2, last_movement_snapshot = $3, adjustment_base_quantity = $4 WHERE id = $1`,
          [lot.id, formatDecimal(snapshot.quantity), snapshot.lastMovementId, formatDecimal(lotDelta)]);
        delta += lotDelta;
        system += snapshot.quantity;
      }
      await client.query(`UPDATE tenant.inventory_adjustment_lines SET system_base_quantity = $2, adjustment_base_quantity = $3, counted_at = now() WHERE id = $1`,
        [line.id, formatDecimal(system), formatDecimal(delta)]);
    } else if (line.tracking_type === "serial") {
      // A serial count names what is present: recheck it by recounting (editing the line).
      continue;
    } else {
      const snapshot = await scopeSnapshot(client, c, { itemId: line.item_id, warehouseId: row.warehouse_id, locationId: line.location_id, batchId: null });
      await client.query(`UPDATE tenant.inventory_adjustment_lines SET system_base_quantity = $2, last_movement_snapshot = $3, balance_version_snapshot = $4, adjustment_base_quantity = $5,
          counted_at = now() WHERE id = $1`, [line.id, formatDecimal(snapshot.quantity), snapshot.lastMovementId, snapshot.version, formatDecimal(decimal(line.counted_base_quantity) - snapshot.quantity)]);
    }
    refreshed += 1;
  }
  await client.query(`UPDATE tenant.inventory_adjustments SET version = version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id]);
  await event(client, c, row.id, "snapshot", `Stock rechecked: ${refreshed} counted line${refreshed === 1 ? "" : "s"} compared with the stock recorded now`);
  return getInventoryAdjustment(client, c, row.id);
}

export async function cancelDraftAdjustment(client, c, adjustmentId, input = {}) {
  need(c, P.edit, "You do not have permission to cancel stock adjustments.");
  const row = await loadAdjustment(client, c, adjustmentId, { lock: true });
  if (row.status === "cancelled") return { ...(await getInventoryAdjustment(client, c, row.id)), replayed: true };
  if (row.status !== "draft") throw new AdjustmentError(409, "A posted stock adjustment is not cancelled; reverse it.", "ADJUSTMENT_POSTED");
  const reason = text(input.reason, 500);
  await client.query(`UPDATE tenant.inventory_adjustments SET status = 'cancelled', cancelled_by = $3, cancelled_at = now(), cancel_reason = $4, version = version + 1, updated_at = now()
     WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, c.userId ?? null, reason]);
  await event(client, c, row.id, "cancelled", `Draft cancelled${reason ? `: ${reason}` : ""}`);
  return { ...(await getInventoryAdjustment(client, c, row.id)), replayed: false };
}

// ------------------------------------------------------------------ impact: what posting would do, against stock as it is now

// The parts a line posts: one per batch, one per serial number, or the line itself — each with its signed base quantity.
function partsOf(line) {
  if (line.tracking_type === "serial")
    return line.serials.map((serial) => ({ key: serial.serial_number.toLowerCase(), serialId: serial.serial_id, serialNumber: serial.serial_number, batchId: null,
      delta: serial.direction === "in" ? UNIT : -UNIT, row: serial }));
  if (line.tracking_type === "batch")
    return line.lots.map((lot) => ({ key: lot.batch_id ?? `new:${lot.new_batch_number.toLowerCase()}`, batchId: lot.batch_id, batch: lot.batch_number ?? lot.new_batch_number,
      newBatchNumber: lot.new_batch_number, delta: decimal(lot.adjustment_base_quantity), row: lot }));
  return [{ key: "all", batchId: null, delta: decimal(line.adjustment_base_quantity), row: null }];
}

// The reservations a shortage at one position would break: the active ones on that very stock (or on a missing serial number).
async function reservationsOn(client, c, { itemId, warehouseId, locationId, batchId, serialId }) {
  return (await client.query(
    `SELECT reservation.id, reservation.reservation_number, reservation.reference_type, reservation.active_quantity, reservation.serial_id,
            COALESCE(sales_order.sales_order_number, line_order.sales_order_number, transfer.document_number, purchase_return.return_number) AS document
       FROM tenant.stock_reservations reservation
       LEFT JOIN tenant.sales_orders sales_order ON sales_order.id = reservation.reference_id AND reservation.reference_type = 'sales_order'
       LEFT JOIN tenant.sales_orders line_order ON line_order.id = reservation.sales_order_id AND reservation.reference_type = 'sales_order_line'
       LEFT JOIN tenant.inventory_transfers transfer ON transfer.id = reservation.reference_id AND reservation.reference_type = 'stock_transfer'
       LEFT JOIN tenant.purchase_returns purchase_return ON purchase_return.id = reservation.reference_id AND reservation.reference_type = 'purchase_return'
      WHERE reservation.organization_id = $1 AND reservation.status = 'active' AND reservation.item_id = $2 AND reservation.warehouse_id = $3
        AND ${serialId ? "reservation.serial_id = $4" : "reservation.warehouse_location_id IS NOT DISTINCT FROM $4 AND reservation.batch_id IS NOT DISTINCT FROM $5"}
      ORDER BY reservation.created_at DESC`,
    serialId ? [c.organizationId, itemId, warehouseId, serialId] : [c.organizationId, itemId, warehouseId, locationId ?? null, batchId ?? null])).rows
    .map((row) => ({ id: row.id, number: row.reservation_number, source: row.reference_type, document: row.document, quantity: n(row.active_quantity), serialId: row.serial_id }));
}

// The cost of stock found: the authorized entered cost, zero when authorized, otherwise the current valuation cost of the item in this
// warehouse (Inventory Valuation's moving average or carrying rate). null when there is none: someone with the cost permission must decide.
async function foundCost(client, c, row, line) {
  if (line.valuation_source === "manual_authorized_cost") return line.manual_unit_cost === null ? null : Number(line.manual_unit_cost);
  if (line.valuation_source === "zero_cost_authorized") return 0;
  const rate = await currentValuationRate(client, c.organizationId, row.warehouse_id, line.item_id);
  return rate > 0 ? rate : null;
}

// Everything posting checks and shows, part by part: current on hand, reserved and available; the difference and the projected stock; a stale
// count; the reservations a shortage breaks (with the resolutions given, if any); the estimated value. resolutions: [{ reservationId,
// action: release | reallocate, quantity?, locationId?, batchId?, serialId? }].
async function evaluate(client, c, row, lines, { resolutions = [] } = {}) {
  const errors = [];
  const flag = (message, code = "ADJUSTMENT_NOT_READY", details = undefined) => errors.push({ message, code, ...(details ? { details } : {}) });
  const reason = (await client.query(`SELECT * FROM tenant.inventory_adjustment_reasons WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.reason_id])).rows[0];
  if (row.status !== "draft") flag(`The stock adjustment is ${row.status}.`, "ADJUSTMENT_POSTED");
  try { await validateWarehouseOperation(client, c, row.warehouse_id, "adjust", { label: "Warehouse" }); } catch (error) { flag(error.message, error.code); }
  if (!reason || reason.status !== "active") flag("The reason is no longer active; choose another.", "ADJUSTMENT_REASON_INVALID");
  if (reason?.requires_notes && !row.notes) flag(`${reason.name} needs notes explaining the discrepancy.`, "ADJUSTMENT_NOTES_REQUIRED");
  const day = dayOf(row.adjustment_date);
  const now = await today(client);
  if (day < now && !can(c, P.backdate)) flag(`The adjustment is dated ${day}; posting it on an earlier date needs the backdate permission.`, "PERMISSION_DENIED");
  const period = await periodOf(client, c, day);
  if (period && period.status !== "open") flag(`The accounting period ${period.name} is ${period.status}; an adjustment dated ${day} cannot be posted into it.`, "ADJUSTMENT_PERIOD_CLOSED");
  if (!lines.length) flag("The stock adjustment has no lines.", "ADJUSTMENT_EMPTY");
  const resolved = new Map(resolutions.map((entry) => [entry.reservationId, entry]));
  const reasonsById = new Map((await client.query(`SELECT * FROM tenant.inventory_adjustment_reasons WHERE organization_id = $1`, [c.organizationId])).rows.map((entry) => [entry.id, entry]));
  const out = [];
  let valueIn = 0;
  let valueOut = 0;
  for (const line of lines) {
    const label = `Line ${line.line_number} (${line.sku})`;
    const delta = decimal(line.adjustment_base_quantity);
    const view = { lineId: line.id, lineNumber: line.line_number, sku: line.sku, itemName: line.item_name, location: line.location_code ?? "MAIN", disposition: line.disposition,
      entryMode: line.entry_mode, baseUom: line.base_uom_code, difference: n(formatDecimal(delta)), stale: false, parts: [] };
    if (!line.track_inventory) flag(`${label}: no longer a stock item.`, "ADJUSTMENT_ITEM_NOT_STOCKED");
    if (delta > ZERO && !can(c, P.postIncrease)) flag(`${label}: you do not have permission to post stock increases.`, "PERMISSION_DENIED");
    if (delta < ZERO && !can(c, P.postDecrease)) flag(`${label}: you do not have permission to post stock decreases.`, "PERMISSION_DENIED");
    if (line.disposition !== "available" && !can(c, P.restricted)) flag(`${label}: you do not have permission to adjust restricted stock.`, "PERMISSION_DENIED");
    if (line.tracking_type === "batch" && !can(c, P.batch)) flag(`${label}: you do not have permission to adjust batch stock.`, "PERMISSION_DENIED");
    if (line.tracking_type === "serial" && !can(c, P.serial)) flag(`${label}: you do not have permission to adjust serial-numbered stock.`, "PERMISSION_DENIED");
    const lineReason = line.reason_id ? reasonsById.get(line.reason_id) : reason;
    if (lineReason?.direction_policy === "increase" && delta < ZERO) flag(`${label}: ${lineReason.name} only adds stock; this line removes ${dec(-delta)}.`, "ADJUSTMENT_DIRECTION_NOT_ALLOWED");
    if (lineReason?.direction_policy === "decrease" && delta > ZERO) flag(`${label}: ${lineReason.name} only removes stock; this line adds ${dec(delta)}.`, "ADJUSTMENT_DIRECTION_NOT_ALLOWED");
    if (line.tracking_type === "batch") {
      if (!line.lots.length) flag(`${label}: enter the batch whose stock is corrected.`, "ADJUSTMENT_BATCH_REQUIRED");
      if (line.lots.reduce((sum, lot) => add(sum, decimal(lot.adjustment_base_quantity)), ZERO) !== delta) flag(`${label}: the batches do not add up to the line's difference.`, "ADJUSTMENT_BATCH_TOTAL_MISMATCH");
    }
    if (line.tracking_type === "serial" && BigInt(line.serials.filter((serial) => serial.direction === "in").length - line.serials.filter((serial) => serial.direction === "out").length) * UNIT !== delta)
      flag(`${label}: the serial numbers do not match the line's difference.`, "ADJUSTMENT_SERIAL_MISMATCH");
    // A counted line posts only if the stock it was counted against is still the stock recorded: anything moved there since makes it stale.
    if (line.entry_mode === "counted") {
      const checks = line.tracking_type === "batch" ? line.lots.filter((lot) => lot.batch_id).map((lot) => ({ batchId: lot.batch_id, snapshot: lot.system_base_quantity, last: lot.last_movement_snapshot }))
        : [{ batchId: null, everyBatch: line.tracking_type === "serial", snapshot: line.system_base_quantity, last: line.last_movement_snapshot }];
      for (const check of checks) {
        const now_ = await scopeSnapshot(client, c, { itemId: line.item_id, warehouseId: row.warehouse_id, locationId: line.location_id, batchId: check.batchId, everyBatch: check.everyBatch });
        if ((now_.lastMovementId ?? null) !== (check.last ?? null) || now_.quantity !== decimal(check.snapshot)) {
          view.stale = true;
          flag(`${label}: stock changed after this count was captured (${dec(decimal(check.snapshot))} then, ${dec(now_.quantity)} now). Recount, or recheck the stock, before posting.`,
            "ADJUSTMENT_COUNT_STALE", { lineId: line.id, counted: dec(decimal(check.snapshot)), current: dec(now_.quantity) });
        }
      }
    }
    for (const part of partsOf(line)) {
      if (part.delta === ZERO) continue;
      const where = `${line.location_code ?? "MAIN"}${part.batch ? ` / batch ${part.batch}` : ""}${part.serialNumber ? ` / ${part.serialNumber}` : ""}`;
      // The stock keeps its disposition: the line's must be the position's (a location's, or an expired or blocked batch).
      const expected = (await dispositionAt(client, c.organizationId, line.location_id)) === "available" && part.row?.batch_status && (part.row.batch_status !== "active"
        || (part.row.expires_on && dayOf(part.row.expires_on) < now)) ? "expired" : await dispositionAt(client, c.organizationId, line.location_id);
      if (expected !== line.disposition)
        flag(`${label}: stock at ${where} is ${ADJUSTMENT_DISPOSITIONS.find((entry) => entry.id === expected)?.label.toLowerCase() ?? expected}, not ${line.disposition.replace(/_/g, " ")}. An adjustment never changes disposition.`,
          "ADJUSTMENT_DISPOSITION_MISMATCH");
      const position = part.newBatchNumber ? { quantity: ZERO, reserved: ZERO, averageCost: null }
        : await scopeSnapshot(client, c, { itemId: line.item_id, warehouseId: row.warehouse_id, locationId: line.location_id, batchId: part.batchId, everyBatch: line.tracking_type === "serial" });
      const partView = { key: part.key, batch: part.batch ?? null, serial: part.serialNumber ?? null, onHand: n(formatDecimal(position.quantity)), reserved: n(formatDecimal(position.reserved)),
        available: n(formatDecimal(position.quantity - position.reserved)), difference: n(formatDecimal(part.delta)), projectedOnHand: n(formatDecimal(position.quantity + part.delta)),
        projectedReserved: n(formatDecimal(position.reserved)), reservations: [], shortfall: 0 };
      if (part.delta < ZERO) {
        const removing = -part.delta;
        if (line.tracking_type !== "serial" && removing > position.quantity)
          flag(`${label}: this adjustment would create negative stock — ${dec(removing)} cannot be removed from ${where}; only ${dec(position.quantity)} is recorded there.`, "ADJUSTMENT_EXCEEDS_ON_HAND");
        // Reserved stock stays protected: a shortage that would leave reservations larger than the stock must resolve them first.
        const affected = await reservationsOn(client, c, { itemId: line.item_id, warehouseId: row.warehouse_id, locationId: line.location_id, batchId: part.batchId,
          serialId: line.tracking_type === "serial" ? part.serialId : null });
        // Only stock that exists can break a reservation: what is removed beyond the unreserved stock, up to what is reserved.
        let shortfall = line.tracking_type === "serial" ? (affected.length ? UNIT : ZERO)
          : (removing > position.quantity ? position.quantity : removing) - (position.quantity - position.reserved);
        if (shortfall < ZERO || !affected.length) shortfall = ZERO;
        let covered = ZERO;
        for (const reservation of affected) {
          const resolution = resolved.get(reservation.id);
          if (resolution) covered += resolution.action === "release" && resolution.quantity !== undefined && resolution.quantity !== null
            ? decimal(String(resolution.quantity)) : decimal(String(reservation.quantity));
        }
        if (shortfall > ZERO) {
          partView.reservations = affected.map((reservation) => ({ ...reservation, resolution: resolved.get(reservation.id) ?? null }));
          partView.shortfall = n(formatDecimal(shortfall));
          partView.projectedReserved = n(formatDecimal(position.reserved - (covered > shortfall ? shortfall : covered)));
          if (covered < shortfall)
            flag(`${label}: removing ${dec(removing)} at ${where} leaves ${dec(shortfall - covered)} reserved unit${shortfall - covered === UNIT ? "" : "s"} that can no longer be fulfilled `
              + `(${affected.map((reservation) => `${reservation.number}${reservation.document ? ` for ${reservation.document}` : ""}`).join(", ")}). Release or reallocate them as part of posting.`,
            "ADJUSTMENT_RESERVATION_CONFLICT", { lineId: line.id, shortfall: dec(shortfall - covered) });
          if (covered > ZERO && !can(c, P.resolveReservations)) flag(`${label}: you do not have permission to resolve reservation conflicts.`, "PERMISSION_DENIED");
        }
        const cost = position.averageCost ?? 0;
        partView.value = -Math.round(Number(formatDecimal(removing)) * cost * 100) / 100;
        valueOut += Number(formatDecimal(removing)) * cost;
      } else {
        const cost = await foundCost(client, c, row, line, part);
        if (cost === null)
          flag(`${label}: there is no current valuation cost for ${line.sku}; someone with the cost permission enters the authorized cost or authorizes zero cost.`, "ADJUSTMENT_COST_REQUIRED");
        partView.unitCost = cost;
        partView.value = Math.round(Number(formatDecimal(part.delta)) * (cost ?? 0) * 100) / 100;
        valueIn += Number(formatDecimal(part.delta)) * (cost ?? 0);
      }
      view.parts.push(partView);
    }
    if (line.valuation_source === "manual_authorized_cost" && delta > ZERO && !can(c, P.manualCost)) flag(`${label}: you do not have permission to post an entered cost.`, "PERMISSION_DENIED");
    if (line.valuation_source === "zero_cost_authorized" && delta > ZERO && !can(c, P.zeroCost)) flag(`${label}: you do not have permission to add stock at zero cost.`, "PERMISSION_DENIED");
    out.push(view);
  }
  const value = { increase: Math.round(valueIn * 100) / 100, decrease: Math.round(valueOut * 100) / 100, net: Math.round((valueIn - valueOut) * 100) / 100 };
  const threshold = (await client.query(`SELECT adjustment_value_threshold FROM tenant.stock_settings WHERE organization_id = $1`, [c.organizationId])).rows[0]?.adjustment_value_threshold;
  const large = threshold !== null && threshold !== undefined && Math.max(value.increase, value.decrease) > Number(threshold);
  if (large && !can(c, P.postLarge))
    flag(`This adjustment moves ${Math.max(value.increase, value.decrease).toFixed(2)} of inventory value, above the ${Number(threshold).toFixed(2)} threshold; an inventory manager posts it.`, "PERMISSION_DENIED");
  return { ready: errors.length === 0, errors, lines: out, value, large };
}

const shown = (c, result) => ({ ready: result.ready, errors: result.errors, large: result.large,
  lines: result.lines.map((line) => ({ ...line, parts: line.parts.map((part) => (can(c, P.viewCost) ? part : { ...part, value: undefined, unitCost: undefined })) })),
  ...(can(c, P.viewCost) ? { value: result.value } : {}) });

// The preview: what posting would do now (and with the given reservation resolutions).
export async function getAdjustmentImpact(client, c, adjustmentId, input = {}) {
  need(c, P.view, "You do not have permission to view stock adjustments.");
  const row = await loadAdjustment(client, c, adjustmentId);
  return shown(c, await evaluate(client, c, row, await lineRows(client, c, row.id), { resolutions: readResolutions(input.resolutions) }));
}

export async function validateInventoryAdjustment(client, c, adjustmentId) {
  const impact = await getAdjustmentImpact(client, c, adjustmentId);
  return { ready: impact.ready, errors: impact.errors };
}

function readResolutions(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail("resolutions", "Reservation resolutions are a list.");
  return value.map((entry, index) => {
    const action = entry?.action;
    if (!["release", "reallocate"].includes(action)) fail("resolutions", `Resolution ${index + 1}: release or reallocate the reservation.`);
    const quantity = entry.quantity === undefined || entry.quantity === null || entry.quantity === "" ? null : quantityText(entry.quantity);
    if (entry.quantity !== undefined && entry.quantity !== null && entry.quantity !== "" && (quantity === null || decimal(quantity) <= ZERO))
      fail("resolutions", `Resolution ${index + 1}: the quantity released is not valid.`);
    return { reservationId: uuid(entry.reservationId, `Resolution ${index + 1} reservation`), action, quantity: action === "release" ? quantity : null,
      locationId: optionalUuid(entry.locationId, "Reallocate to location"), batchId: optionalUuid(entry.batchId, "Reallocate to batch"), serialId: optionalUuid(entry.serialId, "Reallocate to serial") };
  });
}

// ------------------------------------------------------------------ posting

// postInventoryAdjustment: under the document's lock and every item's stock lock, re-checked against current stock (a stale count is refused),
// the reservations a shortage breaks resolved as given (released, or reallocated to other stock), Adjustment In / Out posted through the Stock
// Ledger (one posting; one movement per batch or serial number; zero lines post nothing), the gain / loss journal posted, the document marked
// Posted — together, once. input: { resolutions? }.
export async function postInventoryAdjustment(client, c, adjustmentId, input = {}) {
  need(c, P.view, "You do not have permission to view stock adjustments.");
  if (!can(c, P.postIncrease) && !can(c, P.postDecrease)) throw new AdjustmentError(403, "You do not have permission to post stock adjustments.", "PERMISSION_DENIED");
  const row = await loadAdjustment(client, c, adjustmentId, { lock: true });
  if (row.status === "posted" || row.status === "reversed") return { ...(await getInventoryAdjustment(client, c, row.id)), replayed: true };
  const resolutions = readResolutions(input.resolutions);
  const lines = await lineRows(client, c, row.id);
  // Every item's stock is locked first, in one order, so a delivery, transfer or another adjustment of the same stock waits — no interleaving.
  for (const itemId of [...new Set(lines.map((line) => line.item_id))].sort()) await lockInventoryItem(client, c, itemId);
  const check = await evaluate(client, c, row, lines, { resolutions });
  if (!check.ready) {
    const codes = [...new Set(check.errors.map((entry) => entry.code))];
    throw new AdjustmentError(codes.includes("PERMISSION_DENIED") ? 403 : 409, check.errors[0].message, codes.length === 1 ? codes[0] : "ADJUSTMENT_NOT_READY",
      { errors: check.errors, impact: shown(c, check) });
  }
  const reason = (await client.query(`SELECT * FROM tenant.inventory_adjustment_reasons WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.reason_id])).rows[0];
  const stock = stockContext(c);
  const label = (line) => `Line ${line.line_number} (${line.sku})`;
  // Reservations first: released or reallocated so that what remains reserved still exists after the shortage.
  for (const resolution of resolutions) {
    const reservation = (await client.query(`SELECT reservation_number FROM tenant.stock_reservations WHERE organization_id = $1 AND id = $2 AND status = 'active'`,
      [c.organizationId, resolution.reservationId])).rows[0];
    if (!reservation) fail("resolutions", "A reservation to resolve is no longer active.", "ADJUSTMENT_RESERVATION_CONFLICT", 409);
    const why = `${row.document_number}: stock found missing at the count`;
    if (resolution.action === "release")
      await stocked(() => releaseStockReservation(client, stock, resolution.reservationId, { status: "released", quantity: resolution.quantity, reasonCode: "adjustment_shortage", reason: why }),
        `Reservation ${reservation.reservation_number}`);
    else
      await stocked(() => reallocateStockReservation(client, stock, resolution.reservationId, { reason: why, locationId: resolution.locationId, batchId: resolution.batchId, serialId: resolution.serialId }),
        `Reservation ${reservation.reservation_number}`);
    await event(client, c, row.id, "reservation_resolved", `${resolution.action === "release" ? "Released" : "Reallocated"} reservation ${reservation.reservation_number}`
      + `${resolution.quantity ? ` (${resolution.quantity})` : ""}`, resolution);
    const serial = (await client.query(`SELECT serial_id FROM tenant.stock_reservations WHERE id = $1`, [resolution.reservationId])).rows[0]?.serial_id;
    if (serial) await client.query(`UPDATE tenant.inventory_adjustment_serials SET reservation_resolution = $2 WHERE organization_id = $1 AND serial_id = $3
        AND adjustment_line_id IN (SELECT id FROM tenant.inventory_adjustment_lines WHERE adjustment_id = $4)`, [c.organizationId, JSON.stringify(resolution), serial, row.id]);
  }
  const day = dayOf(row.adjustment_date);
  const group = await openMovementGroup(client, c, { sourceType: "inventory_adjustment", sourceId: row.id, sourceNumber: row.document_number, operation: "adjustment",
    postingKey: `inventory_adjustment:${row.id}:post`, effectiveAt: `${day} 12:00`, reason: reason.name });
  const values = [];
  for (const line of lines) {
    const factor = decimal(line.conversion_factor);
    const movements = [];
    for (const part of partsOf(line)) {
      if (part.delta === ZERO) continue;
      const quantity = absolute(part.delta);
      let batchId = part.batchId;
      // A genuinely new lot found: its batch is created now, with its expiry.
      if (!batchId && part.newBatchNumber)
        batchId = (await client.query(`INSERT INTO tenant.stock_batches (organization_id, item_id, batch_number, expires_on, status, notes, created_by) VALUES ($1, $2, $3, $4, 'active', $5, $6)
            ON CONFLICT DO NOTHING RETURNING id`, [c.organizationId, line.item_id, part.newBatchNumber, part.row.new_expires_on, `Found by stock adjustment ${row.document_number}`, c.userId ?? null])).rows[0]?.id
          ?? fail("batches", `${label(line)}: batch ${part.newBatchNumber} was created meanwhile; choose it.`, "ADJUSTMENT_BATCH_EXISTS", 409);
      let serialId = part.serialId;
      let serialRegistered = false;
      if (line.tracking_type === "serial" && part.delta > ZERO && !serialId) {
        serialId = (await client.query(`INSERT INTO tenant.stock_serials (organization_id, item_id, serial_number, warehouse_id, warehouse_location_id, status) VALUES ($1, $2, $3, $4, $5, 'available')
            ON CONFLICT DO NOTHING RETURNING id`, [c.organizationId, line.item_id, part.serialNumber, row.warehouse_id, line.location_id])).rows[0]?.id
          ?? fail("serials", `${label(line)}: serial ${part.serialNumber} already exists.`, "ADJUSTMENT_SERIAL_DUPLICATE", 409);
        serialRegistered = true;
        await client.query(`UPDATE tenant.inventory_adjustment_serials SET serial_id = $2 WHERE id = $1`, [part.row.id, serialId]);
      }
      const unitCost = part.delta > ZERO ? await foundCost(client, c, row, line, part) : undefined;
      const costSource = part.delta > ZERO ? line.valuation_source ?? "current_valuation_cost" : undefined;
      const movement = await withActiveBatch(client, c, batchId, () => stocked(() => postStockMovement(client, stock, {
        movementType: "adjustment", adjustmentDirection: part.delta > ZERO ? "increase" : "decrease", itemId: line.item_id, warehouseId: row.warehouse_id, warehouseLocationId: line.location_id,
        batchId: batchId ?? undefined, serialId: serialId ?? undefined, serialRegistered, quantity: formatDecimal(quantity), unitCost: unitCost === undefined ? undefined : String(unitCost), costSource,
        ledgerType: part.delta > ZERO ? "adjustment_in" : "adjustment_out", referenceType: "inventory_adjustment_line", referenceId: line.id, groupId: group.id, occurredOn: day,
        physicalCountId: row.physical_count_id ?? undefined, reason: `${row.document_number} · ${reason.name}`, idempotencyKey: `ia:${line.id}:${part.key}`,
        transaction: { uomId: line.uom_id, quantity: formatDecimal(roundMoney((quantity * UNIT) / factor, 6)), factor: formatDecimal(factor) },
      }), label(line)));
      // A serial number missing stays in history, out of stock and marked missing; one found again is in stock and no longer missing.
      if (serialId) await client.query(`UPDATE tenant.stock_serials SET missing_since = CASE WHEN $3 THEN NULL ELSE now() END, updated_at = now() WHERE organization_id = $1 AND id = $2`,
        [c.organizationId, serialId, part.delta > ZERO]);
      movements.push(movement);
    }
    await client.query(`UPDATE tenant.inventory_adjustment_lines SET movement_ids = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, line.id, movements.map((movement) => movement.id)]);
    // The value Inventory Valuation gave the movements (what the journal posts).
    values.push({ line, value: (await valuationOfMovements(client, c.organizationId, movements.map((movement) => movement.id))).total });
  }
  // Serial-numbered stock and its serial numbers agree after posting, or nothing posts.
  for (const line of lines.filter((entry) => entry.tracking_type === "serial")) {
    const agree = (await client.query(
      `SELECT (SELECT COALESCE(sum(quantity), 0) FROM tenant.stock_balances WHERE organization_id = $1 AND item_id = $2 AND warehouse_id = $3) AS quantity,
              (SELECT count(*) FROM tenant.stock_serials WHERE organization_id = $1 AND item_id = $2 AND warehouse_id = $3 AND status = 'available') AS serials`,
      [c.organizationId, line.item_id, row.warehouse_id])).rows[0];
    if (Number(agree.quantity) !== Number(agree.serials))
      throw new AdjustmentError(409, `${label(line)}: ${line.sku} would have ${n(agree.quantity)} on hand but ${agree.serials} serial numbers in stock in this warehouse; correct the serial numbers.`,
        "ADJUSTMENT_SERIAL_MISMATCH");
  }
  const increase = values.reduce((sum, entry) => sum + Math.max(entry.value, 0), 0);
  const decrease = values.reduce((sum, entry) => sum + Math.max(-entry.value, 0), 0);
  const journal = await postAdjustmentJournal(client, c, row, reason, values, { reverse: false, date: day });
  await client.query(
    `UPDATE tenant.inventory_adjustments SET status = 'posted', posting_date = $3, posted_by = $4, posted_at = now(), movement_group_id = $5, journal_entry_id = $6, value_increase = $7,
            value_decrease = $8, version = version + 1, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, row.id, await today(client), c.userId ?? null, group.id, journal?.journalEntryId ?? null, increase.toFixed(6), decrease.toFixed(6)]);
  const moved = values.filter((entry) => Math.abs(entry.value) > 0 || decimal(entry.line.adjustment_base_quantity) !== ZERO).length;
  await event(client, c, row.id, "posted", `Posted: ${moved} line${moved === 1 ? "" : "s"} adjusted (${reason.name})${journal ? ` · journal ${journal.entryNumber}` : ""}`,
    { groupId: group.id, journalEntryId: journal?.journalEntryId ?? null, increase, decrease });
  return { ...(await getInventoryAdjustment(client, c, row.id)), replayed: false };
}

// The gain / loss journal: stock found Dr Inventory, Cr the gain account; stock lost Dr the loss account, Cr Inventory. The accounts: the reason's,
// else the item's (or its category's) mapping, else the company's default. A reversal posts the opposite.
async function postAdjustmentJournal(client, c, row, reason, values, { reverse, date }) {
  const valued = values.filter((entry) => Math.abs(entry.value) > 1e-9);
  if (!valued.length) return null;
  const ctx = accountingContext(c);
  return accounted(async () => {
    const ledger = await getPrimaryLedger(client, ctx);
    const totals = new Map();
    const post = (accountId, debit, credit, description) => {
      const keyed = `${accountId}:${description}`;
      const current = totals.get(keyed) ?? { accountId, debit: 0, credit: 0, description };
      current.debit += debit;
      current.credit += credit;
      totals.set(keyed, current);
    };
    const lineReasons = new Map((await client.query(`SELECT * FROM tenant.inventory_adjustment_reasons WHERE organization_id = $1`, [c.organizationId])).rows.map((entry) => [entry.id, entry]));
    for (const entry of valued) {
      const inventory = (await getAccountMapping(client, ctx, ledger.id, "inventory", { itemId: entry.line.item_id, date })).account_id;
      const gain = entry.value > 0;
      const lineReason = entry.line.reason_id ? lineReasons.get(entry.line.reason_id) ?? reason : reason;
      const other = gain
        ? lineReason.gain_account_id ?? (await getAccountMapping(client, ctx, ledger.id, "inventory_adjustment_gain", { itemId: entry.line.item_id, date })).account_id
        : lineReason.loss_account_id ?? (await getAccountMapping(client, ctx, ledger.id, "inventory_adjustment_loss", { itemId: entry.line.item_id, date })).account_id;
      const amount = Math.abs(entry.value);
      if (gain) { post(inventory, amount, 0, "Inventory"); post(other, 0, amount, "Inventory adjustment gain"); }
      else { post(other, amount, 0, "Inventory adjustment loss"); post(inventory, 0, amount, "Inventory"); }
    }
    const money = (value) => (Math.round(value * 100) / 100).toFixed(2);
    const what = `${row.document_number} · ${reason.name}`;
    const lines = [...totals.values()].filter((entry) => Math.abs(entry.debit - entry.credit) > 1e-9).map((entry) => {
      const net = entry.debit - entry.credit;
      const debit = reverse ? net < 0 : net > 0;
      return { accountId: entry.accountId, description: `${reverse ? "Reversal of " : ""}${entry.description} · ${what}`, referenceType: "inventory_adjustment", referenceId: row.id,
        debit: debit ? money(Math.abs(net)) : "0.00", credit: debit ? "0.00" : money(Math.abs(net)) };
    });
    if (!lines.length) return null;
    // Rounding to the currency: the last line carries the difference so the entry balances.
    const debit = lines.reduce((sum, line) => sum + Number(line.debit), 0);
    const credit = lines.reduce((sum, line) => sum + Number(line.credit), 0);
    if (Math.abs(debit - credit) > 0) {
      const last = lines[lines.length - 1];
      if (Number(last.debit) > 0) last.debit = money(Number(last.debit) + (credit - debit)); else last.credit = money(Number(last.credit) + (debit - credit));
    }
    const journal = (await client.query(`SELECT id FROM tenant.accounting_journals WHERE organization_id = $1 AND ledger_id = $2 AND journal_type = 'general' AND status = 'active' ORDER BY code LIMIT 1`,
      [c.organizationId, ledger.id])).rows[0];
    if (!journal) throw new AdjustmentError(409, "Finance: a General journal is not configured.", "ADJUSTMENT_FINANCE_FAILED");
    const currency = (await client.query(`SELECT base_currency FROM public.organizations WHERE id = $1`, [c.organizationId])).rows[0]?.base_currency?.trim() ?? "INR";
    const entry = await createJournalEntry(client, ctx, {
      ledgerId: ledger.id, journalId: journal.id, entryDate: date, accountingDate: date, documentDate: dayOf(row.adjustment_date), entryType: "subledger", reference: row.document_number,
      description: `${reverse ? "Stock adjustment reversed" : "Stock adjustment"} ${what}`, currencyCode: currency, exchangeRate: "1", lines,
    }, { internal: true, sourceModule: "inventory", sourceType: reverse ? "inventory_adjustment_reversal" : "inventory_adjustment", sourceId: row.id, sourceNumber: row.document_number });
    await postJournalEntry(client, ctx, entry.entry.id, { internal: true, allowDraft: true });
    return { journalEntryId: entry.entry.id, entryNumber: entry.entry.entry_number ?? entry.entry.entryNumber ?? null };
  });
}

// ------------------------------------------------------------------ reversal

// reverseInventoryAdjustment: only for a posting mistake (a later discrepancy is a new adjustment). Every movement is reversed with a compensating
// one (the originals stay), the journal is reversed, the document is Reversed — once. Stock found and since used, or a serial number since sold,
// cannot be taken back mechanically.
export async function reverseInventoryAdjustment(client, c, adjustmentId, input = {}) {
  need(c, P.reverse, "You do not have permission to reverse stock adjustments.");
  const row = await loadAdjustment(client, c, adjustmentId, { lock: true });
  if (row.status === "reversed") throw new AdjustmentError(409, "This stock adjustment was already reversed.", "ADJUSTMENT_ALREADY_REVERSED");
  if (row.status !== "posted") throw new AdjustmentError(409, "Only a posted stock adjustment is reversed.", "ADJUSTMENT_NOT_POSTED");
  const reason = text(input.reason, 500);
  if (!reason || reason.length < 3) fail("reason", "Give the reason for the reversal (the posting mistake).", "ADJUSTMENT_REASON_REQUIRED");
  const day = await today(client);
  const period = await periodOf(client, c, day);
  if (period && period.status !== "open") throw new AdjustmentError(409, `The accounting period ${period.name} is ${period.status}; the reversal cannot be posted.`, "ADJUSTMENT_PERIOD_CLOSED");
  const lines = await lineRows(client, c, row.id);
  for (const itemId of [...new Set(lines.map((line) => line.item_id))].sort()) await lockInventoryItem(client, c, itemId);
  const ids = lines.flatMap((line) => line.movement_ids);
  const stock = stockContext(c);
  const reversed = ids.length ? await stocked(() => reverseStockMovements(client, stock, ids, { reason: `${row.document_number} reversed: ${reason}`, keyPrefix: `ia-reverse:${row.id}` }),
    "Reversal") : { groupId: null, movements: [] };
  // Serial numbers return to where they were: a missing one is in stock again, a found one is out again (missing).
  for (const movement of reversed.movements.filter((entry) => entry.serial_id))
    await client.query(`UPDATE tenant.stock_serials SET missing_since = CASE WHEN $3 THEN NULL ELSE now() END, updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, movement.serial_id, Number(movement.quantity) > 0]);
  const reasonRow = (await client.query(`SELECT * FROM tenant.inventory_adjustment_reasons WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.reason_id])).rows[0];
  const values = [];
  for (const line of lines)
    values.push({ line, value: -(await valuationOfMovements(client, c.organizationId, reversed.movements.filter((movement) => movement.reference_id === line.id).map((movement) => movement.id))).total });
  const journal = await postAdjustmentJournal(client, c, row, reasonRow, values, { reverse: true, date: day });
  await client.query(`UPDATE tenant.inventory_adjustments SET status = 'reversed', reversed_by = $3, reversed_at = now(), reversal_reason = $4, reversal_group_id = $5,
      reversal_journal_entry_id = $6, version = version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, row.id, c.userId ?? null, reason, reversed.groupId, journal?.journalEntryId ?? null]);
  await event(client, c, row.id, "reversed", `Reversed: ${reason}${journal ? ` · journal ${journal.entryNumber}` : ""}`, { groupId: reversed.groupId, journalEntryId: journal?.journalEntryId ?? null });
  return { ...(await getInventoryAdjustment(client, c, row.id)), replayed: false };
}

// ------------------------------------------------------------------ reading

const SELECT = `
  SELECT adjustment.*, warehouse.code AS warehouse_code, warehouse.name AS warehouse_name, reason.code AS reason_code, reason.name AS reason_name, reason.direction_policy,
         poster.full_name AS posted_by_name, creator.full_name AS created_by_name, reverser.full_name AS reversed_by_name,
         (SELECT count(*) FROM tenant.inventory_adjustment_lines line WHERE line.adjustment_id = adjustment.id) AS line_count,
         (SELECT count(*) FROM tenant.inventory_adjustment_lines line WHERE line.adjustment_id = adjustment.id AND line.adjustment_base_quantity > 0) AS increase_lines,
         (SELECT count(*) FROM tenant.inventory_adjustment_lines line WHERE line.adjustment_id = adjustment.id AND line.adjustment_base_quantity < 0) AS decrease_lines
    FROM tenant.inventory_adjustments adjustment
    JOIN tenant.warehouses warehouse ON warehouse.organization_id = adjustment.organization_id AND warehouse.id = adjustment.warehouse_id
    JOIN tenant.inventory_adjustment_reasons reason ON reason.organization_id = adjustment.organization_id AND reason.id = adjustment.reason_id
    LEFT JOIN public.users poster ON poster.id = adjustment.posted_by
    LEFT JOIN public.users creator ON creator.id = adjustment.created_by
    LEFT JOIN public.users reverser ON reverser.id = adjustment.reversed_by`;

function toHeader(row, c) {
  const cost = can(c, P.viewCost);
  return {
    id: row.id, number: row.document_number, status: row.status, warehouseId: row.warehouse_id, warehouse: row.warehouse_code, warehouseName: row.warehouse_name,
    adjustmentDate: dayOf(row.adjustment_date), postingDate: dayOf(row.posting_date), reasonId: row.reason_id, reasonCode: row.reason_code, reason: row.reason_name,
    directionPolicy: row.direction_policy, reference: row.reference, countReference: row.count_reference, physicalCountId: row.physical_count_id, notes: row.notes,
    lineCount: Number(row.line_count ?? 0), increaseLines: Number(row.increase_lines ?? 0), decreaseLines: Number(row.decrease_lines ?? 0),
    createdAt: row.created_at, createdByName: row.created_by_name, postedAt: row.posted_at, postedByName: row.posted_by_name, cancelledAt: row.cancelled_at, cancelReason: row.cancel_reason,
    reversedAt: row.reversed_at, reversedByName: row.reversed_by_name, reversalReason: row.reversal_reason, version: row.version,
    ...(cost && row.value_increase !== null ? { valueIncrease: n(row.value_increase), valueDecrease: n(row.value_decrease), valueNet: n(Number(row.value_increase) - Number(row.value_decrease)) } : {}),
  };
}

export async function getInventoryAdjustment(client, c, adjustmentId) {
  need(c, P.view, "You do not have permission to view stock adjustments.");
  const row = (await client.query(`${SELECT} WHERE adjustment.organization_id = $1 AND adjustment.id = $2`, [c.organizationId, uuid(adjustmentId, "Stock adjustment")])).rows[0];
  const visible = row ? await visibleWarehouseIds(client, c) : null;
  if (!row || (visible && !visible.includes(row.warehouse_id))) throw new AdjustmentError(404, "Stock adjustment not found.", "ADJUSTMENT_NOT_FOUND");
  const lines = await lineRows(client, c, row.id);
  const cost = can(c, P.viewCost);
  const ledgerContext = { ...c, permissions: [...(c.permissions ?? []), "stock.ledger.view", ...(cost ? ["stock.ledger.view_cost"] : [])] };
  const ledger = row.status === "draft" || row.status === "cancelled" ? { rows: [] }
    : await getStockLedger(client, ledgerContext, { sourceType: "inventory_adjustment", sourceId: row.id, limit: 1000 });
  const history = (await client.query(
    `SELECT event.event_type, event.summary, event.created_at, actor.full_name AS actor_name FROM tenant.inventory_adjustment_events event LEFT JOIN public.users actor ON actor.id = event.actor_user_id
      WHERE event.organization_id = $1 AND event.adjustment_id = $2 ORDER BY event.created_at`, [c.organizationId, row.id])).rows
    .map((entry) => ({ type: entry.event_type, summary: entry.summary, at: entry.created_at, actor: entry.actor_name }));
  const accounting = can(c, P.viewAccounting);
  const journals = accounting
    ? (await client.query(`SELECT entry.id, entry.entry_number, entry.entry_date, entry.status, entry.source_type,
          (SELECT json_agg(json_build_object('account', account.code || ' · ' || account.name, 'debit', line.debit_amount, 'credit', line.credit_amount) ORDER BY line.sequence)
             FROM tenant.accounting_journal_lines line JOIN tenant.accounting_accounts account ON account.id = line.account_id WHERE line.journal_entry_id = entry.id) AS lines
         FROM tenant.accounting_journal_entries entry WHERE entry.organization_id = $1 AND entry.id = ANY($2::uuid[]) ORDER BY entry.created_at`,
      [c.organizationId, [row.journal_entry_id, row.reversal_journal_entry_id].filter(Boolean)])).rows.map((entry) => ({ id: entry.id, number: entry.entry_number,
        date: dayOf(entry.entry_date), status: entry.status, reversal: entry.source_type === "inventory_adjustment_reversal", href: "/accounting/journals",
        lines: (entry.lines ?? []).map((line) => ({ account: line.account, debit: n(line.debit), credit: n(line.credit) })) }))
    : null;
  const draft = row.status === "draft";
  const lineOut = lines.map((line) => {
    const lineValue = ledger.rows.filter((entry) => entry.source.lineId === line.id && entry.type !== "reversal").reduce((sum, entry) => sum + (entry.value ?? 0), 0);
    return {
      id: line.id, lineNumber: line.line_number, itemId: line.item_id, sku: line.sku, itemName: line.item_name, trackingType: line.tracking_type, locationId: line.location_id,
      location: line.location_code ?? "MAIN", disposition: line.disposition, entryMode: line.entry_mode, uomId: line.uom_id, uom: line.uom_code, conversion: n(line.conversion_factor),
      baseUom: line.base_uom_code, systemQuantity: n(line.system_base_quantity), countedQuantity: line.counted_quantity === null ? null : n(line.counted_quantity),
      countedBaseQuantity: line.counted_base_quantity === null ? null : n(line.counted_base_quantity), enteredDifference: line.entered_difference === null ? null : n(line.entered_difference),
      difference: n(line.adjustment_base_quantity), countedAt: line.counted_at, valuationSource: line.valuation_source, ...(cost ? { unitCost: line.manual_unit_cost === null ? null : n(line.manual_unit_cost) } : {}),
      costNote: line.cost_note, notes: line.notes, reasonId: line.reason_id, movementIds: line.movement_ids,
      batches: line.lots.map((lot) => ({ batchId: lot.batch_id, batch: lot.batch_number ?? lot.new_batch_number, isNew: !lot.batch_id, expiresOn: dayOf(lot.expires_on ?? lot.new_expires_on),
        systemQuantity: n(lot.system_base_quantity), countedQuantity: lot.counted_base_quantity === null ? null : n(lot.counted_base_quantity), difference: n(lot.adjustment_base_quantity) })),
      serials: line.serials.map((serial) => ({ id: serial.serial_id, serialNumber: serial.serial_number, direction: serial.direction, reservationResolution: serial.reservation_resolution })),
      ...(cost && !draft ? { value: Math.round(lineValue * 100) / 100 } : {}),
    };
  });
  const status = row.status;
  return {
    adjustment: toHeader(row, c), lines: lineOut, movements: ledger.rows, history, journals, files: await listAdjustmentFiles(client, c, row.id),
    capabilities: {
      edit: draft && can(c, P.edit), count: draft && can(c, P.count), post: draft && (can(c, P.postIncrease) || can(c, P.postDecrease)), cancel: draft && can(c, P.edit),
      reverse: status === "posted" && can(c, P.reverse), resolveReservations: can(c, P.resolveReservations), seesCost: cost, seesAccounting: accounting,
    },
  };
}

// filters: status, warehouseId, reasonId, itemId, direction (increase | decrease), from, to, postedBy, search (number, reference, count reference, notes, SKU,
// batch, serial number), limit, offset.
export async function listInventoryAdjustments(client, c, filters = {}) {
  need(c, P.view, "You do not have permission to view stock adjustments.");
  await ensureReasons(client, c);
  const values = [c.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = ["adjustment.organization_id = $1"];
  const visible = await visibleWarehouseIds(client, c);
  if (visible) where.push(`adjustment.warehouse_id = ANY(${bind(visible)}::uuid[])`);
  if (["draft", "posted", "cancelled", "reversed"].includes(filters.status)) where.push(`adjustment.status = ${bind(filters.status)}`);
  for (const [key, column] of [["warehouseId", "adjustment.warehouse_id"], ["reasonId", "adjustment.reason_id"], ["postedBy", "adjustment.posted_by"]])
    if (filters[key] && UUID.test(filters[key])) where.push(`${column} = ${bind(filters[key])}`);
  if (filters.itemId && UUID.test(filters.itemId))
    where.push(`EXISTS (SELECT 1 FROM tenant.inventory_adjustment_lines line WHERE line.adjustment_id = adjustment.id AND line.item_id = ${bind(filters.itemId)})`);
  if (filters.direction === "increase" || filters.direction === "decrease")
    where.push(`EXISTS (SELECT 1 FROM tenant.inventory_adjustment_lines line WHERE line.adjustment_id = adjustment.id AND line.adjustment_base_quantity ${filters.direction === "increase" ? ">" : "<"} 0)`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.from ?? ""))) where.push(`adjustment.adjustment_date >= ${bind(filters.from)}::date`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.to ?? ""))) where.push(`adjustment.adjustment_date <= ${bind(filters.to)}::date`);
  const term = text(filters.search, 120);
  if (term) {
    const like = bind(`%${term.toLowerCase()}%`);
    where.push(`(lower(concat_ws(' ', adjustment.document_number, adjustment.reference, adjustment.count_reference, adjustment.notes)) LIKE ${like}
     OR EXISTS (SELECT 1 FROM tenant.inventory_adjustment_lines line JOIN tenant.items item ON item.id = line.item_id WHERE line.adjustment_id = adjustment.id
       AND (lower(concat_ws(' ', item.code, item.name)) LIKE ${like}
         OR EXISTS (SELECT 1 FROM tenant.inventory_adjustment_lot_allocations lot LEFT JOIN tenant.stock_batches batch ON batch.id = lot.batch_id WHERE lot.adjustment_line_id = line.id
           AND lower(COALESCE(batch.batch_number, lot.new_batch_number)) LIKE ${like})
         OR EXISTS (SELECT 1 FROM tenant.inventory_adjustment_serials serial WHERE serial.adjustment_line_id = line.id AND lower(serial.serial_number) LIKE ${like}))))`);
  }
  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const total = Number((await client.query(`SELECT count(*) FROM tenant.inventory_adjustments adjustment WHERE ${where.join(" AND ")}`, values)).rows[0].count);
  const rows = (await client.query(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY adjustment.adjustment_date DESC, adjustment.document_number DESC LIMIT ${bind(limit)} OFFSET ${bind(offset)}`,
    values)).rows;
  return { total, rows: rows.map((row) => toHeader(row, c)), canCreate: can(c, P.create), seesCost: can(c, P.viewCost) };
}

// What the screens need: warehouses the user may adjust (with locations and their disposition), reasons, dispositions, cost bases, permissions.
export async function getAdjustmentOptions(client, c) {
  need(c, P.view, "You do not have permission to view stock adjustments.");
  const visible = await visibleWarehouseIds(client, c);
  const warehouses = (await client.query(`SELECT id, code, name, is_default FROM tenant.warehouses WHERE organization_id = $1 AND status = 'active' AND system_role IS NULL
      AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[])) ORDER BY is_default DESC, name`, [c.organizationId, visible])).rows;
  const locations = (await client.query(`SELECT id, warehouse_id, code, name, is_default_storage FROM tenant.warehouse_locations WHERE organization_id = $1 AND status = 'active' AND allow_stock
      AND warehouse_id = ANY($2::uuid[]) ORDER BY is_default_storage DESC, code`, [c.organizationId, warehouses.map((row) => row.id)])).rows;
  const withDisposition = [];
  for (const location of locations) withDisposition.push({ ...location, disposition: location.is_default_storage ? "available" : await dispositionAt(client, c.organizationId, location.id) });
  const threshold = (await client.query(`SELECT adjustment_value_threshold FROM tenant.stock_settings WHERE organization_id = $1`, [c.organizationId])).rows[0]?.adjustment_value_threshold ?? null;
  return {
    warehouses: warehouses.map((row) => ({ id: row.id, code: row.code, name: row.name, isDefault: row.is_default,
      locations: withDisposition.filter((location) => location.warehouse_id === row.id).map((location) => ({ id: location.id, code: location.code, name: location.name,
        isMain: location.is_default_storage, disposition: location.disposition })) })),
    reasons: await listAdjustmentReasons(client, c), dispositions: ADJUSTMENT_DISPOSITIONS, valuationSources: VALUATION_SOURCES,
    valueThreshold: threshold === null ? null : n(threshold),
    capabilities: { create: can(c, P.create), edit: can(c, P.edit), count: can(c, P.count), postIncrease: can(c, P.postIncrease), postDecrease: can(c, P.postDecrease),
      restricted: can(c, P.restricted), batch: can(c, P.batch), serial: can(c, P.serial), resolveReservations: can(c, P.resolveReservations), manualCost: can(c, P.manualCost),
      zeroCost: can(c, P.zeroCost), backdate: can(c, P.backdate), reverse: can(c, P.reverse), seesCost: can(c, P.viewCost), manageReasons: can(c, P.manageReasons) },
  };
}

// ------------------------------------------------------------------ files: count sheets, photos, reconciliation reports, migration evidence

const FILE_TYPES = Object.freeze({ pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", txt: "text/plain", csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
const toFile = (entry) => ({ id: entry.id, fileName: entry.file_name ?? entry.fileName, mimeType: entry.mime_type ?? entry.mimeType, sizeBytes: Number(entry.size_bytes ?? entry.sizeBytes ?? 0),
  uploadedAt: entry.created_at ?? entry.createdAt });

export async function prepareAdjustmentFileUpload({ fileName, bytes }, env = process.env) {
  const extension = (/\.([a-z0-9]{1,10})$/i.exec(String(fileName ?? ""))?.[1] ?? "").toLowerCase();
  if (!FILE_TYPES[extension]) throw new AdjustmentError(400, "Upload a PDF, image, text, spreadsheet or Word file.", "ADJUSTMENT_FILE_TYPE");
  return prepareFileUpload({ fileName, mimeType: FILE_TYPES[extension], bytes, maximumBytes: 10 * 1024 * 1024, allowedTypes: [...new Set(Object.values(FILE_TYPES))] }, env);
}
export async function listAdjustmentFiles(client, c, adjustmentId) {
  need(c, P.view, "You do not have permission to view stock adjustments.");
  return (await listFiles(client, { organizationId: c.organizationId, entityType: FILE_ENTITY, entityId: uuid(adjustmentId, "Stock adjustment") })).map(toFile);
}
export async function uploadAdjustmentFile(client, c, adjustmentId, input = {}, options = {}) {
  need(c, P.create, "You do not have permission to add files to stock adjustments.");
  const row = await loadAdjustment(client, c, adjustmentId);
  const file = await storeFile(client, { organizationId: c.organizationId, entityType: FILE_ENTITY, entityId: row.id, prepared: input.prepared, uploadedBy: c.userId ?? null }, options);
  await event(client, c, row.id, "file_added", `File added: ${file.fileName}`, { fileId: file.id });
  return toFile(file);
}
export async function removeAdjustmentFile(client, c, adjustmentId, fileId) {
  need(c, P.edit, "You do not have permission to remove files from stock adjustments.");
  const row = await loadAdjustment(client, c, adjustmentId);
  if (row.status !== "draft") throw new AdjustmentError(409, "A posted stock adjustment keeps its evidence.", "ADJUSTMENT_POSTED");
  await archiveFile(client, { organizationId: c.organizationId, entityType: FILE_ENTITY, entityId: row.id, fileId: uuid(fileId, "File"), actorUserId: c.userId ?? null });
  await event(client, c, row.id, "file_removed", "File removed", { fileId });
  return { removed: true };
}
export async function readAdjustmentFile(client, c, adjustmentId, fileId, options = {}) {
  need(c, P.view, "You do not have permission to view stock adjustments.");
  const row = await loadAdjustment(client, c, adjustmentId);
  const file = (await client.query(`SELECT id, file_name, mime_type FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND archived_at IS NULL`,
    [c.organizationId, FILE_ENTITY, row.id, uuid(fileId, "File")])).rows[0];
  if (!file) throw new AdjustmentError(404, "File not found.", "ADJUSTMENT_FILE_NOT_FOUND");
  const content = await readFileContent(client, { organizationId: c.organizationId, entityType: FILE_ENTITY, entityId: row.id, fileId: file.id }, options);
  return { fileName: file.file_name, mimeType: file.mime_type, body: content.body };
}
