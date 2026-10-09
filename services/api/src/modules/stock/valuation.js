import { rowsToCsv } from "@vercentlabs/reporting-engine";

import { buildXlsxWorkbook } from "../../core/platform/data-exchange/xlsx.js";
import { getAccountMapping, getPrimaryLedger } from "../accounting/index.js";
import { visibleWarehouseIds } from "./balances.js";
import { StockError } from "./errors.js";
import { LEDGER_TYPE_LABELS } from "./ledger-posting.js";
import { ledgerSourceHref } from "./ledger.js";
import { COST_SOURCES } from "./valuation-engine.js";

// Inventory Valuation, the reading side: what stock is worth (per warehouse and item, the company total, at any past date), the FIFO layers
// left, every value movement with its running balance, the drill-down of one valuation (movement, source document, cost source, layers,
// exchange rate, journal, reversal, restatements), reconciliation (stock quantity, layers, entries, Finance's Inventory Asset accounts) with
// its exceptions, the projection rebuild and exports. Nothing here sets a cost or a value: those come only from stock movements.
//
// Value is visible only with stock.valuation.view (quantities are not); rates, layers, value movements, cost sources and exchange rates each
// need their own permission, enforced here, not by hiding columns.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const privileged = (c) => Boolean(c.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug)));
const can = (c, permission) => privileged(c) || Boolean(c.permissions?.includes(permission));
const need = (c, permission, message) => { if (!can(c, permission)) throw new StockError(403, message, "PERMISSION_DENIED"); };
const n = (value) => Math.round(Number(value ?? 0) * 1e6) / 1e6;
const m = (value) => Math.round(Number(value ?? 0) * 100) / 100;
const text = (value, max = 120) => { const out = String(value ?? "").trim(); return out ? out.slice(0, max) : null; };
const uuidOr = (value) => (value && UUID.test(String(value)) ? String(value) : null);
const P = {
  view: "stock.valuation.view", rate: "stock.valuation.view_rate", layers: "stock.valuation.view_layers", movements: "stock.valuation.view_movements",
  costSource: "stock.valuation.view_cost_source", exchange: "stock.valuation.view_exchange_rate", reconcileView: "stock.valuation.reconcile_view",
  reconcileRun: "stock.valuation.reconcile_run", rebuild: "stock.valuation.rebuild", finance: "stock.valuation.finance_reconcile", export: "stock.valuation.export",
};
export const INVENTORY_VALUATION_METHODS = Object.freeze([{ id: "moving_average", label: "Moving Average" }, { id: "fifo", label: "FIFO" }]);
const METHOD_LABEL = Object.fromEntries(INVENTORY_VALUATION_METHODS.map((entry) => [entry.id, entry.label]));
export const VALUATION_EXCEPTIONS = Object.freeze({
  MOVEMENT_WITHOUT_VALUATION: "Stock movement without valuation", VALUATION_WITHOUT_MOVEMENT: "Valuation without a stock movement",
  QUANTITY_VALUATION_MISMATCH: "Stock quantity and valuation quantity differ", VALUATION_BALANCE_MISMATCH: "Valuation balance differs from its entries",
  FIFO_LAYER_MISMATCH: "FIFO layers differ from the valuation balance", MISSING_INBOUND_COST: "Stock received without a cost", ZERO_COST_REQUIRES_REVIEW: "Stock received at zero cost without authorisation",
  NEGATIVE_INVENTORY_VALUE: "Negative inventory value on positive stock", ZERO_QTY_RESIDUAL_VALUE: "Value left with no stock", NEGATIVE_FIFO_STOCK_BLOCKED: "FIFO stock below zero",
  PROVISIONAL_NEGATIVE_AVERAGE_VALUE: "Negative stock valued provisionally", FINANCE_RECONCILIATION_MISMATCH: "Inventory value differs from the Inventory Asset account",
});
export const valuationCapabilities = (c) => ({ view: can(c, P.view), rate: can(c, P.rate), layers: can(c, P.layers), movements: can(c, P.movements), costSource: can(c, P.costSource),
  exchangeRate: can(c, P.exchange), reconcileView: can(c, P.reconcileView), reconcileRun: can(c, P.reconcileRun), rebuild: can(c, P.rebuild), finance: can(c, P.finance),
  export: can(c, P.export) });

// ------------------------------------------------------------------ what stock is worth

// filters: view (summary: per warehouse and item | warehouse | item), warehouseId, itemId, categoryId, method, search, asOf (YYYY-MM-DD: the
// end of that day), includeZero, limit, offset. Quantities come from the stock ledger, values from the valuation entries, to the same cutoff.
export async function getInventoryValuation(client, c, filters = {}) {
  need(c, P.view, "You do not have permission to see inventory value.");
  const view = ["warehouse", "item"].includes(filters.view) ? filters.view : "summary";
  const asOf = filters.asOf && DATE.test(String(filters.asOf)) ? String(filters.asOf) : null;
  const values = [c.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = [];
  const visible = await visibleWarehouseIds(client, c);
  if (visible) where.push(`position.warehouse_id = ANY(${bind(visible)}::uuid[])`);
  if (uuidOr(filters.warehouseId)) where.push(`position.warehouse_id = ${bind(filters.warehouseId)}`);
  if (uuidOr(filters.itemId)) where.push(`position.item_id = ${bind(filters.itemId)}`);
  if (uuidOr(filters.categoryId)) where.push(`item.group_id = ${bind(filters.categoryId)}`);
  if (METHOD_LABEL[filters.method]) where.push(`item.valuation_method = ${bind(filters.method)}`);
  const term = text(filters.search);
  if (term) where.push(`lower(concat_ws(' ', item.code, item.sku, item.name)) LIKE ${bind(`%${term.toLowerCase()}%`)}`);
  const zero = filters.includeZero === true || filters.includeZero === "true";
  const source = asOf
    ? `(SELECT entry.warehouse_id, entry.item_id, sum(CASE WHEN entry.entry_kind = 'movement' THEN entry.base_quantity_delta ELSE 0 END) AS quantity, sum(entry.value_delta) AS value, NULL::numeric AS average
          FROM tenant.inventory_valuation_entries entry WHERE entry.organization_id = $1 AND entry.effective_at < ${bind(asOf)}::date + 1 GROUP BY entry.warehouse_id, entry.item_id)`
    : `(SELECT warehouse_id, item_id, base_quantity AS quantity, inventory_value AS value, moving_average_cost AS average FROM tenant.inventory_valuation_balances WHERE organization_id = $1)`;
  const grain = view === "warehouse" ? "position.warehouse_id" : view === "item" ? "position.item_id" : "position.warehouse_id, position.item_id";
  const limit = Math.min(Math.max(Number(filters.limit) || 500, 1), 5000);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const { rows } = await client.query(
    `WITH grouped AS (
       SELECT ${view === "item" ? "NULL::uuid AS warehouse_id, position.item_id" : view === "warehouse" ? "position.warehouse_id, NULL::uuid AS item_id" : "position.warehouse_id, position.item_id"},
              sum(position.quantity) AS quantity, sum(position.value) AS value, max(position.average) AS average, count(DISTINCT position.item_id) AS items
         FROM ${source} AS position JOIN tenant.items item ON item.organization_id = $1 AND item.id = position.item_id
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        GROUP BY ${grain}
        ${zero ? "" : "HAVING sum(position.quantity) <> 0 OR sum(position.value) <> 0"})
     SELECT grouped.*, item.code AS sku, item.name AS item_name, item.valuation_method, uom.code AS base_uom, warehouse.code AS warehouse_code, warehouse.name AS warehouse_name,
            count(*) OVER () AS total_rows, sum(grouped.quantity) OVER () AS total_quantity, sum(grouped.value) OVER () AS total_value
       FROM grouped
       LEFT JOIN tenant.items item ON item.organization_id = $1 AND item.id = grouped.item_id
       LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = item.organization_id AND uom.id = item.uom_id
       LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = $1 AND warehouse.id = grouped.warehouse_id
      ORDER BY item.code NULLS FIRST, warehouse.code NULLS FIRST LIMIT ${bind(limit)} OFFSET ${bind(offset)}`, values);
  const rate = can(c, P.rate);
  const first = rows[0];
  return {
    view, asOf, total: Number(first?.total_rows ?? 0), limit, offset, capabilities: valuationCapabilities(c), methods: INVENTORY_VALUATION_METHODS,
    totals: { quantity: view === "warehouse" ? null : n(first?.total_quantity), value: m(first?.total_value) },
    rows: rows.map((row) => {
      const quantity = n(row.quantity);
      const value = m(row.value);
      return {
        key: `${row.warehouse_id ?? "-"}:${row.item_id ?? "-"}`, itemId: row.item_id, sku: row.sku, itemName: row.item_name, baseUom: row.base_uom,
        method: row.valuation_method ?? null, methodLabel: row.valuation_method ? METHOD_LABEL[row.valuation_method] : null, warehouseId: row.warehouse_id, warehouse: row.warehouse_code,
        warehouseName: row.warehouse_name, items: view === "warehouse" ? Number(row.items) : undefined, onHand: view === "warehouse" ? null : quantity, value,
        ...(rate && view !== "warehouse" ? { rate: quantity > 0 ? Math.round((Number(row.value) / Number(row.quantity)) * 1e6) / 1e6 : row.average === null ? null : n(row.average),
          rateKind: row.valuation_method === "fifo" ? "carrying" : "moving_average" } : {}),
        negative: quantity < 0,
      };
    }),
  };
}

// One item: its method and, per warehouse, quantity, value and rate; the company total.
export async function getItemValuation(client, c, itemId) {
  need(c, P.view, "You do not have permission to see inventory value.");
  if (!UUID.test(String(itemId ?? ""))) throw new StockError(404, "Item not found.", "STOCK_ITEM_NOT_FOUND");
  const item = (await client.query(`SELECT item.id, item.code, item.name, item.valuation_method, uom.code AS base_uom FROM tenant.items item
      LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = item.organization_id AND uom.id = item.uom_id WHERE item.organization_id = $1 AND item.id = $2`, [c.organizationId, itemId])).rows[0];
  if (!item) throw new StockError(404, "Item not found.", "STOCK_ITEM_NOT_FOUND");
  const warehouses = await getInventoryValuation(client, c, { itemId, view: "summary", includeZero: false });
  const locked = Number((await client.query(`SELECT count(*) AS c FROM tenant.inventory_valuation_entries WHERE organization_id = $1 AND item_id = $2`, [c.organizationId, itemId])).rows[0].c) > 0;
  return {
    item: { id: item.id, sku: item.code, name: item.name, baseUom: item.base_uom, method: item.valuation_method, methodLabel: METHOD_LABEL[item.valuation_method], methodLocked: locked },
    warehouses: warehouses.rows, total: { quantity: warehouses.totals.quantity, value: warehouses.totals.value }, capabilities: valuationCapabilities(c),
  };
}

// One warehouse: its total value, the value of each item in it and its latest value movements.
export async function getWarehouseValuation(client, c, warehouseId) {
  need(c, P.view, "You do not have permission to see inventory value.");
  if (!UUID.test(String(warehouseId ?? ""))) throw new StockError(404, "Warehouse not found.", "WAREHOUSE_NOT_FOUND");
  const items = await getInventoryValuation(client, c, { warehouseId, view: "summary" });
  const movements = can(c, P.movements) ? (await getValuationMovements(client, c, { warehouseId, order: "desc", limit: 20 })).rows : [];
  return { warehouseId, total: items.totals.value, items: items.rows, movements, capabilities: valuationCapabilities(c) };
}

// ------------------------------------------------------------------ FIFO layers

// filters: itemId, warehouseId, includeExhausted
export async function getFifoLayers(client, c, filters = {}) {
  need(c, P.layers, "You do not have permission to see FIFO cost layers.");
  const values = [c.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = ["layer.organization_id = $1"];
  if (!(filters.includeExhausted === true || filters.includeExhausted === "true")) where.push("layer.status = 'open'");
  if (uuidOr(filters.itemId)) where.push(`layer.item_id = ${bind(filters.itemId)}`);
  if (uuidOr(filters.warehouseId)) where.push(`layer.warehouse_id = ${bind(filters.warehouseId)}`);
  const visible = await visibleWarehouseIds(client, c);
  if (visible) where.push(`layer.warehouse_id = ANY(${bind(visible)}::uuid[])`);
  const { rows } = await client.query(
    `SELECT layer.*, item.code AS sku, item.name AS item_name, warehouse.code AS warehouse_code, movement.movement_number, movement_group.source_document_type, movement_group.source_document_id,
            movement_group.source_document_number, movement.id AS movement_id, origin_warehouse.code AS origin_warehouse
       FROM tenant.inventory_cost_layers layer
       JOIN tenant.items item ON item.organization_id = layer.organization_id AND item.id = layer.item_id
       JOIN tenant.warehouses warehouse ON warehouse.organization_id = layer.organization_id AND warehouse.id = layer.warehouse_id
       LEFT JOIN tenant.stock_movements movement ON movement.organization_id = layer.organization_id AND movement.id = layer.source_movement_id
       LEFT JOIN tenant.stock_movement_groups movement_group ON movement_group.organization_id = movement.organization_id AND movement_group.id = movement.movement_group_id
       LEFT JOIN tenant.inventory_cost_layers origin ON origin.organization_id = layer.organization_id AND origin.id = layer.origin_layer_id
       LEFT JOIN tenant.warehouses origin_warehouse ON origin_warehouse.organization_id = layer.organization_id AND origin_warehouse.id = origin.warehouse_id
      WHERE ${where.join(" AND ")} ORDER BY item.code, warehouse.code, layer.effective_at, layer.valuation_sequence, layer.id LIMIT 2000`, values);
  return {
    rows: rows.map((row, index) => ({
      id: row.id, label: `L${String(index + 1).padStart(3, "0")}`, itemId: row.item_id, sku: row.sku, itemName: row.item_name, warehouseId: row.warehouse_id, warehouse: row.warehouse_code,
      source: row.source_document_number ? { number: row.source_document_number, href: ledgerSourceHref(row.source_document_type, row.source_document_id, row.movement_id) } : null,
      movement: row.movement_number, transferredFrom: row.origin_warehouse ?? null, date: row.effective_at, originalQuantity: n(row.original_quantity), remainingQuantity: n(row.remaining_quantity),
      unitCost: n(row.unit_cost), originalValue: m(row.original_value), remainingValue: m(row.remaining_value), status: row.status,
    })),
  };
}

// ------------------------------------------------------------------ value movements

// filters: itemId, warehouseId, from, to, order (asc | desc), limit. Each row: the valuation of one movement (or a settlement / restatement),
// its rate and value change, and the running value of its warehouse and item.
export async function getValuationMovements(client, c, filters = {}) {
  need(c, P.movements, "You do not have permission to see value movements.");
  const values = [c.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = [];
  if (uuidOr(filters.itemId)) where.push(`stream.item_id = ${bind(filters.itemId)}`);
  if (uuidOr(filters.warehouseId)) where.push(`stream.warehouse_id = ${bind(filters.warehouseId)}`);
  if (filters.from && DATE.test(String(filters.from))) where.push(`stream.effective_at >= ${bind(filters.from)}::date`);
  if (filters.to && DATE.test(String(filters.to))) where.push(`stream.effective_at < ${bind(filters.to)}::date + 1`);
  const visible = await visibleWarehouseIds(client, c);
  if (visible) where.push(`stream.warehouse_id = ANY(${bind(visible)}::uuid[])`);
  const limit = Math.min(Math.max(Number(filters.limit) || 200, 1), 5000);
  const order = filters.order === "desc" ? "DESC" : "ASC";
  const { rows } = await client.query(
    `WITH stream AS (
       SELECT entry.*, sum(CASE WHEN entry.entry_kind = 'movement' THEN entry.base_quantity_delta ELSE 0 END) OVER running AS balance_quantity, sum(entry.value_delta) OVER running AS balance_value
         FROM tenant.inventory_valuation_entries entry WHERE entry.organization_id = $1
       WINDOW running AS (PARTITION BY entry.warehouse_id, entry.item_id ORDER BY entry.effective_at, entry.valuation_sequence))
     SELECT stream.*, item.code AS sku, item.name AS item_name, warehouse.code AS warehouse_code, movement.movement_number, movement_group.source_document_type, movement_group.source_document_id,
            movement_group.source_document_number
       FROM stream
       JOIN tenant.items item ON item.organization_id = stream.organization_id AND item.id = stream.item_id
       JOIN tenant.warehouses warehouse ON warehouse.organization_id = stream.organization_id AND warehouse.id = stream.warehouse_id
       LEFT JOIN tenant.stock_movements movement ON movement.organization_id = stream.organization_id AND movement.id = stream.movement_id
       LEFT JOIN tenant.stock_movement_groups movement_group ON movement_group.organization_id = movement.organization_id AND movement_group.id = movement.movement_group_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY stream.effective_at ${order}, stream.valuation_sequence ${order} LIMIT ${bind(limit)}`, values);
  const costSource = can(c, P.costSource);
  return { rows: rows.map((row) => entryRow(row, { costSource, rate: can(c, P.rate) })) };
}

function entryRow(row, { costSource, rate }) {
  const kind = row.entry_kind === "movement" ? (LEDGER_TYPE_LABELS[row.ledger_type] ?? row.ledger_type) : row.entry_kind === "settlement" ? "Negative stock settlement" : "Backdated restatement";
  return {
    id: row.id, kind: row.entry_kind, type: kind, date: row.effective_at, postedAt: row.posted_at, itemId: row.item_id, sku: row.sku, itemName: row.item_name, warehouseId: row.warehouse_id,
    warehouse: row.warehouse_code, movementId: row.movement_id, movement: row.movement_number ?? null, method: row.valuation_method, methodLabel: METHOD_LABEL[row.valuation_method],
    source: row.source_document_number ? { number: row.source_document_number, href: ledgerSourceHref(row.source_document_type, row.source_document_id, row.movement_id) } : null,
    quantity: n(row.base_quantity_delta), ...(rate ? { rate: n(row.base_unit_cost) } : {}), value: m(row.value_delta),
    balanceQuantity: row.balance_quantity === undefined ? null : n(row.balance_quantity), balanceValue: row.balance_value === undefined ? null : m(row.balance_value),
    ...(costSource ? { costSource: row.source_cost_type, costSourceLabel: COST_SOURCES[row.source_cost_type] ?? row.source_cost_type } : {}),
    sequence: Number(row.valuation_sequence),
  };
}

// One valuation: the movement and its source document, where the cost came from, the FIFO layers it took or opened, the exchange-rate snapshot,
// the journals, the reversal and the restatements.
export async function getValuationEntry(client, c, entryId) {
  need(c, P.movements, "You do not have permission to see value movements.");
  if (!UUID.test(String(entryId ?? ""))) throw new StockError(404, "Valuation not found.", "VALUATION_NOT_FOUND");
  const row = (await client.query(
    `SELECT entry.*, item.code AS sku, item.name AS item_name, warehouse.code AS warehouse_code, movement.movement_number, movement.quantity AS movement_quantity, movement.movement_group_id,
            movement_group.source_document_type, movement_group.source_document_id, movement_group.source_document_number
       FROM tenant.inventory_valuation_entries entry
       JOIN tenant.items item ON item.organization_id = entry.organization_id AND item.id = entry.item_id
       JOIN tenant.warehouses warehouse ON warehouse.organization_id = entry.organization_id AND warehouse.id = entry.warehouse_id
       LEFT JOIN tenant.stock_movements movement ON movement.organization_id = entry.organization_id AND movement.id = entry.movement_id
       LEFT JOIN tenant.stock_movement_groups movement_group ON movement_group.organization_id = movement.organization_id AND movement_group.id = movement.movement_group_id
      WHERE entry.organization_id = $1 AND entry.id = $2`, [c.organizationId, entryId])).rows[0];
  if (!row) throw new StockError(404, "Valuation not found.", "VALUATION_NOT_FOUND");
  const visible = await visibleWarehouseIds(client, c);
  if (visible && !visible.includes(row.warehouse_id)) throw new StockError(404, "Valuation not found.", "VALUATION_NOT_FOUND");
  const allocations = can(c, P.layers) ? (await client.query(
    `SELECT allocation.*, layer.effective_at, layer.unit_cost AS layer_cost, layer_movement.movement_number AS layer_movement, layer_group.source_document_number AS layer_source,
            layer_group.source_document_type AS layer_source_type, layer_group.source_document_id AS layer_source_id
       FROM tenant.inventory_valuation_allocations allocation
       JOIN tenant.inventory_cost_layers layer ON layer.organization_id = allocation.organization_id AND layer.id = allocation.cost_layer_id
       LEFT JOIN tenant.stock_movements layer_movement ON layer_movement.organization_id = layer.organization_id AND layer_movement.id = layer.source_movement_id
       LEFT JOIN tenant.stock_movement_groups layer_group ON layer_group.organization_id = layer_movement.organization_id AND layer_group.id = layer_movement.movement_group_id
      WHERE allocation.organization_id = $1 AND allocation.valuation_entry_id = $2 ORDER BY layer.effective_at, layer.valuation_sequence`, [c.organizationId, entryId])).rows : [];
  const opened = can(c, P.layers) ? (await client.query(`SELECT id, original_quantity, original_value, unit_cost, effective_at FROM tenant.inventory_cost_layers WHERE organization_id = $1 AND source_entry_id = $2`,
    [c.organizationId, entryId])).rows : [];
  const related = (await client.query(
    `SELECT entry.id, entry.entry_kind, entry.value_delta, entry.effective_at, entry.reversal_of_id, entry.restates_entry_id, movement.movement_number FROM tenant.inventory_valuation_entries entry
       LEFT JOIN tenant.stock_movements movement ON movement.organization_id = entry.organization_id AND movement.id = entry.movement_id
      WHERE entry.organization_id = $1 AND (entry.reversal_of_id = $2 OR entry.restates_entry_id = $2 OR entry.id = $3)`, [c.organizationId, entryId, row.reversal_of_id ?? null])).rows;
  const journals = (await client.query(
    `SELECT DISTINCT journal.id, journal.entry_number, journal.entry_date, journal.status, journal.description FROM tenant.accounting_journal_entries journal
      WHERE journal.organization_id = $1 AND (journal.id = $2 OR (journal.source_type = $3 AND journal.source_id = $4 AND journal.source_type IS NOT NULL)) ORDER BY journal.entry_date`,
    [c.organizationId, row.journal_entry_id ?? null, row.source_document_type ?? null, row.source_document_id ?? null])).rows;
  const costSource = can(c, P.costSource);
  return {
    entry: entryRow(row, { costSource, rate: can(c, P.rate) }),
    movement: row.movement_id ? { id: row.movement_id, number: row.movement_number, href: `/inventory/stock-ledger/${row.movement_id}` } : null,
    ...(can(c, P.exchange) && row.source_currency ? { exchange: { sourceCurrency: row.source_currency, sourceUnitCost: n(row.source_unit_cost), rate: n(row.exchange_rate), baseCurrency: row.base_currency } } : {}),
    allocations: allocations.map((entry) => ({ layerId: entry.cost_layer_id, quantity: n(entry.quantity), value: m(entry.value), unitCost: n(entry.unit_cost), layerDate: entry.effective_at,
      layerSource: entry.layer_source ? { number: entry.layer_source, href: ledgerSourceHref(entry.layer_source_type, entry.layer_source_id, null) } : entry.layer_movement ? { number: entry.layer_movement, href: null } : null,
      restored: Number(entry.quantity) < 0 })),
    layersOpened: opened.map((layer) => ({ id: layer.id, quantity: n(layer.original_quantity), value: m(layer.original_value), unitCost: n(layer.unit_cost), date: layer.effective_at })),
    reversalOf: related.find((entry) => entry.id === row.reversal_of_id) ? { id: row.reversal_of_id, movement: related.find((entry) => entry.id === row.reversal_of_id).movement_number } : null,
    reversedBy: related.filter((entry) => entry.reversal_of_id === entryId).map((entry) => ({ id: entry.id, movement: entry.movement_number, value: m(entry.value_delta) })),
    restatements: related.filter((entry) => entry.restates_entry_id === entryId).map((entry) => ({ id: entry.id, value: m(entry.value_delta), date: entry.effective_at })),
    journals: journals.map((journal) => ({ id: journal.id, number: journal.entry_number, date: journal.entry_date, status: journal.status, description: journal.description, href: "/accounting/journals" })),
    details: row.details ?? {},
  };
}

// ------------------------------------------------------------------ reconciliation

// Stock quantity against valuation quantity, balances against their entries, FIFO layers against balances, movements without valuation, missing
// and unauthorised zero cost, negative values, residual value with no stock, negative FIFO stock, provisional negative values — and, with the
// permission, the Inventory Asset accounts. Changes nothing (a run with stock.valuation.reconcile_run is recorded).
export async function reconcileInventoryValuation(client, c, { record = false } = {}) {
  need(c, record ? P.reconcileRun : P.reconcileView, "You do not have permission to reconcile inventory valuation.");
  const org = c.organizationId;
  const exceptions = [];
  const push = (code, row, extra = {}) => exceptions.push({ code, label: VALUATION_EXCEPTIONS[code], itemId: row.item_id ?? null, sku: row.sku ?? null, warehouseId: row.warehouse_id ?? null,
    warehouse: row.warehouse_code ?? null, ...extra });
  const positions = (await client.query(
    `WITH stock AS (SELECT warehouse_id, item_id, sum(quantity) AS quantity FROM tenant.stock_balances WHERE organization_id = $1 GROUP BY warehouse_id, item_id),
          entries AS (SELECT warehouse_id, item_id, sum(CASE WHEN entry_kind = 'movement' THEN base_quantity_delta ELSE 0 END) AS quantity, sum(value_delta) AS value
                        FROM tenant.inventory_valuation_entries WHERE organization_id = $1 GROUP BY warehouse_id, item_id),
          layers AS (SELECT warehouse_id, item_id, sum(remaining_quantity) AS quantity, sum(remaining_value) AS value FROM tenant.inventory_cost_layers WHERE organization_id = $1 GROUP BY warehouse_id, item_id)
     SELECT COALESCE(balance.warehouse_id, stock.warehouse_id, entries.warehouse_id) AS warehouse_id, COALESCE(balance.item_id, stock.item_id, entries.item_id) AS item_id,
            COALESCE(stock.quantity, 0) AS stock_quantity, COALESCE(balance.base_quantity, 0) AS balance_quantity, COALESCE(balance.inventory_value, 0) AS balance_value,
            COALESCE(entries.quantity, 0) AS entry_quantity, COALESCE(entries.value, 0) AS entry_value, COALESCE(layers.quantity, 0) AS layer_quantity, COALESCE(layers.value, 0) AS layer_value,
            COALESCE(balance.valuation_method, item.valuation_method) AS method, item.code AS sku, warehouse.code AS warehouse_code
       FROM (SELECT * FROM tenant.inventory_valuation_balances WHERE organization_id = $1) balance
       FULL OUTER JOIN stock ON stock.warehouse_id = balance.warehouse_id AND stock.item_id = balance.item_id
       FULL OUTER JOIN entries ON entries.warehouse_id = COALESCE(balance.warehouse_id, stock.warehouse_id) AND entries.item_id = COALESCE(balance.item_id, stock.item_id)
       LEFT JOIN layers ON layers.warehouse_id = COALESCE(balance.warehouse_id, stock.warehouse_id, entries.warehouse_id) AND layers.item_id = COALESCE(balance.item_id, stock.item_id, entries.item_id)
       JOIN tenant.items item ON item.organization_id = $1 AND item.id = COALESCE(balance.item_id, stock.item_id, entries.item_id)
       JOIN tenant.warehouses warehouse ON warehouse.organization_id = $1 AND warehouse.id = COALESCE(balance.warehouse_id, stock.warehouse_id, entries.warehouse_id)`, [org])).rows;
  for (const row of positions) {
    const stockQty = n(row.stock_quantity);
    const qty = n(row.balance_quantity);
    const value = m(row.balance_value);
    if (Math.abs(stockQty - qty) > 1e-6) push("QUANTITY_VALUATION_MISMATCH", row, { stockQuantity: stockQty, valuationQuantity: qty, difference: n(stockQty - qty) });
    if (Math.abs(qty - n(row.entry_quantity)) > 1e-6 || Math.abs(value - m(row.entry_value)) > 0.001)
      push("VALUATION_BALANCE_MISMATCH", row, { balanceQuantity: qty, entryQuantity: n(row.entry_quantity), balanceValue: value, entryValue: m(row.entry_value) });
    if (row.method === "fifo" && qty >= 0 && (Math.abs(n(row.layer_quantity) - qty) > 1e-6 || Math.abs(m(row.layer_value) - value) > 0.001))
      push("FIFO_LAYER_MISMATCH", row, { valuationQuantity: qty, layerQuantity: n(row.layer_quantity), valuationValue: value, layerValue: m(row.layer_value) });
    if (qty > 0 && value < 0) push("NEGATIVE_INVENTORY_VALUE", row, { quantity: qty, value });
    if (qty === 0 && Math.abs(value) > 0.001) push("ZERO_QTY_RESIDUAL_VALUE", row, { value });
    if (qty < 0 && row.method === "fifo") push("NEGATIVE_FIFO_STOCK_BLOCKED", row, { quantity: qty });
    if (qty < 0 && row.method !== "fifo") push("PROVISIONAL_NEGATIVE_AVERAGE_VALUE", row, { quantity: qty, value });
  }
  const unvalued = (await client.query(
    `SELECT movement.id, movement.movement_number, movement.item_id, movement.warehouse_id, item.code AS sku, warehouse.code AS warehouse_code FROM tenant.stock_movements movement
       JOIN tenant.items item ON item.organization_id = movement.organization_id AND item.id = movement.item_id
       JOIN tenant.warehouses warehouse ON warehouse.organization_id = movement.organization_id AND warehouse.id = movement.warehouse_id
      WHERE movement.organization_id = $1 AND NOT EXISTS (SELECT 1 FROM tenant.inventory_valuation_entries entry WHERE entry.organization_id = movement.organization_id AND entry.movement_id = movement.id)
      LIMIT 500`, [org])).rows;
  for (const row of unvalued) push("MOVEMENT_WITHOUT_VALUATION", row, { movementId: row.id, movement: row.movement_number });
  const mismatched = (await client.query(
    `SELECT entry.id, entry.item_id, entry.warehouse_id, item.code AS sku, warehouse.code AS warehouse_code, movement.movement_number FROM tenant.inventory_valuation_entries entry
       JOIN tenant.stock_movements movement ON movement.organization_id = entry.organization_id AND movement.id = entry.movement_id
       JOIN tenant.items item ON item.organization_id = entry.organization_id AND item.id = entry.item_id
       JOIN tenant.warehouses warehouse ON warehouse.organization_id = entry.organization_id AND warehouse.id = entry.warehouse_id
      WHERE entry.organization_id = $1 AND (movement.item_id <> entry.item_id OR movement.warehouse_id <> entry.warehouse_id OR movement.quantity <> entry.base_quantity_delta) LIMIT 500`, [org])).rows;
  for (const row of mismatched) push("VALUATION_WITHOUT_MOVEMENT", row, { entryId: row.id, movement: row.movement_number });
  const costless = (await client.query(
    `SELECT entry.id, entry.source_cost_type, entry.item_id, entry.warehouse_id, item.code AS sku, warehouse.code AS warehouse_code, movement.movement_number FROM tenant.inventory_valuation_entries entry
       JOIN tenant.items item ON item.organization_id = entry.organization_id AND item.id = entry.item_id
       JOIN tenant.warehouses warehouse ON warehouse.organization_id = entry.organization_id AND warehouse.id = entry.warehouse_id
       LEFT JOIN tenant.stock_movements movement ON movement.organization_id = entry.organization_id AND movement.id = entry.movement_id
      WHERE entry.organization_id = $1 AND entry.source_cost_type IN ('missing_cost', 'zero_cost') LIMIT 500`, [org])).rows;
  for (const row of costless) push(row.source_cost_type === "missing_cost" ? "MISSING_INBOUND_COST" : "ZERO_COST_REQUIRES_REVIEW", row, { entryId: row.id, movement: row.movement_number });
  const finance = can(c, P.finance) ? await reconcileInventoryWithFinance(client, c) : null;
  for (const account of finance?.accounts ?? []) if (account.status === "not_reconciled")
    exceptions.push({ code: "FINANCE_RECONCILIATION_MISMATCH", label: VALUATION_EXCEPTIONS.FINANCE_RECONCILIATION_MISMATCH, accountId: account.accountId, account: account.account,
      valuation: account.valuation, ledger: account.ledger, difference: account.difference });
  const company = positions.reduce((total, row) => total + Number(row.balance_value), 0);
  const result = {
    checkedAt: new Date().toISOString(), positions: positions.length, consistent: exceptions.length === 0, companyValue: m(company),
    warehouses: Object.values(positions.reduce((acc, row) => { const key = row.warehouse_id; acc[key] = acc[key] ?? { warehouseId: key, warehouse: row.warehouse_code, value: 0 }; acc[key].value = m(acc[key].value + Number(row.balance_value)); return acc; }, {})),
    exceptions, finance,
  };
  if (record)
    await client.query(`INSERT INTO tenant.inventory_valuation_events (organization_id, event_type, summary, details, actor_user_id) VALUES ($1, 'reconciled', $2, $3, $4)`,
      [org, result.consistent ? "Valuation reconciled: no exceptions" : `Valuation reconciled: ${exceptions.length} exception${exceptions.length === 1 ? "" : "s"}`,
        JSON.stringify({ positions: positions.length, exceptions: exceptions.length, codes: [...new Set(exceptions.map((entry) => entry.code))], companyValue: result.companyValue }), c.userId ?? null]);
  return result;
}

// Inventory value per Inventory Asset account (the account each item's inventory maps to) against the account's balance in the General Ledger
// (posted journals). A difference is shown, never adjusted. A difference of a rupee or less is rounding, shown as such.
export async function reconcileInventoryWithFinance(client, c) {
  need(c, P.finance, "You do not have permission to compare inventory value with the General Ledger.");
  const ctx = { ...c, permissions: [...new Set([...(c.permissions ?? []), "accounting.view"])] };
  const ledger = await getPrimaryLedger(client, ctx).catch(() => null);
  if (!ledger) return { ledger: null, accounts: [], status: "no_ledger" };
  const items = (await client.query(`SELECT item_id, sum(inventory_value) AS value FROM tenant.inventory_valuation_balances WHERE organization_id = $1 GROUP BY item_id`, [c.organizationId])).rows;
  const byAccount = new Map();
  for (const row of items) {
    const account = await getAccountMapping(client, ctx, ledger.id, "inventory", { itemId: row.item_id }).catch(() => null);
    const key = account?.account_id ?? "unmapped";
    const current = byAccount.get(key) ?? { accountId: account?.account_id ?? null, account: account ? `${account.code} · ${account.name}` : "No Inventory account mapped", valuation: 0, items: 0 };
    current.valuation = m(current.valuation + Number(row.value));
    current.items += 1;
    byAccount.set(key, current);
  }
  const accountIds = [...byAccount.values()].map((entry) => entry.accountId).filter(Boolean);
  const inventoryAccounts = (await client.query(`SELECT id, code, name FROM tenant.accounting_accounts WHERE organization_id = $1 AND ledger_id = $2 AND account_type = 'inventory'`, [c.organizationId, ledger.id])).rows;
  for (const account of inventoryAccounts) if (!byAccount.has(account.id)) byAccount.set(account.id, { accountId: account.id, account: `${account.code} · ${account.name}`, valuation: 0, items: 0 });
  const balances = new Map((await client.query(
    `SELECT line.account_id, sum(line.base_debit_amount - line.base_credit_amount) AS balance FROM tenant.accounting_journal_lines line
       JOIN tenant.accounting_journal_entries journal ON journal.organization_id = line.organization_id AND journal.id = line.journal_entry_id
      WHERE line.organization_id = $1 AND journal.ledger_id = $2 AND journal.status = 'posted' AND line.account_id = ANY($3::uuid[]) GROUP BY line.account_id`,
    [c.organizationId, ledger.id, [...new Set([...accountIds, ...inventoryAccounts.map((account) => account.id)])]])).rows.map((row) => [row.account_id, m(row.balance)]));
  const accounts = [...byAccount.values()].map((entry) => {
    const ledgerBalance = entry.accountId ? balances.get(entry.accountId) ?? 0 : null;
    const difference = ledgerBalance === null ? null : m(entry.valuation - ledgerBalance);
    const status = ledgerBalance === null ? "unmapped" : difference === 0 ? "reconciled" : Math.abs(difference) <= 1 ? "rounding" : "not_reconciled";
    return { ...entry, ledger: ledgerBalance, difference, status };
  }).filter((entry) => entry.valuation !== 0 || (entry.ledger ?? 0) !== 0 || entry.items > 0);
  const valuation = m(accounts.reduce((total, entry) => total + entry.valuation, 0));
  const ledgerTotal = m(accounts.reduce((total, entry) => total + (entry.ledger ?? 0), 0));
  return { ledger: ledger.id, accounts, valuation, ledgerBalance: ledgerTotal, difference: m(valuation - ledgerTotal),
    status: accounts.every((entry) => ["reconciled", "rounding"].includes(entry.status)) ? (accounts.some((entry) => entry.status === "rounding") ? "rounding" : "reconciled") : "not_reconciled" };
}

// ------------------------------------------------------------------ projection rebuild

// Rebuilds the balances (quantity and value from the entries; the moving average from them) and the FIFO layers' remaining quantity and
// value (what each layer opened less every allocation against it) — and the carrying rate stock balances show. Records what changed.
export async function rebuildInventoryValuationProjection(client, c, input = {}) {
  need(c, P.rebuild, "You do not have permission to rebuild the valuation projection.");
  const reason = text(input.reason, 500);
  if (!reason) throw new StockError(400, "Give the reason for rebuilding the valuation.", "VALUATION_REASON_REQUIRED");
  const org = c.organizationId;
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('valuation-rebuild:' || $1))`, [org]);
  const balances = (await client.query(
    `WITH entries AS (SELECT warehouse_id, item_id, sum(CASE WHEN entry_kind = 'movement' THEN base_quantity_delta ELSE 0 END) AS quantity, sum(value_delta) AS value
                        FROM tenant.inventory_valuation_entries WHERE organization_id = $1 GROUP BY warehouse_id, item_id)
     SELECT entries.*, balance.id AS balance_id, balance.base_quantity, balance.inventory_value, item.valuation_method
       FROM entries JOIN tenant.items item ON item.organization_id = $1 AND item.id = entries.item_id
       LEFT JOIN tenant.inventory_valuation_balances balance ON balance.organization_id = $1 AND balance.warehouse_id = entries.warehouse_id AND balance.item_id = entries.item_id`, [org])).rows;
  const corrected = [];
  for (const row of balances) {
    const changed = !row.balance_id || n(row.base_quantity) !== n(row.quantity) || m(row.inventory_value) !== m(row.value);
    if (changed) corrected.push({ itemId: row.item_id, warehouseId: row.warehouse_id, was: { quantity: n(row.base_quantity), value: m(row.inventory_value) }, now: { quantity: n(row.quantity), value: m(row.value) } });
    await client.query(
      `INSERT INTO tenant.inventory_valuation_balances (organization_id, warehouse_id, item_id, valuation_method, base_quantity, inventory_value, moving_average_cost, version)
       VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $5::numeric > 0 THEN $6::numeric / $5::numeric END, 1)
       ON CONFLICT (organization_id, warehouse_id, item_id) DO UPDATE SET base_quantity = EXCLUDED.base_quantity, inventory_value = EXCLUDED.inventory_value,
         moving_average_cost = COALESCE(EXCLUDED.moving_average_cost, tenant.inventory_valuation_balances.moving_average_cost), version = tenant.inventory_valuation_balances.version + 1, updated_at = now()`,
      [org, row.warehouse_id, row.item_id, row.valuation_method, row.quantity, row.value]);
  }
  const layers = (await client.query(
    `SELECT layer.id, layer.remaining_quantity, layer.remaining_value, layer.original_quantity - COALESCE(sum(allocation.quantity), 0) AS quantity,
            layer.original_value - COALESCE(sum(allocation.value), 0) AS value
       FROM tenant.inventory_cost_layers layer LEFT JOIN tenant.inventory_valuation_allocations allocation ON allocation.organization_id = layer.organization_id AND allocation.cost_layer_id = layer.id
      WHERE layer.organization_id = $1 GROUP BY layer.id`, [org])).rows;
  let layerCorrections = 0;
  for (const layer of layers) {
    if (n(layer.remaining_quantity) === n(layer.quantity) && m(layer.remaining_value) === m(layer.value)) continue;
    layerCorrections += 1;
    await client.query(`UPDATE tenant.inventory_cost_layers SET remaining_quantity = greatest($3::numeric, 0), remaining_value = greatest($4::numeric, 0),
        status = CASE WHEN $3::numeric > 0 THEN 'open' ELSE 'exhausted' END, updated_at = now() WHERE organization_id = $1 AND id = $2`, [org, layer.id, layer.quantity, layer.value]);
  }
  await client.query(
    `UPDATE tenant.stock_balances stock SET average_cost = abs(balance.inventory_value / balance.base_quantity) FROM tenant.inventory_valuation_balances balance
      WHERE stock.organization_id = $1 AND balance.organization_id = $1 AND balance.warehouse_id = stock.warehouse_id AND balance.item_id = stock.item_id AND balance.base_quantity <> 0`, [org]);
  await client.query(`INSERT INTO tenant.inventory_valuation_events (organization_id, event_type, summary, details, actor_user_id) VALUES ($1, 'rebuilt', $2, $3, $4)`,
    [org, `Valuation projection rebuilt: ${corrected.length} balance${corrected.length === 1 ? "" : "s"} and ${layerCorrections} layer${layerCorrections === 1 ? "" : "s"} corrected`,
      JSON.stringify({ reason, balances: corrected.slice(0, 500), layers: layerCorrections }), c.userId ?? null]);
  return { balanceCorrections: corrected.length, layerCorrections, corrected, after: await reconcileInventoryValuation(client, { ...c, permissions: [...(c.permissions ?? []), P.reconcileView] }) };
}

export async function listValuationEvents(client, c) {
  need(c, P.reconcileView, "You do not have permission to see valuation history.");
  const { rows } = await client.query(
    `SELECT event.*, actor.full_name AS actor_name FROM tenant.inventory_valuation_events event LEFT JOIN public.users actor ON actor.id = event.actor_user_id
      WHERE event.organization_id = $1 ORDER BY event.created_at DESC LIMIT 100`, [c.organizationId]);
  return rows.map((row) => ({ id: row.id, type: row.event_type, summary: row.summary, at: row.created_at, by: row.actor_name ?? null, details: row.details ?? {} }));
}

// ------------------------------------------------------------------ export

export async function exportInventoryValuation(client, c, filters = {}, format = "csv") {
  need(c, P.export, "You do not have permission to export valuation.");
  const report = await getInventoryValuation(client, c, { ...filters, limit: 5000, offset: 0 });
  const rate = can(c, P.rate);
  const columns = [
    { key: "sku", label: "SKU" }, { key: "item", label: "Item" }, { key: "warehouse", label: "Warehouse" }, { key: "uom", label: "Base UOM" }, { key: "onHand", label: "On hand" },
    { key: "method", label: "Valuation method" }, ...(rate ? [{ key: "rate", label: "Valuation rate" }] : []), { key: "value", label: "Inventory value" },
  ];
  const data = report.rows.map((row) => ({ sku: row.sku, item: row.itemName, warehouse: row.warehouse, uom: row.baseUom, onHand: row.onHand, method: row.methodLabel, rate: row.rate, value: row.value }));
  data.push({ sku: "Total", value: report.totals.value });
  const stamp = report.asOf ?? new Date().toISOString().slice(0, 10);
  if (format === "xlsx")
    return { fileName: `inventory-valuation-${stamp}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: buildXlsxWorkbook({ sheetName: "Valuation", columns, rows: data }), rowCount: data.length - 1 };
  return { fileName: `inventory-valuation-${stamp}.csv`, contentType: "text/csv; charset=utf-8", body: rowsToCsv(columns, data), rowCount: data.length - 1 };
}

// Where a value came from, for the ledger's movement detail.
export async function valuationOfMovement(client, c, movementId) {
  const row = (await client.query(`SELECT id FROM tenant.inventory_valuation_entries WHERE organization_id = $1 AND movement_id = $2 AND entry_kind = 'movement'`, [c.organizationId, movementId])).rows[0];
  return row && can(c, P.movements) ? getValuationEntry(client, c, row.id) : null;
}
