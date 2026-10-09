// Unit conversions in bulk: an export of every item's units (to review or clean up) and an import of the same shape, one row per item and
// unit. Each row goes through the very operations the Units screen uses — addItemUomConversion / updateItemUomConversion — so it meets
// every rule (dimension, precision, serial units, permissions, confirmation of a change on an item in use); nothing bypasses them.
//   SKU | Unit | Conversion to base | Purchasing | Sales | Inventory | Status
import { isXlsxFileName, parseXlsxUpload } from "../../core/platform/data-exchange/xlsx.js";
import { parseCsvUpload } from "../../core/platform/data-exchange/csv.js";
import { requireProductPermission } from "./access.js";
import { PRODUCT_PERMISSIONS as P, ProductError } from "./constants.js";
import { addItemUomConversion, removeItemUomConversion, updateItemUomConversion } from "./conversions.js";
import { toCsv } from "./import-export.js";
import { findItemBySku } from "./sku.js";
import { itemUnits } from "./uom.js";

const ROW_LIMIT = 5000;
export const UOM_CONVERSION_COLUMNS = Object.freeze([
  { key: "sku", label: "SKU", aliases: ["item code", "code", "item sku"] },
  { key: "uom", label: "Unit", aliases: ["uom", "alternate uom", "alternate unit", "unit code"] },
  { key: "factor", label: "Conversion to base", aliases: ["conversion", "factor", "conversion factor", "base units"] },
  { key: "purchasing", label: "Purchasing", aliases: ["purchase", "purchase enabled", "purchasing enabled"] },
  { key: "sales", label: "Sales", aliases: ["sales enabled", "sell"] },
  { key: "inventory", label: "Inventory", aliases: ["inventory enabled", "stock"] },
  { key: "status", label: "Status", aliases: ["active"] },
]);
const headerKey = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const BOOLEAN = new Map([["yes", true], ["y", true], ["true", true], ["1", true], ["no", false], ["n", false], ["false", false], ["0", false]]);

// Every item's units as CSV: base unit and each alternate unit with its conversion, usage and status.
export async function exportItemUomConversions(client, context, { includeInactive = true } = {}) {
  requireProductPermission(context, P.export, "You do not have permission to export items.");
  const { rows: items } = await client.query(
    `SELECT item.id, item.code, item.name, base.code AS base_code FROM tenant.items item JOIN tenant.units_of_measure base ON base.organization_id = item.organization_id AND base.id = item.uom_id
      WHERE item.organization_id = $1 AND NOT item.is_variant_template ORDER BY item.code LIMIT 20000`, [context.organizationId]);
  const yes = (value) => (value ? "Yes" : "No");
  const body = [];
  for (const item of items) {
    for (const unit of await itemUnits(client, context.organizationId, item.id, { includeInactive })) {
      if (unit.source === "standard") continue;
      body.push([item.code, item.name, item.base_code, unit.code, unit.factor, yes(unit.purchasing), yes(unit.sales), yes(unit.inventory),
        unit.isBase ? "Base" : unit.isActive ? "Active" : "Inactive"]);
    }
  }
  const header = ["SKU", "Item", "Base UOM", "Unit", "Conversion to base", "Purchasing", "Sales", "Inventory", "Status"];
  return { fileName: `unit-conversions-${new Date().toISOString().slice(0, 10)}.csv`, csv: toCsv([header, ...body]), count: body.length };
}

export function buildUomConversionTemplate() {
  return toCsv([UOM_CONVERSION_COLUMNS.map((column) => column.label), ["BRG-6205", "BOX", "20", "Yes", "Yes", "Yes", "Active"], ["BRG-6205", "CTN", "200", "Yes", "No", "Yes", "Active"]]);
}

// input: { bytes, fileName, dryRun?, acknowledgeHistory? }. A row whose item already has the unit changes it (a changed conversion on an
// item in use needs acknowledgeHistory, as on the screen); a new unit is added; Status Inactive deactivates it. Each row is applied on its
// own: a failing row is reported and the others still apply. dryRun checks every row and saves nothing.
export async function importItemUomConversions(client, context, { bytes, fileName, dryRun = false, acknowledgeHistory = false } = {}) {
  requireProductPermission(context, P.import, "You do not have permission to import items.");
  requireProductPermission(context, P.manageUnits, "You do not have permission to change an item's units.");
  const parsed = isXlsxFileName(fileName) ? parseXlsxUpload(bytes, { maxRows: ROW_LIMIT }) : parseCsvUpload(bytes, { maxRows: ROW_LIMIT });
  const columns = new Map();
  for (const header of parsed.headers) {
    const key = headerKey(header);
    const column = UOM_CONVERSION_COLUMNS.find((entry) => headerKey(entry.label) === key || entry.key === key || entry.aliases.includes(key));
    if (column && ![...columns.values()].includes(column.key)) columns.set(header, column.key);
  }
  for (const required of ["sku", "uom", "factor"])
    if (![...columns.values()].includes(required)) throw new ProductError(400, `The file needs a ${UOM_CONVERSION_COLUMNS.find((entry) => entry.key === required).label} column.`, "UOM_IMPORT_COLUMNS");
  const units = new Map((await client.query(`SELECT id, upper(code) AS code FROM tenant.units_of_measure WHERE organization_id = $1`, [context.organizationId])).rows.map((row) => [row.code, row.id]));
  const results = [];
  const seen = new Map();
  await client.query("SAVEPOINT uom_import");
  for (const [index, record] of parsed.records.entries()) {
    const rowNumber = index + 2;
    const value = (key) => { const header = [...columns.entries()].find(([, column]) => column === key)?.[0]; return header ? String(record[header] ?? "").trim() : ""; };
    const flag = (key) => { const raw = value(key).toLowerCase(); if (!raw) return undefined; if (!BOOLEAN.has(raw)) throw new ProductError(400, `${key}: use Yes or No.`, "UOM_IMPORT_ROW"); return BOOLEAN.get(raw); };
    await client.query("SAVEPOINT uom_import_row");
    try {
      const sku = value("sku");
      const code = value("uom").toUpperCase();
      if (!sku || !code) throw new ProductError(400, "Give the SKU and the unit.", "UOM_IMPORT_ROW");
      const key = `${sku.toUpperCase()}|${code}`;
      if (seen.has(key)) throw new ProductError(400, `${sku} ${code} is also on row ${seen.get(key)}.`, "UOM_IMPORT_ROW");
      seen.set(key, rowNumber);
      const item = await findItemBySku(client, context, sku);
      if (!item || item.matchedBy !== "sku") throw new ProductError(404, `No item has the SKU ${sku}.`, "UOM_IMPORT_ROW");
      const uomId = units.get(code);
      if (!uomId) throw new ProductError(404, `Unit ${code} is not in the unit list. Add it first.`, "UOM_IMPORT_ROW");
      const current = (await itemUnits(client, context.organizationId, item.itemId, { includeInactive: true })).find((unit) => unit.uomId === uomId);
      if (current?.isBase) {
        if (value("factor") && Number(value("factor")) !== 1) throw new ProductError(400, `${code} is the base unit of ${sku}: its conversion is always 1.`, "INVALID_CONVERSION_FACTOR");
        results.push({ rowNumber, sku, uom: code, outcome: "skipped", message: "The base unit converts as 1." });
      } else {
        const input = { uomId, factor: value("factor"), purchasingEnabled: flag("purchasing"), salesEnabled: flag("sales"), inventoryEnabled: flag("inventory"), acknowledgeHistory };
        const status = value("status").toLowerCase();
        if (current?.source === "item" && current.isActive) {
          await updateItemUomConversion(client, context, item.itemId, current.conversionId, input);
          if (status === "inactive") await removeItemUomConversion(client, context, item.itemId, current.conversionId, { reason: "Imported" });
          results.push({ rowNumber, sku, uom: code, outcome: "updated", message: status === "inactive" ? "Deactivated." : "Updated." });
        } else if (status === "inactive") {
          results.push({ rowNumber, sku, uom: code, outcome: "skipped", message: "Not an active unit of the item." });
        } else {
          await addItemUomConversion(client, context, item.itemId, input);
          results.push({ rowNumber, sku, uom: code, outcome: "created", message: `1 ${code} = ${input.factor} added.` });
        }
      }
      await client.query("RELEASE SAVEPOINT uom_import_row");
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT uom_import_row");
      if (!error?.status || error.status >= 500) throw error;
      results.push({ rowNumber, sku: value("sku"), uom: value("uom"), outcome: "failed", message: error.message, code: error.details?.uomError ?? error.code });
    }
  }
  if (dryRun) await client.query("ROLLBACK TO SAVEPOINT uom_import");
  else await client.query("RELEASE SAVEPOINT uom_import");
  const count = (outcome) => results.filter((result) => result.outcome === outcome).length;
  return { dryRun, total: results.length, created: count("created"), updated: count("updated"), skipped: count("skipped"), failed: count("failed"), results };
}
