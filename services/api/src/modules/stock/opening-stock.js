// Opening Stock: the controlled Inventory document that brings in the stock a company already owns when it starts using Vercentlabs. It is
// never a quantity typed onto an item or a warehouse.
//
// One document is one warehouse of the company at one cutoff date, under a migration reference that is loaded once. Each line is an item
// in a location of that warehouse, entered in one of the item's inventory units (the conversion is snapshotted and the base quantity
// derived), at an opening cost per that unit (normalized per base unit), with its disposition (available, or held: quality hold,
// quarantined, damaged — held stock sits in a quality location and is never available) and, for tracked items, its batch (with
// manufacturing and expiry dates) or its serial numbers (one per base unit).
//
// Draft: editable, no effect anywhere. Post (a stronger permission): everything is checked again under a lock, then — exactly once — the
// batches and serials are created, one Inventory receipt per line (reference 'opening_stock', dated at the cutoff) with its valuation
// layer, and Finance's opening entry (Dr Inventory, Cr Opening balance equity) through Accounting's own journals. Posting twice returns the
// first posting. A posted document never changes; a quantity found wrong later is an Inventory adjustment. A controlled reversal undoes a
// posting only while nothing has used its stock, in an open period, with a reason.
import { createHash } from "node:crypto";

import { OPENING_STOCK_PERMISSIONS as P } from "@vercentlabs/permissions";

import { parseCsvUpload } from "../../core/platform/data-exchange/csv.js";
import { isXlsxFileName, parseXlsxUpload } from "../../core/platform/data-exchange/xlsx.js";
import { archiveFile, listFiles, prepareFileUpload, readFileContent, storeFile } from "../../core/platform/files/index.js";
import { nextDocumentNumber } from "../../core/platform/numbering/index.js";
import { add, decimal, div, formatDecimal, mul, roundMoney } from "../../core/decimal.js";
import { createJournalEntry, getAccountMapping, getOpenPeriod, getPrimaryLedger, postJournalEntry, reverseJournalEntry } from "../accounting/index.js";
import { AccountingError } from "../accounting/core.js";
import { normalizeQuantityToBase } from "../products/uom.js";
import { StockError, postStockMovement, reverseStockMovements } from "./index.js";
import { canUseWarehouse, validateWarehouseOperation } from "./warehouses.js";

export class OpeningStockError extends Error {
  constructor(status, message, code = "OPENING_STOCK_ERROR", details = undefined) {
    super(message);
    this.name = "OpeningStockError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const OPENING_STOCK_FILE_ENTITY = "stock.opening_stock";
export const OPENING_DISPOSITIONS = Object.freeze([
  { code: "available", label: "Available" }, { code: "quality_hold", label: "Quality hold" }, { code: "quarantined", label: "Quarantined" }, { code: "damaged", label: "Damaged" },
]);
const STATUS_LABEL = Object.freeze({ draft: "Draft", posted: "Posted", cancelled: "Cancelled", reversed: "Reversed" });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER = /^\d+(\.\d+)?$/;
const MAX_LINES = 5000;
const ZERO = 0n;

const privileged = (c) => Boolean(c.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug)));
export const openingCan = (c, permission) => privileged(c) || Boolean(c.permissions?.includes(permission));
const need = (c, permission, message) => { if (!openingCan(c, permission)) throw new OpeningStockError(403, message, "PERMISSION_DENIED"); };
const text = (value, max = 500) => { const out = String(value ?? "").trim(); return out ? out.slice(0, max) : null; };
const has = (input, key) => Object.prototype.hasOwnProperty.call(input ?? {}, key);
const issue = (field, message, code = "OPENING_STOCK_VALIDATION", status = 400) => new OpeningStockError(status, message, code, { issues: [{ field, message }] });
const uuid = (value, label) => { const id = String(value ?? "").trim(); if (!UUID.test(id)) throw issue(label.toLowerCase(), `${label} is not valid.`); return id; };
// A date column comes back as local midnight: read its calendar day, never its UTC instant.
const dayOf = (value) => (value instanceof Date
  ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
  : value ? String(value).slice(0, 10) : null);
const dec = (value) => formatDecimal(value).replace(/\.?0+$/, "") || "0";
const number = (value) => Number(value ?? 0);

export function openingStockCapabilities(c) {
  return Object.fromEntries(Object.entries(P).map(([name, permission]) => [name, openingCan(c, permission)]));
}

async function today(client) { return (await client.query(`SELECT current_date::text AS d`)).rows[0].d; }

async function event(client, c, documentId, eventType, summary, changes = {}, reason = null) {
  await client.query(`INSERT INTO tenant.opening_stock_events (organization_id, opening_stock_id, event_type, summary, changes, reason, actor_user_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [c.organizationId, documentId, eventType, String(summary).slice(0, 500), JSON.stringify(changes), reason, c.userId ?? null]);
}

// ------------------------------------------------------------------ reading

const SELECT = `
  SELECT document.*, warehouse.code AS warehouse_code, warehouse.name AS warehouse_name, creator.full_name AS created_by_name, poster.full_name AS posted_by_name,
         entry.entry_number AS journal_number, entry.status AS journal_status, reversal.entry_number AS reversal_journal_number,
         (SELECT count(*)::int FROM tenant.opening_stock_lines line WHERE line.organization_id = document.organization_id AND line.opening_stock_id = document.id) AS line_count,
         (SELECT count(DISTINCT line.item_id)::int FROM tenant.opening_stock_lines line WHERE line.organization_id = document.organization_id AND line.opening_stock_id = document.id) AS item_count,
         (SELECT COALESCE(sum(line.line_value), 0) FROM tenant.opening_stock_lines line WHERE line.organization_id = document.organization_id AND line.opening_stock_id = document.id) AS lines_value
    FROM tenant.opening_stocks document
    JOIN tenant.warehouses warehouse ON warehouse.organization_id = document.organization_id AND warehouse.id = document.warehouse_id
    LEFT JOIN public.users creator ON creator.id = document.created_by
    LEFT JOIN public.users poster ON poster.id = document.posted_by
    LEFT JOIN tenant.accounting_journal_entries entry ON entry.organization_id = document.organization_id AND entry.id = document.journal_entry_id
    LEFT JOIN tenant.accounting_journal_entries reversal ON reversal.organization_id = document.organization_id AND reversal.id = document.reversal_journal_entry_id`;

function toDocument(row, c) {
  const cost = openingCan(c, P.viewCost);
  const value = row.status === "draft" ? row.lines_value : row.total_value;
  return {
    id: row.id, number: row.document_number, warehouseId: row.warehouse_id, warehouseCode: row.warehouse_code, warehouseName: row.warehouse_name,
    openingDate: dayOf(row.opening_date), accountingDate: dayOf(row.accounting_date), currencyCode: row.currency_code, migrationReference: row.migration_reference,
    sourceSystem: row.source_system, externalReference: row.external_reference, notes: row.notes, status: row.status, statusLabel: STATUS_LABEL[row.status],
    items: number(row.item_count), lines: number(row.line_count), ...(cost ? { value: number(value) } : {}),
    journalEntryId: row.journal_entry_id, journalNumber: row.journal_number, reversalJournalNumber: row.reversal_journal_number,
    zeroCostReason: row.zero_cost_reason, cancelReason: row.cancel_reason, reversalReason: row.reversal_reason, backdatedAcknowledged: row.backdated_acknowledged,
    createdBy: row.created_by_name, createdAt: row.created_at, postedBy: row.posted_by_name, postedAt: row.posted_at, cancelledAt: row.cancelled_at, reversedAt: row.reversed_at,
    version: number(row.version),
  };
}

// filters: view (all | draft | posted | cancelled | reversed), search (number, reference, warehouse), warehouseId
export async function listOpeningStocks(client, c, filters = {}) {
  need(c, P.view, "You do not have permission to view opening stock.");
  const values = [c.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = ["document.organization_id = $1"];
  if (["draft", "posted", "cancelled", "reversed"].includes(filters.view)) where.push(`document.status = ${bind(filters.view)}`);
  if (filters.warehouseId && UUID.test(filters.warehouseId)) where.push(`document.warehouse_id = ${bind(filters.warehouseId)}`);
  const term = text(filters.search, 120);
  if (term) where.push(`lower(concat_ws(' ', document.document_number, document.migration_reference, document.source_system, warehouse.code, warehouse.name)) LIKE ${bind(`%${term.toLowerCase()}%`)}`);
  const { rows } = await client.query(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY document.created_at DESC LIMIT 500`, values);
  return { documents: rows.map((row) => toDocument(row, c)), capabilities: openingStockCapabilities(c) };
}

async function loadDocument(client, c, documentId, { lock = false } = {}) {
  const id = uuid(documentId, "Opening stock");
  if (lock) await client.query(`SELECT id FROM tenant.opening_stocks WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, id]);
  const row = (await client.query(`${SELECT} WHERE document.organization_id = $1 AND document.id = $2`, [c.organizationId, id])).rows[0];
  if (!row) throw new OpeningStockError(404, "Opening stock document not found.", "OPENING_STOCK_NOT_FOUND");
  return row;
}

async function lineRows(client, organizationId, documentId) {
  return (await client.query(
    `SELECT line.*, item.code AS item_code, item.name AS item_name, item.tracking_type, uom.code AS uom_code, base.code AS base_uom_code, location.code AS location_code,
            location.name AS location_name
       FROM tenant.opening_stock_lines line
       JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
       JOIN tenant.units_of_measure uom ON uom.organization_id = line.organization_id AND uom.id = line.uom_id
       LEFT JOIN tenant.units_of_measure base ON base.organization_id = item.organization_id AND base.id = item.uom_id
       JOIN tenant.warehouse_locations location ON location.organization_id = line.organization_id AND location.id = line.location_id
      WHERE line.organization_id = $1 AND line.opening_stock_id = $2 ORDER BY line.line_number`, [organizationId, documentId])).rows;
}

function toLine(row, c) {
  const cost = openingCan(c, P.viewCost);
  return {
    id: row.id, lineNumber: row.line_number, itemId: row.item_id, sku: row.item_code, itemName: row.item_name, trackingType: row.tracking_type, locationId: row.location_id,
    locationCode: row.location_code, quantity: number(row.quantity), uomId: row.uom_id, uomCode: row.uom_code, conversionFactor: number(row.conversion_factor),
    baseQuantity: number(row.base_quantity), baseUomCode: row.base_uom_code, disposition: row.disposition,
    dispositionLabel: OPENING_DISPOSITIONS.find((entry) => entry.code === row.disposition)?.label ?? row.disposition, batchNumber: row.batch_number,
    manufacturedOn: dayOf(row.manufactured_on), expiresOn: dayOf(row.expires_on), serialNumbers: row.serial_numbers ?? [], notes: row.notes,
    ...(cost ? { unitCost: row.unit_cost === null ? null : number(row.unit_cost), baseUnitCost: row.base_unit_cost === null ? null : number(row.base_unit_cost), value: number(row.line_value) } : {}),
  };
}

// The document with its lines, valuation, Finance link, import reports, files and history.
export async function getOpeningStock(client, c, documentId) {
  need(c, P.view, "You do not have permission to view opening stock.");
  const row = await loadDocument(client, c, documentId);
  const lines = (await lineRows(client, c.organizationId, row.id)).map((line) => toLine(line, c));
  const imports = (await client.query(
    `SELECT id, source_filename, status, total_rows, valid_rows, warning_rows, error_rows, report, uploaded_at FROM tenant.opening_stock_import_batches
      WHERE organization_id = $1 AND opening_stock_id = $2 ORDER BY uploaded_at DESC`, [c.organizationId, row.id])).rows.map(toImport);
  return {
    ...toDocument(row, c), lineItems: lines, imports, accounting: openingCan(c, P.reconcile) ? await accountingStatus(client, c, row) : null,
    files: await listOpeningStockFiles(client, c, row.id), history: await getOpeningStockHistory(client, c, row.id), capabilities: openingStockCapabilities(c),
  };
}

export async function getOpeningStockHistory(client, c, documentId) {
  need(c, P.view, "You do not have permission to view opening stock.");
  const { rows } = await client.query(
    `SELECT history.*, actor.full_name AS actor_name FROM tenant.opening_stock_events history LEFT JOIN public.users actor ON actor.id = history.actor_user_id
      WHERE history.organization_id = $1 AND history.opening_stock_id = $2 ORDER BY history.created_at DESC, history.id DESC LIMIT 300`, [c.organizationId, uuid(documentId, "Opening stock")]);
  return rows.map((entry) => ({ id: entry.id, eventType: entry.event_type, summary: entry.summary, changes: entry.changes, reason: entry.reason, actorName: entry.actor_name, createdAt: entry.created_at }));
}

// ------------------------------------------------------------------ the header

async function readHeader(client, c, input, current = null) {
  const pick = (key, column) => (has(input, key) ? input[key] : current?.[column]);
  const warehouseId = pick("warehouseId", "warehouse_id");
  if (!warehouseId) throw issue("warehouseId", "Choose the warehouse the stock is in.");
  const openingDate = dayOf(pick("openingDate", "opening_date"));
  if (!openingDate || !DATE.test(openingDate)) throw issue("openingDate", "Enter the opening (cutoff) date.");
  const accountingDate = dayOf(pick("accountingDate", "accounting_date")) ?? openingDate;
  if (!DATE.test(accountingDate)) throw issue("accountingDate", "Enter the accounting date.");
  const now = await today(client);
  if (openingDate > now) throw issue("openingDate", "Opening stock cannot be dated in the future.");
  if (accountingDate > now) throw issue("accountingDate", "The accounting date cannot be in the future.");
  if (accountingDate < openingDate) throw issue("accountingDate", "The accounting date cannot be before the opening date.");
  const migrationReference = text(pick("migrationReference", "migration_reference"), 120);
  if (!migrationReference) throw issue("migrationReference", "Enter the migration reference, such as PUNE-CUTOVER-2026.");
  const organization = (await client.query(`SELECT base_currency FROM public.organizations WHERE id = $1`, [c.organizationId])).rows[0];
  const currencyCode = (text(pick("currencyCode", "currency_code"), 3) ?? organization?.base_currency ?? "INR").toUpperCase();
  if (currencyCode !== (organization?.base_currency ?? currencyCode)) throw issue("currencyCode", `Opening stock is valued in the company's currency, ${organization.base_currency}.`);
  return {
    warehouseId: uuid(warehouseId, "Warehouse"), openingDate, accountingDate, migrationReference, currencyCode,
    sourceSystem: text(pick("sourceSystem", "source_system"), 120), externalReference: text(pick("externalReference", "external_reference"), 120), notes: text(pick("notes", "notes"), 2000),
  };
}

async function checkReference(client, c, reference, exceptId = null) {
  const clash = (await client.query(`SELECT document_number, status FROM tenant.opening_stocks WHERE organization_id = $1 AND upper(btrim(migration_reference)) = upper(btrim($2))
      AND status <> 'cancelled' AND ($3::uuid IS NULL OR id <> $3)`, [c.organizationId, reference, exceptId])).rows[0];
  if (clash) throw issue("migrationReference", `${reference} was already loaded on ${clash.document_number} (${STATUS_LABEL[clash.status]}). A migration is loaded once.`, "OPENING_STOCK_DUPLICATE_REFERENCE", 409);
}

async function guarded(client, run) {
  await client.query("SAVEPOINT opening_stock_write");
  try { const result = await run(); await client.query("RELEASE SAVEPOINT opening_stock_write"); return result; } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT opening_stock_write");
    if (error?.code === "23505" && /reference/.test(error.constraint ?? "")) throw issue("migrationReference", "This migration reference was just loaded by someone else.", "OPENING_STOCK_DUPLICATE_REFERENCE", 409);
    if (error?.constraint === "opening_stock_posted_immutable") throw new OpeningStockError(409, error.message, "OPENING_STOCK_POSTED");
    throw error;
  }
}

// input: { warehouseId, openingDate, accountingDate?, currencyCode?, migrationReference, sourceSystem?, externalReference?, notes?, lines? }
export async function createOpeningStock(client, c, input = {}) {
  need(c, P.prepare, "You do not have permission to prepare opening stock.");
  const header = await readHeader(client, c, input);
  await validateWarehouseOperation(client, c, header.warehouseId, "opening", { label: "Opening stock" });
  await checkReference(client, c, header.migrationReference);
  const number = await nextDocumentNumber(client, c, { documentType: "opening_stock", prefix: "OS" });
  const id = await guarded(client, async () => (await client.query(
    `INSERT INTO tenant.opening_stocks (organization_id, document_number, warehouse_id, opening_date, accounting_date, currency_code, migration_reference, source_system, external_reference,
       notes, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11) RETURNING id`,
    [c.organizationId, number, header.warehouseId, header.openingDate, header.accountingDate, header.currencyCode, header.migrationReference, header.sourceSystem, header.externalReference,
      header.notes, c.userId ?? null])).rows[0].id);
  await event(client, c, id, "created", `Opening stock ${number} created for ${header.migrationReference}`, { migrationReference: header.migrationReference });
  if (Array.isArray(input.lines) && input.lines.length) await replaceLines(client, c, id, input.lines);
  return getOpeningStock(client, c, id);
}

function requireDraft(row) {
  if (row.status !== "draft") throw new OpeningStockError(409, `${row.document_number} is ${STATUS_LABEL[row.status].toLowerCase()}; only a draft can change. Correct posted stock with an Inventory adjustment.`, "OPENING_STOCK_POSTED");
}

// input: header fields, lines (the whole list, replacing the draft's), expectedVersion
export async function updateDraftOpeningStock(client, c, documentId, input = {}) {
  need(c, P.prepare, "You do not have permission to prepare opening stock.");
  const row = await loadDocument(client, c, documentId, { lock: true });
  requireDraft(row);
  if (input.expectedVersion !== undefined && input.expectedVersion !== null && Number(input.expectedVersion) !== Number(row.version))
    throw new OpeningStockError(409, "Someone else changed this opening stock after you opened it. Reload it.", "OPENING_STOCK_VERSION_CONFLICT");
  const header = await readHeader(client, c, input, row);
  if (header.warehouseId !== row.warehouse_id) {
    if (number(row.line_count) > 0 && !Array.isArray(input.lines)) throw issue("warehouseId", "Remove the lines before moving the document to another warehouse.", "OPENING_STOCK_WAREHOUSE_LOCKED", 409);
    await validateWarehouseOperation(client, c, header.warehouseId, "opening", { label: "Opening stock" });
  }
  if (header.migrationReference.toUpperCase() !== row.migration_reference.toUpperCase()) await checkReference(client, c, header.migrationReference, row.id);
  await guarded(client, () => client.query(
    `UPDATE tenant.opening_stocks SET warehouse_id = $3, opening_date = $4, accounting_date = $5, currency_code = $6, migration_reference = $7, source_system = $8, external_reference = $9,
       notes = $10, version = version + 1, updated_by = $11, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, row.id, header.warehouseId, header.openingDate, header.accountingDate, header.currencyCode, header.migrationReference, header.sourceSystem, header.externalReference,
      header.notes, c.userId ?? null]));
  await event(client, c, row.id, "updated", "Details changed", { openingDate: header.openingDate, accountingDate: header.accountingDate, migrationReference: header.migrationReference });
  if (Array.isArray(input.lines)) await replaceLines(client, c, row.id, input.lines);
  return getOpeningStock(client, c, row.id);
}

// ------------------------------------------------------------------ lines

// One line as entered, checked and computed: item (a stock item of this company, inventory-tracked), location (of the warehouse; MAIN by
// default, a quality location for held stock), quantity in an inventory unit (converted exactly to base), cost per that unit (normalized per
// base unit; value = quantity × cost), disposition, and the batch or serial numbers the item's tracking needs. Throws with the field.
async function readLine(client, c, warehouse, raw, index, { previous = null, today: now }) {
  const field = (name) => `lines.${index}.${name}`;
  const fail = (name, message, code = "OPENING_STOCK_LINE_INVALID") => { throw new OpeningStockError(400, `Line ${index + 1}: ${message}`, code, { issues: [{ field: field(name), message }], line: index + 1 }); };
  if (!raw?.itemId || !UUID.test(String(raw.itemId))) fail("itemId", "choose the item.");
  const item = (await client.query(
    `SELECT item.id, item.code, item.name, item.item_type, item.track_inventory, item.tracking_type, item.lifecycle_status, item.requires_expiry_date, item.uom_id
       FROM tenant.items item WHERE item.organization_id = $1 AND item.id = $2`, [c.organizationId, raw.itemId])).rows[0];
  if (!item) fail("itemId", "the item was not found.", "OPENING_STOCK_ITEM_NOT_FOUND");
  if (item.item_type === "service") fail("itemId", `${item.code} is a service; services have no stock.`, "OPENING_STOCK_ITEM_NOT_STOCK");
  if (!item.track_inventory) fail("itemId", `${item.code} is not inventory-tracked; opening stock is for stock items.`, "OPENING_STOCK_ITEM_NOT_STOCK");
  if (item.lifecycle_status === "draft") fail("itemId", `${item.code} is still a draft. Activate it first.`, "OPENING_STOCK_ITEM_INACTIVE");
  const disposition = String(raw.disposition ?? "available");
  if (!OPENING_DISPOSITIONS.some((entry) => entry.code === disposition)) fail("disposition", "choose available, quality hold, quarantined or damaged.");
  const held = disposition !== "available";
  // Location: chosen, else MAIN for available stock or, for held stock, the warehouse's location holding that disposition (else any location
  // of held stock). Held stock only ever goes where nothing is allocated; available stock only where stock is available.
  let locationId = raw.locationId && UUID.test(String(raw.locationId)) ? String(raw.locationId) : null;
  if (!locationId) {
    locationId = (await client.query(held
      ? `SELECT id FROM tenant.warehouse_locations WHERE organization_id = $1 AND warehouse_id = $2 AND status = 'active' AND allow_stock AND disposition <> 'available'
          ORDER BY (disposition = $3) DESC, code LIMIT 1`
      : `SELECT id FROM tenant.warehouse_locations WHERE organization_id = $1 AND warehouse_id = $2 AND is_default_storage AND $3::text IS NOT NULL`,
      [c.organizationId, warehouse.id, disposition])).rows[0]?.id ?? null;
    if (!locationId) fail("locationId", held ? `${warehouse.code} has no location for held stock. Add a quality hold, quarantine or damaged location under Warehouses first.` : "choose the location.");
  }
  const location = (await client.query(`SELECT id, code, warehouse_id, status, allow_stock, location_type, disposition FROM tenant.warehouse_locations WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, locationId])).rows[0];
  if (!location || location.warehouse_id !== warehouse.id) fail("locationId", `the location is not in ${warehouse.code}.`, "OPENING_STOCK_LOCATION_INVALID");
  if (location.status !== "active" || !location.allow_stock) fail("locationId", `${location.code} is inactive or does not hold stock.`, "OPENING_STOCK_LOCATION_INVALID");
  const heldLocation = location.disposition !== "available" || location.location_type === "quality";
  if (held && !heldLocation) fail("locationId", `held stock goes into a location for held stock, not ${location.code}.`, "OPENING_STOCK_LOCATION_INVALID");
  if (!held && heldLocation) fail("disposition", `${location.code} holds held stock: choose quality hold, quarantined or damaged.`, "OPENING_STOCK_LOCATION_INVALID");
  // Quantity in the unit entered, converted exactly to base.
  const rawQuantity = String(raw.quantity ?? "").trim();
  if (!NUMBER.test(rawQuantity) || decimal(rawQuantity) <= ZERO) fail("quantity", "enter a quantity greater than zero (opening stock is never negative).", "OPENING_STOCK_QUANTITY_INVALID");
  const unit = await normalizeQuantityToBase(client, c.organizationId, item.id, raw.uomId || item.uom_id, rawQuantity, { purpose: "inventory" });
  if (!unit.ok) fail("uomId", unit.message, unit.code ?? "OPENING_STOCK_UOM_INVALID");
  // Cost per the unit entered; kept from the draft for someone who may not enter costs.
  const canCost = openingCan(c, P.editCost);
  const costInput = canCost ? raw.unitCost : previous?.unit_cost ?? null;
  let unitCost = null;
  if (costInput !== null && costInput !== undefined && String(costInput).trim() !== "") {
    const rawCost = String(costInput).trim();
    if (!NUMBER.test(rawCost)) fail("unitCost", "enter the opening cost as zero or more (never negative).", "OPENING_STOCK_COST_INVALID");
    unitCost = decimal(rawCost);
  }
  const baseUnitCost = unitCost === null ? null : div(unitCost, unit.factor);
  const value = unitCost === null ? ZERO : roundMoney(mul(unit.quantity, unitCost), 2);
  // Tracking.
  const batchNumber = text(raw.batchNumber, 120);
  const manufacturedOn = dayOf(raw.manufacturedOn) || null;
  const expiresOn = dayOf(raw.expiresOn) || null;
  for (const [name, value_] of [["manufacturedOn", manufacturedOn], ["expiresOn", expiresOn]]) if (value_ && !DATE.test(value_)) fail(name, "enter the date as YYYY-MM-DD.");
  if (manufacturedOn && expiresOn && expiresOn < manufacturedOn) fail("expiresOn", "the expiry date cannot be before the manufacturing date.");
  if (manufacturedOn && manufacturedOn > now) fail("manufacturedOn", "the manufacturing date cannot be in the future.");
  if (item.tracking_type === "batch") {
    if (!batchNumber) fail("batchNumber", `${item.code} is batch-tracked: enter its batch (lot) number.`, "OPENING_STOCK_BATCH_REQUIRED");
    if (item.requires_expiry_date && !expiresOn) fail("expiresOn", `${item.code} needs the expiry date of batch ${batchNumber}.`, "OPENING_STOCK_EXPIRY_REQUIRED");
    const existing = (await client.query(`SELECT batch_number, expires_on FROM tenant.stock_batches WHERE organization_id = $1 AND item_id = $2 AND lower(batch_number) = lower($3)`,
      [c.organizationId, item.id, batchNumber])).rows[0];
    if (existing && expiresOn && existing.expires_on && dayOf(existing.expires_on) !== expiresOn)
      fail("expiresOn", `batch ${existing.batch_number} already exists with expiry ${dayOf(existing.expires_on)}.`, "OPENING_STOCK_BATCH_CONFLICT");
  } else if (batchNumber) fail("batchNumber", `${item.code} is not batch-tracked.`, "OPENING_STOCK_BATCH_NOT_ALLOWED");
  const serials = [...new Set((Array.isArray(raw.serialNumbers) ? raw.serialNumbers : String(raw.serialNumbers ?? "").split(/[\s,;]+/)).map((entry) => text(entry, 120)).filter(Boolean))];
  const rawSerialCount = (Array.isArray(raw.serialNumbers) ? raw.serialNumbers : String(raw.serialNumbers ?? "").split(/[\s,;]+/)).map((entry) => text(entry, 120)).filter(Boolean).length;
  if (item.tracking_type === "serial") {
    if (rawSerialCount !== serials.length) fail("serialNumbers", "a serial number is entered twice.", "OPENING_STOCK_SERIAL_DUPLICATE");
    const units = unit.baseQuantity / 1000000n;
    if (BigInt(serials.length) !== units) fail("serialNumbers", `enter one serial number for each of the ${dec(unit.baseQuantity)} ${unit.item.base_code ?? "units"} (${serials.length} entered).`, "OPENING_STOCK_SERIALS_REQUIRED");
  } else if (serials.length) fail("serialNumbers", `${item.code} is not serial-numbered.`, "OPENING_STOCK_SERIAL_NOT_ALLOWED");
  return {
    item, location, disposition, unit, unitCost, baseUnitCost, value, batchNumber, manufacturedOn, expiresOn, serials, notes: text(raw.notes, 1000),
    inactiveItem: item.lifecycle_status === "inactive", expired: Boolean(expiresOn && expiresOn < now),
  };
}

// Replaces the draft's lines with `lines`. Two lines for the same item, location, batch and disposition are refused (consolidate them);
// a serial number twice across lines too.
async function replaceLines(client, c, documentId, lines) {
  const row = await loadDocument(client, c, documentId);
  requireDraft(row);
  if (lines.length > MAX_LINES) throw issue("lines", `An opening stock document holds at most ${MAX_LINES} lines. Split it by warehouse or category.`);
  const warehouse = { id: row.warehouse_id, code: row.warehouse_code };
  const previous = new Map((await client.query(`SELECT id, unit_cost FROM tenant.opening_stock_lines WHERE organization_id = $1 AND opening_stock_id = $2`, [c.organizationId, row.id])).rows
    .map((entry) => [entry.id, entry]));
  const now = await today(client);
  const read = [];
  for (const [index, raw] of lines.entries()) read.push(await readLine(client, c, warehouse, raw, index, { previous: raw?.id ? previous.get(raw.id) : null, today: now }));
  const seen = new Map();
  const serialSeen = new Map();
  for (const [index, line] of read.entries()) {
    const key = `${line.item.id}:${line.location.id}:${(line.batchNumber ?? "").toLowerCase()}:${line.disposition}`;
    if (seen.has(key) && line.item.tracking_type !== "serial")
      throw issue(`lines.${index}.itemId`, `Line ${index + 1}: ${line.item.code} in ${line.location.code}${line.batchNumber ? `, batch ${line.batchNumber}` : ""} is already on line ${seen.get(key) + 1}. Put it on one line.`,
        "OPENING_STOCK_DUPLICATE_LINE", 409);
    seen.set(key, index);
    for (const serial of line.serials) {
      if (serialSeen.has(serial.toLowerCase())) throw issue(`lines.${index}.serialNumbers`, `Line ${index + 1}: serial ${serial} is also on line ${serialSeen.get(serial.toLowerCase()) + 1}.`, "OPENING_STOCK_SERIAL_DUPLICATE", 409);
      serialSeen.set(serial.toLowerCase(), index);
    }
  }
  await client.query(`DELETE FROM tenant.opening_stock_lines WHERE organization_id = $1 AND opening_stock_id = $2`, [c.organizationId, row.id]);
  for (const [index, line] of read.entries())
    await client.query(
      `INSERT INTO tenant.opening_stock_lines (organization_id, opening_stock_id, line_number, item_id, location_id, quantity, uom_id, conversion_factor, base_quantity, unit_cost, base_unit_cost,
         line_value, disposition, batch_number, manufactured_on, expires_on, serial_numbers, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [c.organizationId, row.id, index + 1, line.item.id, line.location.id, formatDecimal(line.unit.quantity), line.unit.unit.uomId, formatDecimal(line.unit.factor),
        formatDecimal(line.unit.baseQuantity), line.unitCost === null ? null : formatDecimal(line.unitCost), line.baseUnitCost === null ? null : formatDecimal(line.baseUnitCost),
        formatDecimal(line.value), line.disposition, line.batchNumber, line.manufacturedOn, line.expiresOn, line.serials, line.notes]);
  await client.query(`UPDATE tenant.opening_stocks SET version = version + 1, updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, c.userId ?? null]);
  await event(client, c, row.id, "lines_changed", `${read.length} line${read.length === 1 ? "" : "s"} saved`, { lines: read.length });
  return read;
}

// ------------------------------------------------------------------ validation

// Everything posting checks, without posting: { errors, warnings, summary }. errors block posting; warnings need the matching permission or
// an acknowledgement (zero cost: a reason; backdated: acknowledgeBackdated).
async function assess(client, c, row) {
  const errors = [];
  const warnings = [];
  const lines = await lineRows(client, c.organizationId, row.id);
  const now = await today(client);
  if (!lines.length) errors.push({ code: "OPENING_STOCK_EMPTY", message: "Add the stock to bring in." });
  // The warehouse: still this company's, active, and the user may bring in opening stock there.
  try { await validateWarehouseOperation(client, c, row.warehouse_id, "opening", { label: row.warehouse_code }); } catch (error) { errors.push({ code: error.code, message: error.message }); }
  if (dayOf(row.opening_date) > now) errors.push({ code: "OPENING_STOCK_FUTURE", message: "Opening stock cannot be dated in the future." });
  // Every line again, as posting will see it.
  const warehouse = { id: row.warehouse_id, code: row.warehouse_code };
  let value = ZERO;
  let batches = 0;
  let serials = 0;
  for (const [index, line] of lines.entries()) {
    try {
      const read = await readLine(client, { ...c, permissions: [...(c.permissions ?? []), P.editCost] }, warehouse, {
        itemId: line.item_id, locationId: line.location_id, quantity: formatDecimal(decimal(line.quantity)), uomId: line.uom_id, unitCost: line.unit_cost, disposition: line.disposition,
        batchNumber: line.batch_number, manufacturedOn: dayOf(line.manufactured_on), expiresOn: dayOf(line.expires_on), serialNumbers: line.serial_numbers,
      }, index, { today: now });
      if (decimal(line.conversion_factor) !== read.unit.factor)
        warnings.push({ code: "OPENING_STOCK_CONVERSION_CHANGED", line: index + 1, message: `Line ${index + 1}: the ${line.uom_code} conversion changed since the line was entered; the entered snapshot (${dec(decimal(line.conversion_factor))}) is used.` });
      if (read.unitCost === null) errors.push({ code: "OPENING_STOCK_COST_REQUIRED", line: index + 1, message: `Line ${index + 1}: ${line.item_code} has no opening cost.` });
      else if (read.unitCost === ZERO) warnings.push({ code: "OPENING_STOCK_ZERO_COST", line: index + 1, message: `Line ${index + 1}: ${line.item_code} at zero cost.` });
      if (read.expired) warnings.push({ code: "OPENING_STOCK_EXPIRED_BATCH", line: index + 1, message: `Line ${index + 1}: batch ${read.batchNumber} expired on ${read.expiresOn}; it is loaded as expired and is not available.` });
      if (read.inactiveItem) warnings.push({ code: "OPENING_STOCK_ITEM_INACTIVE", line: index + 1, message: `Line ${index + 1}: ${line.item_code} is inactive.` });
      value = add(value, decimal(line.line_value));
      if (read.batchNumber) batches += 1;
      serials += read.serials.length;
      // Serial numbers already in the company (unless only a reversed opening left them).
      if (read.serials.length) {
        const taken = (await client.query(
          `SELECT serial.serial_number FROM tenant.stock_serials serial WHERE serial.organization_id = $1 AND lower(serial.serial_number) = ANY($2::text[])
              AND NOT (serial.status = 'sold' AND (SELECT movement.reference_type FROM tenant.stock_movements movement WHERE movement.organization_id = serial.organization_id
                         AND movement.serial_id = serial.id ORDER BY movement.ledger_sequence DESC LIMIT 1) = 'opening_stock_reversal')`,
          [c.organizationId, read.serials.map((entry) => entry.toLowerCase())])).rows;
        if (taken.length) errors.push({ code: "OPENING_STOCK_SERIAL_EXISTS", line: index + 1, message: `Line ${index + 1}: serial ${taken.map((entry) => entry.serial_number).join(", ")} already exists.` });
      }
    } catch (error) {
      if (!(error instanceof OpeningStockError)) throw error;
      errors.push({ code: error.code, line: index + 1, message: error.message });
    }
  }
  // The same stock loaded on another document of this warehouse.
  const repeats = (await client.query(
    `SELECT other.document_number, item.code FROM tenant.opening_stock_lines line
       JOIN tenant.opening_stock_lines twin ON twin.organization_id = line.organization_id AND twin.item_id = line.item_id AND twin.location_id = line.location_id
                                          AND COALESCE(lower(twin.batch_number), '') = COALESCE(lower(line.batch_number), '') AND twin.opening_stock_id <> line.opening_stock_id
       JOIN tenant.opening_stocks other ON other.organization_id = twin.organization_id AND other.id = twin.opening_stock_id AND other.status = 'posted'
       JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
      WHERE line.organization_id = $1 AND line.opening_stock_id = $2 LIMIT 20`, [c.organizationId, row.id])).rows;
  for (const repeat of repeats) warnings.push({ code: "OPENING_STOCK_ALREADY_LOADED", message: `${repeat.code} in the same location was already loaded on ${repeat.document_number}.` });
  // Activity already recorded in the warehouse on or after the cutoff: loading opening stock now rewrites history.
  const later = (await client.query(
    `SELECT count(*)::int AS count FROM tenant.stock_movements movement WHERE movement.organization_id = $1 AND movement.warehouse_id = $2
        AND movement.item_id IN (SELECT item_id FROM tenant.opening_stock_lines WHERE organization_id = $1 AND opening_stock_id = $3)
        AND movement.occurred_at >= $4::date AND COALESCE(movement.reference_type, '') NOT IN ('opening_stock', 'opening_stock_reversal')`,
    [c.organizationId, row.warehouse_id, row.id, dayOf(row.opening_date)])).rows[0].count;
  if (later) warnings.push({ code: "OPENING_STOCK_BACKDATED", message: `${later} stock movement${later === 1 ? "" : "s"} of these items in ${row.warehouse_code} are already recorded on or after ${dayOf(row.opening_date)}.` });
  // The accounting period.
  if (value > ZERO) {
    try { await getOpenPeriod(client, accountingContext(c), dayOf(row.accounting_date)); } catch (error) {
      if (!(error instanceof AccountingError)) throw error;
      errors.push({ code: "OPENING_STOCK_PERIOD_CLOSED", message: `Accounting date ${dayOf(row.accounting_date)}: ${error.message}` });
    }
  }
  const items = new Set(lines.map((line) => line.item_id)).size;
  return {
    errors, warnings,
    summary: { warehouse: row.warehouse_code, items, lines: lines.length, batches, serials, ...(openingCan(c, P.viewCost) ? { value: number(formatDecimal(value)) } : {}),
      zeroCostLines: warnings.filter((entry) => entry.code === "OPENING_STOCK_ZERO_COST").length, expiredBatches: warnings.filter((entry) => entry.code === "OPENING_STOCK_EXPIRED_BATCH").length },
  };
}

export async function validateOpeningStock(client, c, documentId) {
  need(c, P.view, "You do not have permission to view opening stock.");
  const row = await loadDocument(client, c, documentId);
  requireDraft(row);
  const result = await assess(client, c, row);
  if (openingCan(c, P.prepare)) await event(client, c, row.id, "validated", `Validated: ${result.errors.length} error${result.errors.length === 1 ? "" : "s"}, ${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}`,
    { errors: result.errors.length, warnings: result.warnings.length });
  return result;
}

// ------------------------------------------------------------------ posting

const accountingContext = (c) => ({ ...c, permissions: [...(c.permissions ?? []), "accounting.view", "accounting.journal.create", "accounting.journal.reverse"] });
const stockContext = (c) => ({ ...c, permissions: [...(c.permissions ?? []), "stock.receive", "stock.issue", "stock.view"] });

async function stocked(work, label) {
  try { return await work(); } catch (error) {
    if (error instanceof StockError) throw new OpeningStockError(error.status ?? 409, `${label}: ${error.message}`, error.code ?? "OPENING_STOCK_STOCK_FAILED");
    throw error;
  }
}
async function accounted(work) {
  try { return await work(); } catch (error) {
    if (error instanceof AccountingError) throw new OpeningStockError(error.status ?? 409, `Finance: ${error.message}`, "OPENING_STOCK_FINANCE_FAILED");
    throw error;
  }
}

// The batch of a line: the company's existing batch of that number, or a new one. Returns { id, finalStatus }: an expired batch ends
// expired (never available to sell), any other keeps the status it had.
async function findOrCreateBatch(client, c, line, row) {
  const existing = (await client.query(`SELECT id, status, expires_on FROM tenant.stock_batches WHERE organization_id = $1 AND item_id = $2 AND lower(batch_number) = lower($3)`,
    [c.organizationId, line.item_id, line.batch_number])).rows[0];
  const expired = Boolean(line.expires_on && dayOf(line.expires_on) < (await today(client)));
  if (existing) {
    if (!existing.expires_on && line.expires_on) await client.query(`UPDATE tenant.stock_batches SET expires_on = $3, manufactured_on = COALESCE(manufactured_on, $4), updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, existing.id, line.expires_on, line.manufactured_on]);
    return { id: existing.id, finalStatus: expired && existing.status === "active" ? "expired" : existing.status };
  }
  const id = (await client.query(
    `INSERT INTO tenant.stock_batches (organization_id, item_id, batch_number, manufactured_on, expires_on, status, notes, created_by) VALUES ($1, $2, $3, $4, $5, 'active', $6, $7) RETURNING id`,
    [c.organizationId, line.item_id, line.batch_number, line.manufactured_on, line.expires_on, `Opening stock ${row.document_number}`, c.userId ?? null])).rows[0].id;
  return { id, finalStatus: expired ? "expired" : "active" };
}

// Inventory moves stock only in an active batch; an expired or blocked one is opened for this posting and closed again after it.
async function inBatch(client, c, batchId, finalStatus, work) {
  if (!batchId) return work();
  const current = (await client.query(`SELECT status FROM tenant.stock_batches WHERE organization_id = $1 AND id = $2`, [c.organizationId, batchId])).rows[0].status;
  if (current !== "active") await client.query(`UPDATE tenant.stock_batches SET status = 'active' WHERE organization_id = $1 AND id = $2`, [c.organizationId, batchId]);
  const result = await work();
  const target = finalStatus ?? current;
  if (target !== "active") await client.query(`UPDATE tenant.stock_batches SET status = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`, [c.organizationId, batchId, target]);
  return result;
}

// A value split over n units, to the cent, the first units taking the leftover paise.
function splitCents(total, count) {
  const cents = (decimal(total) + 5000n) / 10000n;
  const each = cents / BigInt(count);
  const extra = cents - each * BigInt(count);
  return Array.from({ length: count }, (_, index) => { const unit = each + (BigInt(index) < extra ? 1n : 0n); return `${unit / 100n}.${String(unit % 100n).padStart(2, "0")}`; });
}

// One Inventory receipt per line (per revived serial for serials a reversed opening left behind), dated at the cutoff, carrying exactly the
// line value (split to the cent over serial numbers): Inventory Valuation and the opening journal agree to the paisa.
async function postLine(client, c, row, line) {
  const stock = stockContext(c);
  const label = `Line ${line.line_number} (${line.item_code})`;
  const batch = line.batch_number ? await findOrCreateBatch(client, c, line, row) : { id: null, finalStatus: null };
  const batchId = batch.id;
  const base = {
    movementType: "receipt", itemId: line.item_id, warehouseId: row.warehouse_id, warehouseLocationId: line.location_id, batchId,
    costSource: decimal(line.line_value) > ZERO ? "opening_cost" : "zero_cost_authorized",
    referenceType: "opening_stock", referenceId: row.id, sourceLineId: line.id, reason: `Opening stock ${row.document_number} (${row.migration_reference})`, occurredOn: dayOf(row.opening_date),
  };
  const movements = await inBatch(client, c, batchId, batch.finalStatus, () => receiveLine(client, c, stock, base, line, label, batchId, row));
  await client.query(`UPDATE tenant.opening_stock_lines SET batch_id = $3, movement_ids = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`, [c.organizationId, line.id, batchId, movements]);
  return movements;
}

async function receiveLine(client, c, stock, base, line, label, batchId, row) {
  const movements = [];
  if (line.tracking_type === "serial") {
    const units = splitCents(line.line_value, line.serial_numbers.length);
    const revived = (await client.query(`SELECT id, serial_number FROM tenant.stock_serials WHERE organization_id = $1 AND item_id = $2 AND lower(serial_number) = ANY($3::text[])`,
      [c.organizationId, line.item_id, line.serial_numbers.map((entry) => entry.toLowerCase())])).rows;
    const revivedNames = new Set(revived.map((entry) => entry.serial_number.toLowerCase()));
    const fresh = line.serial_numbers.filter((entry) => !revivedNames.has(entry.toLowerCase()));
    // Each new serial number is registered and received by its own movement: its history starts here.
    for (const serialNumber of fresh) {
      const serial = (await client.query(`INSERT INTO tenant.stock_serials (organization_id, item_id, serial_number, warehouse_id, warehouse_location_id, status, batch_id)
         VALUES ($1, $2, $3, $4, $5, 'available', $6) RETURNING id`, [c.organizationId, line.item_id, serialNumber, row.warehouse_id, line.location_id, batchId])).rows[0];
      const movement = await stocked(() => postStockMovement(client, stock, { ...base, value: units.shift(), quantity: "1", serialId: serial.id, serialRegistered: true,
        idempotencyKey: `opening:${line.id}:${serialNumber.toLowerCase()}` }), label);
      movements.push(movement.id);
    }
    for (const serial of revived) {
      const movement = await stocked(() => postStockMovement(client, stock, { ...base, value: units.shift(), quantity: "1", serialId: serial.id, idempotencyKey: `opening:${line.id}:${serial.id}` }), label);
      movements.push(movement.id);
    }
  } else {
    const movement = await stocked(() => postStockMovement(client, stock, { ...base, value: formatDecimal(decimal(line.line_value), 2), quantity: formatDecimal(decimal(line.base_quantity)), idempotencyKey: `opening:${line.id}`,
      transaction: { uomId: line.uom_id, quantity: line.quantity, factor: line.conversion_factor } }), label);
    movements.push(movement.id);
  }
  return movements;
}

// Finance's opening entry: Dr each item's Inventory account, Cr Opening balance equity, in the Opening balance journal on the accounting date.
async function postFinance(client, c, row, lines) {
  const valued = lines.filter((line) => decimal(line.line_value) > ZERO);
  if (!valued.length) return null;
  const ctx = accountingContext(c);
  return accounted(async () => {
    const ledger = await getPrimaryLedger(client, ctx);
    const date = dayOf(row.accounting_date);
    const equity = await getAccountMapping(client, ctx, ledger.id, "opening_balance_equity", { date });
    const debits = new Map();
    let total = ZERO;
    for (const line of valued) {
      const inventory = await getAccountMapping(client, ctx, ledger.id, "inventory", { itemId: line.item_id, date });
      debits.set(inventory.account_id, add(debits.get(inventory.account_id) ?? ZERO, decimal(line.line_value)));
      total = add(total, decimal(line.line_value));
    }
    const journal = (await client.query(`SELECT id FROM tenant.accounting_journals WHERE organization_id = $1 AND ledger_id = $2 AND journal_type = 'opening' AND status = 'active' ORDER BY code LIMIT 1`,
      [c.organizationId, ledger.id])).rows[0];
    if (!journal) throw new OpeningStockError(409, "Finance: an Opening balance journal is not configured.", "OPENING_STOCK_FINANCE_FAILED");
    const entry = await createJournalEntry(client, ctx, {
      ledgerId: ledger.id, journalId: journal.id, entryDate: date, accountingDate: date, documentDate: dayOf(row.opening_date), entryType: "subledger", reference: row.document_number,
      description: `Opening stock ${row.document_number} · ${row.warehouse_code} · ${row.migration_reference}`, currencyCode: row.currency_code, exchangeRate: "1",
      lines: [
        ...[...debits].map(([accountId, amount]) => ({ accountId, description: `Opening inventory · ${row.warehouse_code}`, debit: formatDecimal(amount), credit: 0, referenceType: "opening_stock", referenceId: row.id })),
        { accountId: equity.account_id, description: `Opening balance · ${row.migration_reference}`, debit: 0, credit: formatDecimal(total), referenceType: "opening_stock", referenceId: row.id },
      ],
    }, { internal: true, sourceModule: "inventory", sourceType: "opening_stock", sourceId: row.id, sourceNumber: row.document_number });
    await postJournalEntry(client, ctx, entry.entry.id, { internal: true, allowDraft: true });
    return { journalEntryId: entry.entry.id, amount: total };
  });
}

// input: { acknowledgeBackdated?, zeroCostReason?, expectedVersion? }. Posting twice returns the first posting.
export async function postOpeningStock(client, c, documentId, input = {}) {
  need(c, P.post, "You do not have permission to post opening stock.");
  const row = await loadDocument(client, c, documentId, { lock: true });
  if (row.status === "posted") return { ...(await getOpeningStock(client, c, row.id)), replayed: true };
  requireDraft(row);
  if (input.expectedVersion !== undefined && input.expectedVersion !== null && Number(input.expectedVersion) !== Number(row.version))
    throw new OpeningStockError(409, "Someone else changed this opening stock after you opened it. Reload it.", "OPENING_STOCK_VERSION_CONFLICT");
  const result = await assess(client, c, row);
  if (result.errors.length)
    throw new OpeningStockError(409, `${row.document_number} cannot be posted: ${result.errors.map((entry) => entry.message).join(" ")}`, "OPENING_STOCK_INVALID", { errors: result.errors, warnings: result.warnings });
  const zeroCost = result.warnings.some((entry) => entry.code === "OPENING_STOCK_ZERO_COST");
  const zeroCostReason = text(input.zeroCostReason, 500);
  if (zeroCost) {
    need(c, P.zeroCost, "Some lines are at zero cost: posting them needs the zero-cost permission.");
    if (!zeroCostReason) throw issue("zeroCostReason", "Give the reason some lines carry zero cost (samples, written-down stock…).", "OPENING_STOCK_ZERO_COST_REASON");
  }
  const backdated = result.warnings.some((entry) => entry.code === "OPENING_STOCK_BACKDATED");
  if (backdated) {
    need(c, P.backdate, "Stock movements are already recorded after this cutoff: posting needs the backdate permission.");
    if (input.acknowledgeBackdated !== true)
      throw new OpeningStockError(409, `${result.warnings.find((entry) => entry.code === "OPENING_STOCK_BACKDATED").message} Confirm to post opening stock behind them.`, "OPENING_STOCK_BACKDATED");
  }
  const lines = await lineRows(client, c.organizationId, row.id);
  for (const line of lines) await postLine(client, c, row, line);
  const finance = await postFinance(client, c, row, lines);
  const total = lines.reduce((sum, line) => add(sum, decimal(line.line_value)), ZERO);
  await client.query(
    `UPDATE tenant.opening_stocks SET status = 'posted', total_value = $3, journal_entry_id = $4, zero_cost_reason = $5, backdated_acknowledged = $6, posted_by = $7, posted_at = now(),
       version = version + 1, updated_by = $7, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, row.id, formatDecimal(total), finance?.journalEntryId ?? null, zeroCost ? zeroCostReason : null, backdated, c.userId ?? null]);
  await event(client, c, row.id, "posted", `Posted: ${lines.length} line${lines.length === 1 ? "" : "s"} into ${row.warehouse_code}`, { lines: lines.length, value: formatDecimal(total) }, zeroCost ? zeroCostReason : null);
  if (finance) await event(client, c, row.id, "finance_linked", `Finance opening entry posted: ${formatDecimal(finance.amount, 2)} ${row.currency_code}`, { journalEntryId: finance.journalEntryId });
  return { ...(await getOpeningStock(client, c, row.id)), replayed: false };
}

export async function cancelOpeningStock(client, c, documentId, input = {}) {
  need(c, P.prepare, "You do not have permission to cancel opening stock.");
  const row = await loadDocument(client, c, documentId, { lock: true });
  if (row.status === "cancelled") return getOpeningStock(client, c, row.id);
  requireDraft(row);
  const reason = text(input.reason, 500);
  await client.query(`UPDATE tenant.opening_stocks SET status = 'cancelled', cancel_reason = $3, cancelled_by = $4, cancelled_at = now(), version = version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, row.id, reason, c.userId ?? null]);
  await event(client, c, row.id, "cancelled", "Cancelled (nothing was posted)", {}, reason);
  return getOpeningStock(client, c, row.id);
}

// ------------------------------------------------------------------ reversal

// What stands in the way of reversing: anything that used the stock since it was posted (any later movement or an active reservation of
// these items in this warehouse), serials no longer in stock, a closed period. [] when it can be reversed.
export async function validateOpeningStockReversal(client, c, documentId) {
  need(c, P.view, "You do not have permission to view opening stock.");
  const row = await loadDocument(client, c, documentId);
  if (row.status !== "posted") return [{ code: "OPENING_STOCK_NOT_POSTED", message: "Only a posted opening stock can be reversed." }];
  const blockers = [];
  const one = async (sql, values = [c.organizationId, row.id, row.warehouse_id]) => (await client.query(sql, values)).rows[0];
  const later = await one(
    `SELECT count(*)::int AS count FROM tenant.stock_movements movement WHERE movement.organization_id = $1 AND movement.warehouse_id = $3
        AND movement.item_id IN (SELECT item_id FROM tenant.opening_stock_lines WHERE organization_id = $1 AND opening_stock_id = $2)
        AND movement.created_at >= (SELECT posted_at FROM tenant.opening_stocks WHERE organization_id = $1 AND id = $2)
        AND NOT (COALESCE(movement.reference_type, '') = 'opening_stock' AND movement.reference_id IS NOT DISTINCT FROM $2)`);
  if (later.count) blockers.push({ code: "OPENING_STOCK_USED", message: `${later.count} stock movement${later.count === 1 ? "" : "s"} of these items happened in this warehouse after posting.` });
  const reserved = await one(
    `SELECT count(*)::int AS count FROM tenant.stock_reservations WHERE organization_id = $1 AND warehouse_id = $3 AND status = 'active'
        AND item_id IN (SELECT item_id FROM tenant.opening_stock_lines WHERE organization_id = $1 AND opening_stock_id = $2)`);
  if (reserved.count) blockers.push({ code: "OPENING_STOCK_RESERVED", message: `${reserved.count} active reservation${reserved.count === 1 ? "" : "s"} hold this stock.` });
  const serials = await one(
    `SELECT count(*)::int AS count FROM tenant.opening_stock_lines line CROSS JOIN LATERAL unnest(line.serial_numbers) AS number(serial)
       LEFT JOIN tenant.stock_serials serial ON serial.organization_id = line.organization_id AND serial.item_id = line.item_id AND lower(serial.serial_number) = lower(number.serial)
      WHERE line.organization_id = $1 AND line.opening_stock_id = $2 AND (serial.id IS NULL OR serial.status <> 'available' OR serial.warehouse_id <> $3)`);
  if (serials.count) blockers.push({ code: "OPENING_STOCK_SERIALS_MOVED", message: `${serials.count} serial number${serials.count === 1 ? " is" : "s are"} no longer in stock here.` });
  if (row.journal_entry_id) {
    try { await getOpenPeriod(client, accountingContext(c), await today(client)); } catch (error) {
      if (!(error instanceof AccountingError)) throw error;
      blockers.push({ code: "OPENING_STOCK_PERIOD_CLOSED", message: error.message });
    }
  }
  return blockers;
}

// input: { reason }. Takes the posted stock back out (one issue per line, per serial for serials), reverses Finance's entry, marks Reversed.
export async function reverseOpeningStock(client, c, documentId, input = {}) {
  need(c, P.reverse, "You do not have permission to reverse opening stock.");
  const row = await loadDocument(client, c, documentId, { lock: true });
  if (row.status === "reversed") return { ...(await getOpeningStock(client, c, row.id)), replayed: true };
  const reason = text(input.reason, 500);
  if (!reason) throw issue("reason", "Give the reason for reversing this opening stock.", "OPENING_STOCK_REASON_REQUIRED");
  const blockers = await validateOpeningStockReversal(client, c, row.id);
  if (blockers.length)
    throw new OpeningStockError(409, `Opening stock reversal blocked. ${blockers.map((entry) => entry.message).join(" ")} Use an Inventory adjustment instead.`, "OPENING_STOCK_REVERSAL_BLOCKED", { blockers });
  // Each movement the document posted is reversed by a compensating one (the opening stays in the ledger): the same location, batch and serial.
  const stock = stockContext(c);
  for (const line of await lineRows(client, c.organizationId, row.id)) {
    const label = `Line ${line.line_number} (${line.item_code})`;
    await inBatch(client, c, line.batch_id, null, () => stocked(() => reverseStockMovements(client, stock, line.movement_ids, { referenceType: "opening_stock_reversal", referenceId: row.id,
      reason: `Opening stock ${row.document_number} reversed: ${reason}`, keyPrefix: "opening-reversal" }), label));
  }
  let reversalId = null;
  if (row.journal_entry_id) {
    const ctx = accountingContext(c);
    const reversal = await accounted(() => reverseJournalEntry(client, ctx, row.journal_entry_id, { reason: `Opening stock ${row.document_number} reversed: ${reason}` }));
    reversalId = reversal.entry?.id ?? reversal.id ?? null;
  }
  await client.query(`UPDATE tenant.opening_stocks SET status = 'reversed', reversal_reason = $3, reversal_journal_entry_id = $4, reversed_by = $5, reversed_at = now(), version = version + 1, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, reason, reversalId, c.userId ?? null]);
  await event(client, c, row.id, "reversed", "Reversed: the stock and its Finance entry are taken back out", { journalEntryId: reversalId }, reason);
  return { ...(await getOpeningStock(client, c, row.id)), replayed: false };
}

// ------------------------------------------------------------------ Finance reconciliation

async function accountingStatus(client, c, row) {
  if (row.status !== "posted" && row.status !== "reversed") return { status: "not_posted", label: "Not posted" };
  if (row.status === "reversed") return { status: "reversed", label: row.journal_entry_id ? "Reversed in Finance too" : "Reversed (nothing was booked)", inventoryValue: 0, financeValue: 0, difference: 0,
    journalNumber: row.journal_number, reversalJournalNumber: row.reversal_journal_number };
  const value = decimal(row.total_value);
  const booked = row.journal_entry_id ? decimal((await client.query(
    `SELECT COALESCE(sum(line.base_debit_amount), 0) AS amount FROM tenant.accounting_journal_lines line JOIN tenant.accounting_journal_entries entry ON entry.id = line.journal_entry_id
      WHERE line.organization_id = $1 AND line.journal_entry_id = $2 AND entry.status IN ('posted', 'reversed') AND line.reference_type = 'opening_stock'`, [c.organizationId, row.journal_entry_id])).rows[0].amount) : ZERO;
  const difference = roundMoney(value - booked, 2);
  return {
    status: difference === ZERO ? "reconciled" : "needs_reconciliation", label: difference === ZERO ? "Reconciled" : "Needs reconciliation",
    inventoryValue: number(formatDecimal(value)), financeValue: number(formatDecimal(booked)), difference: number(formatDecimal(difference)),
    journalNumber: row.journal_number, reversalJournalNumber: row.reversal_journal_number,
  };
}

// The company's opening Inventory value (posted opening stock) against Finance's opening Inventory balance (the net of Inventory accounts in
// opening journals): Reconciled, or the difference to explain.
export async function getOpeningStockReconciliation(client, c) {
  need(c, P.reconcile, "You do not have permission to see the opening stock reconciliation.");
  const inventory = decimal((await client.query(`SELECT COALESCE(sum(total_value), 0) AS value FROM tenant.opening_stocks WHERE organization_id = $1 AND status = 'posted'`,
    [c.organizationId])).rows[0].value);
  const finance = decimal((await client.query(
    `SELECT COALESCE(sum(line.base_debit_amount - line.base_credit_amount), 0) AS value FROM tenant.accounting_journal_lines line
       JOIN tenant.accounting_journal_entries entry ON entry.organization_id = line.organization_id AND entry.id = line.journal_entry_id AND entry.status IN ('posted', 'reversed')
       JOIN tenant.accounting_journals journal ON journal.organization_id = entry.organization_id AND journal.id = entry.journal_id AND journal.journal_type = 'opening'
       JOIN tenant.accounting_accounts account ON account.organization_id = line.organization_id AND account.id = line.account_id AND account.account_type = 'inventory'
      WHERE line.organization_id = $1`, [c.organizationId])).rows[0].value);
  const difference = roundMoney(inventory - finance, 2);
  return {
    inventoryValue: number(formatDecimal(inventory)), financeValue: number(formatDecimal(finance)), difference: number(formatDecimal(difference)),
    status: difference === ZERO ? "reconciled" : "needs_reconciliation", label: difference === ZERO ? "Reconciled" : "Needs reconciliation",
  };
}

// ------------------------------------------------------------------ import

export const OPENING_STOCK_IMPORT_COLUMNS = Object.freeze(["SKU", "Warehouse", "Location", "Qty", "UOM", "Unit Cost", "Batch", "Manufactured", "Expiry", "Serial", "Disposition", "Notes"]);

export function buildOpeningStockTemplate() {
  const rows = [OPENING_STOCK_IMPORT_COLUMNS,
    ["PUMP-001", "PUN-01", "MAIN", "100", "PCS", "500", "", "", "", "", "available", ""],
    ["CHEM-A", "PUN-01", "MAIN", "120", "L", "50", "B001", "2026-01-15", "2027-12-31", "", "available", ""],
    ["LAPTOP", "PUN-01", "MAIN", "1", "PCS", "45000", "", "", "", "DL-001", "available", "One row per serial number"]];
  const cell = (value) => (/[",\r\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value));
  return `﻿${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}

const pickColumn = (record, name) => {
  const key = Object.keys(record).find((header) => header.trim().toLowerCase().replace(/[^a-z]/g, "") === name.toLowerCase().replace(/[^a-z]/g, ""));
  return key ? String(record[key] ?? "").trim() : "";
};

function toImport(row) {
  return { id: row.id, fileName: row.source_filename, status: row.status, rows: row.total_rows, valid: row.valid_rows, warnings: row.warning_rows, errors: row.error_rows, report: row.report, uploadedAt: row.uploaded_at };
}

// Reads a CSV / XLSX into lines for `document` (its warehouse): one row per line, or per serial number (rows of one item, location, unit,
// cost and disposition gather into one line). dryRun checks and reports, saving nothing but the report; otherwise the lines are added to the
// draft (replacing none of its others). The same file is never applied twice.
export async function importOpeningStock(client, c, documentId, { bytes, fileName, dryRun = true } = {}) {
  need(c, P.prepare, "You do not have permission to import opening stock.");
  const row = await loadDocument(client, c, documentId, { lock: true });
  requireDraft(row);
  const checksum = createHash("sha256").update(Buffer.from(bytes ?? [])).digest("hex");
  const applied = (await client.query(
    `SELECT batch.source_filename, document.document_number FROM tenant.opening_stock_import_batches batch
       LEFT JOIN tenant.opening_stocks document ON document.organization_id = batch.organization_id AND document.id = batch.opening_stock_id
      WHERE batch.organization_id = $1 AND batch.checksum = $2 AND batch.status = 'applied' AND COALESCE(document.status, 'cancelled') <> 'cancelled' LIMIT 1`, [c.organizationId, checksum])).rows[0];
  if (applied) throw new OpeningStockError(409, `This file (${applied.source_filename}) was already imported into ${applied.document_number}.`, "OPENING_STOCK_DUPLICATE_IMPORT");
  let parsed;
  try { parsed = isXlsxFileName(fileName) ? parseXlsxUpload(bytes, { maxRows: MAX_LINES }) : parseCsvUpload(bytes, { maxRows: MAX_LINES }); } catch (error) {
    throw new OpeningStockError(error.status ?? 400, error.message, error.code ?? "OPENING_STOCK_IMPORT_FILE");
  }
  const lookup = async (sql, values) => (await client.query(sql, values)).rows[0] ?? null;
  const results = [];
  const groups = new Map();
  for (const [index, record] of parsed.records.entries()) {
    const rowNumber = index + 2;
    const value = (name) => pickColumn(record, name);
    const report = (outcome, message) => results.push({ rowNumber, sku: value("SKU"), outcome, message });
    if (!Object.values(record).some((cell) => String(cell ?? "").trim())) continue;
    const sku = value("SKU");
    const item = sku ? await lookup(`SELECT id, code, tracking_type, uom_id FROM tenant.items WHERE organization_id = $1 AND (upper(code) = upper($2) OR upper(sku) = upper($2)) LIMIT 1`, [c.organizationId, sku]) : null;
    if (!item) { report("error", `SKU ${sku || "(blank)"} not found.`); continue; }
    const warehouseCode = value("Warehouse");
    if (warehouseCode && warehouseCode.toUpperCase() !== row.warehouse_code.toUpperCase()) { report("error", `Warehouse ${warehouseCode} is not ${row.warehouse_code}; import each warehouse into its own document.`); continue; }
    const locationCode = value("Location");
    let locationId = null;
    if (locationCode && locationCode.toUpperCase() !== "MAIN") {
      locationId = (await lookup(`SELECT id FROM tenant.warehouse_locations WHERE organization_id = $1 AND warehouse_id = $2 AND upper(code) = upper($3)`, [c.organizationId, row.warehouse_id, locationCode]))?.id ?? null;
      if (!locationId) { report("error", `Location ${locationCode} is not in ${row.warehouse_code}.`); continue; }
    }
    const uomCode = value("UOM");
    let uomId = item.uom_id;
    if (uomCode) {
      uomId = (await lookup(`SELECT id FROM tenant.units_of_measure WHERE organization_id = $1 AND upper(code) = upper($2)`, [c.organizationId, uomCode]))?.id ?? null;
      if (!uomId) { report("error", `UOM ${uomCode} not found.`); continue; }
    }
    const serial = value("Serial");
    const disposition = (value("Disposition") || "available").toLowerCase().replace(/\s+/g, "_");
    const cost = value("Unit Cost").replace(/[,₹\s]/g, "");
    const key = item.tracking_type === "serial" ? `${item.id}:${locationId}:${uomId}:${cost}:${disposition}:${value("Batch").toLowerCase()}` : `row:${rowNumber}`;
    const group = groups.get(key) ?? { rows: [], line: { itemId: item.id, locationId, uomId, unitCost: cost === "" ? null : cost, disposition, batchNumber: value("Batch") || null,
      manufacturedOn: value("Manufactured") || null, expiresOn: value("Expiry") || null, notes: value("Notes") || null, quantity: "0", serialNumbers: [] } };
    group.rows.push({ rowNumber, sku });
    if (item.tracking_type === "serial") {
      if (!serial) { report("error", `${item.code} is serial-numbered: one serial number per row.`); continue; }
      group.line.serialNumbers.push(serial);
      group.line.quantity = String(group.line.serialNumbers.length);
    } else group.line.quantity = value("Qty");
    groups.set(key, group);
  }
  // Each gathered line through the same checks as the form, its rows reported together.
  const now = await today(client);
  const warehouse = { id: row.warehouse_id, code: row.warehouse_code };
  const lines = [];
  for (const group of groups.values()) {
    try {
      const read = await readLine(client, c, warehouse, group.line, lines.length, { today: now });
      const taken = read.serials.length ? (await client.query(`SELECT serial_number FROM tenant.stock_serials WHERE organization_id = $1 AND lower(serial_number) = ANY($2::text[])`,
        [c.organizationId, read.serials.map((entry) => entry.toLowerCase())])).rows : [];
      if (taken.length) throw new OpeningStockError(409, `Serial ${taken.map((entry) => entry.serial_number).join(", ")} already exists.`, "OPENING_STOCK_SERIAL_EXISTS");
      const warnings = [read.unitCost === ZERO && "zero cost", read.expired && "expired batch", read.inactiveItem && "inactive item"].filter(Boolean);
      for (const entry of group.rows) results.push({ rowNumber: entry.rowNumber, sku: entry.sku, outcome: warnings.length ? "warning" : "valid", message: warnings.join(", ") || null });
      lines.push(group.line);
    } catch (error) {
      if (!(error instanceof OpeningStockError)) throw error;
      const message = error.message.replace(/^Line \d+: /, "");
      for (const entry of group.rows) results.push({ rowNumber: entry.rowNumber, sku: entry.sku, outcome: "error", message });
    }
  }
  results.sort((left, right) => left.rowNumber - right.rowNumber);
  const counts = { total: results.length, valid: results.filter((entry) => entry.outcome === "valid").length, warnings: results.filter((entry) => entry.outcome === "warning").length,
    errors: results.filter((entry) => entry.outcome === "error").length };
  const status = counts.errors ? "rejected" : dryRun ? "validated" : "applied";
  if (!dryRun && counts.errors) throw new OpeningStockError(409, `The file has ${counts.errors} row error${counts.errors === 1 ? "" : "s"}. Fix them and upload it again.`, "OPENING_STOCK_IMPORT_ERRORS", { results });
  if (!dryRun) {
    const existing = (await lineRows(client, c.organizationId, row.id)).map((line) => ({
      id: line.id, itemId: line.item_id, locationId: line.location_id, quantity: formatDecimal(decimal(line.quantity)), uomId: line.uom_id, unitCost: line.unit_cost, disposition: line.disposition,
      batchNumber: line.batch_number, manufacturedOn: dayOf(line.manufactured_on), expiresOn: dayOf(line.expires_on), serialNumbers: line.serial_numbers, notes: line.notes,
    }));
    await replaceLines(client, c, row.id, [...existing, ...lines]);
  }
  await client.query(
    `INSERT INTO tenant.opening_stock_import_batches (organization_id, warehouse_id, opening_stock_id, migration_reference, source_filename, checksum, status, total_rows, valid_rows, warning_rows,
       error_rows, report, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [c.organizationId, row.warehouse_id, row.id, row.migration_reference, String(fileName ?? "upload").slice(0, 240), checksum, status, counts.total, counts.valid, counts.warnings, counts.errors,
      JSON.stringify(results.filter((entry) => entry.outcome !== "valid").slice(0, 2000)), c.userId ?? null]);
  if (!dryRun) await event(client, c, row.id, "imported", `Imported ${lines.length} line${lines.length === 1 ? "" : "s"} from ${fileName}`, { fileName, rows: counts.total, warnings: counts.warnings });
  return { dryRun: Boolean(dryRun), status, rows: counts.total, valid: counts.valid, warnings: counts.warnings, errors: counts.errors, lines: lines.length, results };
}

export async function listOpeningStockImports(client, c) {
  need(c, P.view, "You do not have permission to view opening stock.");
  const { rows } = await client.query(
    `SELECT batch.*, document.document_number, warehouse.code AS warehouse_code, uploader.full_name AS uploaded_by_name FROM tenant.opening_stock_import_batches batch
       LEFT JOIN tenant.opening_stocks document ON document.organization_id = batch.organization_id AND document.id = batch.opening_stock_id
       JOIN tenant.warehouses warehouse ON warehouse.organization_id = batch.organization_id AND warehouse.id = batch.warehouse_id
       LEFT JOIN public.users uploader ON uploader.id = batch.uploaded_by
      WHERE batch.organization_id = $1 ORDER BY batch.uploaded_at DESC LIMIT 300`, [c.organizationId]);
  return rows.map((entry) => ({ ...toImport(entry), documentId: entry.opening_stock_id, documentNumber: entry.document_number, warehouseCode: entry.warehouse_code,
    migrationReference: entry.migration_reference, uploadedBy: entry.uploaded_by_name }));
}

// ------------------------------------------------------------------ files

const FILE_TYPES = Object.freeze({ pdf: "application/pdf", xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv",
  txt: "text/plain", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
const toFile = (entry) => ({ id: entry.id, fileName: entry.file_name ?? entry.fileName, mimeType: entry.mime_type ?? entry.mimeType, sizeBytes: number(entry.size_bytes ?? entry.sizeBytes), uploadedAt: entry.created_at ?? entry.createdAt });

export async function prepareOpeningStockFileUpload({ fileName, bytes }, env = process.env) {
  const extension = (/\.([a-z0-9]{1,10})$/i.exec(String(fileName ?? ""))?.[1] ?? "").toLowerCase();
  if (!FILE_TYPES[extension]) throw new OpeningStockError(400, "Upload a PDF, spreadsheet, CSV, text, Word or image file.", "OPENING_STOCK_FILE_TYPE");
  return prepareFileUpload({ fileName, mimeType: FILE_TYPES[extension], bytes, maximumBytes: 10 * 1024 * 1024, allowedTypes: [...new Set(Object.values(FILE_TYPES))] }, env);
}

export async function listOpeningStockFiles(client, c, documentId) {
  need(c, P.view, "You do not have permission to view opening stock.");
  return (await listFiles(client, { organizationId: c.organizationId, entityType: OPENING_STOCK_FILE_ENTITY, entityId: uuid(documentId, "Opening stock") })).map(toFile);
}

export async function uploadOpeningStockFile(client, c, documentId, input = {}, options = {}) {
  need(c, P.prepare, "You do not have permission to add files to opening stock.");
  const row = await loadDocument(client, c, documentId);
  const file = await storeFile(client, { organizationId: c.organizationId, entityType: OPENING_STOCK_FILE_ENTITY, entityId: row.id, prepared: input.prepared, uploadedBy: c.userId ?? null }, options);
  await event(client, c, row.id, "file_added", `File added: ${file.fileName}`, { fileId: file.id });
  return toFile(file);
}

export async function removeOpeningStockFile(client, c, documentId, fileId) {
  need(c, P.prepare, "You do not have permission to remove files from opening stock.");
  const row = await loadDocument(client, c, documentId);
  if (row.status !== "draft") throw new OpeningStockError(409, "A posted document keeps its migration evidence.", "OPENING_STOCK_POSTED");
  await archiveFile(client, { organizationId: c.organizationId, entityType: OPENING_STOCK_FILE_ENTITY, entityId: row.id, fileId: uuid(fileId, "File"), actorUserId: c.userId ?? null });
  await event(client, c, row.id, "file_removed", "File removed", { fileId });
  return { removed: true };
}

export async function readOpeningStockFile(client, c, documentId, fileId, options = {}) {
  need(c, P.view, "You do not have permission to view opening stock.");
  const row = await loadDocument(client, c, documentId);
  const file = (await client.query(`SELECT id, file_name, mime_type FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND archived_at IS NULL`,
    [c.organizationId, OPENING_STOCK_FILE_ENTITY, row.id, uuid(fileId, "File")])).rows[0];
  if (!file) throw new OpeningStockError(404, "File not found.", "OPENING_STOCK_FILE_NOT_FOUND");
  const content = await readFileContent(client, { organizationId: c.organizationId, entityType: OPENING_STOCK_FILE_ENTITY, entityId: row.id, fileId: file.id }, options);
  return { fileName: file.file_name, mimeType: file.mime_type, body: content.body };
}

// ------------------------------------------------------------------ options

// What the screens need: warehouses the user may bring opening stock into, dispositions, the company currency and capabilities.
export async function getOpeningStockOptions(client, c) {
  need(c, P.view, "You do not have permission to view opening stock.");
  const warehouses = (await client.query(`SELECT id, code, name FROM tenant.warehouses WHERE organization_id = $1 AND status = 'active' AND system_role IS NULL ORDER BY is_default DESC, name`, [c.organizationId])).rows;
  const usable = [];
  for (const warehouse of warehouses) if (await canUseWarehouse(client, c, warehouse.id, "opening")) usable.push(warehouse);
  const organization = (await client.query(`SELECT base_currency FROM public.organizations WHERE id = $1`, [c.organizationId])).rows[0];
  return { warehouses: usable, dispositions: OPENING_DISPOSITIONS, currencyCode: organization?.base_currency ?? "INR", today: await today(client), capabilities: openingStockCapabilities(c) };
}
