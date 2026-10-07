// The one conversion service for units of measure. Every module that turns a quantity in some unit into an item's base unit — purchase
// orders, goods receipts, supplier bills, purchase returns, quotations, sales orders, deliveries, sales returns, price lists and inventory
// movements — asks here, so the meaning of a conversion is fixed in one place:
//
//   conversion_to_base = how many base units one unit holds         (1 BOX = 20 PCS: 20)
//   base quantity      = quantity × conversion_to_base               (7 BOX = 140 PCS)
//   quantity           = base quantity ÷ conversion_to_base          (140 PCS = 7 BOX)
//   base unit price    = unit price ÷ conversion_to_base             (₹1,000 / BOX = ₹50 / PCS)
//
// An item can be counted in its base unit (factor 1), in any unit it has its own active conversion for, and in a unit of the same
// dimension as its base with a standard conversion (an item kept in KG is also counted in G). Arithmetic is decimal (core/decimal.js,
// six places); a quantity that does not fit a unit's precision, or a conversion that would lose material, is refused, never rounded away.
import { decimal, div, formatDecimal, mul, roundMoney } from "../../core/decimal.js";

export const UOM_PURPOSES = Object.freeze(["purchase", "sales", "inventory"]);
const MEASURES = new Set(["weight", "volume", "length", "area", "time"]);
const SCALE = 1_000_000n;

// The standard same-dimension conversions (shared reference data; read once per process).
let standardCache = null;
async function standardFactors(client) {
  if (!standardCache) {
    const { rows } = await client.query(`SELECT code, dimension, factor_to_reference FROM public.uom_standard_conversions`);
    standardCache = new Map(rows.map((row) => [row.code, { dimension: row.dimension, factor: decimal(formatDecimal(decimal(String(row.factor_to_reference).match(/^\d+(?:\.\d{1,6})?/)?.[0] ?? "0"))) }]));
  }
  return standardCache;
}

// ------------------------------------------------------------------ arithmetic

// The factor of a resolved unit, as a scaled decimal.
export const factorOf = (unit) => decimal(unit.factor);
// quantity × conversion_to_base.
export const toBaseQuantity = (quantity, factor) => mul(quantity, factor);
// base quantity ÷ conversion_to_base.
export const fromBaseQuantity = (baseQuantity, factor) => div(baseQuantity, factor);
// unit price ÷ conversion_to_base: the price of one base unit.
export const baseUnitPrice = (unitPrice, factor) => div(unitPrice, factor);
// Whether a quantity fits `places` decimal places.
export const fitsPrecision = (quantity, places) => roundMoney(quantity, places) === decimal(quantity);
// The decimal places a value actually uses.
export function decimalsUsed(value) {
  const fraction = formatDecimal(value, 6).split(".")[1] ?? "";
  return fraction.replace(/0+$/, "").length;
}

// quantity × fromFactor ÷ toFactor, or null when it is not exact to six places (5 PCS as BOX of 12 is 0.41666…: refused, not rounded).
export function exactConversion(quantity, fromFactor, toFactor) {
  const numerator = decimal(quantity) * decimal(fromFactor);
  const denominator = decimal(toFactor);
  if (denominator <= 0n) return null;
  if (numerator % denominator !== 0n) return null;
  return numerator / denominator;
}

// "1 BOX = 20 PCS".
export const conversionText = (code, factor, baseCode) => `1 ${code} = ${formatDecimal(factor).replace(/\.?0+$/, "")} ${baseCode}`;

// The standard factor from `uomId` to `baseUomId` (1 G = 0.001 KG), or null when they are not standard units of one dimension.
export async function standardUnitFactor(client, organizationId, baseUomId, uomId) {
  if (!baseUomId || !uomId || baseUomId === uomId) return null;
  const { rows } = await client.query(`SELECT id, code, category FROM tenant.units_of_measure WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [organizationId, [baseUomId, uomId]]);
  const base = rows.find((row) => row.id === baseUomId);
  const unit = rows.find((row) => row.id === uomId);
  if (!base || !unit || base.category !== unit.category || !MEASURES.has(base.category)) return null;
  const standards = await standardFactors(client);
  const from = standards.get(unit.code);
  const to = standards.get(base.code);
  if (!from || !to || from.dimension !== to.dimension) return null;
  const ratio = exactConversion(SCALE, from.factor, to.factor);
  return ratio && ratio > 0n ? ratio : null;
}

// ------------------------------------------------------------------ an item's units

async function loadItem(client, organizationId, itemOrId) {
  if (itemOrId && typeof itemOrId === "object" && itemOrId.base_code !== undefined) return itemOrId;
  const id = typeof itemOrId === "object" ? itemOrId?.id : itemOrId;
  return (await client.query(
    `SELECT item.id, item.code, item.name, item.uom_id, item.purchase_uom_id, item.sales_uom_id, item.tracking_type, item.item_type,
            base.code AS base_code, base.name AS base_name, base.symbol AS base_symbol, base.category AS base_category, base.decimal_places AS base_decimals
       FROM tenant.items item LEFT JOIN tenant.units_of_measure base ON base.organization_id = item.organization_id AND base.id = item.uom_id
      WHERE item.organization_id = $1 AND item.id = $2`, [organizationId, id])).rows[0] ?? null;
}

// Every unit the item can be counted in, resolved: the base (factor 1), its own conversions (with their usage flags), and the units of
// its base's dimension with a standard conversion that is exact. [{ uomId, code, name, symbol, category, decimals, factor, isBase,
// source: "base" | "item" | "standard", conversionId, purchasing, sales, inventory, isActive, isPurchaseDefault, isSalesDefault, version,
// text }]. Inactive units and conversions only with includeInactive.
export async function itemUnits(client, organizationId, itemOrId, { includeInactive = false } = {}) {
  const item = await loadItem(client, organizationId, itemOrId);
  if (!item || !item.uom_id) return [];
  const { rows } = await client.query(
    `SELECT uom.id, uom.code, uom.name, uom.symbol, uom.category, uom.decimal_places, uom.status AS uom_status,
            conversion.id AS conversion_id, conversion.conversion_factor, conversion.status AS conversion_status, conversion.purchasing_enabled, conversion.sales_enabled,
            conversion.inventory_enabled, conversion.quantity_precision, conversion.version
       FROM tenant.units_of_measure uom
       LEFT JOIN tenant.item_uom_conversions conversion ON conversion.organization_id = uom.organization_id AND conversion.item_id = $2 AND conversion.from_uom_id = uom.id
            AND conversion.to_uom_id = $3 AND (conversion.status = 'active' OR $4::boolean)
      WHERE uom.organization_id = $1 AND (uom.id = $3 OR conversion.id IS NOT NULL OR uom.category = $5)
      ORDER BY uom.code, conversion.status`, [organizationId, item.id, item.uom_id, includeInactive, item.base_category]);
  const standards = await standardFactors(client);
  const baseStandard = standards.get(item.base_code);
  const units = [];
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    const common = {
      uomId: row.id, code: row.code, name: row.name, symbol: row.symbol, category: row.category, uomActive: row.uom_status === "active",
      isPurchaseDefault: row.id === (item.purchase_uom_id ?? item.uom_id), isSalesDefault: row.id === (item.sales_uom_id ?? item.uom_id),
    };
    if (row.id === item.uom_id) {
      seen.add(row.id);
      units.push({ ...common, decimals: Number(row.decimal_places), factor: "1", isBase: true, source: "base", conversionId: null, purchasing: true, sales: true, inventory: true,
        isActive: row.uom_status === "active", version: null, text: `${row.code} (base unit)` });
    } else if (row.conversion_id) {
      seen.add(row.id);
      const factor = decimal(formatDecimal(decimal(String(row.conversion_factor).match(/^\d+(?:\.\d{1,6})?/)?.[0] ?? "0")));
      units.push({ ...common, decimals: row.quantity_precision === null ? Number(row.decimal_places) : Math.min(Number(row.quantity_precision), Number(row.decimal_places)),
        factor: formatDecimal(factor).replace(/\.?0+$/, ""), isBase: false, source: "item", conversionId: row.conversion_id, purchasing: row.purchasing_enabled, sales: row.sales_enabled,
        inventory: row.inventory_enabled, isActive: row.conversion_status === "active" && row.uom_status === "active", conversionStatus: row.conversion_status, version: Number(row.version),
        quantityPrecision: row.quantity_precision === null ? null : Number(row.quantity_precision), text: conversionText(row.code, factor, item.base_code) });
    } else if (baseStandard && MEASURES.has(row.category)) {
      // Same dimension, standard factors on both sides, and an exact ratio: KG item counted in G (1 G = 0.001 KG).
      const own = standards.get(row.code);
      if (!own || own.dimension !== baseStandard.dimension) continue;
      const ratio = exactConversion(SCALE, own.factor, baseStandard.factor);
      if (ratio === null || ratio <= 0n) continue;
      seen.add(row.id);
      units.push({ ...common, decimals: Number(row.decimal_places), factor: formatDecimal(ratio).replace(/\.?0+$/, ""), isBase: false, source: "standard", conversionId: null,
        purchasing: true, sales: true, inventory: true, isActive: row.uom_status === "active", version: null, text: `${conversionText(row.code, ratio, item.base_code)} (standard)` });
    }
  }
  return units.sort((left, right) => (right.isBase - left.isBase) || (decimal(left.factor) < decimal(right.factor) ? -1 : 1));
}

const PURPOSE_FLAG = { purchase: "purchasing", sales: "sales", inventory: "inventory" };
const PURPOSE_LABEL = { purchase: "purchasing", sales: "sales", inventory: "inventory entry" };

// One unit of an item for a purpose: { ok: true, unit, item } or { ok: false, reason, message } with reason "item_not_found" |
// "unit_not_found" | "unit_inactive" | "no_conversion" | "not_enabled". `allowInactive` keeps a unit an existing document already uses.
export async function resolveItemUnit(client, organizationId, itemOrId, uomId, { purpose = null, allowInactive = false } = {}) {
  const item = await loadItem(client, organizationId, itemOrId);
  if (!item) return { ok: false, reason: "item_not_found", message: "The item was not found." };
  const wanted = uomId || item.uom_id;
  const units = await itemUnits(client, organizationId, item, { includeInactive: true });
  const unit = units.find((entry) => entry.uomId === wanted);
  if (!unit) {
    const known = (await client.query(`SELECT code FROM tenant.units_of_measure WHERE organization_id = $1 AND id = $2`, [organizationId, wanted])).rows[0];
    if (!known) return { ok: false, reason: "unit_not_found", message: "The unit of measure was not found.", item };
    return { ok: false, reason: "no_conversion", message: `${item.name} has no conversion from ${known.code} to its base unit ${item.base_code}.`, item };
  }
  if (!unit.isActive && !allowInactive) return { ok: false, reason: "unit_inactive", message: `${unit.code} is no longer in use for ${item.name}.`, item, unit };
  if (purpose && !unit[PURPOSE_FLAG[purpose]] && !allowInactive)
    return { ok: false, reason: "not_enabled", message: `${unit.code} is not enabled for ${PURPOSE_LABEL[purpose]} on ${item.name}.`, item, unit };
  return { ok: true, unit, item };
}

// The units an item may be entered in for a purpose.
export async function allowedItemUnits(client, organizationId, itemOrId, purpose) {
  return (await itemUnits(client, organizationId, itemOrId)).filter((unit) => unit.isActive && (!purpose || unit[PURPOSE_FLAG[purpose]]));
}
export const getAllowedPurchaseUoms = (client, organizationId, item) => allowedItemUnits(client, organizationId, item, "purchase");
export const getAllowedSalesUoms = (client, organizationId, item) => allowedItemUnits(client, organizationId, item, "sales");
export const getAllowedInventoryUoms = (client, organizationId, item) => allowedItemUnits(client, organizationId, item, "inventory");

// A quantity entered in a unit, checked and converted: { ok: true, quantity, baseQuantity, factor, unit } (scaled decimals) or
// { ok: false, reason, message }. Checks the unit's precision, that the base quantity fits the base unit's precision (no material lost)
// and, for a serial-numbered item, that it is a whole number of units.
export async function normalizeQuantityToBase(client, organizationId, itemOrId, uomId, quantity, { purpose = null, allowInactive = false } = {}) {
  const resolved = await resolveItemUnit(client, organizationId, itemOrId, uomId, { purpose, allowInactive });
  if (!resolved.ok) return resolved;
  const { unit, item } = resolved;
  let amount;
  try { amount = decimal(quantity); } catch { return { ok: false, reason: "quantity_invalid", message: "Enter the quantity as a number." }; }
  if (!fitsPrecision(amount, unit.decimals))
    return { ok: false, reason: "precision", message: `${unit.code} allows ${unit.decimals} decimal place${unit.decimals === 1 ? "" : "s"}${unit.decimals === 0 ? " (whole numbers only)" : ""}.`, unit };
  const factor = factorOf(unit);
  const baseQuantity = toBaseQuantity(amount, factor);
  const exact = exactConversion(amount, factor, decimal(1));
  if (exact === null || exact !== baseQuantity) return { ok: false, reason: "conversion_loss", message: `${formatDecimal(amount)} ${unit.code} cannot be converted exactly.`, unit };
  const baseDecimals = Number(item.base_decimals ?? 6);
  if (!fitsPrecision(baseQuantity, baseDecimals))
    return { ok: false, reason: "base_precision", message: `${formatDecimal(amount).replace(/\.?0+$/, "")} ${unit.code} is ${formatDecimal(baseQuantity).replace(/\.?0+$/, "")} ${item.base_code}, but ${item.base_code} allows ${baseDecimals} decimal place${baseDecimals === 1 ? "" : "s"}.`, unit };
  if (item.tracking_type === "serial" && baseQuantity % SCALE !== 0n)
    return { ok: false, reason: "serial_fraction", message: `${item.name} is serial-numbered: ${formatDecimal(amount).replace(/\.?0+$/, "")} ${unit.code} must be a whole number of ${item.base_code}.`, unit };
  return { ok: true, quantity: amount, baseQuantity, factor, unit, item };
}

// The quantity a base quantity is in a unit (a display, or a remaining entitlement in the order's unit).
export async function convertBaseToUom(client, organizationId, itemOrId, uomId, baseQuantity) {
  const resolved = await resolveItemUnit(client, organizationId, itemOrId, uomId, { allowInactive: true });
  if (!resolved.ok) return null;
  return { quantity: fromBaseQuantity(baseQuantity, factorOf(resolved.unit)), exact: exactConversion(baseQuantity, decimal(1), factorOf(resolved.unit)) !== null, unit: resolved.unit };
}

// The price of one base unit for a price per `uomId`.
export async function normalizeUnitPriceToBase(client, organizationId, itemOrId, uomId, unitPrice) {
  const resolved = await resolveItemUnit(client, organizationId, itemOrId, uomId, { allowInactive: true });
  if (!resolved.ok) return null;
  return baseUnitPrice(unitPrice, factorOf(resolved.unit));
}

// The factor from one unit of an item to another (quantity in `fromUomId` × ratio = quantity in `toUomId`), for documents kept in
// another document's unit (a bill in the order's unit). Null when either unit cannot count the item.
export async function unitRatio(client, organizationId, itemOrId, fromUomId, toUomId, { purpose = null } = {}) {
  const from = await resolveItemUnit(client, organizationId, itemOrId, fromUomId, { purpose });
  const to = await resolveItemUnit(client, organizationId, itemOrId, toUomId, { allowInactive: true });
  if (!from.ok || !to.ok) return null;
  return { ratio: div(factorOf(from.unit), factorOf(to.unit)), from: from.unit, to: to.unit };
}

// A quantity in `fromUomId` expressed exactly in `toUomId` (30 PCS against a BOX of 20 line is 1.5 BOX), or the reason it cannot be.
export async function convertBetweenUnits(client, organizationId, itemOrId, quantity, fromUomId, toUomId, { purpose = null } = {}) {
  const from = await normalizeQuantityToBase(client, organizationId, itemOrId, fromUomId, quantity, { purpose });
  if (!from.ok) return from;
  const to = await resolveItemUnit(client, organizationId, from.item, toUomId, { allowInactive: true });
  if (!to.ok) return to;
  const converted = exactConversion(from.quantity, from.factor, factorOf(to.unit));
  if (converted === null)
    return { ok: false, reason: "inexact", message: `${formatDecimal(from.quantity).replace(/\.?0+$/, "")} ${from.unit.code} is not an exact quantity of ${to.unit.code} (1 ${to.unit.code} = ${to.unit.factor} ${from.item.base_code}). Enter it in ${to.unit.code} or in a quantity that converts exactly.` };
  return { ok: true, quantity: converted, baseQuantity: from.baseQuantity, entered: from, target: to.unit };
}

// Dimension rule for a new item conversion: { problem } when it is refused, { needsReason } when it is allowed only with a reason.
// A standard measure converts to a base of its own dimension only by the standard factor and never to a base of another measure
// (1 KG = 5 L is refused); a measure to a count or packaging base (1 M = 20 PCS) is an item-specific business conversion that needs a
// reason; packaging, count and other units map to any base.
export async function validateUomDimension(client, unit, base) {
  const standards = await standardFactors(client);
  const unitStandard = standards.get(unit.code);
  const baseStandard = standards.get(base.code);
  if (MEASURES.has(unit.category) && MEASURES.has(base.category) && unit.category !== base.category)
    return { problem: `${unit.code} measures ${unit.category} and ${base.code} measures ${base.category}: they cannot be converted with a fixed factor.` };
  if (unitStandard && baseStandard && unitStandard.dimension === baseStandard.dimension)
    return { problem: `${unit.code} already converts to ${base.code} by the standard factor; it needs no item conversion.` };
  if (MEASURES.has(unit.category) && !MEASURES.has(base.category))
    return { needsReason: `${unit.code} measures ${unit.category} while ${base.code} is a count: say why this item has a fixed conversion (such as a cut length).` };
  return {};
}
