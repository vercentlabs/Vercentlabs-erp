// Supplier Rates (Procurement report H1): each supplier's price list for the items it sells — the rate (in a unit, from a minimum quantity,
// in a currency, for a period), the supplier's own item code, the lead time, and whether this supplier is the preferred one for the item.
// They price new order lines after a rate contract (pricing.js), show in the item picker, and tell reorder and make-to-order whom to buy
// from. Kept in tenant.procurement_supplier_prices (the baseline table that had no screen); one preferred supplier per item at a time.
import { decimal, formatDecimal } from "../../../core/decimal.js";
import { parseCsvUpload } from "../../../core/platform/data-exchange/csv.js";
import { isXlsxFileName, parseXlsxUpload } from "../../../core/platform/data-exchange/xlsx.js";
import { normalizeQuantityToBase } from "../../products/uom.js";
import { assertSupplierUsable } from "../suppliers/defaults.js";
import { poCan, requirePoAccess, requirePoPermission } from "../purchase-orders/access.js";
import { PO_PERMISSIONS, PurchaseOrderError, dayOf, fail, isUuid, optionalUuid, readDate, requireUuid, text } from "../purchase-orders/constants.js";
import { translated } from "../purchase-orders/document.js";
import { databaseToday } from "../org-day.js";
import { pagedList } from "../paging.js";

export const SUPPLIER_RATE_VIEWS = Object.freeze([
  { key: "active", label: "Current" }, { key: "preferred", label: "Preferred" }, { key: "ended", label: "Ended" }, { key: "inactive", label: "Switched off" }, { key: "all", label: "All" },
]);
const dec = (value) => (value === null || value === undefined ? null : formatDecimal(value));
const MONEY = /^\d+(\.\d{1,6})?$/;
const QUANTITY = /^\d+(\.\d{1,6})?$/;

const SELECT = `
  SELECT price.*, btrim(price.currency_code) AS currency, item.code AS item_code, item.name AS item_name, uom.code AS uom_code, party.display_name AS supplier_name,
         supplier.supplier_number
    FROM tenant.procurement_supplier_prices price
    JOIN tenant.items item ON item.organization_id = price.organization_id AND item.id = price.item_id
    JOIN tenant.procurement_suppliers supplier ON supplier.organization_id = price.organization_id AND supplier.id = price.supplier_id
    JOIN tenant.business_parties party ON party.organization_id = supplier.organization_id AND party.id = supplier.party_id
    LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = price.organization_id AND uom.id = price.uom_id`;

const view = (row, today) => ({
  id: row.id, supplierId: row.supplier_id, supplierName: row.supplier_name, supplierNumber: row.supplier_number, productId: row.item_id, productCode: row.item_code,
  productName: row.item_name, uomId: row.uom_id, uomCode: row.uom_code, rate: dec(row.rate), minimumQuantity: dec(row.minimum_quantity), currencyCode: row.currency,
  validFrom: dayOf(row.valid_from), validTo: dayOf(row.valid_to), supplierItemCode: row.supplier_item_code ?? null, leadTimeDays: row.lead_time_days ?? null,
  preferred: Boolean(row.is_preferred), notes: row.notes ?? null, status: row.status,
  state: row.status !== "active" ? "inactive" : row.valid_to && dayOf(row.valid_to) < today ? "ended" : dayOf(row.valid_from) > today ? "scheduled" : "current",
  updatedAt: row.updated_at,
});

// filters: view, supplierId, itemId, search (item, supplier, supplier's item code), limit, offset.
export async function listSupplierRates(client, context, filters = {}) {
  requirePoAccess(context);
  const today = await databaseToday(client, context.organizationId);
  const values = [context.organizationId, today];
  const bind = (value) => `$${values.push(value)}`;
  let where = " WHERE price.organization_id = $1";
  const chosen = SUPPLIER_RATE_VIEWS.some((entry) => entry.key === filters.view) ? filters.view : "active";
  const current = " AND price.status = 'active' AND price.valid_from <= $2::date AND (price.valid_to IS NULL OR price.valid_to >= $2::date)";
  if (chosen === "active") where += current;
  else if (chosen === "preferred") where += `${current} AND price.is_preferred`;
  else if (chosen === "ended") where += " AND price.status = 'active' AND price.valid_to < $2::date";
  else if (chosen === "inactive") where += " AND price.status = 'inactive'";
  if (isUuid(filters.supplierId)) where += ` AND price.supplier_id = ${bind(filters.supplierId)}`;
  if (isUuid(filters.itemId)) where += ` AND price.item_id = ${bind(filters.itemId)}`;
  const search = text(filters.search, 120);
  if (search) {
    const term = bind(`%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`);
    where += ` AND (item.name ILIKE ${term} OR item.code ILIKE ${term} OR party.display_name ILIKE ${term} OR price.supplier_item_code ILIKE ${term})`;
  }
  return pagedList(client, `${SELECT}${where} ORDER BY item.name, price.is_preferred DESC, price.rate, price.minimum_quantity`, values, filters, (row) => view(row, today));
}

export async function getSupplierRate(client, context, rateId) {
  requirePoAccess(context);
  const row = (await client.query(`${SELECT} WHERE price.organization_id = $1 AND price.id = $2`, [context.organizationId, requireUuid(rateId, "Supplier rate")])).rows[0];
  if (!row) throw new PurchaseOrderError(404, "Supplier rate not found.", "SUPPLIER_RATE_NOT_FOUND");
  return { rate: view(row, await databaseToday(client, context.organizationId)), actions: { edit: poCan(context, PO_PERMISSIONS.create) } };
}

async function readInput(client, context, input, current = null) {
  const supplierId = requireUuid(input.supplierId ?? current?.supplier_id, "Supplier");
  if (!current || supplierId !== current.supplier_id) await translated(() => assertSupplierUsable(client, context.organizationId, supplierId, { purpose: "a supplier rate" }));
  const itemId = requireUuid(input.productId ?? input.itemId ?? current?.item_id, "Item");
  const item = (await client.query(`SELECT id, uom_id, purchase_uom_id, status, is_purchasable FROM tenant.items WHERE organization_id = $1 AND id = $2`, [context.organizationId, itemId])).rows[0];
  if (!item || item.status !== "active" || item.is_purchasable === false) fail("Choose an active item that is bought.", "productId", "SUPPLIER_RATE_ITEM_INVALID", 409);
  const uomId = optionalUuid(input.uomId, "Unit") ?? current?.uom_id ?? item.purchase_uom_id ?? item.uom_id;
  const rate = String(input.rate ?? (current ? formatDecimal(current.rate) : "")).trim();
  if (!MONEY.test(rate)) fail("Enter the rate: zero or more.", "rate", "SUPPLIER_RATE_INVALID");
  const minimumQuantity = String(input.minimumQuantity ?? (current ? formatDecimal(current.minimum_quantity) : "1")).trim() || "1";
  if (!QUANTITY.test(minimumQuantity) || decimal(minimumQuantity) <= 0n) fail("The minimum quantity must be more than zero.", "minimumQuantity", "SUPPLIER_RATE_INVALID");
  const unit = await normalizeQuantityToBase(client, context.organizationId, item.id, uomId, decimal(minimumQuantity), { purpose: "purchase" });
  if (!unit.ok) fail(unit.message, "uomId", "SUPPLIER_RATE_UOM_INVALID");
  const supplierCurrency = (await client.query(`SELECT btrim(default_currency) AS code FROM tenant.procurement_suppliers WHERE organization_id = $1 AND id = $2`, [context.organizationId, supplierId])).rows[0]?.code;
  const currencyCode = String(input.currencyCode ?? current?.currency_code ?? supplierCurrency ?? "INR").trim().toUpperCase();
  if (!(await client.query(`SELECT 1 FROM tenant.currencies WHERE organization_id = $1 AND btrim(code) = $2 AND status = 'active'`, [context.organizationId, currencyCode])).rowCount)
    fail("Choose a currency your company uses.", "currencyCode", "SUPPLIER_RATE_CURRENCY_INVALID");
  const validFrom = readDate(input.validFrom, "Valid from") ?? (current ? dayOf(current.valid_from) : await databaseToday(client, context.organizationId));
  const validTo = input.validTo === null || input.validTo === "" ? null : readDate(input.validTo, "Valid to") ?? (current ? dayOf(current.valid_to) : null);
  if (validTo && validTo < validFrom) fail("Valid to is before valid from.", "validTo", "SUPPLIER_RATE_DATES_INVALID");
  const lead = input.leadTimeDays === undefined ? current?.lead_time_days ?? null : input.leadTimeDays === null || input.leadTimeDays === "" ? null : Number(input.leadTimeDays);
  if (lead !== null && (!Number.isInteger(lead) || lead < 0 || lead > 3650)) fail("The lead time is a whole number of days.", "leadTimeDays", "SUPPLIER_RATE_LEAD_INVALID");
  return {
    supplierId, itemId, uomId, rate, minimumQuantity, currencyCode, validFrom, validTo, leadTimeDays: lead,
    supplierItemCode: input.supplierItemCode === undefined ? current?.supplier_item_code ?? null : text(input.supplierItemCode, 80),
    preferred: input.preferred === undefined ? Boolean(current?.is_preferred) : Boolean(input.preferred),
    notes: input.notes === undefined ? current?.notes ?? null : text(input.notes, 1000),
  };
}

// One preferred supplier per item: choosing one clears the others first.
async function keepOnePreferred(client, context, rateId, itemId) {
  await client.query(`UPDATE tenant.procurement_supplier_prices SET is_preferred = false, updated_by = $4, updated_at = now()
      WHERE organization_id = $1 AND item_id = $2 AND id IS DISTINCT FROM $3::uuid AND is_preferred`, [context.organizationId, itemId, rateId, context.userId ?? null]);
}

async function write(client, context, data, id = null) {
  if (data.preferred) await keepOnePreferred(client, context, id, data.itemId);
  try {
    const row = id
      ? (await client.query(
        `UPDATE tenant.procurement_supplier_prices SET supplier_id = $3, item_id = $4, uom_id = $5, rate = $6, minimum_quantity = $7, currency_code = $8, valid_from = $9, valid_to = $10,
            lead_time_days = $11, supplier_item_code = $12, is_preferred = $13, notes = $14, updated_by = $15, updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING id`,
        [context.organizationId, id, data.supplierId, data.itemId, data.uomId, data.rate, data.minimumQuantity, data.currencyCode, data.validFrom, data.validTo, data.leadTimeDays,
          data.supplierItemCode, data.preferred, data.notes, context.userId ?? null])).rows[0]
      : (await client.query(
        `INSERT INTO tenant.procurement_supplier_prices (organization_id, supplier_id, item_id, uom_id, rate, minimum_quantity, currency_code, valid_from, valid_to, lead_time_days,
            supplier_item_code, is_preferred, notes, status, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'active', $14, $14) RETURNING id`,
        [context.organizationId, data.supplierId, data.itemId, data.uomId, data.rate, data.minimumQuantity, data.currencyCode, data.validFrom, data.validTo, data.leadTimeDays,
          data.supplierItemCode, data.preferred, data.notes, context.userId ?? null])).rows[0];
    return row.id;
  } catch (error) {
    if (error?.code === "23505") fail("This supplier already has a rate for the item in that unit, from that quantity and date. Change that one instead.", "productId", "SUPPLIER_RATE_DUPLICATE", 409);
    throw error;
  }
}

// createSupplierRate. input: { supplierId, productId, uomId?, rate, minimumQuantity?, currencyCode?, validFrom?, validTo?, leadTimeDays?, supplierItemCode?, preferred?, notes? }
export async function createSupplierRate(client, context, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.create, "You do not have permission to record supplier rates.");
  const id = await write(client, context, await readInput(client, context, input));
  return { id };
}

export async function updateSupplierRate(client, context, rateId, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.create, "You do not have permission to change supplier rates.");
  const current = (await client.query(`SELECT * FROM tenant.procurement_supplier_prices WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, requireUuid(rateId, "Supplier rate")])).rows[0];
  if (!current) throw new PurchaseOrderError(404, "Supplier rate not found.", "SUPPLIER_RATE_NOT_FOUND");
  await write(client, context, await readInput(client, context, input, current), current.id);
  if (input.active !== undefined) await setSupplierRateActive(client, context, current.id, Boolean(input.active));
  return { id: current.id };
}

// Switched off: kept for its history, no longer used. Switching off the preferred rate leaves the item without a preferred supplier.
export async function setSupplierRateActive(client, context, rateId, active) {
  requirePoPermission(context, PO_PERMISSIONS.create, "You do not have permission to change supplier rates.");
  const row = (await client.query(
    `UPDATE tenant.procurement_supplier_prices price SET status = $3, updated_by = $4, updated_at = now(),
            is_preferred = $3 = 'active' AND price.is_preferred AND NOT EXISTS (SELECT 1 FROM tenant.procurement_supplier_prices other WHERE other.organization_id = price.organization_id
              AND other.item_id = price.item_id AND other.id <> price.id AND other.is_preferred AND other.status = 'active')
      WHERE price.organization_id = $1 AND price.id = $2 RETURNING price.id, price.status`, [context.organizationId, requireUuid(rateId, "Supplier rate"), active ? "active" : "inactive", context.userId ?? null])).rows[0];
  if (!row) throw new PurchaseOrderError(404, "Supplier rate not found.", "SUPPLIER_RATE_NOT_FOUND");
  return { id: row.id, status: row.status };
}

// The supplier's rate for an order line: valid on the date, in the line's unit and the order's currency, the highest minimum quantity the
// line reaches. Returns { id, rate, minimumQuantity, leadTimeDays, supplierItemCode } or null.
export async function supplierRateFor(client, organizationId, { supplierId, itemId, uomId, quantity = null, date, currencyCode = null }) {
  if (!isUuid(supplierId) || !isUuid(itemId)) return null;
  const row = (await client.query(
    `SELECT price.id, price.rate, price.minimum_quantity, price.lead_time_days, price.supplier_item_code FROM tenant.procurement_supplier_prices price
      WHERE price.organization_id = $1 AND price.supplier_id = $2 AND price.item_id = $3 AND price.uom_id IS NOT DISTINCT FROM $4 AND price.status = 'active'
        AND price.valid_from <= $5::date AND (price.valid_to IS NULL OR price.valid_to >= $5::date) AND ($6::text IS NULL OR btrim(price.currency_code) = $6)
        AND ($7::numeric IS NULL OR price.minimum_quantity <= $7::numeric)
      ORDER BY price.minimum_quantity DESC, price.valid_from DESC LIMIT 1`,
    [organizationId, supplierId, itemId, uomId ?? null, date, currencyCode ? String(currencyCode).trim().toUpperCase() : null, quantity === null ? null : formatDecimal(quantity)])).rows[0];
  return row ? { id: row.id, rate: dec(row.rate), minimumQuantity: dec(row.minimum_quantity), leadTimeDays: row.lead_time_days, supplierItemCode: row.supplier_item_code } : null;
}

// Whom to buy an item from: the preferred supplier's current rate, else the lowest current rate. Null when the item has no current rate.
export async function preferredSupplierRate(client, organizationId, itemId, date) {
  const row = (await client.query(
    `SELECT price.supplier_id, price.rate, price.uom_id, btrim(price.currency_code) AS currency_code, price.minimum_quantity, price.lead_time_days, price.is_preferred
       FROM tenant.procurement_supplier_prices price
       JOIN tenant.procurement_suppliers supplier ON supplier.organization_id = price.organization_id AND supplier.id = price.supplier_id AND supplier.status = 'active'
      WHERE price.organization_id = $1 AND price.item_id = $2 AND price.status = 'active' AND price.valid_from <= $3::date AND (price.valid_to IS NULL OR price.valid_to >= $3::date)
      ORDER BY price.is_preferred DESC, price.rate, price.minimum_quantity LIMIT 1`, [organizationId, itemId, date])).rows[0];
  return row ? { supplierId: row.supplier_id, rate: dec(row.rate), uomId: row.uom_id, currencyCode: row.currency_code, minimumQuantity: dec(row.minimum_quantity),
    leadTimeDays: row.lead_time_days, preferred: row.is_preferred } : null;
}

// The supplier's rates on its own page: what it sells and for how much.
export const listRatesForSupplier = (client, context, supplierId, filters = {}) => listSupplierRates(client, context, { ...filters, supplierId, view: filters.view ?? "all" });

// ---------------------------------------------------------------- Import and fill

export const SUPPLIER_RATE_IMPORT_COLUMNS = Object.freeze([
  { key: "supplier", label: "Supplier", hint: "Name or supplier number" }, { key: "item", label: "Item code" }, { key: "unit", label: "Unit", hint: "Empty: the item's purchase unit" },
  { key: "rate", label: "Rate" }, { key: "minimumQuantity", label: "Minimum quantity" }, { key: "currency", label: "Currency" }, { key: "validFrom", label: "Valid from" },
  { key: "validTo", label: "Valid to" }, { key: "leadTimeDays", label: "Lead time (days)" }, { key: "supplierItemCode", label: "Supplier's item code" }, { key: "preferred", label: "Preferred" },
]);
const headerKey = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const COLUMN_BY_HEADER = new Map(SUPPLIER_RATE_IMPORT_COLUMNS.flatMap((column) => [[headerKey(column.label), column.key], [headerKey(column.key), column.key]]));

// importSupplierRates: a CSV or Excel file with the columns above, one rate per row. dryRun checks every row and saves nothing.
// Returns { rows, created, updated, errors: [{ row, message }] }; a row for a supplier, item, unit, quantity and date already recorded updates it.
export async function importSupplierRates(client, context, { bytes, fileName, dryRun = false }) {
  requirePoPermission(context, PO_PERMISSIONS.create, "You do not have permission to import supplier rates.");
  const parsed = isXlsxFileName(fileName) ? parseXlsxUpload(bytes) : parseCsvUpload(bytes);
  const columns = new Map(parsed.headers.map((header) => [header, COLUMN_BY_HEADER.get(headerKey(header))]).filter(([, key]) => key));
  for (const needed of ["supplier", "item", "rate"])
    if (![...columns.values()].includes(needed)) fail(`The file needs a "${SUPPLIER_RATE_IMPORT_COLUMNS.find((column) => column.key === needed).label}" column.`, "file", "SUPPLIER_RATE_IMPORT_COLUMNS");
  const errors = [];
  let created = 0;
  let updated = 0;
  await client.query("SAVEPOINT supplier_rate_import");
  for (const [index, record] of parsed.records.entries()) {
    const values = {};
    for (const [header, key] of columns) { const value = String(record[header] ?? "").replace(/^'(?=[=+\-@])/, "").trim(); if (value) values[key] = value; }
    if (!Object.keys(values).length) continue;
    await client.query("SAVEPOINT supplier_rate_row");
    try {
      const supplier = (await client.query(
        `SELECT supplier.id FROM tenant.procurement_suppliers supplier JOIN tenant.business_parties party ON party.organization_id = supplier.organization_id AND party.id = supplier.party_id
          WHERE supplier.organization_id = $1 AND (lower(party.display_name) = lower($2) OR lower(supplier.supplier_number) = lower($2)) LIMIT 2`, [context.organizationId, values.supplier ?? ""])).rows;
      if (supplier.length !== 1) throw new PurchaseOrderError(400, supplier.length ? `More than one supplier is called "${values.supplier}": use the supplier number.` : `Supplier "${values.supplier}" was not found.`);
      const item = (await client.query(`SELECT id FROM tenant.items WHERE organization_id = $1 AND (lower(code) = lower($2) OR lower(sku) = lower($2)) LIMIT 1`, [context.organizationId, values.item ?? ""])).rows[0];
      if (!item) throw new PurchaseOrderError(400, `Item "${values.item}" was not found.`);
      const unit = values.unit ? (await client.query(`SELECT id FROM tenant.units_of_measure WHERE organization_id = $1 AND lower(code) = lower($2) LIMIT 1`, [context.organizationId, values.unit])).rows[0] : null;
      if (values.unit && !unit) throw new PurchaseOrderError(400, `Unit "${values.unit}" was not found.`);
      const input = { supplierId: supplier[0].id, productId: item.id, uomId: unit?.id, rate: values.rate?.replace(/,/g, ""), minimumQuantity: values.minimumQuantity?.replace(/,/g, ""),
        currencyCode: values.currency, validFrom: values.validFrom, validTo: values.validTo, leadTimeDays: values.leadTimeDays, supplierItemCode: values.supplierItemCode,
        preferred: /^(y|yes|true|1)$/i.test(values.preferred ?? "") };
      const data = await readInput(client, context, input);
      const existing = (await client.query(
        `SELECT id FROM tenant.procurement_supplier_prices WHERE organization_id = $1 AND supplier_id = $2 AND item_id = $3 AND uom_id IS NOT DISTINCT FROM $4 AND minimum_quantity = $5::numeric AND valid_from = $6::date`,
        [context.organizationId, data.supplierId, data.itemId, data.uomId, data.minimumQuantity, data.validFrom])).rows[0];
      await write(client, context, data, existing?.id ?? null);
      if (existing) updated += 1; else created += 1;
      await client.query("RELEASE SAVEPOINT supplier_rate_row");
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT supplier_rate_row");
      errors.push({ row: index + 2, message: error.message });
    }
  }
  // A check run saves nothing: everything it wrote is undone.
  await client.query(dryRun ? "ROLLBACK TO SAVEPOINT supplier_rate_import" : "RELEASE SAVEPOINT supplier_rate_import");
  return { rows: parsed.records.length, created, updated, errors, dryRun: Boolean(dryRun) };
}

// fillSupplierRatesFromOrders: a first price list from the last 12 months of orders — the latest price per supplier, item and unit — for
// the buyer to check. Items that already have a current rate with that supplier are left alone. Returns { created }.
export async function fillSupplierRatesFromOrders(client, context, { months = 12 } = {}) {
  requirePoPermission(context, PO_PERMISSIONS.create, "You do not have permission to record supplier rates.");
  const today = await databaseToday(client, context.organizationId);
  const rows = (await client.query(
    `SELECT DISTINCT ON (po.supplier_id, line.product_id, line.purchase_uom_id) po.supplier_id, line.product_id, line.purchase_uom_id, line.unit_price, btrim(po.currency_code) AS currency_code
       FROM tenant.purchase_order_lines line JOIN tenant.purchase_orders po ON po.organization_id = line.organization_id AND po.id = line.purchase_order_id
       JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.product_id AND item.status = 'active'
      WHERE line.organization_id = $1 AND po.status IN ('confirmed', 'closed') AND line.product_id IS NOT NULL AND line.unit_price > 0 AND po.order_date >= $2::date - ($3::int * interval '1 month')
        AND NOT EXISTS (SELECT 1 FROM tenant.procurement_supplier_prices price WHERE price.organization_id = line.organization_id AND price.supplier_id = po.supplier_id
                         AND price.item_id = line.product_id AND price.status = 'active' AND (price.valid_to IS NULL OR price.valid_to >= $2::date))
      ORDER BY po.supplier_id, line.product_id, line.purchase_uom_id, po.order_date DESC, po.created_at DESC`, [context.organizationId, today, Math.min(Math.max(Number(months) || 12, 1), 36)])).rows;
  let created = 0;
  for (const row of rows) {
    const inserted = await client.query(
      `INSERT INTO tenant.procurement_supplier_prices (organization_id, supplier_id, item_id, uom_id, rate, minimum_quantity, currency_code, valid_from, status, notes, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, 1, $6, $7, 'active', 'From the last order', $8, $8) ON CONFLICT DO NOTHING`,
      [context.organizationId, row.supplier_id, row.product_id, row.purchase_uom_id, row.unit_price, row.currency_code, today, context.userId ?? null]);
    created += inserted.rowCount;
  }
  return { created };
}
