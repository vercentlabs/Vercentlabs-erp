// Stock Ledger: the authoritative, append-only history of every physical stock change, and the proof of how the current balance came to be.
//
//   Stock Ledger            how stock changed (this module; tenant.stock_movements and their movement groups)
//   Real-Time Stock Balance what stock exists now (balances.js; a projection rebuilt from this ledger)
//   Available / Reserved    what can be, and what is already, committed (reservations never appear here)
//
// One canonical query serves every view: item, warehouse, item + warehouse, batch and serial ledgers are filters of it. The running balance is
// derived (never stored) over the scope the filters name, in the ledger's deterministic order: effective date, then ledger sequence. Quantities
// are signed, in the item's base unit; what was entered (quantity, unit, conversion) is kept beside them. Cost and value come from Inventory
// Valuation and are shown only with View Stock Ledger Valuation.
import { STOCK_LEDGER_PERMISSIONS } from "@vercentlabs/permissions";
import { rowsToCsv } from "@vercentlabs/reporting-engine";

import { buildXlsxWorkbook } from "../../core/platform/data-exchange/xlsx.js";
import { visibleWarehouseIds } from "./balances.js";
import { StockError } from "./errors.js";
import { INBOUND_LEDGER_TYPES, INTERNAL_OPERATIONS, LEDGER_KINDS, LEDGER_TYPE_LABELS, OUTBOUND_LEDGER_TYPES, ledgerKindSql } from "./ledger-posting.js";

const P = STOCK_LEDGER_PERMISSIONS;
const privileged = (c) => Boolean(c.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug)));
const can = (c, permission) => privileged(c) || Boolean(c.permissions?.includes(permission));
const need = (c, permission, message) => { if (!can(c, permission)) throw new StockError(403, message, "PERMISSION_DENIED"); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const n = (value) => Math.round(Number(value ?? 0) * 1e6) / 1e6;
const text = (value, max = 120) => { const out = String(value ?? "").trim(); return out ? out.slice(0, max) : null; };
const uuidOrNull = (value, label) => {
  if (value === undefined || value === null || value === "") return null;
  if (!UUID.test(String(value))) throw new StockError(400, `${label} is invalid.`, "STOCK_LEDGER_FILTER_INVALID");
  return String(value);
};
const dayOrNull = (value, label) => {
  if (value === undefined || value === null || value === "") return null;
  const day = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) throw new StockError(400, `${label} is not a valid date.`, "STOCK_LEDGER_FILTER_INVALID");
  return day;
};

export const STOCK_LEDGER_MOVEMENT_TYPES = Object.freeze(LEDGER_KINDS.map((id) => ({ id, label: LEDGER_TYPE_LABELS[id],
  direction: INBOUND_LEDGER_TYPES.includes(id) ? "in" : OUTBOUND_LEDGER_TYPES.includes(id) || id === "goods_issue" ? "out" : "either" })));
export const STOCK_LEDGER_DISPOSITIONS = Object.freeze([
  { id: "available", label: "Available" }, { id: "quality_hold", label: "Quality hold" }, { id: "quarantined", label: "Quarantined" }, { id: "damaged", label: "Damaged" },
]);
const DISPOSITION_LABEL = Object.fromEntries(STOCK_LEDGER_DISPOSITIONS.map((entry) => [entry.id, entry.label]));

// The document a movement came from, and where it opens.
const SOURCE_LABEL = Object.freeze({
  opening_stock: "Opening Stock", goods_receipt: "Goods Receipt", purchase_return: "Purchase Return", sales_delivery: "Sales Delivery", sales_return: "Sales Return",
  stock_transfer: "Stock Transfer", stock_count: "Stock Count", stock_adjustment: "Manual adjustment", receiving_rejection: "Receiving Rejection",
  manufacturing_work_order: "Production Order", pos_sale: "POS Sale", pos_return: "POS Return", goods_issue: "Goods Issue", inventory_transfer: "Transfer",
  inventory_adjustment: "Stock Adjustment", inventory_stock_hold: "Quality Hold",
});
export function ledgerSourceHref(type, id, movementId) {
  switch (type) {
    case "opening_stock": return `/inventory/opening-stock/${id}`;
    case "goods_receipt": return `/procurement/goods-receipts/${id}`;
    case "purchase_return": return `/procurement/purchase-returns/${id}`;
    case "sales_delivery": return `/sales/deliveries/${id}`;
    case "sales_return": return `/sales/returns/${id}`;
    case "stock_transfer": return "/inventory/transfers";
    case "stock_count": return null; // the earlier counts: history only, no page
    case "receiving_rejection": return "/procurement/receiving-issues";
    case "manufacturing_work_order": return "/manufacturing/production-orders";
    case "pos_sale": return `/pos/receipts/${id}`;
    case "pos_return": return "/pos/returns";
    case "goods_issue": return `/inventory/goods-issues/${id}`;
    case "inventory_transfer": return `/inventory/transfers/${id}`;
    case "inventory_adjustment": return `/inventory/adjustments/${id}`;
    case "inventory_stock_hold": return `/inventory/quality-holds/${id}`;
    case "stock_adjustment": return movementId ? `/inventory/stock-ledger/${movementId}` : null;
    default: return null;
  }
}

const MOVEMENT_FROM = `
    FROM tenant.stock_movements movement
    JOIN tenant.stock_movement_groups movement_group ON movement_group.organization_id = movement.organization_id AND movement_group.id = movement.movement_group_id
    JOIN tenant.items item ON item.organization_id = movement.organization_id AND item.id = movement.item_id
    LEFT JOIN tenant.units_of_measure base_uom ON base_uom.organization_id = movement.organization_id AND base_uom.id = movement.base_uom_id
    LEFT JOIN tenant.units_of_measure entered_uom ON entered_uom.organization_id = movement.organization_id AND entered_uom.id = movement.entered_uom_id
    JOIN tenant.warehouses warehouse ON warehouse.organization_id = movement.organization_id AND warehouse.id = movement.warehouse_id
    LEFT JOIN tenant.warehouse_locations location ON location.organization_id = movement.organization_id AND location.id = movement.warehouse_location_id
    LEFT JOIN tenant.stock_batches batch ON batch.organization_id = movement.organization_id AND batch.id = movement.batch_id
    LEFT JOIN tenant.stock_serials serial ON serial.organization_id = movement.organization_id AND serial.id = movement.serial_id
    LEFT JOIN public.users poster ON poster.id = movement.created_by`;
const MOVEMENT_COLUMNS = `movement.id, movement.movement_number, movement.ledger_sequence, movement.ledger_type, ${ledgerKindSql()} AS ledger_kind, movement.quantity, movement.unit_cost, movement.occurred_at,
    movement.created_at, movement.created_by, movement.reason, movement.disposition, movement.source_line_id, movement.reversed_movement_id, movement.movement_group_id,
    movement.entered_quantity, movement.entered_conversion_factor, movement.item_id, movement.warehouse_id, movement.warehouse_location_id, movement.batch_id, movement.serial_id,
    movement.reference_type, movement.reference_id,
    movement_group.source_document_type, movement_group.source_document_id, movement_group.source_document_number, movement_group.operation_type,
    movement_group.reversal_of_group_id, item.code AS sku, item.name AS item_name, item.tracking_type, base_uom.code AS base_uom, entered_uom.code AS entered_uom,
    warehouse.code AS warehouse_code, warehouse.name AS warehouse_name, COALESCE(location.code, 'MAIN') AS location_code, batch.batch_number, serial.serial_number,
    poster.full_name AS posted_by_name,
    (SELECT reversal.id FROM tenant.stock_movements reversal WHERE reversal.organization_id = movement.organization_id AND reversal.reversed_movement_id = movement.id) AS reversed_by_id`;

function toRow(row, { cost, balance }) {
  const quantity = n(row.quantity);
  return {
    id: row.id, number: row.movement_number, sequence: Number(row.ledger_sequence), type: row.ledger_kind ?? row.ledger_type,
    typeLabel: LEDGER_TYPE_LABELS[row.ledger_kind ?? row.ledger_type] ?? row.ledger_type,
    effectiveAt: row.occurred_at, postedAt: row.created_at, postedBy: row.posted_by_name ?? null,
    source: { type: row.source_document_type, label: SOURCE_LABEL[row.source_document_type] ?? row.source_document_type, id: row.source_document_id,
      number: row.source_document_number, lineId: row.source_line_id, href: ledgerSourceHref(row.source_document_type, row.source_document_id, row.id) },
    itemId: row.item_id, sku: row.sku, itemName: row.item_name, trackingType: row.tracking_type,
    warehouseId: row.warehouse_id, warehouse: row.warehouse_code, warehouseName: row.warehouse_name, locationId: row.warehouse_location_id, location: row.location_code,
    batchId: row.batch_id, batch: row.batch_number ?? null, serialId: row.serial_id, serial: row.serial_number ?? null,
    disposition: row.disposition, dispositionLabel: DISPOSITION_LABEL[row.disposition] ?? row.disposition,
    quantity, quantityIn: quantity > 0 ? quantity : null, quantityOut: quantity < 0 ? -quantity : null, balance: balance && row.running !== undefined ? n(row.running) : null,
    baseUom: row.base_uom, entered: row.entered_quantity === null ? null : { quantity: n(row.entered_quantity), uom: row.entered_uom, conversion: n(row.entered_conversion_factor) },
    reversesId: row.reversed_movement_id, reversedById: row.reversed_by_id ?? null, groupId: row.movement_group_id, reason: row.reason,
    ...(cost ? { unitCost: n(row.unit_cost), value: n(quantity * Number(row.unit_cost)) } : {}),
  };
}

// The warehouses this user may query; asking for another is refused, not quietly emptied.
async function warehouseScope(client, c, warehouseId) {
  const visible = await visibleWarehouseIds(client, c);
  if (warehouseId && visible && !visible.includes(warehouseId))
    throw new StockError(403, "You do not have access to that warehouse's stock ledger.", "STOCK_LEDGER_WAREHOUSE_FORBIDDEN");
  return visible;
}

function readFilters(filters = {}) {
  const types = String(filters.type ?? filters.ledgerType ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const unknown = types.find((type) => !LEDGER_KINDS.includes(type));
  if (unknown) throw new StockError(400, `Unknown movement type ${unknown}.`, "STOCK_LEDGER_FILTER_INVALID");
  const disposition = text(filters.disposition, 30);
  if (disposition && !DISPOSITION_LABEL[disposition]) throw new StockError(400, "Unknown disposition.", "STOCK_LEDGER_FILTER_INVALID");
  return {
    itemId: uuidOrNull(filters.itemId, "Item"), warehouseId: uuidOrNull(filters.warehouseId, "Warehouse"), locationId: uuidOrNull(filters.locationId, "Location"),
    batchId: uuidOrNull(filters.batchId, "Batch"), serialId: uuidOrNull(filters.serialId, "Serial number"), categoryId: uuidOrNull(filters.categoryId, "Category"),
    postedBy: uuidOrNull(filters.postedBy, "Posted by"), sourceId: uuidOrNull(filters.sourceId, "Source document"), sourceType: text(filters.sourceType, 60),
    from: dayOrNull(filters.from, "From"), to: dayOrNull(filters.to, "To"), postedFrom: dayOrNull(filters.postedFrom, "Posted from"), postedTo: dayOrNull(filters.postedTo, "Posted to"),
    types, disposition, reference: text(filters.reference, 60), search: text(filters.search, 120),
    order: filters.order === "desc" ? "desc" : "asc", limit: Math.min(Math.max(Number(filters.limit) || 100, 1), 500), cursor: text(filters.cursor, 200),
  };
}

// The scope of the running balance: the stock position the filters name (an item, and optionally its warehouse, location, batch, serial
// number or disposition). Without an item there is no single balance to run, so none is shown.
function balanceScope(f, item) {
  if (!f.itemId) return null;
  const parts = [`${item?.code ?? "Item"}`];
  parts.push(f.warehouseId ? "one warehouse" : "all warehouses");
  if (f.locationId) parts.push("one location");
  if (f.batchId) parts.push("one batch");
  if (f.serialId) parts.push("one serial number");
  if (f.disposition) parts.push(DISPOSITION_LABEL[f.disposition]);
  return { itemId: f.itemId, warehouseId: f.warehouseId, locationId: f.locationId, batchId: f.batchId, serialId: f.serialId, disposition: f.disposition, label: parts.join(" · ") };
}

// A page continues after the last row it showed: its ledger sequence (its effective time is read back exactly, to the microsecond).
const encodeCursor = (row) => String(row.ledger_sequence);
function decodeCursor(cursor) {
  if (!cursor) return null;
  if (!/^\d{1,18}$/.test(cursor)) throw new StockError(400, "The page cursor is invalid.", "STOCK_LEDGER_FILTER_INVALID");
  return cursor;
}

// filters: itemId, warehouseId, locationId, batchId, serialId, disposition (the balance scope); from/to (effective dates), postedFrom/postedTo,
// type (comma-separated ledger types), categoryId, reference (document number), sourceType/sourceId, postedBy, search (SKU, item, barcode,
// document, batch, serial), order (asc | desc), limit (≤ 500), cursor. Rows come a page at a time; the balance after each row is the running
// balance of the scope, which other filters (type, reference, posted by…) never change.
export async function getStockLedger(client, c, filters = {}) {
  need(c, P.view, "You do not have permission to view the stock ledger.");
  const f = readFilters(filters);
  const visible = await warehouseScope(client, c, f.warehouseId);
  if (f.serialId && !f.itemId) f.itemId = (await client.query(`SELECT item_id FROM tenant.stock_serials WHERE organization_id = $1 AND id = $2`, [c.organizationId, f.serialId])).rows[0]?.item_id ?? null;
  if (f.batchId && !f.itemId) f.itemId = (await client.query(`SELECT item_id FROM tenant.stock_batches WHERE organization_id = $1 AND id = $2`, [c.organizationId, f.batchId])).rows[0]?.item_id ?? null;
  const item = f.itemId ? (await client.query(`SELECT id, code, name FROM tenant.items WHERE organization_id = $1 AND id = $2`, [c.organizationId, f.itemId])).rows[0] : null;
  if (f.itemId && !item) throw new StockError(404, "Item not found.", "STOCK_LEDGER_ITEM_NOT_FOUND");
  const main = f.locationId
    ? (await client.query(`SELECT warehouse_id, is_default_storage FROM tenant.warehouse_locations WHERE organization_id = $1 AND id = $2`, [c.organizationId, f.locationId])).rows[0]
    : null;
  if (f.locationId && !main) throw new StockError(404, "Location not found.", "STOCK_LEDGER_FILTER_INVALID");
  const scope = balanceScope(f, item);
  const cost = can(c, P.viewCost);
  const cursor = decodeCursor(f.cursor);

  // Each query gets its own parameters: the scope (what the running balance runs over) and the listing filters (which of its rows show).
  const query = ({ listing = true } = {}) => {
    const values = [c.organizationId];
    const bind = (value) => { values.push(value); return `$${values.length}`; };
    const scoped = ["movement.organization_id = $1"];
    if (visible) scoped.push(`movement.warehouse_id = ANY(${bind(visible)}::uuid[])`);
    if (f.itemId) scoped.push(`movement.item_id = ${bind(f.itemId)}`);
    if (f.warehouseId) scoped.push(`movement.warehouse_id = ${bind(f.warehouseId)}`);
    if (main) scoped.push(main.is_default_storage ? `movement.warehouse_location_id IS NULL AND movement.warehouse_id = ${bind(main.warehouse_id)}` : `movement.warehouse_location_id = ${bind(f.locationId)}`);
    if (f.batchId) scoped.push(`movement.batch_id = ${bind(f.batchId)}`);
    if (f.serialId) scoped.push(`movement.serial_id = ${bind(f.serialId)}`);
    if (f.disposition) scoped.push(`movement.disposition = ${bind(f.disposition)}`);
    if (f.to) scoped.push(`movement.occurred_at < ${bind(f.to)}::date + 1`);
    const listed = [];
    if (!listing) return { values, bind, scoped: scoped.join(" AND "), listed };
    if (f.from) listed.push(`movement.occurred_at >= ${bind(f.from)}::date`);
    if (f.postedFrom) listed.push(`movement.created_at >= ${bind(f.postedFrom)}::date`);
    if (f.postedTo) listed.push(`movement.created_at < ${bind(f.postedTo)}::date + 1`);
    if (f.types.length) listed.push(`${ledgerKindSql()} = ANY(${bind(f.types)}::text[])`);
    if (f.categoryId) listed.push(`item.group_id = ${bind(f.categoryId)}`);
    if (f.postedBy) listed.push(`movement.created_by = ${bind(f.postedBy)}`);
    if (f.sourceType) listed.push(`movement_group.source_document_type = ${bind(f.sourceType)}`);
    if (f.sourceId) listed.push(`movement_group.source_document_id = ${bind(f.sourceId)}`);
    if (f.reference) listed.push(`(upper(COALESCE(movement_group.source_document_number, '')) LIKE ${bind(`%${f.reference.toUpperCase()}%`)} OR upper(movement.movement_number) = ${bind(f.reference.toUpperCase())})`);
    if (f.search)
      listed.push(`lower(concat_ws(' ', item.code, item.name, item.barcode, movement_group.source_document_number, movement.movement_number, batch.batch_number, serial.serial_number)) LIKE ${bind(`%${f.search.toLowerCase()}%`)}`);
    return { values, bind, scoped: scoped.join(" AND "), listed };
  };
  const and = (list) => (list.length ? ` AND ${list.join(" AND ")}` : "");
  const direction = f.order === "desc" ? "DESC" : "ASC";

  const rowsQuery = query();
  const page = [...rowsQuery.listed];
  if (cursor) {
    const after = rowsQuery.bind(cursor);
    page.push(`(movement.occurred_at, movement.ledger_sequence) ${f.order === "desc" ? "<" : ">"} ((SELECT occurred_at FROM tenant.stock_movements WHERE ledger_sequence = ${after}::bigint), ${after}::bigint)`);
  }
  const running = scope ? "sum(movement.quantity) OVER (ORDER BY movement.occurred_at, movement.ledger_sequence) AS running" : "NULL::numeric AS running";
  // The running balance is computed over the whole scope first; the listing filters then pick rows without changing it.
  const { rows } = await client.query(
    `WITH ledger AS (SELECT movement.id, ${running} FROM tenant.stock_movements movement WHERE ${rowsQuery.scoped})
     SELECT ${MOVEMENT_COLUMNS}, ledger.running ${MOVEMENT_FROM} JOIN ledger ON ledger.id = movement.id
      WHERE true${and(page)}
      ORDER BY movement.occurred_at ${direction}, movement.ledger_sequence ${direction} LIMIT ${rowsQuery.bind(f.limit + 1)}`,
    rowsQuery.values);
  const more = rows.length > f.limit;
  const pageRows = more ? rows.slice(0, f.limit) : rows;

  // The scope's balance before the period and at its end; what moved in and out among the listed rows.
  let opening = null;
  let closing = null;
  if (scope) {
    const balanceQuery = query({ listing: false });
    const before = f.from ? `movement.occurred_at < ${balanceQuery.bind(f.from)}::date` : "false";
    const totals = (await client.query(`SELECT COALESCE(sum(movement.quantity) FILTER (WHERE ${before}), 0) AS opening, COALESCE(sum(movement.quantity), 0) AS closing
         FROM tenant.stock_movements movement WHERE ${balanceQuery.scoped}`, balanceQuery.values)).rows[0];
    opening = n(totals.opening);
    closing = n(totals.closing);
  }
  const summaryQuery = query();
  const summary = (await client.query(
    `SELECT COALESCE(sum(movement.quantity) FILTER (WHERE movement.quantity > 0), 0) AS quantity_in, COALESCE(-sum(movement.quantity) FILTER (WHERE movement.quantity < 0), 0) AS quantity_out,
            count(*) AS movements
       ${MOVEMENT_FROM} WHERE ${summaryQuery.scoped}${and(summaryQuery.listed)}`, summaryQuery.values)).rows[0];
  return {
    rows: pageRows.map((row) => toRow(row, { cost, balance: Boolean(scope) })),
    scope, openingBalance: opening, closingBalance: closing,
    totals: { quantityIn: n(summary.quantity_in), quantityOut: n(summary.quantity_out), movements: Number(summary.movements) },
    nextCursor: more ? encodeCursor(pageRows[pageRows.length - 1]) : null,
    canSeeCost: cost, canExport: can(c, P.export), canReconcile: can(c, P.reconcile), baseUom: pageRows[0]?.base_uom ?? null,
  };
}

// Presets of the same ledger.
export const getItemLedger = (client, c, itemId, filters = {}) => getStockLedger(client, c, { ...filters, itemId });
export const getWarehouseLedger = (client, c, warehouseId, filters = {}) => getStockLedger(client, c, { ...filters, warehouseId });
export const getBatchLedger = (client, c, batchId, filters = {}) => getStockLedger(client, c, { ...filters, batchId });

// The balance of a stock scope as of a moment: the sum of its movements effective by then.
export async function getStockBalanceAsOf(client, c, { itemId, warehouseId = null, locationId = null, batchId = null, serialId = null, at = null } = {}) {
  need(c, P.view, "You do not have permission to view the stock ledger.");
  const item = uuidOrNull(itemId, "Item");
  if (!item) throw new StockError(400, "Choose the item.", "STOCK_LEDGER_FILTER_INVALID");
  const visible = await warehouseScope(client, c, uuidOrNull(warehouseId, "Warehouse"));
  const moment = at ? new Date(at) : new Date();
  if (Number.isNaN(moment.getTime())) throw new StockError(400, "The date is invalid.", "STOCK_LEDGER_FILTER_INVALID");
  const { rows } = await client.query(
    `SELECT COALESCE(sum(quantity), 0) AS quantity FROM tenant.stock_movements
      WHERE organization_id = $1 AND item_id = $2 AND occurred_at <= $3 AND ($4::uuid IS NULL OR warehouse_id = $4) AND ($5::uuid[] IS NULL OR warehouse_id = ANY($5::uuid[]))
        AND ($6::uuid IS NULL OR warehouse_location_id = $6) AND ($7::uuid IS NULL OR batch_id = $7) AND ($8::uuid IS NULL OR serial_id = $8)`,
    [c.organizationId, item, moment.toISOString(), uuidOrNull(warehouseId, "Warehouse"), visible, uuidOrNull(locationId, "Location"), uuidOrNull(batchId, "Batch"), uuidOrNull(serialId, "Serial number")]);
  return { itemId: item, at: moment.toISOString(), quantity: n(rows[0].quantity) };
}

// One movement, as evidence: its posting (the other legs of the group), the document behind it, what it reversed or what reversed it, its
// valuation layer and, for those who may see accounting, the journals of its document.
export async function getMovementDetail(client, c, movementId) {
  need(c, P.view, "You do not have permission to view the stock ledger.");
  const id = uuidOrNull(movementId, "Movement");
  const row = (await client.query(`SELECT ${MOVEMENT_COLUMNS} ${MOVEMENT_FROM} WHERE movement.organization_id = $1 AND movement.id = $2`, [c.organizationId, id])).rows[0];
  if (!row) throw new StockError(404, "Stock movement not found.", "STOCK_MOVEMENT_NOT_FOUND");
  const visible = await visibleWarehouseIds(client, c);
  if (visible && !visible.includes(row.warehouse_id)) throw new StockError(404, "Stock movement not found.", "STOCK_MOVEMENT_NOT_FOUND");
  const cost = can(c, P.viewCost);
  const legs = (await client.query(`SELECT ${MOVEMENT_COLUMNS} ${MOVEMENT_FROM} WHERE movement.organization_id = $1 AND movement.movement_group_id = $2 ORDER BY movement.ledger_sequence`,
    [c.organizationId, row.movement_group_id])).rows.filter((leg) => !visible || visible.includes(leg.warehouse_id));
  const group = (await client.query(`SELECT movement_group.*, poster.full_name AS posted_by_name FROM tenant.stock_movement_groups movement_group
      LEFT JOIN public.users poster ON poster.id = movement_group.posted_by WHERE movement_group.organization_id = $1 AND movement_group.id = $2`, [c.organizationId, row.movement_group_id])).rows[0];
  const related = async (relatedId) => {
    if (!relatedId) return null;
    const entry = (await client.query(`SELECT ${MOVEMENT_COLUMNS} ${MOVEMENT_FROM} WHERE movement.organization_id = $1 AND movement.id = $2`, [c.organizationId, relatedId])).rows[0];
    return entry ? toRow(entry, { cost, balance: false }) : null;
  };
  // The movement's valuation (Inventory Valuation): its value, rate and cost source, opened in full on the valuation page.
  const valuation = cost
    ? (await client.query(
      `SELECT entry.id, entry.value_delta + COALESCE((SELECT sum(restatement.value_delta) FROM tenant.inventory_valuation_entries restatement WHERE restatement.organization_id = entry.organization_id
                AND restatement.restates_entry_id = entry.id), 0) AS value, entry.base_unit_cost, entry.source_cost_type, entry.valuation_method
         FROM tenant.inventory_valuation_entries entry WHERE entry.organization_id = $1 AND entry.movement_id = $2 AND entry.entry_kind = 'movement'`, [c.organizationId, row.id])).rows
      .map((entry) => ({ entryId: entry.id, value: Math.round(Number(entry.value) * 100) / 100, unitCost: n(entry.base_unit_cost), costSource: entry.source_cost_type,
        method: entry.valuation_method, href: `/inventory/valuation?entry=${entry.id}` }))[0] ?? null
    : null;
  const journals = can(c, "accounting.view")
    ? (await client.query(`SELECT id, entry_number, entry_date, status, source_type FROM tenant.accounting_journal_entries WHERE organization_id = $1 AND source_id = $2 ORDER BY entry_date, entry_number`,
      [c.organizationId, row.source_document_id])).rows.map((entry) => ({ id: entry.id, number: entry.entry_number, date: entry.entry_date, status: entry.status, href: "/accounting/journals" }))
    : null;
  return {
    movement: toRow(row, { cost, balance: false }),
    group: { id: group.id, operation: group.operation_type, postingKey: group.posting_key, effectiveAt: group.effective_at, postedAt: group.posted_at, postedBy: group.posted_by_name ?? null,
      reason: group.reason, reversalOfGroupId: group.reversal_of_group_id, net: n(legs.reduce((sum, leg) => sum + Number(leg.quantity), 0)) },
    legs: legs.map((leg) => toRow(leg, { cost, balance: false })),
    reverses: await related(row.reversed_movement_id), reversedBy: await related(row.reversed_by_id),
    valuation, journals,
    links: {
      source: ledgerSourceHref(row.source_document_type, row.source_document_id, row.id), item: `/inventory/items/${row.item_id}`, itemStock: `/inventory/stock/items/${row.item_id}`,
      warehouse: `/inventory/warehouses/${row.warehouse_id}`, serialHistory: row.serial_id ? `/inventory/stock-ledger?serialId=${row.serial_id}` : null,
      batchLedger: row.batch_id ? `/inventory/stock-ledger?batchId=${row.batch_id}` : null,
    },
  };
}

// A serial number's complete physical journey: every movement of that unit, wherever it went.
export async function getSerialHistory(client, c, { serialId = null, serialNumber = null } = {}) {
  need(c, P.view, "You do not have permission to view the stock ledger.");
  const serial = (await client.query(
    `SELECT serial.*, item.code AS sku, item.name AS item_name, warehouse.code AS warehouse_code, COALESCE(location.code, 'MAIN') AS location_code
       FROM tenant.stock_serials serial JOIN tenant.items item ON item.organization_id = serial.organization_id AND item.id = serial.item_id
       LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = serial.organization_id AND warehouse.id = serial.warehouse_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = serial.organization_id AND location.id = serial.warehouse_location_id
      WHERE serial.organization_id = $1 AND (serial.id = $2 OR lower(serial.serial_number) = lower($3)) ORDER BY serial.created_at LIMIT 1`,
    [c.organizationId, uuidOrNull(serialId, "Serial number"), text(serialNumber) ?? ""])).rows[0];
  if (!serial) throw new StockError(404, "Serial number not found.", "STOCK_SERIAL_NOT_FOUND");
  const ledger = await getStockLedger(client, c, { serialId: serial.id, limit: 500 });
  return {
    serial: { id: serial.id, serialNumber: serial.serial_number, itemId: serial.item_id, sku: serial.sku, itemName: serial.item_name, status: serial.status,
      inStock: serial.status === "available", warehouse: serial.status === "available" ? serial.warehouse_code : null, location: serial.status === "available" ? serial.location_code : null },
    movements: ledger.rows,
  };
}

// Proof that the balances are what the ledger says, for the whole company or one item / warehouse:
//   positions  every balance row's on hand equals the sum of its ledger movements (and every ledger position has its balance row)
//   batches    batch-tracked stock is never held without a batch
//   serials    serial-tracked on hand equals the count of serial numbers in stock at that position
//   groups     transfers, location and disposition moves (and their reversals) net to zero
// Each run is recorded. Any difference is an integrity defect: rebuild the projection (Stock Balance) after finding its cause.
export async function reconcileStockLedger(client, c, filters = {}) {
  need(c, P.reconcile, "You do not have permission to reconcile the stock ledger.");
  const itemId = uuidOrNull(filters.itemId, "Item");
  const warehouseId = uuidOrNull(filters.warehouseId, "Warehouse");
  const args = [c.organizationId, itemId, warehouseId];
  const scopeOf = (alias) => `($2::uuid IS NULL OR ${alias}.item_id = $2) AND ($3::uuid IS NULL OR ${alias}.warehouse_id = $3)`;
  const positions = (await client.query(
    `WITH ledger AS (
       SELECT item_id, warehouse_id, warehouse_location_id, batch_id, sum(quantity) AS quantity FROM tenant.stock_movements movement
        WHERE organization_id = $1 AND ${scopeOf("movement")} GROUP BY item_id, warehouse_id, warehouse_location_id, batch_id),
     projection AS (SELECT item_id, warehouse_id, warehouse_location_id, batch_id, quantity FROM tenant.stock_balances balance WHERE organization_id = $1 AND ${scopeOf("balance")})
     SELECT COALESCE(ledger.item_id, projection.item_id) AS item_id, COALESCE(ledger.warehouse_id, projection.warehouse_id) AS warehouse_id,
            COALESCE(ledger.warehouse_location_id, projection.warehouse_location_id) AS location_id, COALESCE(ledger.batch_id, projection.batch_id) AS batch_id,
            COALESCE(ledger.quantity, 0) AS ledger_quantity, COALESCE(projection.quantity, 0) AS balance_quantity
       FROM ledger FULL JOIN projection ON projection.item_id = ledger.item_id AND projection.warehouse_id = ledger.warehouse_id
            AND projection.warehouse_location_id IS NOT DISTINCT FROM ledger.warehouse_location_id AND projection.batch_id IS NOT DISTINCT FROM ledger.batch_id
      WHERE abs(COALESCE(ledger.quantity, 0) - COALESCE(projection.quantity, 0)) > 0.000001 LIMIT 200`, args)).rows;
  const batches = (await client.query(
    `SELECT balance.item_id, balance.warehouse_id, balance.warehouse_location_id AS location_id, balance.quantity FROM tenant.stock_balances balance
       JOIN tenant.items item ON item.organization_id = balance.organization_id AND item.id = balance.item_id
      WHERE balance.organization_id = $1 AND ${scopeOf("balance")} AND item.tracking_type = 'batch' AND balance.batch_id IS NULL AND balance.quantity <> 0 LIMIT 200`, args)).rows;
  const serials = (await client.query(
    `WITH held AS (
       SELECT balance.item_id, balance.warehouse_id, balance.warehouse_location_id, sum(balance.quantity) AS quantity FROM tenant.stock_balances balance
         JOIN tenant.items item ON item.organization_id = balance.organization_id AND item.id = balance.item_id
        WHERE balance.organization_id = $1 AND ${scopeOf("balance")} AND item.tracking_type = 'serial' GROUP BY balance.item_id, balance.warehouse_id, balance.warehouse_location_id),
     counted AS (
       SELECT serial.item_id, serial.warehouse_id, serial.warehouse_location_id, count(*) AS quantity FROM tenant.stock_serials serial
         JOIN tenant.items item ON item.organization_id = serial.organization_id AND item.id = serial.item_id
        WHERE serial.organization_id = $1 AND ${scopeOf("serial")} AND item.tracking_type = 'serial' AND serial.status = 'available'
        GROUP BY serial.item_id, serial.warehouse_id, serial.warehouse_location_id)
     SELECT COALESCE(held.item_id, counted.item_id) AS item_id, COALESCE(held.warehouse_id, counted.warehouse_id) AS warehouse_id,
            COALESCE(held.warehouse_location_id, counted.warehouse_location_id) AS location_id, COALESCE(held.quantity, 0) AS on_hand, COALESCE(counted.quantity, 0) AS serials_in_stock
       FROM held FULL JOIN counted ON counted.item_id = held.item_id AND counted.warehouse_id = held.warehouse_id
            AND counted.warehouse_location_id IS NOT DISTINCT FROM held.warehouse_location_id
      WHERE COALESCE(held.quantity, 0) <> COALESCE(counted.quantity, 0) LIMIT 200`, args)).rows;
  const groups = (await client.query(
    `SELECT movement_group.id, movement_group.source_document_number, movement_group.operation_type, sum(movement.quantity) AS net
       FROM tenant.stock_movement_groups movement_group
       JOIN tenant.stock_movements movement ON movement.organization_id = movement_group.organization_id AND movement.movement_group_id = movement_group.id
       LEFT JOIN tenant.stock_movement_groups original ON original.organization_id = movement_group.organization_id AND original.id = movement_group.reversal_of_group_id
      WHERE movement_group.organization_id = $1 AND ${scopeOf("movement")}
        AND (movement_group.operation_type = ANY($4::text[]) OR original.operation_type = ANY($4::text[]))
      GROUP BY movement_group.id HAVING abs(sum(movement.quantity)) > 0.000001 LIMIT 200`, [...args, INTERNAL_OPERATIONS])).rows;
  const names = await describe(client, c, [...positions, ...batches, ...serials]);
  const result = {
    positions: positions.map((row) => ({ ...names(row), ledger: n(row.ledger_quantity), balance: n(row.balance_quantity), difference: n(Number(row.balance_quantity) - Number(row.ledger_quantity)) })),
    batches: batches.map((row) => ({ ...names(row), quantityWithoutBatch: n(row.quantity) })),
    serials: serials.map((row) => ({ ...names(row), onHand: n(row.on_hand), serialsInStock: Number(row.serials_in_stock) })),
    groups: groups.map((row) => ({ groupId: row.id, document: row.source_document_number, operation: row.operation_type, net: n(row.net) })),
  };
  const consistent = !positions.length && !batches.length && !serials.length && !groups.length;
  const run = (await client.query(
    `INSERT INTO tenant.stock_ledger_reconciliations (organization_id, run_by, scope, position_differences, batch_differences, serial_differences, group_differences, result)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, run_at`,
    [c.organizationId, c.userId ?? null, JSON.stringify({ itemId, warehouseId }), positions.length, batches.length, serials.length, groups.length, JSON.stringify(result)])).rows[0];
  return { runId: run.id, runAt: run.run_at, consistent, ...result };
}

export const reconcileBatchBalances = async (client, c, filters = {}) => (await reconcileStockLedger(client, c, filters)).batches;
export const reconcileSerialBalances = async (client, c, filters = {}) => (await reconcileStockLedger(client, c, filters)).serials;

export async function listStockLedgerReconciliations(client, c) {
  need(c, P.reconcile, "You do not have permission to reconcile the stock ledger.");
  const { rows } = await client.query(
    `SELECT run.id, run.run_at, run.scope, run.position_differences, run.batch_differences, run.serial_differences, run.group_differences, runner.full_name AS run_by_name
       FROM tenant.stock_ledger_reconciliations run LEFT JOIN public.users runner ON runner.id = run.run_by
      WHERE run.organization_id = $1 ORDER BY run.run_at DESC LIMIT 20`, [c.organizationId]);
  return rows.map((row) => ({ id: row.id, runAt: row.run_at, runBy: row.run_by_name ?? null, scope: row.scope,
    differences: row.position_differences + row.batch_differences + row.serial_differences + row.group_differences }));
}

async function describe(client, c, rows) {
  const ids = (key) => [...new Set(rows.map((row) => row[key]).filter(Boolean))];
  const items = new Map((await client.query(`SELECT id, code, name FROM tenant.items WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [c.organizationId, ids("item_id")])).rows.map((row) => [row.id, row]));
  const warehouses = new Map((await client.query(`SELECT id, code FROM tenant.warehouses WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [c.organizationId, ids("warehouse_id")])).rows.map((row) => [row.id, row]));
  const locations = new Map((await client.query(`SELECT id, code FROM tenant.warehouse_locations WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [c.organizationId, ids("location_id")])).rows.map((row) => [row.id, row]));
  const batches = new Map((await client.query(`SELECT id, batch_number FROM tenant.stock_batches WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [c.organizationId, ids("batch_id")])).rows.map((row) => [row.id, row]));
  return (row) => ({ itemId: row.item_id, sku: items.get(row.item_id)?.code ?? null, itemName: items.get(row.item_id)?.name ?? null, warehouseId: row.warehouse_id,
    warehouse: warehouses.get(row.warehouse_id)?.code ?? null, location: row.location_id ? locations.get(row.location_id)?.code ?? null : "MAIN",
    batch: row.batch_id ? batches.get(row.batch_id)?.batch_number ?? null : null });
}

// The filtered ledger as a file (CSV or XLSX), the same rows the screen shows (up to 50,000), cost columns only for those who may see cost.
export async function exportStockLedger(client, c, filters = {}, format = "csv") {
  need(c, P.export, "You do not have permission to export the stock ledger.");
  const rows = [];
  let cursor = null;
  let first = null;
  do {
    const pageData = await getStockLedger(client, c, { ...filters, limit: 500, cursor });
    first ??= pageData;
    rows.push(...pageData.rows);
    cursor = pageData.nextCursor;
  } while (cursor && rows.length < 50000);
  const cost = first.canSeeCost;
  const columns = [
    { key: "id", label: "Movement ID" }, { key: "number", label: "Movement" }, { key: "effective", label: "Effective date" }, { key: "posted", label: "Posted at" },
    { key: "type", label: "Movement type" }, { key: "reference", label: "Reference" }, { key: "sku", label: "SKU" }, { key: "item", label: "Item" },
    { key: "warehouse", label: "Warehouse" }, { key: "location", label: "Location" }, { key: "batch", label: "Batch" }, { key: "serial", label: "Serial" },
    { key: "disposition", label: "Disposition" }, { key: "enteredQuantity", label: "Transaction qty" }, { key: "enteredUom", label: "Transaction UOM" },
    { key: "quantity", label: "Base qty delta" }, { key: "baseUom", label: "Base UOM" }, ...(first.scope ? [{ key: "balance", label: "Balance" }] : []),
    { key: "postedBy", label: "Posted by" }, ...(cost ? [{ key: "unitCost", label: "Unit cost" }, { key: "value", label: "Movement value" }] : []),
  ];
  const data = rows.map((row) => ({
    id: row.id, number: row.number, effective: new Date(row.effectiveAt).toISOString().slice(0, 10), posted: new Date(row.postedAt).toISOString(), type: row.typeLabel,
    reference: row.source.number ?? row.number, sku: row.sku, item: row.itemName, warehouse: row.warehouse, location: row.location, batch: row.batch, serial: row.serial,
    disposition: row.dispositionLabel, enteredQuantity: row.entered?.quantity ?? row.quantity, enteredUom: row.entered?.uom ?? row.baseUom, quantity: row.quantity, baseUom: row.baseUom,
    balance: row.balance, postedBy: row.postedBy, unitCost: row.unitCost, value: row.value,
  }));
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "xlsx")
    return { fileName: `stock-ledger-${stamp}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: buildXlsxWorkbook({ sheetName: "Stock ledger", columns, rows: data }), rowCount: data.length };
  return { fileName: `stock-ledger-${stamp}.csv`, contentType: "text/csv; charset=utf-8", body: rowsToCsv(columns, data), rowCount: data.length };
}

// What the ledger page offers: movement types, dispositions, the warehouses this user may see (with their locations), categories.
export async function getStockLedgerOptions(client, c) {
  need(c, P.view, "You do not have permission to view the stock ledger.");
  const visible = await visibleWarehouseIds(client, c);
  const warehouses = (await client.query(`SELECT id, code, name, system_role FROM tenant.warehouses WHERE organization_id = $1 AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
      ORDER BY system_role NULLS FIRST, is_default DESC, code`, [c.organizationId, visible])).rows;
  const locations = (await client.query(`SELECT id, warehouse_id, code, name FROM tenant.warehouse_locations WHERE organization_id = $1 AND allow_stock AND warehouse_id = ANY($2::uuid[])
      ORDER BY is_default_storage DESC, code`, [c.organizationId, warehouses.map((row) => row.id)])).rows;
  const categories = (await client.query(`SELECT id, name FROM tenant.item_groups WHERE organization_id = $1 ORDER BY name LIMIT 500`, [c.organizationId])).rows;
  return {
    movementTypes: STOCK_LEDGER_MOVEMENT_TYPES, dispositions: STOCK_LEDGER_DISPOSITIONS,
    warehouses: warehouses.map((row) => ({ id: row.id, code: row.code, name: row.name, system: Boolean(row.system_role),
      locations: locations.filter((location) => location.warehouse_id === row.id).map((location) => ({ id: location.id, code: location.code, name: location.name })) })),
    categories, canSeeCost: can(c, P.viewCost), canExport: can(c, P.export), canReconcile: can(c, P.reconcile), canRebuild: can(c, "stock.balance.rebuild"),
  };
}
