// Product and service import (CSV / XLSX) and export (CSV).
//
// Import is two steps, both stateless: analyze the file (headers, suggested
// column mapping, sample rows), then run it with the confirmed mapping. Each
// row goes through createProduct, or updateProduct for a row whose code
// already exists when the caller chose to update, so validation, duplicate
// checks, permissions and history are exactly those of the form. Category,
// unit and tax category are matched to existing records by name or code;
// nothing is created from a typo. A failing row is reported with its reason
// and never stops the rest. `dryRun` checks the whole file and saves nothing.
import { parseCsvUpload } from "../../core/platform/data-exchange/csv.js";
import { isXlsxFileName, parseXlsxUpload } from "../../core/platform/data-exchange/xlsx.js";
import { canViewProductCost, requireProductPermission } from "./access.js";
import { PRODUCT_PERMISSIONS, PRODUCT_TYPES, ProductError } from "./constants.js";
import { PRODUCT_SELECT, buildProductListWhere, createProduct, toProduct, updateProduct } from "./records.js";
import { text } from "./validation.js";

const IMPORT_ROW_LIMIT = 5000;
const EXPORT_ROW_LIMIT = 20000;

export const PRODUCT_IMPORT_FIELDS = Object.freeze([
  { key: "code", label: "Code", aliases: ["product code", "item code", "sku code"], sample: "ERP-CRM" },
  { key: "name", label: "Name", aliases: ["product name", "item name", "product", "item", "service"], sample: "ERP CRM Module" },
  { key: "type", label: "Type", aliases: ["product type", "item type"], sample: "Service" },
  { key: "category", label: "Category", aliases: ["group", "item group", "product category"], sample: "ERP Modules" },
  { key: "description", label: "Description", aliases: ["internal description"], sample: "" },
  { key: "salesDescription", label: "Sales Description", aliases: ["sales text"], sample: "Vercentlabs ERP CRM module" },
  { key: "sku", label: "SKU", aliases: [], sample: "" },
  { key: "barcode", label: "Barcode", aliases: ["ean", "upc", "gtin"], sample: "" },
  { key: "baseUom", label: "UOM", aliases: ["base uom", "unit", "base unit", "unit of measure"], sample: "License" },
  { key: "salesUom", label: "Sales UOM", aliases: ["sales unit"], sample: "" },
  { key: "salesUomFactor", label: "Sales UOM Factor", aliases: ["sales conversion"], sample: "" },
  { key: "purchaseUom", label: "Purchase UOM", aliases: ["purchase unit"], sample: "" },
  { key: "purchaseUomFactor", label: "Purchase UOM Factor", aliases: ["purchase conversion"], sample: "" },
  { key: "isSellable", label: "Sellable", aliases: ["can be sold", "sell"], sample: "Yes" },
  { key: "isPurchasable", label: "Purchasable", aliases: ["can be purchased", "buy"], sample: "No" },
  { key: "inventoryTracked", label: "Inventory Tracked", aliases: ["track inventory", "stock tracked", "stock item"], sample: "No" },
  { key: "hsn", label: "HSN", aliases: ["hsn code"], sample: "" },
  { key: "sac", label: "SAC", aliases: ["sac code"], sample: "998313" },
  { key: "taxCategory", label: "Tax Category", aliases: ["tax", "gst category", "tax class"], sample: "" },
  { key: "defaultSalesPrice", label: "Default Sales Price", aliases: ["sales price", "price", "selling price", "mrp"], sample: "2000" },
  { key: "defaultPurchaseCost", label: "Default Purchase Cost", aliases: ["purchase cost", "cost", "purchase price"], sample: "" },
  { key: "status", label: "Status", aliases: ["active"], sample: "Active" },
]);

const FIELD_BY_KEY = new Map(PRODUCT_IMPORT_FIELDS.map((field) => [field.key, field]));
const headerKey = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const TYPE_BY_LABEL = new Map([
  ...PRODUCT_TYPES.flatMap((entry) => [[headerKey(entry.label), entry.code], [headerKey(entry.code), entry.code]]),
  ["stock", "stock"], ["stockable", "stock"], ["inventory", "stock"], ["goods", "stock"], ["product", "stock"], ["non stock", "non_stock"], ["nonstock", "non_stock"],
  ["consumable", "non_stock"], ["service", "service"], ["services", "service"],
]);
const BOOLEAN = new Map([["yes", true], ["y", true], ["true", true], ["1", true], ["no", false], ["n", false], ["false", false], ["0", false]]);

function csvCell(value) {
  let cell = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}
const toCsv = (rows) => `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;

export function buildProductImportTemplate() {
  return toCsv([PRODUCT_IMPORT_FIELDS.map((field) => field.label), PRODUCT_IMPORT_FIELDS.map((field) => field.sample)]);
}

const parseUpload = (bytes, fileName) => (isXlsxFileName(fileName) ? parseXlsxUpload(bytes, { maxRows: IMPORT_ROW_LIMIT }) : parseCsvUpload(bytes, { maxRows: IMPORT_ROW_LIMIT }));

function suggestMapping(headers) {
  const mapping = {};
  const taken = new Set();
  for (const header of headers) {
    const key = headerKey(header);
    const field = PRODUCT_IMPORT_FIELDS.find((entry) => !taken.has(entry.key) && (headerKey(entry.label) === key || headerKey(entry.key) === key || entry.aliases.includes(key)));
    if (field) { mapping[header] = field.key; taken.add(field.key); }
  }
  return mapping;
}

export async function analyzeProductImport(_client, context, { bytes, fileName }) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.import, "You do not have permission to import products.");
  const parsed = parseUpload(bytes, fileName);
  return {
    fileName, headers: parsed.headers, rowCount: parsed.rowCount ?? parsed.records.length, sampleRows: parsed.records.slice(0, 5),
    suggestedMapping: suggestMapping(parsed.headers), fields: PRODUCT_IMPORT_FIELDS.map(({ key, label }) => ({ key, label })),
  };
}

// Matches names and codes to this organisation's records, exactly; a value
// that matches nothing is an error on the row.
async function makeLookups(client, context) {
  const load = async (sql) => (await client.query(sql, [context.organizationId])).rows;
  const index = (rows, label) => {
    const map = new Map();
    for (const row of rows) for (const key of [row.code, row.name]) if (key) map.set(String(key).trim().toLowerCase(), row.id);
    return (value) => {
      const id = map.get(text(value).toLowerCase());
      if (!id) throw new ProductError(400, `${label} “${text(value)}” was not found. Add it first or correct the spelling.`, "PRODUCT_IMPORT_ROW");
      return id;
    };
  };
  return {
    category: index(await load(`SELECT id, code, name FROM tenant.item_groups WHERE organization_id = $1 AND status = 'active'`), "Category"),
    uom: index(await load(`SELECT id, code, name FROM tenant.units_of_measure WHERE organization_id = $1 AND status = 'active'`), "Unit of measure"),
    taxCategory: index(await load(`SELECT id, code, name FROM tenant.tax_categories WHERE organization_id = $1 AND status = 'active'`), "Tax category"),
  };
}

function flag(values, key, label) {
  if (!(key in values)) return undefined;
  const value = BOOLEAN.get(text(values[key]).toLowerCase());
  if (value === undefined) throw new ProductError(400, `${label} must be Yes or No.`, "PRODUCT_IMPORT_ROW");
  return value;
}

function rowToInput(values, lookups) {
  const input = {};
  for (const field of ["code", "name", "description", "salesDescription", "sku", "barcode", "salesUomFactor", "purchaseUomFactor", "defaultSalesPrice", "defaultPurchaseCost"])
    if (values[field]) input[field] = values[field];
  const tracked = flag(values, "inventoryTracked", "Inventory Tracked");
  if (values.type) {
    const type = TYPE_BY_LABEL.get(headerKey(values.type));
    if (!type) throw new ProductError(400, `Type “${values.type}” is not valid. Use Stock Item, Non-Stock Item or Service.`, "PRODUCT_IMPORT_ROW");
    input.type = type === "service" ? "service" : tracked === false ? "non_stock" : tracked === true ? "stock" : type;
    if (type === "service" && tracked === true) throw new ProductError(400, "A service cannot be inventory tracked.", "PRODUCT_IMPORT_ROW");
  } else if (tracked !== undefined) input.type = tracked ? "stock" : "non_stock";
  for (const [key, label, field] of [["isSellable", "Sellable", "isSellable"], ["isPurchasable", "Purchasable", "isPurchasable"]]) {
    const value = flag(values, key, label);
    if (value !== undefined) input[field] = value;
  }
  if (values.category) input.categoryId = lookups.category(values.category);
  if (values.baseUom) input.baseUomId = lookups.uom(values.baseUom);
  if (values.salesUom) input.salesUomId = lookups.uom(values.salesUom);
  if (values.purchaseUom) input.purchaseUomId = lookups.uom(values.purchaseUom);
  if (values.taxCategory) input.taxCategoryId = lookups.taxCategory(values.taxCategory);
  // One HSN / SAC column per type: HSN for goods, SAC for services.
  if (values.hsn && values.sac) throw new ProductError(400, "Give either an HSN (goods) or a SAC (services), not both.", "PRODUCT_IMPORT_ROW");
  if (values.sac && input.type && input.type !== "service") throw new ProductError(400, "A SAC is for services. Use the HSN column for goods.", "PRODUCT_IMPORT_ROW");
  if (values.hsn && input.type === "service") throw new ProductError(400, "An HSN is for goods. Use the SAC column for services.", "PRODUCT_IMPORT_ROW");
  if (values.hsn || values.sac) input.hsnSacCode = values.hsn || values.sac;
  if (values.status) {
    const status = { active: "active", inactive: "inactive", yes: "active", no: "inactive" }[text(values.status).toLowerCase()];
    if (!status) throw new ProductError(400, "Status must be Active or Inactive.", "PRODUCT_IMPORT_ROW");
    input.status = status;
  }
  return input;
}

// options: mapping { header: fieldKey }, existing ("skip" | "update"): what to
// do with a row whose code already exists, dryRun.
export async function importProducts(client, context, { bytes, fileName, mapping = {}, existing = "skip", dryRun = false }) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.import, "You do not have permission to import products.");
  requireProductPermission(context, PRODUCT_PERMISSIONS.create, "You do not have permission to create products.");
  if (!["skip", "update"].includes(existing)) throw new ProductError(400, "Choose what to do with existing codes.", "PRODUCT_IMPORT_MAPPING");
  if (existing === "update") requireProductPermission(context, PRODUCT_PERMISSIONS.edit, "You do not have permission to edit products.");
  const parsed = parseUpload(bytes, fileName);
  const unknown = Object.keys(mapping).filter((header) => !parsed.headers.includes(header));
  if (unknown.length) throw new ProductError(400, `The file has no column named "${unknown[0]}".`, "PRODUCT_IMPORT_MAPPING");
  for (const required of ["name", "baseUom"])
    if (!Object.values(mapping).includes(required)) throw new ProductError(400, `Map the ${FIELD_BY_KEY.get(required).label} column.`, "PRODUCT_IMPORT_MAPPING");
  const lookups = await makeLookups(client, context);
  const results = [];
  const seen = new Map();
  await client.query("SAVEPOINT product_import");
  for (const [index, record] of parsed.records.entries()) {
    const rowNumber = index + 2;
    const values = {};
    for (const [header, fieldKey] of Object.entries(mapping)) {
      if (!FIELD_BY_KEY.has(fieldKey)) continue;
      const value = text(record[header]);
      if (value) values[fieldKey] = value;
    }
    const name = values.name ?? null;
    await client.query("SAVEPOINT product_import_row");
    try {
      const input = rowToInput(values, lookups);
      // Two rows of the same file with one code, SKU or barcode.
      for (const field of ["code", "sku", "barcode"]) {
        const key = input[field] ? `${field}:${String(input[field]).toUpperCase()}` : null;
        if (key && seen.has(key)) throw new ProductError(400, `${field.toUpperCase()} ${input[field]} is also on row ${seen.get(key)}.`, "PRODUCT_IMPORT_ROW");
      }
      const match = input.code ? (await client.query(`SELECT id FROM tenant.items WHERE organization_id = $1 AND upper(code) = $2`, [context.organizationId, String(input.code).toUpperCase()])).rows[0] : null;
      if (match && existing === "skip") {
        results.push({ rowNumber, name, outcome: "skipped", productId: match.id, message: `Code ${input.code} already exists.` });
      } else if (match) {
        const { status: _status, code: _code, ...changes } = input;
        const updated = await updateProduct(client, context, match.id, changes);
        results.push({ rowNumber, name, outcome: "updated", productId: updated.id, code: updated.code, message: `Updated ${updated.code}.` });
      } else {
        if (!input.type) input.type = "stock";
        const created = await createProduct(client, context, input, { origin: "import" });
        results.push({ rowNumber, name, outcome: "created", productId: created.id, code: created.code, message: `Created ${created.code}.` });
      }
      for (const field of ["code", "sku", "barcode"]) if (input[field]) seen.set(`${field}:${String(input[field]).toUpperCase()}`, rowNumber);
      await client.query("RELEASE SAVEPOINT product_import_row");
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT product_import_row");
      if (!error?.status || error.status >= 500) throw error;
      results.push({ rowNumber, name, outcome: "failed", message: error.message, field: error.details?.issues?.[0]?.field ?? null });
    }
  }
  if (dryRun) await client.query("ROLLBACK TO SAVEPOINT product_import");
  await client.query("RELEASE SAVEPOINT product_import");
  const count = (outcome) => results.filter((result) => result.outcome === outcome).length;
  return {
    dryRun: Boolean(dryRun), total: results.length, created: count("created"), updated: count("updated"), skipped: count("skipped"), failed: count("failed"),
    results: dryRun ? results.map(({ code: _code, ...result }) => ({ ...result, productId: result.outcome === "created" ? null : result.productId ?? null })) : results,
  };
}

export function buildProductImportErrorFile(results) {
  return toCsv([["Row", "Name", "Result", "Reason"], ...results.filter((result) => ["failed", "skipped"].includes(result.outcome)).map((result) => [result.rowNumber, result.name ?? "", result.outcome, result.message])]);
}

// The list as CSV, with the screen's filters. Cost columns only for callers who may see cost.
export async function exportProducts(client, context, filters = {}) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.export, "You do not have permission to export products.");
  const cost = canViewProductCost(context);
  const { values, sql } = buildProductListWhere(context, filters);
  const { rows } = await client.query(`${PRODUCT_SELECT} ${sql} ORDER BY item.code LIMIT ${EXPORT_ROW_LIMIT + 1}`, values);
  if (rows.length > EXPORT_ROW_LIMIT) throw new ProductError(413, `More than ${EXPORT_ROW_LIMIT} products match. Narrow the filters and export again.`, "PRODUCT_EXPORT_TOO_LARGE");
  const yes = (value) => (value ? "Yes" : "No");
  const header = ["Code", "Name", "Type", "Category", "Description", "Sales Description", "SKU", "Barcode", "UOM", "Sales UOM", "Sales UOM Factor", "Purchase UOM", "Purchase UOM Factor",
    "Sellable", "Purchasable", "Inventory Tracked", "HSN", "SAC", "Tax Category", "GST Rate", "Default Sales Price", ...(cost ? ["Default Purchase Cost", "Standard Cost"] : []), "Status"];
  const body = rows.map((row) => {
    const product = toProduct(row, { cost });
    return [product.code, product.name, product.typeLabel, product.categoryName, product.description, product.salesDescription, product.sku, product.barcode, product.baseUom?.code,
      product.salesUom?.code, product.salesUomFactor === 1 ? "" : product.salesUomFactor, product.purchaseUom?.code, product.purchaseUomFactor === 1 ? "" : product.purchaseUomFactor,
      yes(product.isSellable), yes(product.isPurchasable), yes(product.inventoryTracked), product.isService ? "" : product.hsnSacCode, product.isService ? product.hsnSacCode : "",
      product.taxCategoryName, product.gstRate, product.defaultSalesPrice, ...(cost ? [product.defaultPurchaseCost, product.standardCost] : []), product.isActive ? "Active" : "Inactive"];
  });
  return { fileName: `products-${new Date().toISOString().slice(0, 10)}.csv`, csv: toCsv([header, ...body]), count: rows.length };
}
