// Bulk price maintenance: export a price list, edit it in a spreadsheet,
// import it again.
//
// Each row is a price for a product (by code or SKU) in a unit (by code or
// name; the base unit when empty), with optional validity dates. A row
// whose product, unit and start date match an existing active price
// changes that price; any other row adds a price. Every row goes through
// addPrice / updatePrice, so validation and the overlap rule are exactly
// those of the screen. A failing row is reported and never stops the rest.
// dryRun checks the whole file and saves nothing.
import { parseCsvUpload } from "../../../core/platform/data-exchange/csv.js";
import { isXlsxFileName, parseXlsxUpload } from "../../../core/platform/data-exchange/xlsx.js";
import { requirePriceListPermission } from "./access.js";
import { PRICE_LIST_PERMISSIONS, PriceListError, text } from "./constants.js";
import { addPrice, updatePrice } from "./entries.js";
import { recordPriceListHistory } from "./history.js";
import { loadPriceListRow } from "./records.js";

const ROW_LIMIT = 10000;
export const PRICE_IMPORT_FIELDS = Object.freeze([
  { key: "productCode", label: "Product Code", aliases: ["code", "item code", "product", "sku", "item"], sample: "ERP-CRM" },
  { key: "productName", label: "Product Name", aliases: ["name", "item name", "description"], sample: "ERP CRM Module" },
  { key: "uom", label: "UOM", aliases: ["unit", "unit of measure", "uom code"], sample: "LIC" },
  { key: "unitPrice", label: "Unit Price", aliases: ["price", "rate", "list price"], sample: "2000" },
  { key: "validFrom", label: "Valid From", aliases: ["from", "start date", "effective from"], sample: "" },
  { key: "validTo", label: "Valid Until", aliases: ["valid to", "until", "to", "end date"], sample: "" },
]);
const FIELD_BY_KEY = new Map(PRICE_IMPORT_FIELDS.map((field) => [field.key, field]));
const headerKey = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function csvCell(value) {
  let cell = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}
const toCsv = (rows) => `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
const parseUpload = (bytes, fileName) => (isXlsxFileName(fileName) ? parseXlsxUpload(bytes, { maxRows: ROW_LIMIT }) : parseCsvUpload(bytes, { maxRows: ROW_LIMIT }));

export function buildPriceImportTemplate() {
  return toCsv([PRICE_IMPORT_FIELDS.map((field) => field.label), PRICE_IMPORT_FIELDS.map((field) => field.sample)]);
}

function suggestMapping(headers) {
  const mapping = {};
  const taken = new Set();
  for (const header of headers) {
    const key = headerKey(header);
    const field = PRICE_IMPORT_FIELDS.find((entry) => !taken.has(entry.key) && (headerKey(entry.label) === key || headerKey(entry.key) === key || entry.aliases.includes(key)));
    if (field) { mapping[header] = field.key; taken.add(field.key); }
  }
  return mapping;
}

export async function analyzePriceImport(client, context, priceListId, { bytes, fileName }) {
  requirePriceListPermission(context, PRICE_LIST_PERMISSIONS.import, "You do not have permission to import prices.");
  await loadPriceListRow(client, context, priceListId);
  const parsed = parseUpload(bytes, fileName);
  return {
    fileName, headers: parsed.headers, rowCount: parsed.rowCount ?? parsed.records.length, sampleRows: parsed.records.slice(0, 5),
    suggestedMapping: suggestMapping(parsed.headers), fields: PRICE_IMPORT_FIELDS.map(({ key, label }) => ({ key, label })),
  };
}

// Spreadsheets give dates as 2026-01-31, 31/01/2026 or 31-01-2026.
function readDate(value) {
  const raw = text(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(raw);
  if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  throw new PriceListError(400, `“${raw}” is not a date. Use YYYY-MM-DD or DD/MM/YYYY.`, "SALES_PRICE_IMPORT_ROW");
}

export async function importPrices(client, context, priceListId, { bytes, fileName, mapping = {}, dryRun = false }) {
  requirePriceListPermission(context, PRICE_LIST_PERMISSIONS.import, "You do not have permission to import prices.");
  requirePriceListPermission(context, PRICE_LIST_PERMISSIONS.managePrices, "You do not have permission to change prices.");
  const list = await loadPriceListRow(client, context, priceListId);
  const parsed = parseUpload(bytes, fileName);
  const unknown = Object.keys(mapping).filter((header) => !parsed.headers.includes(header));
  if (unknown.length) throw new PriceListError(400, `The file has no column named "${unknown[0]}".`, "SALES_PRICE_IMPORT_MAPPING");
  for (const required of ["productCode", "unitPrice"])
    if (!Object.values(mapping).includes(required)) throw new PriceListError(400, `Map the ${FIELD_BY_KEY.get(required).label} column.`, "SALES_PRICE_IMPORT_MAPPING");

  const products = new Map();
  // A product is named by its SKU or by any of its live barcodes.
  for (const row of (await client.query(`SELECT id, code FROM tenant.items WHERE organization_id = $1`, [context.organizationId])).rows) products.set(row.code.toUpperCase(), row.id);
  for (const row of (await client.query(`SELECT item_id, value FROM tenant.item_identifiers WHERE organization_id = $1 AND status = 'active'`, [context.organizationId])).rows)
    products.set(row.value.toUpperCase(), products.get(row.value.toUpperCase()) ?? row.item_id);
  const units = new Map();
  for (const row of (await client.query(`SELECT id, code, name FROM tenant.units_of_measure WHERE organization_id = $1 AND status = 'active'`, [context.organizationId])).rows) {
    units.set(row.code.toLowerCase(), row.id);
    units.set(row.name.toLowerCase(), units.get(row.name.toLowerCase()) ?? row.id);
  }
  const results = [];
  await client.query("SAVEPOINT price_import");
  for (const [index, record] of parsed.records.entries()) {
    const rowNumber = index + 2;
    const values = {};
    for (const [header, key] of Object.entries(mapping)) if (FIELD_BY_KEY.has(key)) values[key] = text(record[header]);
    const name = [values.productCode, values.uom].filter(Boolean).join(" · ") || null;
    await client.query("SAVEPOINT price_import_row");
    try {
      if (!values.productCode) throw new PriceListError(400, "The product code is missing.", "SALES_PRICE_IMPORT_ROW");
      const productId = products.get(values.productCode.toUpperCase());
      if (!productId) throw new PriceListError(400, `Product ${values.productCode} was not found.`, "SALES_PRICE_IMPORT_ROW");
      let uomId = null;
      if (values.uom) {
        uomId = units.get(values.uom.toLowerCase());
        if (!uomId) throw new PriceListError(400, `Unit ${values.uom} was not found.`, "SALES_PRICE_IMPORT_ROW");
      } else uomId = (await client.query(`SELECT uom_id FROM tenant.items WHERE organization_id = $1 AND id = $2`, [context.organizationId, productId])).rows[0].uom_id;
      const validFrom = readDate(values.validFrom);
      const validTo = readDate(values.validTo);
      const existing = (await client.query(
        `SELECT id, rate, valid_to::text AS valid_to FROM tenant.price_list_items
          WHERE organization_id = $1 AND price_list_id = $2 AND item_id = $3 AND uom_id = $4 AND status = 'active' AND valid_from IS NOT DISTINCT FROM $5::date`,
        [context.organizationId, list.id, productId, uomId, validFrom])).rows[0];
      if (existing) {
        if (Number(existing.rate) === Number(text(values.unitPrice).replace(/[,\s]/g, "")) && (existing.valid_to ?? null) === validTo) {
          results.push({ rowNumber, name, outcome: "unchanged", message: "Same price as now." });
        } else {
          await updatePrice(client, context, list.id, existing.id, { unitPrice: values.unitPrice, validTo });
          results.push({ rowNumber, name, outcome: "updated", message: `Price ${Number(existing.rate)} → ${values.unitPrice}.` });
        }
      } else {
        await addPrice(client, context, list.id, { productId, uomId, unitPrice: values.unitPrice, validFrom, validTo });
        results.push({ rowNumber, name, outcome: "added", message: `Added at ${values.unitPrice}.` });
      }
      await client.query("RELEASE SAVEPOINT price_import_row");
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT price_import_row");
      if (!error?.status || error.status >= 500) throw error;
      results.push({ rowNumber, name, outcome: "failed", message: error.message });
    }
  }
  const count = (outcome) => results.filter((result) => result.outcome === outcome).length;
  const summary = { added: count("added"), updated: count("updated"), unchanged: count("unchanged"), failed: count("failed") };
  if (dryRun) await client.query("ROLLBACK TO SAVEPOINT price_import");
  else if (summary.added + summary.updated > 0)
    await recordPriceListHistory(client, context, list.id, "imported", `Import of ${fileName}: ${summary.added} added, ${summary.updated} changed, ${summary.failed} not imported`, { changes: summary });
  await client.query("RELEASE SAVEPOINT price_import");
  return { dryRun: Boolean(dryRun), total: results.length, ...summary, results };
}

export function buildPriceImportErrorFile(results) {
  return toCsv([["Row", "Product / Unit", "Reason"], ...results.filter((result) => result.outcome === "failed").map((result) => [result.rowNumber, result.name ?? "", result.message])]);
}

// The whole list in the import format, so it can be edited and re-imported.
// state: active (default: every active price) | current | all.
export async function exportPrices(client, context, priceListId, { state = "active" } = {}) {
  requirePriceListPermission(context, PRICE_LIST_PERMISSIONS.export, "You do not have permission to export prices.");
  const list = await loadPriceListRow(client, context, priceListId);
  const { rows } = await client.query(
    `SELECT item.code, item.name, uom.code AS uom_code, entry.rate, entry.valid_from::text AS valid_from, entry.valid_to::text AS valid_to, entry.status
       FROM tenant.price_list_items entry
       JOIN tenant.items item ON item.organization_id = entry.organization_id AND item.id = entry.item_id
       LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = entry.organization_id AND uom.id = entry.uom_id
      WHERE entry.organization_id = $1 AND entry.price_list_id = $2
        AND ($3 = 'all' OR entry.status = 'active')
        AND ($3 <> 'current' OR ((entry.valid_from IS NULL OR entry.valid_from <= current_date) AND (entry.valid_to IS NULL OR entry.valid_to >= current_date)))
      ORDER BY item.code, uom.code, entry.valid_from NULLS FIRST`,
    [context.organizationId, list.id, ["active", "current", "all"].includes(state) ? state : "active"]);
  const header = [...PRICE_IMPORT_FIELDS.map((field) => field.label), ...(state === "all" ? ["Status"] : [])];
  const body = rows.map((row) => [row.code, row.name, row.uom_code, Number(row.rate), row.valid_from ?? "", row.valid_to ?? "", ...(state === "all" ? [row.status === "active" ? "Active" : "Removed"] : [])]);
  return { fileName: `${list.code.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`, csv: toCsv([header, ...body]), count: rows.length };
}
