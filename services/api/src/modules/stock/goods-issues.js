// Goods Issues: stock deliberately taken out of inventory for a known internal purpose — consumption, maintenance, samples, project use, scrap
// and disposal. Not a sale (Sales Delivery), a supplier return (Purchase Return), a move (Transfer) or the correction of an unexplained
// difference (Inventory Adjustment).
//
// One document is one company and one source warehouse, with a structured reason and who or what the goods went to. Each line is one item
// from one location, in any of the item's units (kept with its conversion), with its batches or serial numbers. A draft moves and reserves
// nothing; posting re-checks everything against current stock (only unreserved stock, and only the dispositions the reason allows), issues
// through the Stock Ledger at the valuation engine's cost, and posts the expense journal — all in one transaction, once. A posted issue is never
// edited: it is reversed, fully or partly, bringing the same batch or serial back at the cost it left with.
import { GOODS_ISSUE_PERMISSIONS as P } from "@vercentlabs/permissions";

import { add, decimal, formatDecimal, roundMoney, sub } from "../../core/decimal.js";
import { archiveFile, listFiles, prepareFileUpload, readFileContent, storeFile } from "../../core/platform/files/index.js";
import { nextDocumentNumber } from "../../core/platform/numbering/index.js";
import { AccountingError } from "../accounting/core.js";
import { createJournalEntry, getAccountMapping, getPrimaryLedger, postJournalEntry } from "../accounting/index.js";
import { normalizeQuantityToBase } from "../products/uom.js";
import { visibleWarehouseIds } from "./balances.js";
import { StockError } from "./errors.js";
import { postStockMovement } from "./index.js";
import { valuationOfMovements } from "./valuation-engine.js";
import { getStockLedger } from "./ledger.js";
import { NEGATIVE_OVERRIDE_REASONS, canOverrideNegativeStock, carryNegativeStock, getNegativeStockPolicy, isNegativeStockCode, resolveNegativeStockPolicy } from "./negative-stock-control.js";
import { openMovementGroup } from "./ledger-posting.js";
import { itemPositions, positionOf, withActiveBatch } from "./positions.js";
import { ledgerLocation, validateWarehouseOperation } from "./warehouses.js";

export class GoodsIssueError extends Error {
  constructor(status, message, code = "GOODS_ISSUE_ERROR", details = undefined) {
    super(message);
    this.name = "GoodsIssueError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const GOODS_ISSUE_DISPOSITIONS = Object.freeze([
  { id: "available", label: "Available" }, { id: "quality_hold", label: "Quality hold" }, { id: "quarantined", label: "Quarantined" }, { id: "damaged", label: "Damaged" },
  { id: "expired", label: "Expired / blocked batch" },
]);
export const GOODS_ISSUE_TO_TYPES = Object.freeze([
  { id: "department", label: "Department" }, { id: "employee", label: "Employee" }, { id: "project", label: "Project" }, { id: "cost_center", label: "Cost center" }, { id: "other", label: "Other" },
]);
// The reasons every company starts with (migration 0069 seeds the same).
const SYSTEM_REASONS = Object.freeze([
  ["INTERNAL_CONSUMPTION", "Internal consumption", "Consumables used inside the company.", ["available"], false, false],
  ["MAINTENANCE", "Maintenance", "Parts and materials used to maintain the company's own equipment.", ["available"], false, false],
  ["SAMPLE_PROMOTION", "Sample / promotion", "Free samples and promotional goods given without a sale.", ["available"], true, false],
  ["PROJECT_CONSUMPTION", "Project consumption", "Material permanently consumed by an internal project.", ["available"], true, false],
  ["SCRAP_DISPOSAL", "Scrap / disposal", "Damaged, expired or quarantined stock destroyed or disposed of.", ["available", "quality_hold", "quarantined", "damaged", "expired"], false, true],
  ["OTHER", "Other", "Any other authorized issue; explain it in the notes.", ["available"], false, true],
]);
const DISPOSAL = "SCRAP_DISPOSAL";
const FILE_ENTITY = "stock.goods_issue";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZERO = 0n;

const privileged = (c) => Boolean(c.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug)));
const can = (c, permission) => privileged(c) || Boolean(c.permissions?.includes(permission));
const need = (c, permission, message) => { if (!can(c, permission)) throw new GoodsIssueError(403, message, "PERMISSION_DENIED"); };
const text = (value, max = 500) => { const out = String(value ?? "").trim(); return out ? out.slice(0, max) : null; };
const has = (input, key) => Object.prototype.hasOwnProperty.call(input ?? {}, key);
const fail = (field, message, code = "GOODS_ISSUE_VALIDATION", status = 400) => { throw new GoodsIssueError(status, message, code, { issues: [{ field, message }] }); };
const uuid = (value, label) => { const id = String(value ?? "").trim(); if (!UUID.test(id)) fail(label, `${label} is not valid.`, "GOODS_ISSUE_VALIDATION"); return id; };
const optionalUuid = (value, label) => (value === undefined || value === null || value === "" ? null : uuid(value, label));
const dec = (value) => formatDecimal(value).replace(/\.?0+$/, "") || "0";
const n = (value) => Math.round(Number(value ?? 0) * 1e6) / 1e6;
const dayOf = (value) => (value instanceof Date
  ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` : value ? String(value).slice(0, 10) : null);
const stockContext = (c) => ({ ...c, permissions: [...(c.permissions ?? []), "stock.issue", "stock.receive", "stock.view", "stock.ledger.view", "stock.ledger.view_cost"] });
const accountingContext = (c) => ({ ...c, permissions: [...(c.permissions ?? []), "accounting.view", "accounting.journal.create"] });

async function stocked(work, label) {
  try { return await work(); } catch (error) {
    if (error instanceof StockError) {
      // Negative-Stock Control's refusals keep their code, facts and audit.
      if (isNegativeStockCode(error.code)) throw carryNegativeStock(error, new GoodsIssueError(error.status ?? 409, `${label}: ${error.message}`, error.code, error.details));
      throw new GoodsIssueError(error.status ?? 409, `${label}: ${error.message}`, error.code ?? "GOODS_ISSUE_STOCK_FAILED");
    }
    if (String(error?.code ?? "").startsWith("WAREHOUSE_")) throw new GoodsIssueError(error.status ?? 409, `${label}: ${error.message}`, error.code);
    throw error;
  }
}
async function accounted(work) {
  try { return await work(); } catch (error) {
    if (error instanceof AccountingError) throw new GoodsIssueError(error.status ?? 409, `Finance: ${error.message}`, "GOODS_ISSUE_FINANCE_FAILED");
    throw error;
  }
}
async function event(client, c, issueId, eventType, summary, details = {}) {
  await client.query(`INSERT INTO tenant.goods_issue_events (organization_id, goods_issue_id, event_type, summary, details, actor_user_id) VALUES ($1, $2, $3, $4, $5, $6)`,
    [c.organizationId, issueId, eventType, String(summary).slice(0, 1000), JSON.stringify(details), c.userId ?? null]);
}

// ------------------------------------------------------------------ reasons

async function ensureReasons(client, c) {
  const exists = (await client.query(`SELECT 1 FROM tenant.goods_issue_reasons WHERE organization_id = $1 LIMIT 1`, [c.organizationId])).rows[0];
  if (exists) return;
  for (const [code, name, description, allowed, recipient, notes] of SYSTEM_REASONS)
    await client.query(
      `INSERT INTO tenant.goods_issue_reasons (organization_id, code, name, description, allowed_dispositions, requires_recipient, requires_notes, is_system)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true) ON CONFLICT (organization_id, code) DO NOTHING`, [c.organizationId, code, name, description, allowed, recipient, notes]);
}
const toReason = (row) => ({
  id: row.id, code: row.code, name: row.name, description: row.description, allowedDispositions: row.allowed_dispositions, requiresRecipient: row.requires_recipient,
  requiresNotes: row.requires_notes, expenseAccountId: row.expense_account_id, expenseAccount: row.account_code ? `${row.account_code} · ${row.account_name}` : null, isSystem: row.is_system,
  isDisposal: row.code === DISPOSAL, status: row.status, version: row.version,
});

export async function listGoodsIssueReasons(client, c, { includeInactive = false } = {}) {
  need(c, P.view, "You do not have permission to view goods issues.");
  await ensureReasons(client, c);
  const { rows } = await client.query(
    `SELECT reason.*, account.code AS account_code, account.name AS account_name FROM tenant.goods_issue_reasons reason
       LEFT JOIN tenant.accounting_accounts account ON account.id = reason.expense_account_id
      WHERE reason.organization_id = $1 AND ($2 OR reason.status = 'active') ORDER BY reason.is_system DESC, reason.name`, [c.organizationId, Boolean(includeInactive)]);
  return rows.map(toReason);
}

async function readReason(client, c, input, current = null) {
  const keep = (key, fallback) => (has(input, key) ? input[key] : fallback);
  const name = text(keep("name", current?.name), 80);
  if (!name) fail("name", "Enter the reason's name.");
  const allowed = keep("allowedDispositions", current?.allowed_dispositions ?? ["available"]);
  if (!Array.isArray(allowed) || !allowed.length || allowed.some((entry) => !GOODS_ISSUE_DISPOSITIONS.some((option) => option.id === entry)))
    fail("allowedDispositions", "Choose which stock the reason may issue (available, quality hold, quarantined, damaged, expired).");
  const expenseAccountId = optionalUuid(keep("expenseAccountId", current?.expense_account_id), "Expense account");
  if (expenseAccountId) {
    const account = (await client.query(`SELECT 1 FROM tenant.accounting_accounts WHERE organization_id = $1 AND id = $2`, [c.organizationId, expenseAccountId])).rows[0];
    if (!account) fail("expenseAccountId", "The expense account was not found.", "GOODS_ISSUE_VALIDATION", 404);
  }
  return { name, description: text(keep("description", current?.description), 500), allowed: [...new Set(allowed)], expenseAccountId,
    requiresRecipient: Boolean(keep("requiresRecipient", current?.requires_recipient ?? false)), requiresNotes: Boolean(keep("requiresNotes", current?.requires_notes ?? false)) };
}

export async function createGoodsIssueReason(client, c, input = {}) {
  need(c, P.manageReasons, "You do not have permission to manage goods issue reasons.");
  await ensureReasons(client, c);
  const code = String(input.code ?? "").trim().toUpperCase().replace(/[^A-Z0-9_]+/g, "_");
  if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(code)) fail("code", "Use 2–40 letters, digits or underscores, starting with a letter, such as TRAINING_USE.");
  if (SYSTEM_REASONS.some(([system]) => system === code)) fail("code", "That code belongs to a system reason.", "GOODS_ISSUE_REASON_EXISTS", 409);
  const values = await readReason(client, c, input);
  const row = (await client.query(
    `INSERT INTO tenant.goods_issue_reasons (organization_id, code, name, description, allowed_dispositions, requires_recipient, requires_notes, expense_account_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (organization_id, code) DO NOTHING RETURNING *`,
    [c.organizationId, code, values.name, values.description, values.allowed, values.requiresRecipient, values.requiresNotes, values.expenseAccountId, c.userId ?? null])).rows[0];
  if (!row) fail("code", `Reason ${code} already exists.`, "GOODS_ISSUE_REASON_EXISTS", 409);
  return toReason(row);
}

// input: name, description, allowedDispositions, requiresRecipient, requiresNotes, expenseAccountId, status (active | inactive), expectedVersion.
// A reason is never deleted (documents keep it); it is deactivated.
export async function updateGoodsIssueReason(client, c, reasonId, input = {}) {
  need(c, P.manageReasons, "You do not have permission to manage goods issue reasons.");
  const row = (await client.query(`SELECT * FROM tenant.goods_issue_reasons WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(reasonId, "Reason")])).rows[0];
  if (!row) throw new GoodsIssueError(404, "Goods issue reason not found.", "GOODS_ISSUE_REASON_NOT_FOUND");
  if (input.expectedVersion !== undefined && input.expectedVersion !== null && Number(input.expectedVersion) !== row.version)
    throw new GoodsIssueError(409, "Someone else changed this reason. Reload it.", "GOODS_ISSUE_VERSION_CONFLICT");
  const values = await readReason(client, c, input, row);
  // The disposal reason always may issue restricted stock; the others never issue what they are not meant to.
  if (row.code === DISPOSAL && values.allowed.length === 1 && values.allowed[0] === "available") fail("allowedDispositions", "Scrap / disposal exists to issue restricted stock.");
  const status = has(input, "status") ? input.status : row.status;
  if (!["active", "inactive"].includes(status)) fail("status", "Status is active or inactive.");
  const updated = (await client.query(
    `UPDATE tenant.goods_issue_reasons SET name = $3, description = $4, allowed_dispositions = $5, requires_recipient = $6, requires_notes = $7, expense_account_id = $8, status = $9,
            version = version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING *`,
    [c.organizationId, row.id, values.name, values.description, values.allowed, values.requiresRecipient, values.requiresNotes, values.expenseAccountId, status])).rows[0];
  return toReason(updated);
}

// ------------------------------------------------------------------ reading

async function loadIssue(client, c, issueId, { lock = false } = {}) {
  const row = (await client.query(`SELECT * FROM tenant.goods_issues WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [c.organizationId, uuid(issueId, "Goods issue")])).rows[0];
  const visible = row ? await visibleWarehouseIds(client, c) : null;
  if (!row || (visible && !visible.includes(row.warehouse_id))) throw new GoodsIssueError(404, "Goods issue not found.", "GOODS_ISSUE_NOT_FOUND");
  return row;
}

async function lineRows(client, c, issueId) {
  const lines = (await client.query(
    `SELECT line.*, item.code AS sku, item.name AS item_name, item.tracking_type, item.track_inventory, item.lifecycle_status, item.uom_id AS base_uom_id, uom.code AS uom_code,
            base.code AS base_uom_code, location.code AS location_code, location.name AS location_name,
            COALESCE((SELECT sum(reversal.base_quantity) FROM tenant.goods_issue_reversal_lines reversal WHERE reversal.organization_id = line.organization_id
               AND reversal.goods_issue_line_id = line.id), 0) AS reversed_quantity
       FROM tenant.goods_issue_lines line
       JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
       LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = line.organization_id AND uom.id = line.uom_id
       LEFT JOIN tenant.units_of_measure base ON base.organization_id = item.organization_id AND base.id = item.uom_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = line.organization_id AND location.id = line.location_id
      WHERE line.organization_id = $1 AND line.goods_issue_id = $2 ORDER BY line.line_number`, [c.organizationId, issueId])).rows;
  const ids = lines.map((line) => line.id);
  const lots = (await client.query(
    `SELECT allocation.*, batch.batch_number, batch.expires_on,
            COALESCE((SELECT sum(reversal.base_quantity) FROM tenant.goods_issue_reversal_lines reversal WHERE reversal.organization_id = allocation.organization_id
               AND reversal.goods_issue_line_id = allocation.goods_issue_line_id AND reversal.batch_id = allocation.batch_id), 0) AS reversed_quantity
       FROM tenant.goods_issue_lot_allocations allocation JOIN tenant.stock_batches batch ON batch.id = allocation.batch_id
      WHERE allocation.organization_id = $1 AND allocation.goods_issue_line_id = ANY($2::uuid[]) ORDER BY batch.batch_number`, [c.organizationId, ids])).rows;
  const serials = (await client.query(
    `SELECT serial.id, serial.serial_number, EXISTS (SELECT 1 FROM tenant.goods_issue_reversal_lines reversal WHERE reversal.organization_id = serial.organization_id
              AND reversal.serial_id = serial.id AND reversal.goods_issue_line_id = ANY($2::uuid[])) AS reversed
       FROM tenant.stock_serials serial WHERE serial.organization_id = $1 AND serial.id = ANY($3::uuid[])`,
    [c.organizationId, ids, lines.flatMap((line) => line.serial_ids)])).rows;
  return lines.map((line) => ({ ...line, lots: lots.filter((lot) => lot.goods_issue_line_id === line.id), serials: serials.filter((serial) => line.serial_ids.includes(serial.id)) }));
}

function statusOf(row, lines = []) {
  if (row.status !== "posted") return row.status;
  const issued = lines.reduce((sum, line) => add(sum, decimal(line.base_quantity)), ZERO);
  const reversed = lines.reduce((sum, line) => add(sum, decimal(line.reversed_quantity)), ZERO);
  if (reversed === ZERO) return "posted";
  return reversed >= issued ? "reversed" : "partially_reversed";
}

// ------------------------------------------------------------------ where stock may come from

// For the line editor: an item's positions in a warehouse (on hand, reserved, available, disposition), its batches and its serial numbers in stock.
export async function getGoodsIssueAvailability(client, c, { warehouseId, itemId } = {}) {
  need(c, P.view, "You do not have permission to view goods issues.");
  const warehouse = uuid(warehouseId, "Warehouse");
  const visible = await visibleWarehouseIds(client, c);
  if (visible && !visible.includes(warehouse)) throw new GoodsIssueError(403, "You may not work in this warehouse.", "WAREHOUSE_FORBIDDEN");
  return itemPositions(client, c, { warehouseId: warehouse, itemId: uuid(itemId, "Item") });
}

// ------------------------------------------------------------------ drafts

async function readHeader(client, c, input, current = null) {
  const keep = (key, column) => (has(input, key) ? input[key] : current?.[column] ?? null);
  const warehouseId = optionalUuid(keep("warehouseId", "warehouse_id"), "Warehouse");
  if (!warehouseId) fail("warehouseId", "Choose the warehouse the goods are issued from.");
  await stocked(() => validateWarehouseOperation(client, c, warehouseId, "adjust", { label: "Warehouse" }), "Warehouse");
  const today = (await client.query(`SELECT current_date::text AS d`)).rows[0].d;
  const issueDate = text(keep("issueDate", "issue_date") instanceof Date ? dayOf(keep("issueDate", "issue_date")) : keep("issueDate", "issue_date"), 10) ?? today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate) || Number.isNaN(Date.parse(issueDate))) fail("issueDate", "The issue date is not a valid date.");
  if (issueDate > today) fail("issueDate", "The issue date cannot be in the future.");
  await ensureReasons(client, c);
  const reasonId = optionalUuid(keep("reasonId", "reason_id"), "Reason");
  if (!reasonId) fail("reasonId", "Choose why the goods are issued.");
  const reason = (await client.query(`SELECT * FROM tenant.goods_issue_reasons WHERE organization_id = $1 AND id = $2`, [c.organizationId, reasonId])).rows[0];
  if (!reason || (reason.status !== "active" && reason.id !== current?.reason_id)) fail("reasonId", "Choose an active reason.", "GOODS_ISSUE_REASON_INVALID", 409);
  const issueToType = text(keep("issueToType", "issue_to_type"), 20);
  if (issueToType && !GOODS_ISSUE_TO_TYPES.some((entry) => entry.id === issueToType)) fail("issueToType", "Issued to is a department, employee, project, cost center or other.");
  const issueToId = issueToType && ["department", "employee", "project", "cost_center"].includes(issueToType) ? optionalUuid(keep("issueToId", "issue_to_id"), "Issued to") : null;
  // Departments and cost centers are Finance's shared masters (they become the journal's dimensions); employees are HR's; projects are Projects'.
  const source = { department: ["public.departments", "Department"], employee: ["tenant.hr_employees", "Employee"], project: ["tenant.projects", "Project"],
    cost_center: ["public.cost_centers", "Cost center"] }[issueToType];
  if (issueToId && source && !(await client.query(`SELECT 1 FROM ${source[0]} WHERE organization_id = $1 AND id = $2`, [c.organizationId, issueToId])).rows[0])
    fail("issueToId", `${source[1]} not found.`, "GOODS_ISSUE_VALIDATION", 404);
  const projectId = optionalUuid(keep("projectId", "project_id"), "Project") ?? (issueToType === "project" ? issueToId : null);
  const issuedToCostCenter = issueToType === "cost_center" ? issueToId : null;
  if (projectId && !(await client.query(`SELECT 1 FROM tenant.projects WHERE organization_id = $1 AND id = $2`, [c.organizationId, projectId])).rows[0])
    fail("projectId", "Project not found.", "GOODS_ISSUE_VALIDATION", 404);
  const costCenterId = optionalUuid(keep("costCenterId", "cost_center_id"), "Cost center") ?? issuedToCostCenter;
  if (costCenterId && !(await client.query(`SELECT 1 FROM public.cost_centers WHERE organization_id = $1 AND id = $2 AND status = 'active'`, [c.organizationId, costCenterId])).rows[0])
    fail("costCenterId", "Choose an active cost center.", "GOODS_ISSUE_VALIDATION", 404);
  return {
    warehouseId, issueDate, reason, issueToType, issueToId, issueToText: text(keep("issueToText", "issue_to_text"), 200), projectId, costCenterId, externalReference: text(keep("externalReference", "external_reference"), 120), notes: text(keep("notes", "notes"), 2000),
    issuedBy: optionalUuid(keep("issuedBy", "issued_by"), "Issued by"),
  };
}

// lines: [{ itemId, quantity, uomId?, locationId?, sourceDisposition?, batches?: [{ batchId, quantity (base) }], serialIds? | serialNumbers?, reasonId?, notes? }]
async function readLines(client, c, warehouseId, inputLines) {
  if (!Array.isArray(inputLines) || !inputLines.length) fail("lines", "Add the items issued.", "GOODS_ISSUE_EMPTY");
  if (inputLines.length > 500) fail("lines", "A goods issue holds at most 500 lines.");
  const out = [];
  for (const [index, entry] of inputLines.entries()) {
    const label = `Line ${index + 1}`;
    const itemId = uuid(entry.itemId, `${label} item`);
    const item = (await client.query(`SELECT id, code, name, item_type, track_inventory, tracking_type, uom_id, lifecycle_status FROM tenant.items WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, itemId])).rows[0];
    if (!item) fail("itemId", `${label}: item not found.`, "GOODS_ISSUE_VALIDATION", 404);
    // Only stock is issued: a service has no stock, and a non-stock item has no perpetual quantity to take it from.
    if (!item.track_inventory) fail("itemId", `${label}: ${item.name} is not a stock item; only inventory-tracked items are issued.`, "GOODS_ISSUE_ITEM_NOT_STOCKED", 409);
    const raw = String(entry.quantity ?? "").trim();
    if (!/^\d+(\.\d+)?$/.test(raw) || decimal(raw) <= ZERO) fail("quantity", `${label}: enter a quantity greater than zero.`, "GOODS_ISSUE_QUANTITY_INVALID");
    const uomId = optionalUuid(entry.uomId, `${label} unit`) ?? item.uom_id;
    const unit = await normalizeQuantityToBase(client, c.organizationId, item.id, uomId, raw, { purpose: "inventory" });
    if (!unit.ok) fail("uomId", `${label}: ${unit.message}`, unit.code ?? "GOODS_ISSUE_UOM_INVALID", 409);
    const base = unit.baseQuantity;
    const locationId = await stocked(() => ledgerLocation(client, c.organizationId, warehouseId, optionalUuid(entry.locationId, `${label} location`), { label: `${label} location` }), label);
    const disposition = text(entry.sourceDisposition, 20) ?? "available";
    if (!GOODS_ISSUE_DISPOSITIONS.some((option) => option.id === disposition)) fail("sourceDisposition", `${label}: unknown disposition.`);
    const lots = [];
    if (item.tracking_type === "batch") {
      const batches = Array.isArray(entry.batches) ? entry.batches.filter((lot) => lot && (lot.batchId || lot.batchNumber)) : [];
      if (!batches.length) fail("batches", `${label}: choose the batch (or batches) issued.`, "GOODS_ISSUE_BATCH_REQUIRED");
      for (const lot of batches) {
        const batch = (await client.query(`SELECT id, batch_number FROM tenant.stock_batches WHERE organization_id = $1 AND item_id = $2 AND (id::text = $3 OR lower(batch_number) = lower($3))`,
          [c.organizationId, item.id, String(lot.batchId ?? lot.batchNumber)])).rows[0];
        if (!batch) fail("batches", `${label}: batch ${lot.batchNumber ?? lot.batchId} not found for ${item.name}.`, "GOODS_ISSUE_BATCH_INVALID", 404);
        if (lots.some((existing) => existing.batchId === batch.id)) fail("batches", `${label}: batch ${batch.batch_number} is entered twice.`, "GOODS_ISSUE_BATCH_DUPLICATE");
        const quantity = String(lot.quantity ?? "").trim();
        if (!/^\d+(\.\d+)?$/.test(quantity) || decimal(quantity) <= ZERO) fail("batches", `${label}: enter the quantity issued from batch ${batch.batch_number}.`);
        lots.push({ batchId: batch.id, batchNumber: batch.batch_number, quantity: decimal(quantity) });
      }
      const total = lots.reduce((sum, lot) => add(sum, lot.quantity), ZERO);
      if (total !== base)
        fail("batches", `${label}: the batches add up to ${dec(total)}, but the line issues ${dec(base)} ${unit.item?.base_code ?? ""}. Allocate every unit to a batch.`.replace(/ \./, "."),
          "GOODS_ISSUE_BATCH_TOTAL_MISMATCH");
    }
    let serialIds = [];
    if (item.tracking_type === "serial") {
      const requested = [...new Set((Array.isArray(entry.serialIds) ? entry.serialIds : []).map(String))];
      const names = (Array.isArray(entry.serialNumbers) ? entry.serialNumbers : String(entry.serialNumbers ?? "").split(/[\s,;]+/)).map((value) => String(value).trim()).filter(Boolean);
      if (new Set(names.map((name) => name.toLowerCase())).size !== names.length || (Array.isArray(entry.serialIds) && requested.length !== entry.serialIds.length))
        fail("serialNumbers", `${label}: a serial number is chosen twice.`, "GOODS_ISSUE_SERIAL_DUPLICATE");
      const rows = (await client.query(`SELECT id, serial_number FROM tenant.stock_serials WHERE organization_id = $1 AND item_id = $2 AND (id = ANY($3::uuid[]) OR lower(serial_number) = ANY($4::text[]))`,
        [c.organizationId, item.id, requested.filter((value) => UUID.test(value)), names.map((name) => name.toLowerCase())])).rows;
      if (rows.length !== requested.length + names.length) fail("serialNumbers", `${label}: a serial number was not found for ${item.name}.`, "GOODS_ISSUE_SERIAL_INVALID", 404);
      serialIds = rows.map((row) => row.id);
      if (BigInt(serialIds.length) * 1000000n !== base)
        fail("serialNumbers", `${label}: choose one serial number for each unit issued (${dec(base)}).`, "GOODS_ISSUE_SERIALS_REQUIRED");
    }
    const reasonId = optionalUuid(entry.reasonId, `${label} reason`);
    out.push({ item, quantity: decimal(raw), uomId, factor: unit.factor, base, locationId, disposition, lots, serialIds, reasonId, notes: text(entry.notes, 500) });
  }
  return out;
}

async function writeLines(client, c, issueId, lines) {
  await client.query(`DELETE FROM tenant.goods_issue_lines WHERE organization_id = $1 AND goods_issue_id = $2`, [c.organizationId, issueId]);
  for (const [index, line] of lines.entries()) {
    const id = (await client.query(
      `INSERT INTO tenant.goods_issue_lines (organization_id, goods_issue_id, line_number, item_id, item_snapshot, quantity, uom_id, conversion_factor, base_quantity, location_id,
         source_disposition, serial_ids, reason_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
      [c.organizationId, issueId, index + 1, line.item.id, JSON.stringify({ code: line.item.code, name: line.item.name, trackingType: line.item.tracking_type }), formatDecimal(line.quantity),
        line.uomId, formatDecimal(line.factor), formatDecimal(line.base), line.locationId, line.disposition, line.serialIds, line.reasonId, line.notes])).rows[0].id;
    for (const lot of line.lots)
      await client.query(`INSERT INTO tenant.goods_issue_lot_allocations (organization_id, goods_issue_line_id, batch_id, base_quantity) VALUES ($1, $2, $3, $4)`,
        [c.organizationId, id, lot.batchId, formatDecimal(lot.quantity)]);
  }
}

// createGoodsIssue. input: { warehouseId, issueDate?, reasonId, issueToType?, issueToId?, issueToText?, projectId?, costCenter?, externalReference?, notes?, issuedBy?,
// lines, post?, idempotencyKey? }. A draft is saved even if stock is short today: posting decides.
export async function createGoodsIssue(client, c, input = {}) {
  need(c, P.create, "You do not have permission to prepare goods issues.");
  const key = text(input.idempotencyKey, 200);
  if (key) {
    const done = (await client.query(`SELECT id FROM tenant.goods_issues WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { ...(await getGoodsIssue(client, c, done.id)), replayed: true };
  }
  const header = await readHeader(client, c, input);
  const lines = await readLines(client, c, header.warehouseId, input.lines);
  const number = await nextDocumentNumber(client, c, { documentType: "goods_issue", at: new Date(`${header.issueDate}T12:00:00Z`) });
  const id = (await client.query(
    `INSERT INTO tenant.goods_issues (organization_id, document_number, warehouse_id, issue_date, reason_id, issue_to_type, issue_to_id, issue_to_text, project_id, cost_center_id,
       external_reference, notes, issued_by, idempotency_key, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15) RETURNING id`,
    [c.organizationId, number, header.warehouseId, header.issueDate, header.reason.id, header.issueToType, header.issueToId, header.issueToText, header.projectId, header.costCenterId,
      header.externalReference, header.notes, header.issuedBy, key, c.userId ?? null])).rows[0].id;
  await writeLines(client, c, id, lines);
  await event(client, c, id, "created", `Drafted: ${lines.length} line${lines.length === 1 ? "" : "s"} · ${header.reason.name}`, { lines: lines.length });
  if (input.post) await postGoodsIssue(client, c, id);
  return { ...(await getGoodsIssue(client, c, id)), replayed: false };
}

// updateDraftGoodsIssue: any header field and the lines (replaced as a whole), with expectedVersion.
export async function updateDraftGoodsIssue(client, c, issueId, input = {}) {
  need(c, P.create, "You do not have permission to edit goods issues.");
  const row = await loadIssue(client, c, issueId, { lock: true });
  if (row.status !== "draft") throw new GoodsIssueError(409, "Only a draft goods issue is edited; a posted one is reversed.", "GOODS_ISSUE_POSTED");
  if (input.expectedVersion !== undefined && input.expectedVersion !== null && Number(input.expectedVersion) !== row.version)
    throw new GoodsIssueError(409, "Someone else changed this goods issue. Reload it and enter your change again.", "GOODS_ISSUE_VERSION_CONFLICT");
  const header = await readHeader(client, c, input, row);
  const changes = [];
  if (header.reason.id !== row.reason_id) changes.push(`reason → ${header.reason.name}`);
  if (header.warehouseId !== row.warehouse_id) changes.push("warehouse changed");
  if ((header.issueToText ?? null) !== (row.issue_to_text ?? null) || header.issueToId !== row.issue_to_id) changes.push("recipient changed");
  if (Array.isArray(input.lines)) { await writeLines(client, c, row.id, await readLines(client, c, header.warehouseId, input.lines)); changes.push("lines changed"); }
  else if (header.warehouseId !== row.warehouse_id) fail("lines", "Re-enter the lines for the new warehouse (their locations and stock differ).");
  await client.query(
    `UPDATE tenant.goods_issues SET warehouse_id = $3, issue_date = $4, reason_id = $5, issue_to_type = $6, issue_to_id = $7, issue_to_text = $8, project_id = $9, cost_center_id = $10,
            external_reference = $11, notes = $12, issued_by = $13, version = version + 1, updated_by = $14, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, row.id, header.warehouseId, header.issueDate, header.reason.id, header.issueToType, header.issueToId, header.issueToText, header.projectId, header.costCenterId,
      header.externalReference, header.notes, header.issuedBy, c.userId ?? null]);
  await event(client, c, row.id, "updated", changes.length ? `Draft changed: ${changes.join(", ")}` : "Draft changed");
  return getGoodsIssue(client, c, row.id);
}

export async function cancelDraftGoodsIssue(client, c, issueId, input = {}) {
  need(c, P.create, "You do not have permission to cancel goods issues.");
  const row = await loadIssue(client, c, issueId, { lock: true });
  if (row.status === "cancelled") return { ...(await getGoodsIssue(client, c, row.id)), replayed: true };
  if (row.status !== "draft") throw new GoodsIssueError(409, "A posted goods issue is not cancelled; reverse it.", "GOODS_ISSUE_POSTED");
  const reason = text(input.reason, 500);
  await client.query(`UPDATE tenant.goods_issues SET status = 'cancelled', cancelled_by = $3, cancelled_at = now(), cancel_reason = $4, version = version + 1, updated_at = now()
     WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, c.userId ?? null, reason]);
  await event(client, c, row.id, "cancelled", `Draft cancelled${reason ? `: ${reason}` : ""}`);
  return { ...(await getGoodsIssue(client, c, row.id)), replayed: false };
}

// ------------------------------------------------------------------ validation

// Everything posting checks, against stock as it is now (a draft's view may be stale). errors block posting; warnings only inform.
export async function validateGoodsIssue(client, c, issueId) {
  need(c, P.view, "You do not have permission to view goods issues.");
  const row = await loadIssue(client, c, issueId);
  return assess(client, c, row, await lineRows(client, c, row.id));
}

// options.negativeOverride: an authorised override is being given — an untracked line short of stock (and with nothing reserved there) is then
// listed under negative rather than refused; the stock engine checks the override itself when it posts.
async function assess(client, c, row, lines, options = {}) {
  const errors = [];
  const negative = [];
  const { policy: companyPolicy } = await getNegativeStockPolicy(client, c.organizationId);
  const itemPolicies = new Map((await client.query(`SELECT id, negative_stock_policy_override, valuation_method FROM tenant.items WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
    [c.organizationId, [...new Set(lines.map((line) => line.item_id))]])).rows.map((item) => [item.id, item]));
  const add_ = (message, code = "GOODS_ISSUE_NOT_READY", details = undefined) => errors.push({ message, code, ...(details ? { details } : {}) });
  if (row.status !== "draft") add_(`The goods issue is ${row.status}.`, "GOODS_ISSUE_POSTED");
  try { await validateWarehouseOperation(client, c, row.warehouse_id, "adjust", { label: "Warehouse" }); } catch (error) { add_(error.message, error.code); }
  const reason = (await client.query(`SELECT * FROM tenant.goods_issue_reasons WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.reason_id])).rows[0];
  if (!reason || reason.status !== "active") add_("The reason is no longer active; choose another.", "GOODS_ISSUE_REASON_INVALID");
  if (reason?.requires_recipient && !row.issue_to_id && !row.issue_to_text) add_(`${reason.name} needs to say who or what the goods were issued to.`, "GOODS_ISSUE_RECIPIENT_REQUIRED");
  if (reason?.requires_notes && !row.notes) add_(`${reason.name} needs notes explaining the issue.`, "GOODS_ISSUE_NOTES_REQUIRED");
  if (reason?.code === DISPOSAL && !can(c, P.dispose)) add_("You do not have permission to post scrap and disposal issues.", "PERMISSION_DENIED");
  const period = (await client.query(
    `SELECT name, status FROM tenant.fiscal_periods WHERE organization_id = $1 AND $2::date BETWEEN start_date AND end_date ORDER BY period_type = 'standard' DESC, start_date DESC LIMIT 1`,
    [c.organizationId, dayOf(row.issue_date)])).rows[0];
  if (period && period.status !== "open") add_(`The accounting period ${period.name} is ${period.status}; an issue dated ${dayOf(row.issue_date)} cannot be posted into it.`, "GOODS_ISSUE_PERIOD_CLOSED");
  if (!lines.length) add_("The goods issue has no lines.", "GOODS_ISSUE_EMPTY");
  const reasons = new Map((await client.query(`SELECT * FROM tenant.goods_issue_reasons WHERE organization_id = $1`, [c.organizationId])).rows.map((entry) => [entry.id, entry]));
  for (const line of lines) {
    const label = `Line ${line.line_number} (${line.sku})`;
    if (!line.track_inventory) add_(`${label}: no longer a stock item.`, "GOODS_ISSUE_ITEM_NOT_STOCKED");
    const lineReason = line.reason_id ? reasons.get(line.reason_id) : reason;
    // The reason decides which stock may be issued: ordinary reasons only available stock, disposal also held, damaged and expired stock.
    if (lineReason && !lineReason.allowed_dispositions.includes(line.source_disposition))
      add_(`${label}: ${lineReason.name} does not issue ${GOODS_ISSUE_DISPOSITIONS.find((entry) => entry.id === line.source_disposition)?.label.toLowerCase() ?? line.source_disposition} stock.`,
        "GOODS_ISSUE_DISPOSITION_NOT_ALLOWED");
    if (line.source_disposition !== "available" && !can(c, P.issueRestricted)) add_(`${label}: you do not have permission to issue restricted stock.`, "PERMISSION_DENIED");
    const parts = line.tracking_type === "batch" ? line.lots.map((lot) => ({ batchId: lot.batch_id, batch: lot.batch_number, quantity: decimal(lot.base_quantity) }))
      : [{ batchId: null, batch: null, quantity: decimal(line.base_quantity) }];
    if (line.tracking_type === "batch" && parts.reduce((sum, part) => add(sum, part.quantity), ZERO) !== decimal(line.base_quantity))
      add_(`${label}: the batches do not add up to the quantity issued.`, "GOODS_ISSUE_BATCH_TOTAL_MISMATCH");
    if (line.tracking_type === "batch" && !parts.length) add_(`${label}: choose the batch issued.`, "GOODS_ISSUE_BATCH_REQUIRED");
    for (const part of parts) {
      const position = await positionOf(client, c, { itemId: line.item_id, warehouseId: row.warehouse_id, locationId: line.location_id, batchId: part.batchId });
      const where = `${line.location_code ?? "MAIN"}${part.batch ? ` / batch ${part.batch}` : ""}`;
      if (position.disposition === "restricted") { add_(`${label}: stock at ${where} is not issued (not allocatable, inactive or in transit).`, "GOODS_ISSUE_DISPOSITION_NOT_ALLOWED"); continue; }
      if (position.disposition !== line.source_disposition)
        add_(`${label}: stock at ${where} is ${GOODS_ISSUE_DISPOSITIONS.find((entry) => entry.id === position.disposition)?.label.toLowerCase()}, not ${line.source_disposition.replace(/_/g, " ")}.`,
          "GOODS_ISSUE_DISPOSITION_MISMATCH");
      if (part.quantity > position.free && line.tracking_type === "none" && position.reserved <= ZERO && itemPolicies.get(line.item_id)?.valuation_method !== "fifo"
          && resolveNegativeStockPolicy(companyPolicy, itemPolicies.get(line.item_id)) === "allow_with_override") {
        // Short, nothing reserved there, and the company allows controlled overrides: the line may go negative with an authorised override.
        const shortage = { lineId: line.id, lineNumber: line.line_number, sku: line.sku, location: where, uom: line.base_uom_code ?? "", onHand: dec(position.quantity),
          requested: dec(part.quantity), projected: dec(sub(position.quantity, part.quantity)) };
        negative.push(shortage);
        if (!options.negativeOverride)
          add_(`${label}: on hand ${shortage.onHand} ${shortage.uom} at ${where}; issuing ${shortage.requested} would take it to ${shortage.projected}. This needs an authorised negative-stock override.`.replace("  ", " "),
            "NEGATIVE_STOCK_OVERRIDE_REQUIRED", shortage);
      } else if (part.quantity > position.free) {
        const available = position.free > ZERO ? position.free : ZERO;
        const uom = line.base_uom_code ?? "";
        add_(`${label}: cannot issue ${dec(part.quantity)} ${uom} at ${where} — on hand ${dec(position.quantity)}, reserved ${dec(position.reserved)}, available ${dec(available)} (${dec(sub(part.quantity, available))} short).`
          .replace(/ {2,}/g, " "), "GOODS_ISSUE_INSUFFICIENT_AVAILABLE",
          { requested: dec(part.quantity), available: dec(available), onHand: dec(position.quantity), reserved: dec(position.reserved), shortfall: dec(sub(part.quantity, available)) });
      }
    }
    if (line.tracking_type === "serial") {
      if (BigInt(line.serial_ids.length) * 1000000n !== decimal(line.base_quantity)) add_(`${label}: choose one serial number for each unit issued.`, "GOODS_ISSUE_SERIALS_REQUIRED");
      const serials = (await client.query(
        `SELECT serial.serial_number, serial.status, serial.warehouse_id, serial.warehouse_location_id,
                (SELECT reservation.reservation_number FROM tenant.stock_reservations reservation WHERE reservation.organization_id = serial.organization_id AND reservation.serial_id = serial.id
                   AND reservation.status = 'active' LIMIT 1) AS reserved_by
           FROM tenant.stock_serials serial WHERE serial.organization_id = $1 AND serial.id = ANY($2::uuid[])`, [c.organizationId, line.serial_ids])).rows;
      for (const serial of serials) {
        if (serial.status !== "available" || serial.warehouse_id !== row.warehouse_id || (serial.warehouse_location_id ?? null) !== (line.location_id ?? null))
          add_(`${label}: serial ${serial.serial_number} is not in stock at ${line.location_code ?? "MAIN"}.`, "GOODS_ISSUE_SERIAL_NOT_AVAILABLE");
        else if (serial.reserved_by) add_(`${label}: serial ${serial.serial_number} is reserved (${serial.reserved_by}); choose another.`, "GOODS_ISSUE_SERIAL_RESERVED");
      }
    }
  }
  return { ready: errors.length === 0, errors, negative, canOverrideNegative: negative.length > 0 && canOverrideNegativeStock(c),
    overrideReasons: negative.length ? NEGATIVE_OVERRIDE_REASONS : [] };
}

// ------------------------------------------------------------------ posting

// postGoodsIssue: under the document's lock, re-checked against current stock, issued through the Stock Ledger (one posting, one movement per
// batch or serial, at the valuation engine's cost), the expense journal posted, the document marked Posted — together, once.
// options.negativeOverride: { reasonCode, notes } — an authorised override for lines that would take untracked stock below zero.
export async function postGoodsIssue(client, c, issueId, options = {}) {
  need(c, P.post, "You do not have permission to post goods issues.");
  const row = await loadIssue(client, c, issueId, { lock: true });
  if (row.status === "posted") return { ...(await getGoodsIssue(client, c, row.id)), replayed: true };
  const lines = await lineRows(client, c, row.id);
  const negativeOverride = options.negativeOverride && typeof options.negativeOverride === "object" ? options.negativeOverride : null;
  const check = await assess(client, c, row, lines, { negativeOverride });
  if (!check.ready) {
    const only = (code) => check.errors.every((entry) => entry.code === code) ? code : null;
    throw new GoodsIssueError(409, check.errors[0].message, only("GOODS_ISSUE_INSUFFICIENT_AVAILABLE") ?? only("NEGATIVE_STOCK_OVERRIDE_REQUIRED")
      ?? (check.errors[0].code === "PERMISSION_DENIED" ? "PERMISSION_DENIED" : "GOODS_ISSUE_NOT_READY"),
      { errors: check.errors, negative: check.negative, canOverrideNegative: check.canOverrideNegative, overrideReasons: check.overrideReasons });
  }
  const reason = (await client.query(`SELECT * FROM tenant.goods_issue_reasons WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.reason_id])).rows[0];
  const stock = stockContext(c);
  const group = await openMovementGroup(client, c, { sourceType: "goods_issue", sourceId: row.id, sourceNumber: row.document_number, operation: "goods_issue",
    postingKey: `goods_issue:${row.id}:post`, effectiveAt: `${dayOf(row.issue_date)} 12:00`, reason: reason.name });
  const values = [];
  for (const line of lines) {
    const label = `Line ${line.line_number} (${line.sku})`;
    const factor = decimal(line.conversion_factor);
    const base = { movementType: "issue", itemId: line.item_id, warehouseId: row.warehouse_id, warehouseLocationId: line.location_id, ledgerType: "adjustment_out",
      referenceType: "goods_issue_line", referenceId: line.id, groupId: group.id, occurredOn: dayOf(row.issue_date),
      reason: `${row.document_number} · ${reason.name}${row.issue_to_text ? ` · ${row.issue_to_text}` : ""}` };
    const units = line.tracking_type === "serial" ? line.serial_ids.map((serialId) => ({ key: serialId, serialId, quantity: 1000000n }))
      : line.tracking_type === "batch" ? line.lots.map((lot) => ({ key: lot.batch_id, batchId: lot.batch_id, quantity: decimal(lot.base_quantity) }))
      : [{ key: "all", quantity: decimal(line.base_quantity) }];
    const movements = [];
    for (const part of units) {
      const movement = await withActiveBatch(client, c, part.batchId, () => stocked(() => postStockMovement(client, stock, { ...base, batchId: part.batchId, serialId: part.serialId, quantity: formatDecimal(part.quantity),
        idempotencyKey: `gi:${line.id}:${part.key}`, ...(negativeOverride && line.tracking_type === "none" ? { negativeOverride } : {}),
        transaction: { uomId: line.uom_id, quantity: formatDecimal(roundMoney(part.quantity * 1000000n / factor, 6)), factor: formatDecimal(factor) } }), label));
      movements.push(movement);
    }
    await client.query(`UPDATE tenant.goods_issue_lines SET movement_ids = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, line.id, movements.map((movement) => movement.id)]);
    // The value Inventory Valuation took out (what the journal expenses).
    values.push({ line, value: -(await valuationOfMovements(client, c.organizationId, movements.map((movement) => movement.id))).total });
  }
  const total = values.reduce((sum, entry) => sum + entry.value, 0);
  const journal = await postExpenseJournal(client, c, row, reason, values, { reverse: false, date: dayOf(row.issue_date) });
  await client.query(
    `UPDATE tenant.goods_issues SET status = 'posted', posted_by = $3, posted_at = now(), issued_by = COALESCE(issued_by, $3), journal_entry_id = $4, issued_value = $5,
            version = version + 1, updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, row.id, c.userId ?? null, journal?.journalEntryId ?? null, formatDecimal(decimal(total.toFixed(6)))]);
  await event(client, c, row.id, "posted", `Posted: ${lines.length} line${lines.length === 1 ? "" : "s"} issued (${reason.name})${journal ? ` · journal ${journal.entryNumber}` : ""}`,
    { groupId: group.id, journalEntryId: journal?.journalEntryId ?? null });
  const overridden = (await client.query(`SELECT count(*)::int AS count FROM tenant.negative_stock_overrides WHERE organization_id = $1 AND movement_id IN (SELECT id FROM tenant.stock_movements WHERE organization_id = $1 AND movement_group_id = $2)`,
    [c.organizationId, group.id])).rows[0].count;
  if (overridden) await event(client, c, row.id, "negative_override", `Negative stock overridden on ${overridden} line${overridden === 1 ? "" : "s"} (${negativeOverride.reasonCode}): ${negativeOverride.notes}`,
    { reasonCode: negativeOverride.reasonCode, lines: check.negative });
  return { ...(await getGoodsIssue(client, c, row.id)), replayed: false };
}

// The expense of what was issued: Dr the reason's expense account (else the company's write-off account for scrap, its expense account for the
// rest), Cr each item's inventory account. A reversal posts the opposite.
async function postExpenseJournal(client, c, row, reason, values, { reverse, date, reversalId = null }) {
  const valued = values.filter((entry) => Math.abs(entry.value) > 1e-9);
  if (!valued.length) return null;
  const ctx = accountingContext(c);
  return accounted(async () => {
    const ledger = await getPrimaryLedger(client, ctx);
    const expense = reason.expense_account_id ?? (await getAccountMapping(client, ctx, ledger.id, reason.code === DISPOSAL ? "writeoff" : "expense", { date })).account_id;
    const credits = new Map();
    for (const entry of valued) {
      const inventory = await getAccountMapping(client, ctx, ledger.id, "inventory", { itemId: entry.line.item_id, date });
      credits.set(inventory.account_id, (credits.get(inventory.account_id) ?? 0) + entry.value);
    }
    const total = valued.reduce((sum, entry) => sum + entry.value, 0);
    const journal = (await client.query(`SELECT id FROM tenant.accounting_journals WHERE organization_id = $1 AND ledger_id = $2 AND journal_type = 'general' AND status = 'active' ORDER BY code LIMIT 1`,
      [c.organizationId, ledger.id])).rows[0];
    if (!journal) throw new GoodsIssueError(409, "Finance: a General journal is not configured.", "GOODS_ISSUE_FINANCE_FAILED");
    const amount = (value) => (Math.round(value * 100) / 100).toFixed(2);
    const what = `${row.document_number} · ${reason.name}`;
    // The expense carries the issue's Finance dimensions: its cost center, and the department it was issued to.
    const expenseLine = { accountId: expense, description: `${reverse ? "Reversal of " : ""}${what}`, referenceType: "goods_issue", referenceId: row.id,
      ...(row.cost_center_id ? { costCenterId: row.cost_center_id } : {}), ...(row.issue_to_type === "department" && row.issue_to_id ? { departmentId: row.issue_to_id } : {}) };
    const lines = [
      reverse ? { ...expenseLine, debit: 0, credit: amount(total) } : { ...expenseLine, debit: amount(total), credit: 0 },
      ...[...credits].map(([accountId, value]) => ({ accountId, description: `Inventory · ${what}`, referenceType: "goods_issue", referenceId: row.id,
        ...(reverse ? { debit: amount(value), credit: 0 } : { debit: 0, credit: amount(value) }) })),
    ];
    // Rounding to the currency: the inventory side carries the difference so the entry balances.
    const debit = lines.reduce((sum, line) => sum + Number(line.debit), 0);
    const credit = lines.reduce((sum, line) => sum + Number(line.credit), 0);
    if (Math.abs(debit - credit) > 0) {
      const last = lines[lines.length - 1];
      if (reverse) last.debit = amount(Number(last.debit) + (credit - debit)); else last.credit = amount(Number(last.credit) + (debit - credit));
    }
    const currency = (await client.query(`SELECT base_currency FROM public.organizations WHERE id = $1`, [c.organizationId])).rows[0]?.base_currency?.trim() ?? "INR";
    const entry = await createJournalEntry(client, ctx, {
      ledgerId: ledger.id, journalId: journal.id, entryDate: date, accountingDate: date, documentDate: dayOf(row.issue_date), entryType: "subledger", reference: row.document_number,
      description: `${reverse ? "Goods issue reversed" : "Goods issue"} ${what}`, currencyCode: currency, exchangeRate: "1", lines,
    }, { internal: true, sourceModule: "inventory", sourceType: reversalId ? "goods_issue_reversal" : "goods_issue", sourceId: reversalId ?? row.id, sourceNumber: row.document_number });
    await postJournalEntry(client, ctx, entry.entry.id, { internal: true, allowDraft: true });
    return { journalEntryId: entry.entry.id, entryNumber: entry.entry.entry_number ?? entry.entry.entryNumber ?? null, amount: total };
  });
}

// ------------------------------------------------------------------ reversal

// reverseGoodsIssue: undoes a posted issue, fully (no lines) or partly (lines: [{ lineId, quantity? (base), serialIds?, batches?: [{ batchId,
// quantity }] }]), with a reason. The same batch or serial comes back to the same place at the cost it left with; the original movements stay.
// Idempotent with idempotencyKey; never more than was issued.
export async function reverseGoodsIssue(client, c, issueId, input = {}) {
  need(c, P.reverse, "You do not have permission to reverse goods issues.");
  const row = await loadIssue(client, c, issueId, { lock: true });
  const key = text(input.idempotencyKey, 200);
  if (key) {
    const done = (await client.query(`SELECT id FROM tenant.goods_issue_reversals WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { ...(await getGoodsIssue(client, c, row.id)), replayed: true };
  }
  if (row.status !== "posted") throw new GoodsIssueError(409, "Only a posted goods issue is reversed.", "GOODS_ISSUE_NOT_POSTED");
  const reason = text(input.reason, 500);
  if (!reason || reason.length < 3) fail("reason", "Give the reason for the reversal.", "GOODS_ISSUE_REASON_REQUIRED");
  const today = (await client.query(`SELECT current_date::text AS d`)).rows[0].d;
  const period = (await client.query(
    `SELECT name, status FROM tenant.fiscal_periods WHERE organization_id = $1 AND $2::date BETWEEN start_date AND end_date ORDER BY period_type = 'standard' DESC, start_date DESC LIMIT 1`,
    [c.organizationId, today])).rows[0];
  if (period && period.status !== "open") throw new GoodsIssueError(409, `The accounting period ${period.name} is ${period.status}; the reversal cannot be posted.`, "GOODS_ISSUE_PERIOD_CLOSED");
  const lines = await lineRows(client, c, row.id);
  const requested = Array.isArray(input.lines) && input.lines.length ? input.lines : null;
  const plan = [];
  for (const line of lines) {
    const ask = requested ? requested.find((entry) => entry.lineId === line.id) : {};
    if (!ask) continue;
    const label = `Line ${line.line_number} (${line.sku})`;
    const movements = (await client.query(`SELECT * FROM tenant.stock_movements WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [c.organizationId, line.movement_ids])).rows;
    const reversedOf = async (filter, args) => decimal((await client.query(
      `SELECT COALESCE(sum(base_quantity), 0) AS q FROM tenant.goods_issue_reversal_lines WHERE organization_id = $1 AND goods_issue_line_id = $2 ${filter}`, [c.organizationId, line.id, ...args])).rows[0].q);
    if (line.tracking_type === "serial") {
      const open = line.serials.filter((serial) => !serial.reversed);
      const serialIds = ask.serialIds ? [...new Set(ask.serialIds.map(String))] : requested ? null : open.map((serial) => serial.id);
      if (!serialIds?.length) fail("serialIds", `${label}: choose the serial numbers that come back.`, "GOODS_ISSUE_SERIALS_REQUIRED");
      for (const serialId of serialIds) {
        if (!open.some((serial) => serial.id === serialId)) fail("serialIds", `${label}: a serial number was not issued on this line or has already come back.`, "GOODS_ISSUE_REVERSAL_EXCEEDS");
        const original = movements.find((movement) => movement.serial_id === serialId);
        plan.push({ line, original, serialId, batchId: original.batch_id, quantity: 1000000n, full: true });
      }
      continue;
    }
    if (line.tracking_type === "batch") {
      const wanted = ask.batches ?? (ask.quantity !== undefined ? null : line.lots.map((lot) => ({ batchId: lot.batch_id, quantity: dec(sub(decimal(lot.base_quantity), decimal(lot.reversed_quantity))) })));
      let remainingAsk = ask.quantity !== undefined && !ask.batches ? decimal(String(ask.quantity)) : null;
      const picks = wanted ?? line.lots.map((lot) => ({ batchId: lot.batch_id, quantity: null }));
      for (const pick of picks) {
        const lot = line.lots.find((entry) => entry.batch_id === pick.batchId);
        if (!lot) fail("batches", `${label}: that batch was not issued on this line.`, "GOODS_ISSUE_REVERSAL_EXCEEDS");
        const open = sub(decimal(lot.base_quantity), await reversedOf("AND batch_id = $3", [lot.batch_id]));
        let quantity = pick.quantity === null ? (remainingAsk > open ? open : remainingAsk) : decimal(String(pick.quantity));
        if (pick.quantity === null) remainingAsk = sub(remainingAsk, quantity);
        if (quantity <= ZERO) continue;
        if (quantity > open) fail("batches", `${label}: only ${dec(open)} of batch ${lot.batch_number} is still issued.`, "GOODS_ISSUE_REVERSAL_EXCEEDS");
        const original = movements.find((movement) => movement.batch_id === lot.batch_id);
        plan.push({ line, original, batchId: lot.batch_id, quantity, full: quantity === decimal(lot.base_quantity) && open === decimal(lot.base_quantity) });
      }
      if (remainingAsk !== null && remainingAsk > ZERO) fail("quantity", `${label}: more than was issued would come back.`, "GOODS_ISSUE_REVERSAL_EXCEEDS");
      continue;
    }
    const open = sub(decimal(line.base_quantity), decimal(line.reversed_quantity));
    const quantity = ask.quantity !== undefined ? decimal(String(ask.quantity)) : open;
    if (quantity <= ZERO) { if (requested) fail("quantity", `${label}: enter the quantity that comes back.`); continue; }
    if (quantity > open) fail("quantity", `${label}: only ${dec(open)} is still issued; ${dec(quantity)} cannot come back.`, "GOODS_ISSUE_REVERSAL_EXCEEDS");
    plan.push({ line, original: movements[0], quantity, full: quantity === decimal(line.base_quantity) && open === decimal(line.base_quantity) });
  }
  if (!plan.length) throw new GoodsIssueError(409, "Nothing is left to reverse on this goods issue.", "GOODS_ISSUE_REVERSAL_EXCEEDS");
  const reversal = (await client.query(`INSERT INTO tenant.goods_issue_reversals (organization_id, goods_issue_id, reason, reversal_date, idempotency_key, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [c.organizationId, row.id, reason, today, key, c.userId ?? null])).rows[0];
  const group = await openMovementGroup(client, c, { sourceType: "goods_issue", sourceId: row.id, sourceNumber: row.document_number, operation: "reversal",
    postingKey: `goods_issue:${row.id}:reversal:${reversal.id}`, reason });
  const stock = stockContext(c);
  const values = [];
  for (const step of plan) {
    const label = `Line ${step.line.line_number} (${step.line.sku})`;
    // A whole movement reversed is linked to it; a part of one is a reversal of the document, not of that movement.
    const movement = await withActiveBatch(client, c, step.batchId, () => stocked(() => postStockMovement(client, stock, {
      movementType: "receipt", itemId: step.line.item_id, warehouseId: row.warehouse_id, warehouseLocationId: step.line.location_id, batchId: step.batchId ?? undefined,
      serialId: step.serialId ?? undefined, quantity: formatDecimal(step.quantity), unitCost: step.original.unit_cost, costSource: "reversal_original", ledgerType: "reversal", referenceType: "goods_issue_reversal",
      referenceId: step.line.id, groupId: group.id, reversesMovementId: step.full && Math.abs(Number(step.original.quantity)) === Number(formatDecimal(step.quantity)) ? step.original.id : undefined,
      reason: `${row.document_number} reversed: ${reason}`, idempotencyKey: `gi-reversal:${reversal.id}:${step.line.id}:${step.serialId ?? step.batchId ?? "all"}`,
    }), label));
    await client.query(`INSERT INTO tenant.goods_issue_reversal_lines (organization_id, reversal_id, goods_issue_line_id, batch_id, serial_id, base_quantity, movement_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [c.organizationId, reversal.id, step.line.id, step.batchId ?? null, step.serialId ?? null, formatDecimal(step.quantity), movement.id]);
    values.push({ line: step.line, value: (await valuationOfMovements(client, c.organizationId, [movement.id])).total });
  }
  const reasonRow = (await client.query(`SELECT * FROM tenant.goods_issue_reasons WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.reason_id])).rows[0];
  const journal = await postExpenseJournal(client, c, row, reasonRow, values, { reverse: true, date: today, reversalId: reversal.id });
  // The reversal record is evidence: its journal and value are written with it, once.
  await client.query(`INSERT INTO tenant.goods_issue_events (organization_id, goods_issue_id, event_type, summary, details, actor_user_id) VALUES ($1, $2, 'reversed', $3, $4, $5)`,
    [c.organizationId, row.id, `Reversed ${plan.length} part${plan.length === 1 ? "" : "s"}: ${reason}${journal ? ` · journal ${journal.entryNumber}` : ""}`,
      JSON.stringify({ reversalId: reversal.id, journalEntryId: journal?.journalEntryId ?? null, value: values.reduce((sum, entry) => sum + entry.value, 0) }), c.userId ?? null]);
  await client.query(`UPDATE tenant.goods_issues SET version = version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id]);
  return { ...(await getGoodsIssue(client, c, row.id)), replayed: false };
}

// ------------------------------------------------------------------ reading

const SELECT = `
  SELECT issue.*, warehouse.code AS warehouse_code, warehouse.name AS warehouse_name, reason.code AS reason_code, reason.name AS reason_name,
         poster.full_name AS posted_by_name, issuer.full_name AS issued_by_name, creator.full_name AS created_by_name, project.name AS project_name, project.project_number,
         cost_center.name AS cost_center_name, cost_center.code AS cost_center_code,
         CASE issue.issue_to_type WHEN 'department' THEN (SELECT name FROM public.departments WHERE id = issue.issue_to_id)
                                  WHEN 'employee' THEN (SELECT concat_ws(' ', first_name, last_name) FROM tenant.hr_employees WHERE id = issue.issue_to_id)
                                  WHEN 'project' THEN (SELECT name FROM tenant.projects WHERE id = issue.issue_to_id)
                                  WHEN 'cost_center' THEN (SELECT name FROM public.cost_centers WHERE id = issue.issue_to_id) END AS issue_to_name,
         (SELECT count(*) FROM tenant.goods_issue_lines line WHERE line.goods_issue_id = issue.id) AS line_count
    FROM tenant.goods_issues issue
    JOIN tenant.warehouses warehouse ON warehouse.organization_id = issue.organization_id AND warehouse.id = issue.warehouse_id
    JOIN tenant.goods_issue_reasons reason ON reason.organization_id = issue.organization_id AND reason.id = issue.reason_id
    LEFT JOIN tenant.projects project ON project.organization_id = issue.organization_id AND project.id = issue.project_id
    LEFT JOIN public.cost_centers cost_center ON cost_center.organization_id = issue.organization_id AND cost_center.id = issue.cost_center_id
    LEFT JOIN public.users poster ON poster.id = issue.posted_by
    LEFT JOIN public.users issuer ON issuer.id = issue.issued_by
    LEFT JOIN public.users creator ON creator.id = issue.created_by`;

function toHeader(row, c, status) {
  return {
    id: row.id, number: row.document_number, status, warehouseId: row.warehouse_id, warehouse: row.warehouse_code, warehouseName: row.warehouse_name, issueDate: dayOf(row.issue_date),
    reasonId: row.reason_id, reasonCode: row.reason_code, reason: row.reason_name, issueToType: row.issue_to_type, issueToId: row.issue_to_id,
    issuedTo: row.issue_to_name ?? row.issue_to_text ?? null, issueToText: row.issue_to_text, projectId: row.project_id, project: row.project_name ? `${row.project_number ?? ""} ${row.project_name}`.trim() : null,
    costCenterId: row.cost_center_id, costCenter: row.cost_center_name ? `${row.cost_center_code ? `${row.cost_center_code} · ` : ""}${row.cost_center_name}` : null, externalReference: row.external_reference, notes: row.notes, issuedBy: row.issued_by, issuedByName: row.issued_by_name, postedAt: row.posted_at,
    postedByName: row.posted_by_name, createdAt: row.created_at, createdByName: row.created_by_name, cancelledAt: row.cancelled_at, cancelReason: row.cancel_reason,
    journalEntryId: can(c, "accounting.view") ? row.journal_entry_id : undefined, lineCount: Number(row.line_count ?? 0), version: row.version,
    ...(can(c, P.viewCost) && row.issued_value !== null ? { value: n(row.issued_value) } : {}),
  };
}

export async function getGoodsIssue(client, c, issueId) {
  need(c, P.view, "You do not have permission to view goods issues.");
  const row = (await client.query(`${SELECT} WHERE issue.organization_id = $1 AND issue.id = $2`, [c.organizationId, uuid(issueId, "Goods issue")])).rows[0];
  const visible = row ? await visibleWarehouseIds(client, c) : null;
  if (!row || (visible && !visible.includes(row.warehouse_id))) throw new GoodsIssueError(404, "Goods issue not found.", "GOODS_ISSUE_NOT_FOUND");
  const lines = await lineRows(client, c, row.id);
  const status = statusOf(row, lines);
  const cost = can(c, P.viewCost);
  const ledger = row.status === "draft" || row.status === "cancelled" ? { rows: [] }
    : await getStockLedger(client, { ...c, permissions: [...(c.permissions ?? []), "stock.ledger.view", ...(cost ? ["stock.ledger.view_cost"] : [])] },
      { sourceType: "goods_issue", sourceId: row.id, limit: 500 });
  const reversals = (await client.query(
    `SELECT reversal.*, creator.full_name AS created_by_name, (SELECT sum(base_quantity) FROM tenant.goods_issue_reversal_lines WHERE reversal_id = reversal.id) AS quantity,
            (SELECT details->>'journalEntryId' FROM tenant.goods_issue_events WHERE goods_issue_id = reversal.goods_issue_id AND details->>'reversalId' = reversal.id::text LIMIT 1) AS journal_entry_id,
            (SELECT (details->>'value')::numeric FROM tenant.goods_issue_events WHERE goods_issue_id = reversal.goods_issue_id AND details->>'reversalId' = reversal.id::text LIMIT 1) AS value
       FROM tenant.goods_issue_reversals reversal LEFT JOIN public.users creator ON creator.id = reversal.created_by
      WHERE reversal.organization_id = $1 AND reversal.goods_issue_id = $2 ORDER BY reversal.created_at`, [c.organizationId, row.id])).rows;
  const journals = can(c, "accounting.view")
    ? (await client.query(`SELECT id, entry_number, entry_date, status, source_type FROM tenant.accounting_journal_entries WHERE organization_id = $1 AND ((source_type = 'goods_issue' AND source_id = $2)
        OR (source_type = 'goods_issue_reversal' AND source_id IN (SELECT id FROM tenant.goods_issue_reversals WHERE goods_issue_id = $2))) ORDER BY created_at`, [c.organizationId, row.id])).rows.map((entry) => ({ id: entry.id, number: entry.entry_number, date: dayOf(entry.entry_date),
        status: entry.status, reversal: entry.source_type === "goods_issue_reversal", href: "/accounting/journals" }))
    : null;
  const history = (await client.query(
    `SELECT event.event_type, event.summary, event.created_at, actor.full_name AS actor_name FROM tenant.goods_issue_events event LEFT JOIN public.users actor ON actor.id = event.actor_user_id
      WHERE event.organization_id = $1 AND event.goods_issue_id = $2 ORDER BY event.created_at`, [c.organizationId, row.id])).rows
    .map((entry) => ({ type: entry.event_type, summary: entry.summary, at: entry.created_at, actor: entry.actor_name }));
  const draft = row.status === "draft";
  const lineOut = [];
  for (const line of lines) {
    const position = draft ? await positionOf(client, c, { itemId: line.item_id, warehouseId: row.warehouse_id, locationId: line.location_id, batchId: line.lots.length === 1 ? line.lots[0].batch_id : null }) : null;
    const lineValue = ledger.rows.filter((entry) => entry.source.lineId === line.id && entry.type !== "reversal").reduce((sum, entry) => sum + (entry.value ?? 0), 0);
    lineOut.push({
      id: line.id, lineNumber: line.line_number, itemId: line.item_id, sku: line.sku, itemName: line.item_name, trackingType: line.tracking_type, quantity: n(line.quantity), uomId: line.uom_id,
      uom: line.uom_code, conversion: n(line.conversion_factor), baseQuantity: n(line.base_quantity), baseUom: line.base_uom_code, locationId: line.location_id, location: line.location_code ?? "MAIN",
      sourceDisposition: line.source_disposition, reasonId: line.reason_id, notes: line.notes, reversedQuantity: n(line.reversed_quantity),
      batches: line.lots.map((lot) => ({ batchId: lot.batch_id, batch: lot.batch_number, expiresOn: dayOf(lot.expires_on), quantity: n(lot.base_quantity), reversed: n(lot.reversed_quantity) })),
      serials: line.serials.map((serial) => ({ id: serial.id, serialNumber: serial.serial_number, reversed: serial.reversed })),
      ...(position ? { availableNow: n(position.free), dispositionNow: position.disposition } : {}),
      ...(cost && !draft ? { value: Math.round(-lineValue * 100) / 100 } : {}),
    });
  }
  return {
    goodsIssue: toHeader(row, c, status), lines: lineOut, movements: ledger.rows, history,
    reversals: reversals.map((entry) => ({ id: entry.id, reason: entry.reason, date: dayOf(entry.reversal_date), quantity: n(entry.quantity), createdByName: entry.created_by_name, at: entry.created_at,
      ...(cost && entry.value !== null ? { value: n(entry.value) } : {}), ...(can(c, "accounting.view") ? { journalEntryId: entry.journal_entry_id } : {}) })),
    journals, files: await listGoodsIssueFiles(client, c, row.id),
    capabilities: { edit: draft && can(c, P.create), post: draft && can(c, P.post), cancel: draft && can(c, P.create), reverse: ["posted", "partially_reversed"].includes(status) && can(c, P.reverse),
      seesCost: cost, seesAccounting: can(c, "accounting.view") },
  };
}

// filters: status (draft | posted | cancelled | reversed), warehouseId, reasonId, itemId, issueToType, projectId, costCenterId, from, to, search (number, reference,
// recipient, notes, SKU), limit, offset.
export async function listGoodsIssues(client, c, filters = {}) {
  need(c, P.view, "You do not have permission to view goods issues.");
  await ensureReasons(client, c);
  const values = [c.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = ["issue.organization_id = $1"];
  const visible = await visibleWarehouseIds(client, c);
  if (visible) where.push(`issue.warehouse_id = ANY(${bind(visible)}::uuid[])`);
  if (["draft", "posted", "cancelled"].includes(filters.status)) where.push(`issue.status = ${bind(filters.status)}`);
  if (filters.status === "reversed") where.push(`EXISTS (SELECT 1 FROM tenant.goods_issue_reversals reversal WHERE reversal.goods_issue_id = issue.id)`);
  for (const [key, column] of [["warehouseId", "issue.warehouse_id"], ["reasonId", "issue.reason_id"], ["projectId", "issue.project_id"]])
    if (filters[key] && UUID.test(filters[key])) where.push(`${column} = ${bind(filters[key])}`);
  if (filters.itemId && UUID.test(filters.itemId)) where.push(`EXISTS (SELECT 1 FROM tenant.goods_issue_lines line WHERE line.goods_issue_id = issue.id AND line.item_id = ${bind(filters.itemId)})`);
  if (filters.issueToType && GOODS_ISSUE_TO_TYPES.some((entry) => entry.id === filters.issueToType)) where.push(`issue.issue_to_type = ${bind(filters.issueToType)}`);
  if (filters.costCenterId && UUID.test(filters.costCenterId)) where.push(`issue.cost_center_id = ${bind(filters.costCenterId)}`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.from ?? ""))) where.push(`issue.issue_date >= ${bind(filters.from)}::date`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.to ?? ""))) where.push(`issue.issue_date <= ${bind(filters.to)}::date`);
  const term = text(filters.search, 120);
  if (term) where.push(`(lower(concat_ws(' ', issue.document_number, issue.external_reference, issue.issue_to_text, issue.notes)) LIKE ${bind(`%${term.toLowerCase()}%`)}
     OR EXISTS (SELECT 1 FROM tenant.goods_issue_lines line JOIN tenant.items item ON item.id = line.item_id WHERE line.goods_issue_id = issue.id
       AND lower(concat_ws(' ', item.code, item.name)) LIKE ${bind(`%${term.toLowerCase()}%`)}))`);
  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const total = Number((await client.query(`SELECT count(*) FROM tenant.goods_issues issue WHERE ${where.join(" AND ")}`, values)).rows[0].count);
  const rows = (await client.query(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY issue.issue_date DESC, issue.document_number DESC LIMIT ${bind(limit)} OFFSET ${bind(offset)}`, values)).rows;
  const reversedBy = new Map((await client.query(
    `SELECT line.goods_issue_id, sum(line.base_quantity) AS issued, COALESCE(sum((SELECT sum(reversal.base_quantity) FROM tenant.goods_issue_reversal_lines reversal WHERE reversal.goods_issue_line_id = line.id)), 0) AS reversed
       FROM tenant.goods_issue_lines line WHERE line.organization_id = $1 AND line.goods_issue_id = ANY($2::uuid[]) GROUP BY line.goods_issue_id`,
    [c.organizationId, rows.map((row) => row.id)])).rows.map((row) => [row.goods_issue_id, row]));
  return {
    total, rows: rows.map((row) => {
      const sums = reversedBy.get(row.id);
      const status = row.status !== "posted" || !sums || Number(sums.reversed) === 0 ? row.status : Number(sums.reversed) >= Number(sums.issued) ? "reversed" : "partially_reversed";
      return toHeader(row, c, status);
    }),
    canCreate: can(c, P.create), seesCost: can(c, P.viewCost),
  };
}

// What the screens need: warehouses the user may issue from, reasons, recipients (departments, employees, projects), dispositions, units.
export async function getGoodsIssueOptions(client, c) {
  need(c, P.view, "You do not have permission to view goods issues.");
  const visible = await visibleWarehouseIds(client, c);
  const warehouses = (await client.query(`SELECT id, code, name, is_default FROM tenant.warehouses WHERE organization_id = $1 AND status = 'active' AND system_role IS NULL
      AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[])) ORDER BY is_default DESC, name`, [c.organizationId, visible])).rows;
  const locations = (await client.query(`SELECT id, warehouse_id, code, name, is_default_storage FROM tenant.warehouse_locations WHERE organization_id = $1 AND status = 'active' AND allow_stock
      AND warehouse_id = ANY($2::uuid[]) ORDER BY is_default_storage DESC, code`, [c.organizationId, warehouses.map((row) => row.id)])).rows;
  const departments = (await client.query(`SELECT id, code, name FROM public.departments WHERE organization_id = $1 AND status = 'active' ORDER BY name LIMIT 500`, [c.organizationId])).rows;
  const costCenters = (await client.query(`SELECT id, code, name FROM public.cost_centers WHERE organization_id = $1 AND status = 'active' ORDER BY name LIMIT 500`, [c.organizationId])).rows;
  const employees = (await client.query(`SELECT id, concat_ws(' ', first_name, last_name) AS name FROM tenant.hr_employees WHERE organization_id = $1 AND COALESCE(status, 'active') = 'active'
      ORDER BY first_name LIMIT 1000`, [c.organizationId])).rows;
  const projects = (await client.query(`SELECT id, project_number, name FROM tenant.projects WHERE organization_id = $1 ORDER BY name LIMIT 500`, [c.organizationId])).rows;
  return {
    warehouses: warehouses.map((row) => ({ id: row.id, code: row.code, name: row.name, isDefault: row.is_default,
      locations: locations.filter((location) => location.warehouse_id === row.id).map((location) => ({ id: location.id, code: location.code, name: location.name, isMain: location.is_default_storage })) })),
    reasons: await listGoodsIssueReasons(client, c), dispositions: GOODS_ISSUE_DISPOSITIONS, issueToTypes: GOODS_ISSUE_TO_TYPES,
    departments: departments.map((row) => ({ id: row.id, name: `${row.code ? `${row.code} · ` : ""}${row.name}` })), employees,
    costCenters: costCenters.map((row) => ({ id: row.id, name: `${row.code ? `${row.code} · ` : ""}${row.name}` })), projects: projects.map((row) => ({ id: row.id, name: `${row.project_number ?? ""} ${row.name}`.trim() })),
    capabilities: { create: can(c, P.create), post: can(c, P.post), reverse: can(c, P.reverse), issueRestricted: can(c, P.issueRestricted), dispose: can(c, P.dispose),
      seesCost: can(c, P.viewCost), manageReasons: can(c, P.manageReasons) },
  };
}

// ------------------------------------------------------------------ files

const FILE_TYPES = Object.freeze({ pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", txt: "text/plain", csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
const toFile = (entry) => ({ id: entry.id, fileName: entry.file_name ?? entry.fileName, mimeType: entry.mime_type ?? entry.mimeType, sizeBytes: Number(entry.size_bytes ?? entry.sizeBytes ?? 0),
  uploadedAt: entry.created_at ?? entry.createdAt });

export async function prepareGoodsIssueFileUpload({ fileName, bytes }, env = process.env) {
  const extension = (/\.([a-z0-9]{1,10})$/i.exec(String(fileName ?? ""))?.[1] ?? "").toLowerCase();
  if (!FILE_TYPES[extension]) throw new GoodsIssueError(400, "Upload a PDF, image, text, spreadsheet or Word file.", "GOODS_ISSUE_FILE_TYPE");
  return prepareFileUpload({ fileName, mimeType: FILE_TYPES[extension], bytes, maximumBytes: 10 * 1024 * 1024, allowedTypes: [...new Set(Object.values(FILE_TYPES))] }, env);
}
export async function listGoodsIssueFiles(client, c, issueId) {
  need(c, P.view, "You do not have permission to view goods issues.");
  return (await listFiles(client, { organizationId: c.organizationId, entityType: FILE_ENTITY, entityId: uuid(issueId, "Goods issue") })).map(toFile);
}
export async function uploadGoodsIssueFile(client, c, issueId, input = {}, options = {}) {
  need(c, P.create, "You do not have permission to add files to goods issues.");
  const row = await loadIssue(client, c, issueId);
  const file = await storeFile(client, { organizationId: c.organizationId, entityType: FILE_ENTITY, entityId: row.id, prepared: input.prepared, uploadedBy: c.userId ?? null }, options);
  await event(client, c, row.id, "file_added", `File added: ${file.fileName}`, { fileId: file.id });
  return toFile(file);
}
export async function removeGoodsIssueFile(client, c, issueId, fileId) {
  need(c, P.create, "You do not have permission to remove files from goods issues.");
  const row = await loadIssue(client, c, issueId);
  if (row.status !== "draft") throw new GoodsIssueError(409, "A posted goods issue keeps its evidence.", "GOODS_ISSUE_POSTED");
  await archiveFile(client, { organizationId: c.organizationId, entityType: FILE_ENTITY, entityId: row.id, fileId: uuid(fileId, "File"), actorUserId: c.userId ?? null });
  await event(client, c, row.id, "file_removed", "File removed", { fileId });
  return { removed: true };
}
export async function readGoodsIssueFile(client, c, issueId, fileId, options = {}) {
  need(c, P.view, "You do not have permission to view goods issues.");
  const row = await loadIssue(client, c, issueId);
  const file = (await client.query(`SELECT id, file_name, mime_type FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND archived_at IS NULL`,
    [c.organizationId, FILE_ENTITY, row.id, uuid(fileId, "File")])).rows[0];
  if (!file) throw new GoodsIssueError(404, "File not found.", "GOODS_ISSUE_FILE_NOT_FOUND");
  const content = await readFileContent(client, { organizationId: c.organizationId, entityType: FILE_ENTITY, entityId: row.id, fileId: file.id }, options);
  return { fileName: file.file_name, mimeType: file.mime_type, body: content.body };
}

