// Units of measure: the organization's list (Piece, Kilogram, Litre, Box …), each with its dimension (count, weight, length …), an
// optional symbol and the decimal places a quantity in it may have — 0 for whole pieces, 3 for kilograms to the gram. Precision may be
// raised at any time; it can only be lowered while no item that has history counts in the unit, because recorded quantities would no
// longer fit. A unit is never deleted: an inactive one stays on every document that used it. Standard units of one dimension convert by
// their standard factor (uom.js); what a box holds is each item's own conversion.
import { requireProductPermission } from "./access.js";
import { PRODUCT_PERMISSIONS, ProductError } from "./constants.js";
import { SKU_PATTERN, has, requireUuid, text } from "./validation.js";

const MANAGE = [PRODUCT_PERMISSIONS.manageUomMaster, "You do not have permission to manage units of measure."];

export const UOM_CATEGORIES = Object.freeze([
  { code: "quantity", label: "Count" }, { code: "weight", label: "Weight" }, { code: "volume", label: "Volume" }, { code: "length", label: "Length" },
  { code: "area", label: "Area" }, { code: "time", label: "Time" }, { code: "packaging", label: "Packaging" }, { code: "other", label: "Other" },
]);
const CATEGORY_CODES = new Set(UOM_CATEGORIES.map((entry) => entry.code));
const issue = (field, message, code = "UOM_VALIDATION", status = 400) => new ProductError(status, message, code, { issues: [{ field, message }] });

const USED_BY_ITEMS = `SELECT count(*)::int FROM tenant.items item WHERE item.organization_id = uom.organization_id
  AND (item.uom_id = uom.id OR item.sales_uom_id = uom.id OR item.purchase_uom_id = uom.id)`;
const toUnit = (row) => ({
  id: row.id, code: row.code, name: row.name, symbol: row.symbol ?? null, category: row.category, dimension: row.category, decimalPlaces: Number(row.decimal_places),
  fractionAllowed: Number(row.decimal_places) > 0, status: row.status, isActive: row.status === "active", itemCount: Number(row.item_count ?? 0),
  standardFactor: row.standard_factor === null || row.standard_factor === undefined ? null : String(Number(row.standard_factor)), standardDimension: row.standard_dimension ?? null,
  version: Number(row.version ?? 1), updatedAt: row.updated_at,
});
const STANDARD = `LEFT JOIN public.uom_standard_conversions standard ON standard.code = uom.code AND standard.dimension = uom.category`;

export async function listUnitsOfMeasure(client, context, { includeInactive = true } = {}) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.view, "You do not have permission to view items.");
  const { rows } = await client.query(
    `SELECT uom.*, (${USED_BY_ITEMS}) AS item_count, standard.factor_to_reference AS standard_factor, standard.dimension AS standard_dimension
       FROM tenant.units_of_measure uom ${STANDARD} WHERE uom.organization_id = $1${includeInactive ? "" : " AND uom.status = 'active'"}
      ORDER BY uom.category, uom.name`, [context.organizationId]);
  return rows.map(toUnit);
}

async function loadUnit(client, context, uomId) {
  const row = (await client.query(`SELECT uom.*, (${USED_BY_ITEMS}) AS item_count FROM tenant.units_of_measure uom WHERE uom.organization_id = $1 AND uom.id = $2 FOR UPDATE OF uom`,
    [context.organizationId, requireUuid(uomId, "Unit")])).rows[0];
  if (!row) throw new ProductError(404, "Unit not found.", "UOM_NOT_FOUND");
  return row;
}

function check(values) {
  if (!values.code || values.code.length > 20 || !SKU_PATTERN.test(values.code)) throw issue("code", "Enter a short code of up to 20 letters or numbers, such as PCS.");
  if (!values.name || values.name.length > 80) throw issue("name", "Enter the unit's name, up to 80 characters.");
  if (!CATEGORY_CODES.has(values.category)) throw issue("category", "Choose what the unit measures.");
  if (!Number.isInteger(values.decimalPlaces) || values.decimalPlaces < 0 || values.decimalPlaces > 6) throw issue("decimalPlaces", "Choose 0 to 6 decimal places.");
  if (values.symbol && values.symbol.length > 12) throw issue("symbol", "Use up to 12 characters, such as kg.");
}

// input: { code, name, symbol, category (the dimension), decimalPlaces }
export async function createUnitOfMeasure(client, context, input = {}) {
  requireProductPermission(context, ...MANAGE);
  const values = { code: text(input.code).toUpperCase(), name: text(input.name), symbol: text(input.symbol) || null, category: text(input.category || input.dimension || "quantity").toLowerCase(),
    decimalPlaces: Number(input.decimalPlaces ?? 0) };
  check(values);
  if ((await client.query(`SELECT 1 FROM tenant.units_of_measure WHERE organization_id = $1 AND upper(code) = $2`, [context.organizationId, values.code])).rows[0])
    throw issue("code", `${values.code} already exists.`, "UOM_DUPLICATE", 409);
  const row = (await client.query(
    `INSERT INTO tenant.units_of_measure (organization_id, code, name, symbol, category, decimal_places, status, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $7) RETURNING *`,
    [context.organizationId, values.code, values.name, values.symbol, values.category, values.decimalPlaces, context.userId ?? null])).rows[0];
  return toUnit(row);
}

// input: { name, symbol, category, decimalPlaces, expectedVersion }. The code is fixed once created (it is printed on documents); the
// dimension is fixed once items use it.
export async function updateUnitOfMeasure(client, context, uomId, input = {}) {
  requireProductPermission(context, ...MANAGE);
  const row = await loadUnit(client, context, uomId);
  if (has(input, "expectedVersion") && input.expectedVersion !== null && input.expectedVersion !== undefined && Number(input.expectedVersion) !== Number(row.version))
    throw new ProductError(409, "Someone else changed this unit after you opened it. Reload it.", "UOM_VERSION_CONFLICT");
  if (has(input, "code") && text(input.code).toUpperCase() !== row.code) throw issue("code", "A unit's code cannot change. Create a new unit instead.", "UOM_CODE_LOCKED", 409);
  const values = {
    code: row.code, name: has(input, "name") ? text(input.name) : row.name, symbol: has(input, "symbol") ? text(input.symbol) || null : row.symbol,
    category: has(input, "category") ? text(input.category).toLowerCase() : row.category,
    decimalPlaces: has(input, "decimalPlaces") ? Number(input.decimalPlaces) : Number(row.decimal_places),
  };
  check(values);
  if (values.category !== row.category && Number(row.item_count) > 0) throw issue("category", "Items already use this unit, so what it measures cannot change.", "UOM_CATEGORY_LOCKED", 409);
  if (values.decimalPlaces < Number(row.decimal_places)) {
    const used = (await client.query(
      `SELECT item.code FROM tenant.items item WHERE item.organization_id = $1 AND item.uom_id = $2
          AND (EXISTS (SELECT 1 FROM tenant.stock_movements movement WHERE movement.organization_id = item.organization_id AND movement.item_id = item.id)
            OR EXISTS (SELECT 1 FROM tenant.purchase_order_lines line WHERE line.organization_id = item.organization_id AND line.product_id = item.id)
            OR EXISTS (SELECT 1 FROM tenant.sales_order_lines line WHERE line.organization_id = item.organization_id AND line.item_id = item.id)) LIMIT 1`,
      [context.organizationId, row.id])).rows[0];
    if (used) throw issue("decimalPlaces", `${used.code} already has quantities recorded in ${row.code}, so its decimal places cannot be reduced.`, "UOM_PRECISION_LOCKED", 409);
  }
  const updated = (await client.query(
    `UPDATE tenant.units_of_measure SET name = $3, category = $4, decimal_places = $5, symbol = $7, version = version + 1, updated_by = $6, updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING *`,
    [context.organizationId, row.id, values.name, values.category, values.decimalPlaces, context.userId ?? null, values.symbol])).rows[0];
  return toUnit({ ...updated, item_count: row.item_count });
}

// An inactive unit is no longer offered for new documents or items; documents that used it keep it. A unit an active item counts in, buys
// or sells in, or still converts, stays active until that is moved.
export async function setUnitOfMeasureStatus(client, context, uomId, status) {
  requireProductPermission(context, ...MANAGE);
  if (!["active", "inactive"].includes(status)) throw issue("status", "Choose Active or Inactive.");
  const row = await loadUnit(client, context, uomId);
  if (status === "inactive") {
    const used = (await client.query(
      `SELECT code FROM tenant.items WHERE organization_id = $1 AND lifecycle_status <> 'inactive' AND (uom_id = $2 OR sales_uom_id = $2 OR purchase_uom_id = $2) LIMIT 1`,
      [context.organizationId, row.id])).rows[0];
    if (used) throw issue("status", `Item ${used.code} still uses ${row.code}.`, "UOM_IN_USE", 409);
    const converted = (await client.query(
      `SELECT item.code FROM tenant.item_uom_conversions conversion JOIN tenant.items item ON item.organization_id = conversion.organization_id AND item.id = conversion.item_id
        WHERE conversion.organization_id = $1 AND conversion.from_uom_id = $2 AND conversion.status = 'active' AND item.lifecycle_status <> 'inactive' LIMIT 1`, [context.organizationId, row.id])).rows[0];
    if (converted) throw issue("status", `Item ${converted.code} still has ${row.code} as one of its units. Deactivate that unit on the item first.`, "UOM_IN_USE", 409);
  }
  const updated = (await client.query(`UPDATE tenant.units_of_measure SET status = $3, version = version + 1, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING *`,
    [context.organizationId, row.id, status, context.userId ?? null])).rows[0];
  return toUnit({ ...updated, item_count: row.item_count });
}
