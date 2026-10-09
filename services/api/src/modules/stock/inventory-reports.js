// Inventory reports: the three fixed MVP reports, each a period or point-in-time statement read from the authoritative sources.
//
//   stock-balance    on hand, reserved, available and restricted per item and warehouse — now, or as of a date (from the ledger)
//   stock-valuation  quantity, value and rate per item and warehouse — now, or as of a date (from Inventory Valuation); needs stock value
//   stock-movement   per item and warehouse over a period: opening, in, out and closing quantities (from the ledger)
//
// Each can be downloaded as CSV or XLSX. Warehouses the user may not see are never included.
import { rowsToCsv } from "@vercentlabs/reporting-engine";

import { buildXlsxWorkbook } from "../../core/platform/data-exchange/xlsx.js";
import { getStockBalance, visibleWarehouseIds } from "./balances.js";
import { StockError } from "./errors.js";
import { getInventoryValuation } from "./valuation.js";

const privileged = (c) => Boolean(c.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug)));
const can = (c, permission) => privileged(c) || Boolean(c.permissions?.includes(permission));
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const n = (value) => Math.round(Number(value ?? 0) * 1e6) / 1e6;
const day = (value, label) => {
  if (value === undefined || value === null || value === "") return null;
  if (!DATE.test(String(value))) throw new StockError(400, `${label} is not a valid date.`, "INVENTORY_REPORT_FILTER_INVALID");
  return String(value);
};
const uuid = (value) => (value && UUID.test(String(value)) ? String(value) : null);

export const INVENTORY_REPORTS = Object.freeze([
  { key: "stock-balance", title: "Stock Balance", description: "On hand, reserved, available and restricted per item and warehouse — now or as of a date.", permission: "stock.view" },
  { key: "stock-valuation", title: "Stock Valuation", description: "Quantity, value and rate per item and warehouse — now or as of a date.", permission: "stock.valuation.view" },
  { key: "stock-movement", title: "Stock Movement", description: "Opening, in, out and closing quantities per item and warehouse over a period.", permission: "stock.ledger.view" },
]);

export function getInventoryReportCatalog(c) {
  return INVENTORY_REPORTS.filter((report) => can(c, report.permission)).map(({ key, title, description }) => ({ key, title, description }));
}

const col = (key, label, type = "text") => ({ key, label, type });

// filters: asOf (stock-balance, stock-valuation), from / to (stock-movement), warehouseId, itemId, categoryId, search, grain (warehouse | item).
export async function getInventoryReport(client, c, key, filters = {}) {
  const report = INVENTORY_REPORTS.find((entry) => entry.key === key);
  if (!report) throw new StockError(404, "Report not found.", "INVENTORY_REPORT_NOT_FOUND");
  if (!can(c, report.permission)) throw new StockError(403, "You do not have permission to view this report.", "PERMISSION_DENIED");
  const byItem = filters.grain === "item";
  const scope = { warehouseId: uuid(filters.warehouseId) ?? undefined, itemId: uuid(filters.itemId) ?? undefined, categoryId: uuid(filters.categoryId) ?? undefined,
    search: filters.search ? String(filters.search).slice(0, 120) : undefined };
  if (key === "stock-balance") {
    const asOf = day(filters.asOf, "As of");
    const result = await getStockBalance(client, c, { ...scope, view: byItem ? "by_item" : "by_warehouse", asOf: asOf ?? undefined, limit: 5000 });
    const historic = Boolean(asOf);
    const columns = [col("sku", "SKU"), col("item", "Item"), ...(byItem ? [] : [col("warehouse", "Warehouse")]), col("uom", "UOM"), col("onHand", "On hand", "number"),
      ...(historic ? [] : [col("reserved", "Reserved", "number"), col("available", "Available", "number"), col("restricted", "Restricted", "number")])];
    const rows = result.rows.map((row) => ({ sku: row.sku, item: row.itemName, warehouse: row.warehouseCode, uom: row.baseUom, onHand: n(row.onHand), reserved: n(row.reserved),
      available: n(row.available), restricted: n(row.restricted), href: `/inventory/stock/items/${row.itemId}` }));
    return { key, title: report.title, description: report.description, columns, rows, filters: { ...scope, asOf, grain: byItem ? "item" : "warehouse" }, note: historic
      ? `On hand at the end of ${asOf}, from the stock ledger. Reservations and restrictions are only known for now.` : "Now, from the stock balances." };
  }
  if (key === "stock-valuation") {
    const asOf = day(filters.asOf, "As of");
    const result = await getInventoryValuation(client, c, { ...scope, view: byItem ? "item" : "summary", asOf: asOf ?? undefined, limit: 5000 });
    const rate = can(c, "stock.valuation.view_rate");
    const columns = [col("sku", "SKU"), col("item", "Item"), ...(byItem ? [] : [col("warehouse", "Warehouse")]), col("method", "Method"), col("uom", "UOM"),
      col("onHand", "Quantity", "number"), ...(rate ? [col("rate", "Rate", "money")] : []), col("value", "Value", "money")];
    const rows = result.rows.map((row) => ({ sku: row.sku, item: row.itemName, warehouse: row.warehouse, method: row.methodLabel, uom: row.baseUom, onHand: row.onHand, rate: row.rate ?? null,
      value: row.value, href: `/inventory/valuation?itemId=${row.itemId}` }));
    return { key, title: report.title, description: report.description, columns, rows, totals: result.totals, filters: { ...scope, asOf, grain: byItem ? "item" : "warehouse" },
      note: asOf ? `Value at the end of ${asOf}, from the valuation entries.` : "Now, from the valuation balances." };
  }
  // stock-movement
  const from = day(filters.from, "From") ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const to = day(filters.to, "To") ?? new Date().toISOString().slice(0, 10);
  if (from > to) throw new StockError(400, "From must be on or before To.", "INVENTORY_REPORT_FILTER_INVALID");
  const visible = await visibleWarehouseIds(client, c);
  const values = [c.organizationId, from, to];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = ["movement.organization_id = $1", "movement.occurred_at < $3::date + 1"];
  if (visible) where.push(`movement.warehouse_id = ANY(${bind(visible)}::uuid[])`);
  if (scope.warehouseId) where.push(`movement.warehouse_id = ${bind(scope.warehouseId)}`);
  if (scope.itemId) where.push(`movement.item_id = ${bind(scope.itemId)}`);
  if (scope.categoryId) where.push(`item.group_id = ${bind(scope.categoryId)}`);
  if (scope.search) where.push(`lower(concat_ws(' ', item.code, item.name, item.barcode)) LIKE ${bind(`%${scope.search.toLowerCase()}%`)}`);
  const { rows: found } = await client.query(
    `SELECT item.id AS item_id, item.code AS sku, item.name AS item_name, uom.code AS base_uom, ${byItem ? "NULL" : "warehouse.code"} AS warehouse,
            COALESCE(sum(movement.quantity) FILTER (WHERE movement.occurred_at < $2::date), 0) AS opening,
            COALESCE(sum(movement.quantity) FILTER (WHERE movement.occurred_at >= $2::date AND movement.quantity > 0), 0) AS quantity_in,
            COALESCE(-sum(movement.quantity) FILTER (WHERE movement.occurred_at >= $2::date AND movement.quantity < 0), 0) AS quantity_out,
            COALESCE(sum(movement.quantity), 0) AS closing,
            count(*) FILTER (WHERE movement.occurred_at >= $2::date) AS movements
       FROM tenant.stock_movements movement
       JOIN tenant.items item ON item.organization_id = movement.organization_id AND item.id = movement.item_id
       JOIN tenant.warehouses warehouse ON warehouse.organization_id = movement.organization_id AND warehouse.id = movement.warehouse_id
       LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = item.organization_id AND uom.id = item.uom_id
      WHERE ${where.join(" AND ")}
      GROUP BY item.id, item.code, item.name, uom.code${byItem ? "" : ", warehouse.code"}
     HAVING count(*) FILTER (WHERE movement.occurred_at >= $2::date) > 0 OR COALESCE(sum(movement.quantity), 0) <> 0
      ORDER BY item.code${byItem ? "" : ", warehouse.code"} LIMIT 5000`, values);
  const columns = [col("sku", "SKU"), col("item", "Item"), ...(byItem ? [] : [col("warehouse", "Warehouse")]), col("uom", "UOM"), col("opening", "Opening", "number"),
    col("in", "In", "number"), col("out", "Out", "number"), col("closing", "Closing", "number"), col("movements", "Movements", "number")];
  const rows = found.map((row) => ({ sku: row.sku, item: row.item_name, warehouse: row.warehouse, uom: row.base_uom, opening: n(row.opening), in: n(row.quantity_in), out: n(row.quantity_out),
    closing: n(row.closing), movements: Number(row.movements), href: `/inventory/transactions?tab=movements&itemId=${row.item_id}&from=${from}&to=${to}` }));
  return { key, title: report.title, description: report.description, columns, rows, filters: { ...scope, from, to, grain: byItem ? "item" : "warehouse" },
    note: `Effective ${from} to ${to}, from the stock ledger: opening + in − out = closing. Internal moves (transfers, quality holds) count as in and out.` };
}

export async function exportInventoryReport(client, c, key, filters = {}, format = "csv") {
  const report = await getInventoryReport(client, c, key, filters);
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "xlsx")
    return { fileName: `${key}-${stamp}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body: buildXlsxWorkbook({ sheetName: report.title, columns: report.columns, rows: report.rows }), rowCount: report.rows.length };
  return { fileName: `${key}-${stamp}.csv`, contentType: "text/csv; charset=utf-8", body: rowsToCsv(report.columns, report.rows), rowCount: report.rows.length };
}
