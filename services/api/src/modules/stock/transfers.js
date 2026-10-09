// Internal Transfers: company-owned stock moved between warehouses of the company, or between locations of one warehouse. Never a sale, a purchase,
// a goods issue or a change of owner; never a change of disposition (a quality release is its own movement).
//
//   Warehouse, in transit (default): Draft → Confirmed (source stock reserved, all of it) → Dispatched (source → transit, the reservation
//     consumed) → Partially received → Completed (transit → destination). Remaining transit stock stays until it arrives or is written off.
//   Warehouse, direct: Draft → Confirmed → Completed (source → destination together).
//   Location (one warehouse): Draft → Completed.
//   Cancelled before dispatch; Reversed only to undo a posting mistake (a move back is a new transfer).
//
// Lines are entered in any of the item's units and kept with the conversion; batch-tracked lines carry their batches and serial-tracked lines
// their serial numbers — the same identities at source, in transit and at the destination. Every leg is a Stock Ledger movement at the cost the
// stock left with: no profit or loss. Confirm, dispatch and each receipt are idempotent and run under the transfer's lock.
import { STOCK_TRANSFER_PERMISSIONS as P } from "@vercentlabs/permissions";

import { add, decimal, formatDecimal, roundMoney, sub } from "../../core/decimal.js";
import { nextDocumentNumber } from "../../core/platform/numbering/index.js";
import { normalizeQuantityToBase } from "../products/uom.js";
import { visibleWarehouseIds } from "./balances.js";
import { StockError } from "./errors.js";
import { carryNegativeStock, isNegativeStockCode } from "./negative-stock-control.js";
import { consumeStockReservation, postStockMovement, releaseStockReservation, reserveStock, reverseStockMovements } from "./index.js";
import { getStockLedger } from "./ledger.js";
import { dispositionAt, ensureTransitPosition, openMovementGroup } from "./ledger-posting.js";
import { itemPositions, positionOf, withActiveBatch } from "./positions.js";
import { defaultLocationOf, ledgerLocation, validateWarehouseOperation } from "./warehouses.js";

export class TransferError extends Error {
  constructor(status, message, code = "TRANSFER_ERROR", details = undefined) {
    super(message);
    this.name = "TransferError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const TRANSFER_REASONS = Object.freeze([
  { id: "stock_rebalancing", label: "Stock rebalancing" }, { id: "fulfillment_requirement", label: "Fulfilment requirement" },
  { id: "warehouse_relocation", label: "Warehouse relocation" }, { id: "quality_movement", label: "Quality movement (disposition unchanged)" }, { id: "other", label: "Other" },
]);
export const TRANSFER_STATUSES = Object.freeze([
  { id: "draft", label: "Draft" }, { id: "confirmed", label: "Confirmed" }, { id: "dispatched", label: "In transit" }, { id: "partially_received", label: "Partially received" },
  { id: "completed", label: "Completed" }, { id: "cancelled", label: "Cancelled" }, { id: "reversed", label: "Reversed" },
]);
const DISPOSITIONS = ["available", "quality_hold", "quarantined", "damaged", "expired"];
const DISPOSITION_LABEL = { available: "available", quality_hold: "on quality hold", quarantined: "quarantined", damaged: "damaged", expired: "expired", restricted: "restricted" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZERO = 0n;
const UNIT = 1000000n;

const privileged = (c) => Boolean(c.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug)));
const can = (c, permission) => privileged(c) || Boolean(c.permissions?.includes(permission));
const need = (c, permission, message) => { if (!can(c, permission)) throw new TransferError(403, message, "PERMISSION_DENIED"); };
const text = (value, max = 500) => { const out = String(value ?? "").trim(); return out ? out.slice(0, max) : null; };
const has = (input, key) => Object.prototype.hasOwnProperty.call(input ?? {}, key);
const fail = (field, message, code = "TRANSFER_VALIDATION", status = 400) => { throw new TransferError(status, message, code, { issues: [{ field, message }] }); };
const uuid = (value, label) => { const id = String(value ?? "").trim(); if (!UUID.test(id)) fail(label, `${label} is not valid.`); return id; };
const optionalUuid = (value, label) => (value === undefined || value === null || value === "" ? null : uuid(value, label));
const dec = (value) => formatDecimal(value).replace(/\.?0+$/, "") || "0";
const n = (value) => Math.round(Number(value ?? 0) * 1e6) / 1e6;
const dayOf = (value) => (value instanceof Date
  ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` : value ? String(value).slice(0, 10) : null);
const quantityOf = (value, label) => {
  const raw = String(value ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(raw) || decimal(raw) <= ZERO) fail("quantity", `${label}: enter a quantity greater than zero.`, "TRANSFER_QUANTITY_INVALID");
  return decimal(raw);
};
const stockContext = (c) => ({ ...c, permissions: [...(c.permissions ?? []), "stock.issue", "stock.receive", "stock.reserve", "stock.adjust", "stock.view", "stock.ledger.view"] });

async function stocked(work, label) {
  try { return await work(); } catch (error) {
    if (error instanceof StockError || String(error?.code ?? "").startsWith("WAREHOUSE_")) {
      if (error.code === "STOCK_RESERVATION_INSUFFICIENT")
        throw new TransferError(409, `${label}: not enough available stock at the source.`, "TRANSFER_EXCEEDS_AVAILABLE", error.details);
      // Negative-Stock Control's refusals keep their code, facts and audit: a transfer never moves stock that is not there.
      if (isNegativeStockCode(error.code)) throw carryNegativeStock(error, new TransferError(error.status ?? 409, `${label}: ${error.message}`, error.code, error.details));
      throw new TransferError(error.status ?? 409, `${label}: ${error.message}`, error.code ?? "TRANSFER_STOCK_FAILED");
    }
    throw error;
  }
}
async function event(client, c, transferId, eventType, summary, details = {}) {
  await client.query(`INSERT INTO tenant.inventory_transfer_events (organization_id, transfer_id, event_type, summary, details, actor_user_id) VALUES ($1, $2, $3, $4, $5, $6)`,
    [c.organizationId, transferId, eventType, String(summary).slice(0, 1000), JSON.stringify(details), c.userId ?? null]);
}
async function periodOpen(client, c, day, what) {
  const period = (await client.query(
    `SELECT name, status FROM tenant.fiscal_periods WHERE organization_id = $1 AND $2::date BETWEEN start_date AND end_date ORDER BY period_type = 'standard' DESC, start_date DESC LIMIT 1`,
    [c.organizationId, day])).rows[0];
  if (period && period.status !== "open") throw new TransferError(409, `The accounting period ${period.name} is ${period.status}; the ${what} cannot be posted into it.`, "TRANSFER_PERIOD_CLOSED");
}
const today = async (client) => (await client.query(`SELECT current_date::text AS d`)).rows[0].d;

// ------------------------------------------------------------------ reading

async function loadTransfer(client, c, transferId, { lock = false } = {}) {
  const row = (await client.query(`SELECT * FROM tenant.inventory_transfers WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [c.organizationId, uuid(transferId, "Transfer")])).rows[0];
  const visible = row ? await visibleWarehouseIds(client, c) : null;
  if (!row || (visible && !visible.includes(row.source_warehouse_id) && !visible.includes(row.destination_warehouse_id)))
    throw new TransferError(404, "Transfer not found.", "TRANSFER_NOT_FOUND");
  return row;
}

async function lineRows(client, c, transferId) {
  const lines = (await client.query(
    `SELECT line.*, item.code AS sku, item.name AS item_name, item.tracking_type, item.track_inventory, uom.code AS uom_code, base.code AS base_uom_code,
            COALESCE(source.code, 'MAIN') AS source_location_code, COALESCE(destination.code, 'MAIN') AS destination_location_code
       FROM tenant.inventory_transfer_lines line
       JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
       LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = line.organization_id AND uom.id = line.uom_id
       LEFT JOIN tenant.units_of_measure base ON base.organization_id = item.organization_id AND base.id = item.uom_id
       LEFT JOIN tenant.warehouse_locations source ON source.organization_id = line.organization_id AND source.id = line.source_location_id
       LEFT JOIN tenant.warehouse_locations destination ON destination.organization_id = line.organization_id AND destination.id = line.destination_location_id
      WHERE line.organization_id = $1 AND line.transfer_id = $2 ORDER BY line.line_number`, [c.organizationId, transferId])).rows;
  const ids = lines.map((line) => line.id);
  const lots = (await client.query(`SELECT lot.*, batch.batch_number, batch.expires_on FROM tenant.inventory_transfer_lots lot JOIN tenant.stock_batches batch ON batch.id = lot.batch_id
      WHERE lot.organization_id = $1 AND lot.line_id = ANY($2::uuid[]) ORDER BY batch.batch_number`, [c.organizationId, ids])).rows;
  const serials = (await client.query(`SELECT allocation.*, serial.serial_number FROM tenant.inventory_transfer_serials allocation JOIN tenant.stock_serials serial ON serial.id = allocation.serial_id
      WHERE allocation.organization_id = $1 AND allocation.line_id = ANY($2::uuid[]) ORDER BY serial.serial_number`, [c.organizationId, ids])).rows;
  return lines.map((line) => ({ ...line, lots: lots.filter((lot) => lot.line_id === line.id), serials: serials.filter((serial) => serial.line_id === line.id) }));
}

// The units of stock a line moves: one per serial number, one per batch, or the line itself.
function partsOf(line) {
  if (line.tracking_type === "serial") return line.serials.map((serial) => ({ key: serial.serial_id, serialId: serial.serial_id, serial: serial.serial_number, batchId: null, quantity: UNIT, row: serial }));
  if (line.tracking_type === "batch") return line.lots.map((lot) => ({ key: lot.batch_id, batchId: lot.batch_id, batch: lot.batch_number, quantity: decimal(lot.base_quantity), row: lot }));
  return [{ key: "all", batchId: null, quantity: decimal(line.base_quantity), row: null }];
}

// ------------------------------------------------------------------ drafts

async function readHeader(client, c, input, current = null) {
  const keep = (key, column) => (has(input, key) ? input[key] : current?.[column] ?? null);
  const sourceWarehouseId = optionalUuid(keep("sourceWarehouseId", "source_warehouse_id"), "Source warehouse");
  if (!sourceWarehouseId) fail("sourceWarehouseId", "Choose the warehouse the stock leaves.");
  const destinationWarehouseId = optionalUuid(keep("destinationWarehouseId", "destination_warehouse_id"), "Destination warehouse") ?? sourceWarehouseId;
  const type = sourceWarehouseId === destinationWarehouseId ? "location" : "warehouse";
  const requestedType = text(keep("transferType", "transfer_type"), 20);
  if (requestedType && requestedType !== type)
    fail("transferType", type === "location" ? "A warehouse transfer goes to another warehouse; within one warehouse it is a location transfer." : "A location transfer stays in one warehouse.",
      "TRANSFER_SAME_WAREHOUSE");
  const mode = type === "location" ? "direct" : (text(keep("transferMode", "transfer_mode"), 20) ?? "in_transit");
  if (!["direct", "in_transit"].includes(mode)) fail("transferMode", "The mode is direct or in transit.");
  // Both warehouses are the company's own (one company per workspace), active and open to transfers; the source must be one the user moves stock in.
  await stocked(() => validateWarehouseOperation(client, c, sourceWarehouseId, type === "warehouse" ? "transfer" : null, { label: "Source warehouse" }), "Source warehouse");
  if (type === "warehouse") {
    const destination = (await client.query(`SELECT name, status, transfer_enabled, system_role FROM tenant.warehouses WHERE organization_id = $1 AND id = $2`, [c.organizationId, destinationWarehouseId])).rows[0];
    if (!destination || destination.system_role) fail("destinationWarehouseId", "Destination warehouse not found.", "WAREHOUSE_NOT_FOUND", 404);
    if (destination.status !== "active") fail("destinationWarehouseId", `${destination.name} is inactive.`, "WAREHOUSE_INACTIVE", 409);
    if (!destination.transfer_enabled) fail("destinationWarehouseId", `${destination.name} does not allow transfers.`, "WAREHOUSE_OPERATION_DISABLED", 409);
  }
  const date = (value, label) => {
    const day = text(value instanceof Date ? dayOf(value) : value, 10);
    if (day && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day)))) fail(label, `${label} is not a valid date.`);
    return day;
  };
  const transferDate = date(keep("transferDate", "transfer_date"), "Transfer date") ?? await today(client);
  const expected = date(keep("expectedArrivalDate", "expected_arrival_date"), "Expected arrival");
  if (expected && expected < transferDate) fail("expectedArrivalDate", "The expected arrival cannot be before the transfer date.");
  const reasonCode = text(keep("reasonCode", "reason_code"), 40) ?? "stock_rebalancing";
  if (!TRANSFER_REASONS.some((reason) => reason.id === reasonCode)) fail("reasonCode", "Choose a reason from the list.");
  return {
    type, mode, sourceWarehouseId, destinationWarehouseId, transferDate, expected, reasonCode, reference: text(keep("reference", "reference"), 120), carrier: text(keep("carrier", "carrier"), 120),
    vehicleNumber: text(keep("vehicleNumber", "vehicle_number"), 40), transportReference: text(keep("transportReference", "transport_reference"), 120), notes: text(keep("notes", "notes"), 2000),
  };
}

// lines: [{ itemId, quantity, uomId?, sourceLocationId?, destinationLocationId?, disposition?, batches?: [{ batchId, quantity (base) }], serialIds?|serialNumbers?, notes? }]
async function readLines(client, c, header, inputLines) {
  if (!Array.isArray(inputLines) || !inputLines.length) fail("lines", "Add the items to transfer.", "TRANSFER_EMPTY");
  if (inputLines.length > 500) fail("lines", "A transfer holds at most 500 lines.");
  const receiving = header.type === "warehouse" ? await defaultLocationOf(client, c.organizationId, header.destinationWarehouseId, "receiving") : null;
  const out = [];
  for (const [index, entry] of inputLines.entries()) {
    const label = `Line ${index + 1}`;
    const item = (await client.query(`SELECT id, code, name, track_inventory, tracking_type, uom_id FROM tenant.items WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, uuid(entry.itemId, `${label} item`)])).rows[0];
    if (!item) fail("itemId", `${label}: item not found.`, "TRANSFER_VALIDATION", 404);
    if (!item.track_inventory) fail("itemId", `${label}: ${item.name} is not a stock item; only inventory-tracked items are transferred.`, "TRANSFER_ITEM_NOT_STOCKED", 409);
    quantityOf(entry.quantity, label);
    const uomId = optionalUuid(entry.uomId, `${label} unit`) ?? item.uom_id;
    const unit = await normalizeQuantityToBase(client, c.organizationId, item.id, uomId, String(entry.quantity).trim(), { purpose: "inventory" });
    if (!unit.ok) fail("uomId", `${label}: ${unit.message}`, unit.code ?? "TRANSFER_UOM_INVALID", 409);
    const sourceLocationId = await stocked(() => ledgerLocation(client, c.organizationId, header.sourceWarehouseId, optionalUuid(entry.sourceLocationId, `${label} source location`),
      { label: `${label} source location` }), label);
    const requestedDestination = optionalUuid(entry.destinationLocationId, `${label} destination location`);
    const destinationLocationId = await stocked(() => ledgerLocation(client, c.organizationId, header.destinationWarehouseId, requestedDestination ?? (header.type === "warehouse" ? receiving : null),
      { label: `${label} destination location` }), label);
    if (header.type === "location" && (sourceLocationId ?? null) === (destinationLocationId ?? null))
      fail("destinationLocationId", `${label}: the source and destination locations are the same.`, "TRANSFER_SAME_LOCATION");
    const disposition = text(entry.disposition, 20) ?? "available";
    if (!DISPOSITIONS.includes(disposition)) fail("disposition", `${label}: unknown disposition.`);
    // The stock keeps its disposition: the destination location must hold stock of the same kind (expired stock stays expired by its batch).
    const destinationDisposition = await dispositionAt(client, c.organizationId, destinationLocationId);
    if (destinationDisposition !== (disposition === "expired" ? "available" : disposition))
      fail("destinationLocationId", `${label}: the destination location holds ${DISPOSITION_LABEL[destinationDisposition]} stock, but this stock is ${DISPOSITION_LABEL[disposition]}. A transfer never changes disposition; release or quarantine stock through Quality.`,
        "TRANSFER_DISPOSITION_CHANGE");
    const lots = [];
    if (item.tracking_type === "batch") {
      const batches = Array.isArray(entry.batches) ? entry.batches.filter((lot) => lot && (lot.batchId || lot.batchNumber)) : [];
      if (!batches.length) fail("batches", `${label}: choose the batch (or batches) transferred.`, "TRANSFER_BATCH_REQUIRED");
      for (const lot of batches) {
        const batch = (await client.query(`SELECT id, batch_number FROM tenant.stock_batches WHERE organization_id = $1 AND item_id = $2 AND (id::text = $3 OR lower(batch_number) = lower($3))`,
          [c.organizationId, item.id, String(lot.batchId ?? lot.batchNumber)])).rows[0];
        if (!batch) fail("batches", `${label}: batch ${lot.batchNumber ?? lot.batchId} not found for ${item.name}.`, "TRANSFER_BATCH_INVALID", 404);
        if (lots.some((existing) => existing.batchId === batch.id)) fail("batches", `${label}: batch ${batch.batch_number} is entered twice.`, "TRANSFER_BATCH_DUPLICATE");
        lots.push({ batchId: batch.id, quantity: quantityOf(lot.quantity, `${label} batch ${batch.batch_number}`) });
      }
      const total = lots.reduce((sum, lot) => add(sum, lot.quantity), ZERO);
      if (total !== unit.baseQuantity) fail("batches", `${label}: the batches add up to ${dec(total)}, but the line moves ${dec(unit.baseQuantity)}. Allocate every unit to a batch.`, "TRANSFER_BATCH_TOTAL_MISMATCH");
    }
    let serialIds = [];
    if (item.tracking_type === "serial") {
      const ids = (Array.isArray(entry.serialIds) ? entry.serialIds : []).map(String);
      const names = (Array.isArray(entry.serialNumbers) ? entry.serialNumbers : String(entry.serialNumbers ?? "").split(/[\s,;]+/)).map((value) => String(value).trim()).filter(Boolean);
      if (new Set(ids).size !== ids.length || new Set(names.map((name) => name.toLowerCase())).size !== names.length)
        fail("serialIds", `${label}: a serial number is chosen twice.`, "TRANSFER_SERIAL_DUPLICATE");
      const rows = (await client.query(`SELECT id FROM tenant.stock_serials WHERE organization_id = $1 AND item_id = $2 AND (id = ANY($3::uuid[]) OR lower(serial_number) = ANY($4::text[]))`,
        [c.organizationId, item.id, ids.filter((value) => UUID.test(value)), names.map((name) => name.toLowerCase())])).rows;
      if (rows.length !== ids.length + names.length) fail("serialIds", `${label}: a serial number was not found for ${item.name}.`, "TRANSFER_SERIAL_INVALID", 404);
      serialIds = rows.map((row) => row.id);
      if (BigInt(serialIds.length) * UNIT !== unit.baseQuantity) fail("serialIds", `${label}: choose one serial number for each unit transferred (${dec(unit.baseQuantity)}).`, "TRANSFER_SERIALS_REQUIRED");
    }
    out.push({ item, quantity: decimal(String(entry.quantity).trim()), uomId, factor: unit.factor, base: unit.baseQuantity, sourceLocationId, destinationLocationId, disposition, lots, serialIds,
      notes: text(entry.notes, 500) });
  }
  return out;
}

async function writeLines(client, c, transferId, lines) {
  await client.query(`DELETE FROM tenant.inventory_transfer_lines WHERE organization_id = $1 AND transfer_id = $2`, [c.organizationId, transferId]);
  for (const [index, line] of lines.entries()) {
    const id = (await client.query(
      `INSERT INTO tenant.inventory_transfer_lines (organization_id, transfer_id, line_number, item_id, item_snapshot, quantity, uom_id, conversion_factor, base_quantity, source_location_id,
         destination_location_id, disposition, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [c.organizationId, transferId, index + 1, line.item.id, JSON.stringify({ code: line.item.code, name: line.item.name, trackingType: line.item.tracking_type }), formatDecimal(line.quantity),
        line.uomId, formatDecimal(line.factor), formatDecimal(line.base), line.sourceLocationId, line.destinationLocationId, line.disposition, line.notes])).rows[0].id;
    for (const lot of line.lots)
      await client.query(`INSERT INTO tenant.inventory_transfer_lots (organization_id, line_id, batch_id, base_quantity) VALUES ($1, $2, $3, $4)`, [c.organizationId, id, lot.batchId, formatDecimal(lot.quantity)]);
    for (const serialId of line.serialIds)
      await client.query(`INSERT INTO tenant.inventory_transfer_serials (organization_id, line_id, serial_id) VALUES ($1, $2, $3)`, [c.organizationId, id, serialId]);
  }
}

// createInventoryTransfer. input: { sourceWarehouseId, destinationWarehouseId (same for a location transfer), transferMode?, transferDate?, expectedArrivalDate?,
// reasonCode?, reference?, carrier?, vehicleNumber?, transportReference?, notes?, lines, idempotencyKey? }. A draft reserves and moves nothing.
export async function createInventoryTransfer(client, c, input = {}) {
  need(c, P.create, "You do not have permission to prepare transfers.");
  const key = text(input.idempotencyKey, 200);
  if (key) {
    const done = (await client.query(`SELECT id FROM tenant.inventory_transfers WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { ...(await getInventoryTransfer(client, c, done.id)), replayed: true };
  }
  const header = await readHeader(client, c, input);
  const lines = await readLines(client, c, header, input.lines);
  const number = await nextDocumentNumber(client, c, { documentType: "inventory_transfer", at: new Date(`${header.transferDate}T12:00:00Z`) });
  const id = (await client.query(
    `INSERT INTO tenant.inventory_transfers (organization_id, document_number, transfer_type, transfer_mode, source_warehouse_id, destination_warehouse_id, transfer_date, expected_arrival_date,
       reason_code, reference, carrier, vehicle_number, transport_reference, notes, idempotency_key, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16) RETURNING id`,
    [c.organizationId, number, header.type, header.mode, header.sourceWarehouseId, header.destinationWarehouseId, header.transferDate, header.expected, header.reasonCode, header.reference,
      header.carrier, header.vehicleNumber, header.transportReference, header.notes, key, c.userId ?? null])).rows[0].id;
  await writeLines(client, c, id, lines);
  await event(client, c, id, "created", `Drafted: ${lines.length} line${lines.length === 1 ? "" : "s"}, ${header.type === "location" ? "location transfer" : header.mode === "direct" ? "direct" : "in transit"}`);
  return { ...(await getInventoryTransfer(client, c, id)), replayed: false };
}

// updateDraftTransfer: header fields and lines (replaced as a whole) of a draft, with expectedVersion.
export async function updateDraftTransfer(client, c, transferId, input = {}) {
  need(c, P.create, "You do not have permission to edit transfers.");
  const row = await loadTransfer(client, c, transferId, { lock: true });
  if (row.status !== "draft") throw new TransferError(409, row.status === "confirmed" ? "Return the confirmed transfer to draft (releasing its reservation) before changing it." : `A ${row.status} transfer is not edited.`,
    "TRANSFER_NOT_DRAFT");
  if (input.expectedVersion !== undefined && input.expectedVersion !== null && Number(input.expectedVersion) !== row.version)
    throw new TransferError(409, "Someone else changed this transfer. Reload it and enter your change again.", "TRANSFER_VERSION_CONFLICT");
  const header = await readHeader(client, c, input, row);
  if (header.sourceWarehouseId !== row.source_warehouse_id || header.destinationWarehouseId !== row.destination_warehouse_id) {
    if (!Array.isArray(input.lines)) fail("lines", "Re-enter the lines for the new warehouses (their locations and stock differ).");
  }
  if (Array.isArray(input.lines)) await writeLines(client, c, row.id, await readLines(client, c, header, input.lines));
  await client.query(
    `UPDATE tenant.inventory_transfers SET transfer_type = $3, transfer_mode = $4, source_warehouse_id = $5, destination_warehouse_id = $6, transfer_date = $7, expected_arrival_date = $8,
            reason_code = $9, reference = $10, carrier = $11, vehicle_number = $12, transport_reference = $13, notes = $14, version = version + 1, updated_by = $15, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, row.id, header.type, header.mode, header.sourceWarehouseId, header.destinationWarehouseId, header.transferDate, header.expected, header.reasonCode, header.reference,
      header.carrier, header.vehicleNumber, header.transportReference, header.notes, c.userId ?? null]);
  await event(client, c, row.id, "updated", Array.isArray(input.lines) ? "Draft changed (lines re-entered)" : "Draft changed");
  return getInventoryTransfer(client, c, row.id);
}

// ------------------------------------------------------------------ checks against stock

// Everything confirming (or completing a location transfer) checks against stock as it is now: each batch, serial or quantity at its source
// location, of the disposition the line declares, not reserved by anyone else; restricted stock only with its permission.
async function assess(client, c, row, lines, { ownReservations = false } = {}) {
  const errors = [];
  const add_ = (message, code = "TRANSFER_NOT_READY", details = undefined) => errors.push({ message, code, ...(details ? { details } : {}) });
  if (!lines.length) add_("The transfer has no lines.", "TRANSFER_EMPTY");
  for (const line of lines) {
    const label = `Line ${line.line_number} (${line.sku})`;
    if (!line.track_inventory) add_(`${label}: no longer a stock item.`, "TRANSFER_ITEM_NOT_STOCKED");
    if (line.disposition !== "available" && !can(c, P.restricted)) add_(`${label}: you do not have permission to transfer restricted stock.`, "PERMISSION_DENIED");
    for (const part of partsOf(line)) {
      const position = await positionOf(client, c, { itemId: line.item_id, warehouseId: row.source_warehouse_id, locationId: line.source_location_id, batchId: part.batchId });
      const where = `${line.source_location_code}${part.batch ? ` / batch ${part.batch}` : ""}`;
      if (position.disposition === "restricted") { add_(`${label}: stock at ${where} is not moved (not allocatable, inactive or in transit).`, "TRANSFER_DISPOSITION_CHANGE"); continue; }
      if (position.disposition !== line.disposition)
        add_(`${label}: stock at ${where} is ${DISPOSITION_LABEL[position.disposition]}, not ${DISPOSITION_LABEL[line.disposition]}. A transfer never changes disposition.`, "TRANSFER_DISPOSITION_CHANGE");
      if (part.serialId) {
        const serial = (await client.query(
          `SELECT serial.status, serial.warehouse_id, serial.warehouse_location_id,
                  (SELECT reservation.reservation_number FROM tenant.stock_reservations reservation WHERE reservation.organization_id = serial.organization_id AND reservation.serial_id = serial.id
                     AND reservation.status = 'active' AND NOT (reservation.reference_type = 'stock_transfer' AND reservation.reference_id = $3) LIMIT 1) AS reserved_by
             FROM tenant.stock_serials serial WHERE serial.organization_id = $1 AND serial.id = $2`, [c.organizationId, part.serialId, row.id])).rows[0];
        if (serial?.status !== "available" || serial.warehouse_id !== row.source_warehouse_id || (serial.warehouse_location_id ?? null) !== (line.source_location_id ?? null))
          add_(`${label}: serial ${part.serial} is not in stock at ${line.source_location_code}.`, "TRANSFER_SERIAL_NOT_AVAILABLE");
        else if (serial.reserved_by) add_(`${label}: serial ${part.serial} is reserved (${serial.reserved_by}); choose another.`, "TRANSFER_SERIAL_RESERVED");
        continue;
      }
      const free = ownReservations ? position.quantity : position.free;
      if (part.quantity > free)
        add_(`${label}: requested ${dec(part.quantity)} ${line.base_uom_code ?? ""}, available ${dec(free > ZERO ? free : ZERO)} at ${where}.`.replace("  ", " "), "TRANSFER_EXCEEDS_AVAILABLE",
          { requested: dec(part.quantity), available: dec(free > ZERO ? free : ZERO) });
    }
  }
  return { ready: errors.length === 0, errors };
}

function refuse(check) {
  const first = check.errors[0];
  const only = check.errors.every((entry) => entry.code === first.code);
  throw new TransferError(first.code === "PERMISSION_DENIED" ? 403 : 409, first.message, only ? first.code : "TRANSFER_NOT_READY", { errors: check.errors });
}

export async function validateInventoryTransfer(client, c, transferId) {
  need(c, P.view, "You do not have permission to view transfers.");
  const row = await loadTransfer(client, c, transferId);
  return assess(client, c, row, await lineRows(client, c, row.id), { ownReservations: row.status === "confirmed" });
}

// ------------------------------------------------------------------ confirm / cancel

async function reservationsOf(client, c, transferId) {
  return (await client.query(`SELECT * FROM tenant.stock_reservations WHERE organization_id = $1 AND reference_type = 'stock_transfer' AND reference_id = $2 AND status = 'active'
      ORDER BY created_at, id FOR UPDATE`, [c.organizationId, transferId])).rows;
}
const reservationFor = (reservations, line, part) => reservations.find((reservation) => reservation.item_id === line.item_id
  && (reservation.warehouse_location_id ?? null) === (line.source_location_id ?? null) && (reservation.batch_id ?? null) === (part.batchId ?? null)
  && (reservation.serial_id ?? null) === (part.serialId ?? null));

// confirmInventoryTransfer: a warehouse transfer reserves all of its source stock (never part of it), so nothing else can take it. Restricted stock
// (held, damaged, expired) is never reserved — nothing ordinary takes it — and is checked again at dispatch.
export async function confirmInventoryTransfer(client, c, transferId) {
  need(c, P.confirm, "You do not have permission to confirm transfers.");
  const row = await loadTransfer(client, c, transferId, { lock: true });
  if (["confirmed", "dispatched", "partially_received", "completed"].includes(row.status)) return { ...(await getInventoryTransfer(client, c, row.id)), replayed: true };
  if (row.status !== "draft") throw new TransferError(409, `A ${row.status} transfer is not confirmed.`, "TRANSFER_NOT_DRAFT");
  if (row.transfer_type === "location") throw new TransferError(409, "A location transfer is completed directly; it reserves nothing.", "TRANSFER_STATE_INVALID");
  await stocked(() => validateWarehouseOperation(client, c, row.source_warehouse_id, "transfer", { label: "Source warehouse" }), "Source warehouse");
  const lines = await lineRows(client, c, row.id);
  const check = await assess(client, c, row, lines);
  if (!check.ready) refuse(check);
  const stock = stockContext(c);
  for (const line of lines) {
    if (line.disposition !== "available") continue;
    for (const part of partsOf(line))
      await stocked(() => reserveStock(client, stock, { itemId: line.item_id, warehouseId: row.source_warehouse_id, warehouseLocationId: line.source_location_id, batchId: part.batchId,
        serialId: part.serialId ?? undefined, quantity: formatDecimal(part.quantity), referenceType: "stock_transfer", referenceId: row.id,
        sourceLineId: line.id, idempotencyKey: `itr:${row.id}:reserve:${line.id}:${part.key}` }), `Line ${line.line_number} (${line.sku})`);
  }
  await client.query(`UPDATE tenant.inventory_transfers SET status = 'confirmed', confirmed_by = $3, confirmed_at = now(), version = version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, row.id, c.userId ?? null]);
  await event(client, c, row.id, "confirmed", "Confirmed: source stock reserved");
  return { ...(await getInventoryTransfer(client, c, row.id)), replayed: false };
}

async function releaseAll(client, c, row, reasonCode, reason) {
  const stock = stockContext(c);
  for (const reservation of await reservationsOf(client, c, row.id))
    await releaseStockReservation(client, stock, reservation.id, { status: "cancelled", reasonCode, reason });
}

// A confirmed transfer back to draft (its reservation released) to change it; confirm it again afterwards.
export async function returnTransferToDraft(client, c, transferId) {
  need(c, P.confirm, "You do not have permission to change confirmed transfers.");
  const row = await loadTransfer(client, c, transferId, { lock: true });
  if (row.status === "draft") return { ...(await getInventoryTransfer(client, c, row.id)), replayed: true };
  if (row.status !== "confirmed") throw new TransferError(409, "Only a confirmed transfer goes back to draft; a dispatched one is in transit.", "TRANSFER_STATE_INVALID");
  await releaseAll(client, c, row, "transfer_amended", "Transfer returned to draft for changes");
  await client.query(`UPDATE tenant.inventory_transfers SET status = 'draft', confirmed_by = NULL, confirmed_at = NULL, version = version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, row.id]);
  await event(client, c, row.id, "returned_to_draft", "Returned to draft: reservation released");
  return { ...(await getInventoryTransfer(client, c, row.id)), replayed: false };
}

// cancelInventoryTransfer: a draft or a confirmed transfer (its reservation released). Once dispatched the stock is moving: it is received, not cancelled.
export async function cancelInventoryTransfer(client, c, transferId, input = {}) {
  const row = await loadTransfer(client, c, transferId, { lock: true });
  need(c, row.status === "confirmed" ? P.confirm : P.create, "You do not have permission to cancel this transfer.");
  if (row.status === "cancelled") return { ...(await getInventoryTransfer(client, c, row.id)), replayed: true };
  if (!["draft", "confirmed"].includes(row.status))
    throw new TransferError(409, "A dispatched transfer is not cancelled: the stock is already moving. Receive it, or write off a confirmed transit loss.", "TRANSFER_DISPATCHED");
  const reason = text(input.reason, 500);
  if (row.status === "confirmed") await releaseAll(client, c, row, "transfer_cancelled", reason ?? "Transfer cancelled");
  await client.query(`UPDATE tenant.inventory_transfers SET status = 'cancelled', cancelled_by = $3, cancelled_at = now(), cancel_reason = $4, version = version + 1, updated_at = now()
     WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, c.userId ?? null, reason]);
  await event(client, c, row.id, "cancelled", `Cancelled${row.status === "confirmed" ? " (reservation released)" : ""}${reason ? `: ${reason}` : ""}`);
  return { ...(await getInventoryTransfer(client, c, row.id)), replayed: false };
}

// ------------------------------------------------------------------ the legs

// The document unit snapshot a leg keeps: the quantity in the line's unit (a serial moves one base unit, so it keeps none).
const transactionOf = (line, quantity) => (line.tracking_type === "serial" ? null
  : { uomId: line.uom_id, quantity: formatDecimal(roundMoney(quantity * UNIT / decimal(line.conversion_factor), 6)), factor: line.conversion_factor });

// The source leg of each part: out of the source position through its reservation when it holds one; at the valuation engine's cost.
async function issueSource(client, c, row, line, part, { ledgerType, groupId, key, reservations }) {
  const stock = stockContext(c);
  const transaction = transactionOf(line, part.quantity);
  const reservation = reservations ? reservationFor(reservations, line, part) : null;
  const label = `Line ${line.line_number} (${line.sku})`;
  return withActiveBatch(client, c, part.batchId, () => stocked(async () => {
    if (reservation) {
      const consumed = await consumeStockReservation(client, stock, reservation.id, formatDecimal(part.quantity), { issue: { referenceType: "inventory_transfer_line", referenceId: line.id,
        idempotencyKey: key, ledgerType, groupId, transaction } });
      return (await client.query(`SELECT * FROM tenant.stock_movements WHERE organization_id = $1 AND id = $2`, [c.organizationId, consumed.stockMovementId])).rows[0];
    }
    return postStockMovement(client, stock, { movementType: "issue", itemId: line.item_id, warehouseId: row.source_warehouse_id, warehouseLocationId: line.source_location_id,
      batchId: part.batchId, serialId: part.serialId ?? undefined, quantity: formatDecimal(part.quantity), referenceType: "inventory_transfer_line", referenceId: line.id,
      reason: `${row.document_number} · transfer out`, ledgerType, groupId, idempotencyKey: key, transaction });
  }, label));
}

// A receiving leg: into a position with exactly the value that left (valueFrom: the movement it left with; for FIFO its cost layers too).
async function receiveInto(client, c, row, line, part, quantity, { warehouseId, locationId, ledgerType, groupId, key, valueFrom, reason }) {
  const transaction = transactionOf(line, quantity);
  return withActiveBatch(client, c, part.batchId, () => stocked(() => postStockMovement(client, stockContext(c), {
    movementType: "receipt", itemId: line.item_id, warehouseId, warehouseLocationId: locationId, batchId: part.batchId, serialId: part.serialId ?? undefined,
    quantity: formatDecimal(quantity), valueFromMovementId: valueFrom, referenceType: "inventory_transfer_line", referenceId: line.id, reason, ledgerType, groupId, idempotencyKey: key, transaction,
  }), `Line ${line.line_number} (${line.sku})`));
}

function group(client, c, row, operation, key) {
  return openMovementGroup(client, c, { sourceType: "inventory_transfer", sourceId: row.id, sourceNumber: row.document_number, operation, postingKey: `inventory_transfer:${row.id}:${key}` });
}

// dispatchInventoryTransfer: a confirmed in-transit transfer leaves its source. Each part out of the source (Transfer Out, consuming its
// reservation) and into the system transit position (Transfer to Transit), the same batch and serial, at the cost it left with. Retrying moves nothing more.
export async function dispatchInventoryTransfer(client, c, transferId) {
  need(c, P.dispatch, "You do not have permission to dispatch transfers.");
  const row = await loadTransfer(client, c, transferId, { lock: true });
  if (["dispatched", "partially_received", "completed"].includes(row.status)) return { ...(await getInventoryTransfer(client, c, row.id)), replayed: true };
  if (row.status !== "confirmed") throw new TransferError(409, "Only a confirmed transfer is dispatched.", "TRANSFER_STATE_INVALID");
  if (row.transfer_mode !== "in_transit") throw new TransferError(409, "A direct transfer is completed, not dispatched.", "TRANSFER_STATE_INVALID");
  await stocked(() => validateWarehouseOperation(client, c, row.source_warehouse_id, "transfer", { label: "Source warehouse" }), "Source warehouse");
  const day = await today(client);
  await periodOpen(client, c, day, "dispatch");
  const lines = await lineRows(client, c, row.id);
  const check = await assess(client, c, row, lines, { ownReservations: true });
  if (!check.ready) refuse(check);
  const transit = await ensureTransitPosition(client, c);
  const dispatch = await group(client, c, row, "transfer_dispatch", "dispatch");
  const reservations = await reservationsOf(client, c, row.id);
  for (const line of lines) {
    for (const part of partsOf(line)) {
      const out = await issueSource(client, c, row, line, part, { ledgerType: "transfer_out", groupId: dispatch.id, key: `itr:${row.id}:dispatch:${line.id}:${part.key}`, reservations });
      await receiveInto(client, c, row, line, part, part.quantity, { warehouseId: transit.warehouseId, locationId: transit.locationId, ledgerType: "transfer_to_transit", groupId: dispatch.id,
        key: `itr:${row.id}:to-transit:${line.id}:${part.key}`, valueFrom: out.id, reason: `${row.document_number} · in transit` });
      if (part.serialId) await client.query(`UPDATE tenant.inventory_transfer_serials SET status = 'in_transit' WHERE id = $1`, [part.row.id]);
    }
    await client.query(`UPDATE tenant.inventory_transfer_lines SET dispatched_base_quantity = base_quantity WHERE organization_id = $1 AND id = $2`, [c.organizationId, line.id]);
  }
  await client.query(`UPDATE tenant.inventory_transfers SET status = 'dispatched', dispatch_date = $3, dispatched_by = $4, dispatched_at = now(), version = version + 1, updated_at = now()
     WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, day, c.userId ?? null]);
  await event(client, c, row.id, "dispatched", `Dispatched: ${lines.length} line${lines.length === 1 ? "" : "s"} in transit`, { groupId: dispatch.id });
  return { ...(await getInventoryTransfer(client, c, row.id)), replayed: false };
}

// completeInventoryTransfer: a confirmed direct warehouse transfer, or a draft location transfer, moves at once — source out, destination in,
// one posting (Transfer Out / In, or Location Transfer Out / In), the reservation consumed.
export async function completeInventoryTransfer(client, c, transferId) {
  need(c, P.dispatch, "You do not have permission to complete transfers.");
  const row = await loadTransfer(client, c, transferId, { lock: true });
  if (row.status === "completed") return { ...(await getInventoryTransfer(client, c, row.id)), replayed: true };
  if (row.transfer_mode !== "direct") throw new TransferError(409, "An in-transit transfer is dispatched and then received.", "TRANSFER_STATE_INVALID");
  if (row.transfer_type === "warehouse" && row.status !== "confirmed") throw new TransferError(409, "Confirm the transfer (reserving its stock) before completing it.", "TRANSFER_STATE_INVALID");
  if (row.transfer_type === "location" && row.status !== "draft") throw new TransferError(409, `A ${row.status} transfer is not completed.`, "TRANSFER_STATE_INVALID");
  await stocked(() => validateWarehouseOperation(client, c, row.source_warehouse_id, row.transfer_type === "warehouse" ? "transfer" : null, { label: "Source warehouse" }), "Source warehouse");
  if (row.transfer_type === "warehouse") await stocked(() => validateWarehouseOperation(client, c, row.destination_warehouse_id, "transfer", { label: "Destination warehouse" }), "Destination warehouse");
  const day = await today(client);
  await periodOpen(client, c, day, "transfer");
  const lines = await lineRows(client, c, row.id);
  const check = await assess(client, c, row, lines, { ownReservations: row.status === "confirmed" });
  if (!check.ready) refuse(check);
  const legs = row.transfer_type === "warehouse" ? { out: "transfer_out", in: "transfer_in", operation: "transfer" } : { out: "location_transfer_out", in: "location_transfer_in", operation: "location_move" };
  const posting = await group(client, c, row, legs.operation, "complete");
  const reservations = row.status === "confirmed" ? await reservationsOf(client, c, row.id) : [];
  for (const line of lines) {
    for (const part of partsOf(line)) {
      const out = await issueSource(client, c, row, line, part, { ledgerType: legs.out, groupId: posting.id, key: `itr:${row.id}:out:${line.id}:${part.key}`, reservations });
      await receiveInto(client, c, row, line, part, part.quantity, { warehouseId: row.destination_warehouse_id, locationId: line.destination_location_id, ledgerType: legs.in, groupId: posting.id,
        key: `itr:${row.id}:in:${line.id}:${part.key}`, valueFrom: out.id, reason: `${row.document_number} · transfer in` });
      if (part.serialId) await client.query(`UPDATE tenant.inventory_transfer_serials SET status = 'received' WHERE id = $1`, [part.row.id]);
      if (part.batchId) await client.query(`UPDATE tenant.inventory_transfer_lots SET received_base_quantity = base_quantity WHERE id = $1`, [part.row.id]);
    }
    await client.query(`UPDATE tenant.inventory_transfer_lines SET dispatched_base_quantity = base_quantity, received_base_quantity = base_quantity WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, line.id]);
  }
  await client.query(`UPDATE tenant.inventory_transfers SET status = 'completed', dispatch_date = $3, receipt_date = $3, dispatched_by = $4, dispatched_at = now(), completed_by = $4,
            completed_at = now(), version = version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, day, c.userId ?? null]);
  await event(client, c, row.id, "completed", `Completed: ${lines.length} line${lines.length === 1 ? "" : "s"} moved`, { groupId: posting.id });
  return { ...(await getInventoryTransfer(client, c, row.id)), replayed: false };
}

// What is still in transit for a line, per part (its value travels with the transit leg: Inventory Valuation carries it across).
async function inTransit(client, c, line) {
  return partsOf(line).map((part) => ({ ...part,
    open: part.serialId ? (part.row.status === "in_transit" ? UNIT : ZERO)
      : part.batchId ? sub(part.quantity, add(decimal(part.row.received_base_quantity), decimal(part.row.lost_base_quantity)))
      : sub(decimal(line.dispatched_base_quantity), add(decimal(line.received_base_quantity), decimal(line.lost_base_quantity))) }));
}

// Which parts of what is in transit a receipt or a write-off takes: everything still open (no lines), or per line a quantity (spread over its
// batches in order), the batches with their quantities, or the serial numbers.
async function pick(client, c, lines, requested, label) {
  const plan = [];
  for (const line of lines) {
    const ask = requested ? requested.find((entry) => entry.lineId === line.id) : {};
    if (!ask) continue;
    const parts = await inTransit(client, c, line);
    const name = `Line ${line.line_number} (${line.sku})`;
    if (line.tracking_type === "serial") {
      const ids = requested ? (ask.serialIds ?? []).map(String) : parts.filter((part) => part.open > ZERO).map((part) => part.serialId);
      if (requested && !ids.length) fail("serialIds", `${name}: choose the serial numbers ${label}.`, "TRANSFER_SERIALS_REQUIRED");
      for (const id of ids) {
        const part = parts.find((entry) => entry.serialId === id);
        if (!part) fail("serialIds", `${name}: that serial number is not on this transfer.`, "TRANSFER_WRONG_SERIAL");
        if (part.open === ZERO) fail("serialIds", `${name}: serial ${part.serial} is not in transit any more.`, "TRANSFER_EXCEEDS_IN_TRANSIT");
        plan.push({ line, part, quantity: UNIT, destinationLocationId: ask.destinationLocationId });
      }
      continue;
    }
    if (line.tracking_type === "batch" && ask.batches) {
      for (const lot of ask.batches) {
        const part = parts.find((entry) => entry.batchId === lot.batchId);
        if (!part) fail("batches", `${name}: that batch was not dispatched on this transfer.`, "TRANSFER_WRONG_BATCH");
        const quantity = quantityOf(lot.quantity, `${name} batch ${part.batch}`);
        if (quantity > part.open) fail("batches", `${name}: only ${dec(part.open)} of batch ${part.batch} is still in transit.`, "TRANSFER_EXCEEDS_IN_TRANSIT");
        plan.push({ line, part, quantity, destinationLocationId: ask.destinationLocationId });
      }
      continue;
    }
    const open = parts.reduce((sum, part) => add(sum, part.open), ZERO);
    let quantity = requested && ask.quantity !== undefined ? quantityOf(ask.quantity, name) : open;
    if (quantity > open) fail("quantity", `${name}: only ${dec(open)} is still in transit; ${dec(quantity)} cannot ${label === "received" ? "arrive" : "be written off"}.`, "TRANSFER_EXCEEDS_IN_TRANSIT");
    for (const part of parts) {
      if (quantity <= ZERO) break;
      const take = part.open < quantity ? part.open : quantity;
      if (take > ZERO) plan.push({ line, part, quantity: take, destinationLocationId: ask.destinationLocationId });
      quantity = sub(quantity, take);
    }
  }
  return plan;
}

async function settle(client, c, row, plan, column) {
  for (const step of plan) {
    if (step.part.serialId) await client.query(`UPDATE tenant.inventory_transfer_serials SET status = $2 WHERE id = $1`, [step.part.row.id, column === "received" ? "received" : "lost"]);
    else if (step.part.batchId) await client.query(`UPDATE tenant.inventory_transfer_lots SET ${column}_base_quantity = ${column}_base_quantity + $2 WHERE id = $1`, [step.part.row.id, formatDecimal(step.quantity)]);
    await client.query(`UPDATE tenant.inventory_transfer_lines SET ${column}_base_quantity = ${column}_base_quantity + $3 WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, step.line.id, formatDecimal(step.quantity)]);
  }
  const totals = (await client.query(`SELECT sum(dispatched_base_quantity) AS dispatched, sum(received_base_quantity + lost_base_quantity) AS settled FROM tenant.inventory_transfer_lines
      WHERE organization_id = $1 AND transfer_id = $2`, [c.organizationId, row.id])).rows[0];
  const complete = decimal(totals.settled) >= decimal(totals.dispatched);
  return complete;
}

// receiveInventoryTransfer: what arrived at the destination — all of what is in transit (no lines) or part of it (lines: [{ lineId, quantity?
// (base) | batches?: [{ batchId, quantity }] | serialIds?, destinationLocationId? }]). Each part out of transit (Transfer from Transit) and into
// the destination (Transfer In) at the cost it travelled at. Never more than is in transit, never another batch or serial. A retry with the same
// idempotencyKey receives nothing more; two receipts at once are serialised by the transfer's lock.
export async function receiveInventoryTransfer(client, c, transferId, input = {}) {
  need(c, P.receive, "You do not have permission to receive transfers.");
  const row = await loadTransfer(client, c, transferId, { lock: true });
  const key = text(input.idempotencyKey, 200) ?? crypto.randomUUID();
  const done = (await client.query(`SELECT 1 FROM tenant.stock_movement_groups WHERE organization_id = $1 AND posting_key = $2`, [c.organizationId, `inventory_transfer:${row.id}:receipt:${key}`])).rows[0];
  if (done) return { ...(await getInventoryTransfer(client, c, row.id)), replayed: true };
  if (!["dispatched", "partially_received"].includes(row.status))
    throw new TransferError(409, row.status === "completed" ? "Everything on this transfer has arrived." : "Only a dispatched transfer is received.", "TRANSFER_STATE_INVALID");
  await stocked(() => validateWarehouseOperation(client, c, row.destination_warehouse_id, "transfer", { label: "Destination warehouse" }), "Destination warehouse");
  const day = await today(client);
  await periodOpen(client, c, day, "receipt");
  const lines = await lineRows(client, c, row.id);
  const plan = await pick(client, c, lines, Array.isArray(input.lines) && input.lines.length ? input.lines : null, "received");
  if (!plan.length) throw new TransferError(409, "Nothing on this transfer is in transit.", "TRANSFER_EXCEEDS_IN_TRANSIT");
  const transit = await ensureTransitPosition(client, c);
  const receipt = await group(client, c, row, "transfer_receipt", `receipt:${key}`);
  const moved = [];
  for (const [index, step] of plan.entries()) {
    // The receiving location may differ from the planned one (same warehouse, same disposition); the change is recorded.
    let locationId = step.line.destination_location_id;
    if (step.destinationLocationId) {
      locationId = await stocked(() => ledgerLocation(client, c.organizationId, row.destination_warehouse_id, step.destinationLocationId, { label: "Receiving location" }), "Receiving location");
      const disposition = await dispositionAt(client, c.organizationId, locationId);
      if (disposition !== (step.line.disposition === "expired" ? "available" : step.line.disposition))
        fail("destinationLocationId", `Line ${step.line.line_number}: that location holds ${DISPOSITION_LABEL[disposition]} stock; a transfer never changes disposition.`, "TRANSFER_DISPOSITION_CHANGE");
      if ((locationId ?? null) !== (step.line.destination_location_id ?? null)) moved.push(`line ${step.line.line_number} received into another location`);
    }
    const tag = `${key}:${step.line.id}:${step.part.key}:${index}`;
    const arrived = await withActiveBatch(client, c, step.part.batchId, () => stocked(() => postStockMovement(client, stockContext(c), {
      movementType: "issue", itemId: step.line.item_id, warehouseId: transit.warehouseId, warehouseLocationId: transit.locationId, batchId: step.part.batchId,
      serialId: step.part.serialId ?? undefined, quantity: formatDecimal(step.quantity), referenceType: "inventory_transfer_line", referenceId: step.line.id,
      reason: `${row.document_number} · arrived`, ledgerType: "transfer_from_transit", groupId: receipt.id, idempotencyKey: `itr:${row.id}:from-transit:${tag}`,
      transaction: transactionOf(step.line, step.quantity) }), `Line ${step.line.line_number}`));
    await receiveInto(client, c, row, step.line, step.part, step.quantity, { warehouseId: row.destination_warehouse_id, locationId, ledgerType: "transfer_in", groupId: receipt.id,
      key: `itr:${row.id}:receipt:${tag}`, valueFrom: arrived.id, reason: `${row.document_number} · transfer in` });
  }
  const complete = await settle(client, c, row, plan, "received");
  await client.query(`UPDATE tenant.inventory_transfers SET status = $3, receipt_date = $4, completed_by = CASE WHEN $3 = 'completed' THEN $5::uuid ELSE completed_by END,
            completed_at = CASE WHEN $3 = 'completed' THEN now() ELSE completed_at END, version = version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, row.id, complete ? "completed" : "partially_received", day, c.userId ?? null]);
  const total = plan.reduce((sum, step) => add(sum, step.quantity), ZERO);
  await event(client, c, row.id, complete ? "completed" : "partially_received",
    `${complete ? "Received in full" : "Partly received"}: ${dec(total)} arrived${moved.length ? ` (${moved.join(", ")})` : ""}`, { groupId: receipt.id });
  return { ...(await getInventoryTransfer(client, c, row.id)), replayed: false };
}

// writeOffTransitLoss: stock confirmed lost on the way (never written off automatically). An Adjustment Out from transit, with a reason; the
// transfer completes once everything dispatched has arrived or been written off.
export async function writeOffTransitLoss(client, c, transferId, input = {}) {
  need(c, P.writeOff, "You do not have permission to write off transit losses.");
  const row = await loadTransfer(client, c, transferId, { lock: true });
  if (!["dispatched", "partially_received"].includes(row.status)) throw new TransferError(409, "Only stock still in transit is written off.", "TRANSFER_STATE_INVALID");
  const reason = text(input.reason, 500);
  if (!reason || reason.length < 3) fail("reason", "Explain the loss (carrier claim, damage in transit…).", "TRANSFER_REASON_REQUIRED");
  const lines = await lineRows(client, c, row.id);
  const plan = await pick(client, c, lines, Array.isArray(input.lines) && input.lines.length ? input.lines : null, "written off");
  if (!plan.length) throw new TransferError(409, "Nothing on this transfer is in transit.", "TRANSFER_EXCEEDS_IN_TRANSIT");
  const transit = await ensureTransitPosition(client, c);
  const key = crypto.randomUUID();
  const loss = await group(client, c, row, "transit_loss", `loss:${key}`);
  for (const [index, step] of plan.entries())
    await withActiveBatch(client, c, step.part.batchId, () => stocked(() => postStockMovement(client, stockContext(c), {
      movementType: "issue", itemId: step.line.item_id, warehouseId: transit.warehouseId, warehouseLocationId: transit.locationId, batchId: step.part.batchId,
      serialId: step.part.serialId ?? undefined, quantity: formatDecimal(step.quantity), referenceType: "inventory_transfer_line", referenceId: step.line.id,
      reason: `${row.document_number} · lost in transit: ${reason}`, ledgerType: "adjustment_out", groupId: loss.id, idempotencyKey: `itr:${row.id}:loss:${key}:${index}`,
      transaction: transactionOf(step.line, step.quantity) }), `Line ${step.line.line_number}`));
  const complete = await settle(client, c, row, plan, "lost");
  await client.query(`UPDATE tenant.inventory_transfers SET status = $3, discrepancy_note = concat_ws(' · ', discrepancy_note, $4::text), version = version + 1, updated_at = now()
     WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, complete ? "completed" : row.status, reason]);
  await event(client, c, row.id, "transit_loss", `Written off in transit: ${dec(plan.reduce((sum, step) => add(sum, step.quantity), ZERO))} · ${reason}`, { groupId: loss.id });
  return { ...(await getInventoryTransfer(client, c, row.id)), replayed: false };
}

// reverseInventoryTransfer: undoes a completed transfer posted in error — every leg reversed, latest first, the same batch and serial back where
// they came from (the stock must still be at the destination, not reserved). A transfer with a transit loss, or a decision to send goods back, is
// a new transfer instead.
export async function reverseInventoryTransfer(client, c, transferId, input = {}) {
  need(c, P.reverse, "You do not have permission to reverse transfers.");
  const row = await loadTransfer(client, c, transferId, { lock: true });
  if (row.status === "reversed") return { ...(await getInventoryTransfer(client, c, row.id)), replayed: true };
  if (row.status !== "completed") throw new TransferError(409, "Only a completed transfer is reversed; before that it is cancelled or received.", "TRANSFER_STATE_INVALID");
  const reason = text(input.reason, 500);
  if (!reason || reason.length < 3) fail("reason", "Give the reason for the reversal.", "TRANSFER_REASON_REQUIRED");
  await periodOpen(client, c, await today(client), "reversal");
  const lost = (await client.query(`SELECT 1 FROM tenant.inventory_transfer_lines WHERE organization_id = $1 AND transfer_id = $2 AND lost_base_quantity > 0`, [c.organizationId, row.id])).rows[0];
  if (lost) throw new TransferError(409, "Part of this transfer was written off in transit; move the rest back with a new transfer.", "TRANSFER_REVERSAL_BLOCKED");
  // Latest posting first (by the ledger's own order: postings in one transaction share a timestamp), so stock is taken back from where it is now.
  const groups = (await client.query(
    `SELECT movement_group.id, max(movement.ledger_sequence) AS last_sequence FROM tenant.stock_movement_groups movement_group
       JOIN tenant.stock_movements movement ON movement.movement_group_id = movement_group.id
      WHERE movement_group.organization_id = $1 AND movement_group.source_document_type = 'inventory_transfer' AND movement_group.source_document_id = $2
        AND movement_group.reversal_of_group_id IS NULL AND movement_group.operation_type <> 'reversal'
      GROUP BY movement_group.id ORDER BY last_sequence DESC`, [c.organizationId, row.id])).rows;
  const stock = stockContext(c);
  for (const entry of groups) {
    const ids = (await client.query(`SELECT id FROM tenant.stock_movements WHERE organization_id = $1 AND movement_group_id = $2 ORDER BY ledger_sequence`, [c.organizationId, entry.id])).rows.map((m) => m.id);
    await stocked(() => reverseStockMovements(client, stock, ids, { reason: `${row.document_number} reversed: ${reason}`, keyPrefix: `itr-reverse:${row.id}` }), "Reversal");
  }
  await client.query(`UPDATE tenant.inventory_transfer_serials SET status = 'allocated' WHERE line_id IN (SELECT id FROM tenant.inventory_transfer_lines WHERE transfer_id = $1)`, [row.id]);
  await client.query(`UPDATE tenant.inventory_transfers SET status = 'reversed', reversed_by = $3, reversed_at = now(), reversal_reason = $4, version = version + 1, updated_at = now()
     WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, c.userId ?? null, reason]);
  await event(client, c, row.id, "reversed", `Reversed: ${reason}`);
  return { ...(await getInventoryTransfer(client, c, row.id)), replayed: false };
}

// ------------------------------------------------------------------ reading

const SELECT = `
  SELECT transfer.*, source.code AS source_code, source.name AS source_name, destination.code AS destination_code, destination.name AS destination_name,
         creator.full_name AS created_by_name, dispatcher.full_name AS dispatched_by_name, completer.full_name AS completed_by_name, confirmer.full_name AS confirmed_by_name,
         (SELECT count(*) FROM tenant.inventory_transfer_lines line WHERE line.transfer_id = transfer.id) AS line_count,
         (SELECT COALESCE(sum(line.dispatched_base_quantity - line.received_base_quantity - line.lost_base_quantity), 0) FROM tenant.inventory_transfer_lines line
           WHERE line.transfer_id = transfer.id) AS in_transit
    FROM tenant.inventory_transfers transfer
    JOIN tenant.warehouses source ON source.organization_id = transfer.organization_id AND source.id = transfer.source_warehouse_id
    JOIN tenant.warehouses destination ON destination.organization_id = transfer.organization_id AND destination.id = transfer.destination_warehouse_id
    LEFT JOIN public.users creator ON creator.id = transfer.created_by
    LEFT JOIN public.users confirmer ON confirmer.id = transfer.confirmed_by
    LEFT JOIN public.users dispatcher ON dispatcher.id = transfer.dispatched_by
    LEFT JOIN public.users completer ON completer.id = transfer.completed_by`;

const toHeader = (row) => ({
  id: row.id, number: row.document_number, type: row.transfer_type, mode: row.transfer_mode, status: row.status,
  statusLabel: TRANSFER_STATUSES.find((entry) => entry.id === row.status)?.label ?? row.status, sourceWarehouseId: row.source_warehouse_id, source: row.source_code, sourceName: row.source_name,
  destinationWarehouseId: row.destination_warehouse_id, destination: row.destination_code, destinationName: row.destination_name, transferDate: dayOf(row.transfer_date),
  expectedArrivalDate: dayOf(row.expected_arrival_date), dispatchDate: dayOf(row.dispatch_date), receiptDate: dayOf(row.receipt_date), reasonCode: row.reason_code,
  reason: TRANSFER_REASONS.find((entry) => entry.id === row.reason_code)?.label ?? row.reason_code, reference: row.reference, carrier: row.carrier, vehicleNumber: row.vehicle_number,
  transportReference: row.transport_reference, notes: row.notes, discrepancyNote: row.discrepancy_note, lineCount: Number(row.line_count ?? 0), inTransit: n(row.in_transit),
  createdAt: row.created_at, createdByName: row.created_by_name, confirmedAt: row.confirmed_at, confirmedByName: row.confirmed_by_name, dispatchedAt: row.dispatched_at,
  dispatchedByName: row.dispatched_by_name, completedAt: row.completed_at, completedByName: row.completed_by_name, cancelledAt: row.cancelled_at, cancelReason: row.cancel_reason,
  reversedAt: row.reversed_at, reversalReason: row.reversal_reason, version: row.version,
});

export async function getInventoryTransfer(client, c, transferId) {
  need(c, P.view, "You do not have permission to view transfers.");
  const row = (await client.query(`${SELECT} WHERE transfer.organization_id = $1 AND transfer.id = $2`, [c.organizationId, uuid(transferId, "Transfer")])).rows[0];
  const visible = row ? await visibleWarehouseIds(client, c) : null;
  if (!row || (visible && !visible.includes(row.source_warehouse_id) && !visible.includes(row.destination_warehouse_id))) throw new TransferError(404, "Transfer not found.", "TRANSFER_NOT_FOUND");
  const lines = await lineRows(client, c, row.id);
  const reservations = (await client.query(`SELECT reservation_number, status, quantity, active_quantity, consumed_quantity, released_quantity FROM tenant.stock_reservations
      WHERE organization_id = $1 AND reference_type = 'stock_transfer' AND reference_id = $2 ORDER BY created_at`, [c.organizationId, row.id])).rows;
  const ledger = ["draft", "confirmed", "cancelled"].includes(row.status) ? { rows: [] }
    : await getStockLedger(client, { ...c, permissions: [...(c.permissions ?? []), "stock.ledger.view"] }, { sourceType: "inventory_transfer", sourceId: row.id, limit: 500 });
  const history = (await client.query(`SELECT event.event_type, event.summary, event.created_at, actor.full_name AS actor_name FROM tenant.inventory_transfer_events event
      LEFT JOIN public.users actor ON actor.id = event.actor_user_id WHERE event.organization_id = $1 AND event.transfer_id = $2 ORDER BY event.created_at`, [c.organizationId, row.id])).rows
    .map((entry) => ({ type: entry.event_type, summary: entry.summary, at: entry.created_at, actor: entry.actor_name }));
  const draftish = ["draft", "confirmed"].includes(row.status);
  const lineOut = [];
  for (const line of lines) {
    const position = draftish && line.lots.length <= 1
      ? await positionOf(client, c, { itemId: line.item_id, warehouseId: row.source_warehouse_id, locationId: line.source_location_id, batchId: line.lots[0]?.batch_id ?? null }) : null;
    lineOut.push({
      id: line.id, lineNumber: line.line_number, itemId: line.item_id, sku: line.sku, itemName: line.item_name, trackingType: line.tracking_type, quantity: n(line.quantity), uomId: line.uom_id,
      uom: line.uom_code, conversion: n(line.conversion_factor), baseQuantity: n(line.base_quantity), baseUom: line.base_uom_code, sourceLocationId: line.source_location_id,
      sourceLocation: line.source_location_code, destinationLocationId: line.destination_location_id, destinationLocation: line.destination_location_code, disposition: line.disposition,
      dispatched: n(line.dispatched_base_quantity), received: n(line.received_base_quantity), lost: n(line.lost_base_quantity),
      inTransit: n(Number(line.dispatched_base_quantity) - Number(line.received_base_quantity) - Number(line.lost_base_quantity)), notes: line.notes,
      batches: line.lots.map((lot) => ({ batchId: lot.batch_id, batch: lot.batch_number, expiresOn: dayOf(lot.expires_on), quantity: n(lot.base_quantity), received: n(lot.received_base_quantity),
        lost: n(lot.lost_base_quantity) })),
      serials: line.serials.map((serial) => ({ id: serial.serial_id, serialNumber: serial.serial_number, status: serial.status })),
      ...(position ? { availableNow: n(row.status === "confirmed" ? position.quantity : position.free) } : {}),
    });
  }
  const status = row.status;
  return {
    transfer: toHeader(row), lines: lineOut, movements: ledger.rows, history,
    reservations: reservations.map((entry) => ({ number: entry.reservation_number, status: entry.status, quantity: n(entry.quantity), active: n(entry.active_quantity),
      consumed: n(entry.consumed_quantity), released: n(entry.released_quantity) })),
    capabilities: {
      edit: status === "draft" && can(c, P.create), confirm: status === "draft" && row.transfer_type === "warehouse" && can(c, P.confirm),
      backToDraft: status === "confirmed" && can(c, P.confirm), cancel: (status === "draft" && can(c, P.create)) || (status === "confirmed" && can(c, P.confirm)),
      dispatch: status === "confirmed" && row.transfer_mode === "in_transit" && can(c, P.dispatch),
      complete: ((status === "confirmed" && row.transfer_type === "warehouse") || (status === "draft" && row.transfer_type === "location")) && row.transfer_mode === "direct" && can(c, P.dispatch),
      receive: ["dispatched", "partially_received"].includes(status) && can(c, P.receive), writeOff: ["dispatched", "partially_received"].includes(status) && can(c, P.writeOff),
      reverse: status === "completed" && can(c, P.reverse),
    },
  };
}

// filters: view (draft | confirmed | in_transit | partially_received | completed | cancelled | reversed), type, mode, sourceWarehouseId,
// destinationWarehouseId, itemId, from, to, search (number, reference, transport, SKU), limit, offset.
export async function listInventoryTransfers(client, c, filters = {}) {
  need(c, P.view, "You do not have permission to view transfers.");
  const values = [c.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = ["transfer.organization_id = $1"];
  const visible = await visibleWarehouseIds(client, c);
  if (visible) where.push(`(transfer.source_warehouse_id = ANY(${bind(visible)}::uuid[]) OR transfer.destination_warehouse_id = ANY($${values.length}::uuid[]))`);
  const view = text(filters.view ?? filters.status, 30);
  if (view === "in_transit") where.push(`transfer.status IN ('dispatched', 'partially_received')`);
  else if (TRANSFER_STATUSES.some((entry) => entry.id === view)) where.push(`transfer.status = ${bind(view)}`);
  if (["warehouse", "location"].includes(filters.type)) where.push(`transfer.transfer_type = ${bind(filters.type)}`);
  if (["direct", "in_transit"].includes(filters.mode)) where.push(`transfer.transfer_mode = ${bind(filters.mode)}`);
  for (const [key, column] of [["sourceWarehouseId", "transfer.source_warehouse_id"], ["destinationWarehouseId", "transfer.destination_warehouse_id"]])
    if (filters[key] && UUID.test(filters[key])) where.push(`${column} = ${bind(filters[key])}`);
  if (filters.itemId && UUID.test(filters.itemId)) where.push(`EXISTS (SELECT 1 FROM tenant.inventory_transfer_lines line WHERE line.transfer_id = transfer.id AND line.item_id = ${bind(filters.itemId)})`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.from ?? ""))) where.push(`transfer.transfer_date >= ${bind(filters.from)}::date`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.to ?? ""))) where.push(`transfer.transfer_date <= ${bind(filters.to)}::date`);
  const term = text(filters.search, 120);
  if (term) where.push(`(lower(concat_ws(' ', transfer.document_number, transfer.reference, transfer.transport_reference, transfer.vehicle_number)) LIKE ${bind(`%${term.toLowerCase()}%`)}
     OR EXISTS (SELECT 1 FROM tenant.inventory_transfer_lines line JOIN tenant.items item ON item.id = line.item_id WHERE line.transfer_id = transfer.id
       AND lower(concat_ws(' ', item.code, item.name)) LIKE $${values.length}))`);
  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 1000);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const total = Number((await client.query(`SELECT count(*) FROM tenant.inventory_transfers transfer WHERE ${where.join(" AND ")}`, values)).rows[0].count);
  const rows = (await client.query(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY transfer.transfer_date DESC, transfer.document_number DESC LIMIT ${bind(limit)} OFFSET ${bind(offset)}`, values)).rows;
  return { total, rows: rows.map(toHeader), canCreate: can(c, P.create), canExport: can(c, P.export) };
}

// The transfer list as CSV (the same filters), for those who may export.
export async function exportInventoryTransfers(client, c, filters = {}) {
  need(c, P.export, "You do not have permission to export transfers.");
  const { rows } = await listInventoryTransfers(client, c, { ...filters, limit: 1000 });
  const cell = (value) => { const out = value === null || value === undefined ? "" : String(value); return /[",\n\r]/.test(out) || /^[=+\-@]/.test(out) ? `"${(/^[=+\-@]/.test(out) ? `'${out}` : out).replace(/"/g, '""')}"` : out; };
  const header = ["Transfer", "Date", "Type", "Mode", "Source", "Destination", "Items", "In transit", "Expected arrival", "Status", "Reason", "Reference", "Created by"];
  const lines = rows.map((row) => [row.number, row.transferDate, row.type === "warehouse" ? "Warehouse" : "Location", row.mode === "direct" ? "Direct" : "In transit", row.source, row.destination,
    row.lineCount, row.inTransit, row.expectedArrivalDate, row.statusLabel, row.reason, row.reference, row.createdByName].map(cell).join(","));
  return { fileName: `transfers-${await today(client)}.csv`, body: `﻿${[header.join(","), ...lines].join("\r\n")}\r\n` };
}

export async function getInventoryTransferOptions(client, c) {
  need(c, P.view, "You do not have permission to view transfers.");
  const visible = await visibleWarehouseIds(client, c);
  const warehouses = (await client.query(`SELECT id, code, name, is_default, transfer_enabled FROM tenant.warehouses WHERE organization_id = $1 AND status = 'active' AND system_role IS NULL
      ORDER BY is_default DESC, name`, [c.organizationId])).rows;
  const locations = (await client.query(`SELECT id, warehouse_id, code, name, is_default_storage, is_default_receiving, disposition FROM tenant.warehouse_locations
      WHERE organization_id = $1 AND status = 'active' AND allow_stock AND warehouse_id = ANY($2::uuid[]) ORDER BY is_default_storage DESC, code`, [c.organizationId, warehouses.map((row) => row.id)])).rows;
  return {
    warehouses: warehouses.map((row) => ({ id: row.id, code: row.code, name: row.name, isDefault: row.is_default, transferEnabled: row.transfer_enabled, mine: !visible || visible.includes(row.id),
      locations: locations.filter((location) => location.warehouse_id === row.id).map((location) => ({ id: location.id, code: location.code, name: location.name, isMain: location.is_default_storage,
        isReceiving: location.is_default_receiving, disposition: location.disposition })) })),
    reasons: TRANSFER_REASONS, statuses: TRANSFER_STATUSES,
    capabilities: { create: can(c, P.create), confirm: can(c, P.confirm), dispatch: can(c, P.dispatch), receive: can(c, P.receive), restricted: can(c, P.restricted),
      writeOff: can(c, P.writeOff), reverse: can(c, P.reverse), export: can(c, P.export) },
  };
}

// For the line editor: an item's positions at the source warehouse, its batches and serial numbers in stock.
export async function getTransferAvailability(client, c, { warehouseId, itemId } = {}) {
  need(c, P.view, "You do not have permission to view transfers.");
  const warehouse = uuid(warehouseId, "Warehouse");
  const visible = await visibleWarehouseIds(client, c);
  if (visible && !visible.includes(warehouse)) throw new TransferError(403, "You may not work in this warehouse.", "WAREHOUSE_FORBIDDEN");
  return itemPositions(client, c, { warehouseId: warehouse, itemId: uuid(itemId, "Item") });
}
