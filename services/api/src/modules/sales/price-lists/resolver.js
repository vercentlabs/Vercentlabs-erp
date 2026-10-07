// The one place a sales price is looked up. Quotations, sales orders and
// POS all ask here; none of them reads price list entries on its own.
//
//   Customer -> the customer's price list (when it is active, valid on the
//   document date and in the document's currency)
//            -> otherwise the default price list for the currency
//   Product + unit -> the price valid on the document date
//            -> otherwise the price for the base unit, scaled by the
//               product's conversion
//            -> otherwise the price is missing: never a silent zero. A product
//               carries no price of its own.
//
// Discounts and tax are applied by the document afterwards; the price list
// supplies only the list price and whether it includes tax.
import { PRICE_SOURCES, PriceListError, isUuid, requireUuid, text, today } from "./constants.js";
import { resolveItemUnit } from "../../products/uom.js";

const LIST_COLUMNS = "id, code, name, currency_code, tax_inclusive, is_default";
const toList = (row) => (row ? { id: row.id, code: row.code, name: row.name, currencyCode: row.currency_code.trim(), taxInclusive: row.tax_inclusive, isDefault: row.is_default } : null);
const usable = `price_list_type = 'sales' AND status = 'active' AND currency_code = $3 AND (valid_from IS NULL OR valid_from <= $4::date) AND (valid_to IS NULL OR valid_to >= $4::date)`;

// The price list a document uses. input: priceListId (chosen on the
// document), partyId, currencyCode, documentDate. An explicitly chosen list
// that cannot be used is an error; a customer list that does not fit the
// document falls back to the default.
export async function resolveSalesPriceList(client, context, { priceListId = null, partyId = null, currencyCode, documentDate = today() } = {}) {
  const currency = text(currencyCode).toUpperCase();
  const date = text(documentDate).slice(0, 10) || today();
  if (priceListId) {
    const { rows } = await client.query(`SELECT ${LIST_COLUMNS} FROM tenant.price_lists WHERE organization_id = $1 AND id = $2 AND ${usable}`,
      [context.organizationId, requireUuid(priceListId, "Price list"), currency, date]);
    if (!rows[0]) throw new PriceListError(409, "The chosen price list is inactive, not valid on this date, or in another currency.", "SALES_PRICE_LIST_UNUSABLE");
    return { ...toList(rows[0]), basis: "chosen" };
  }
  if (isUuid(partyId)) {
    const { rows } = await client.query(
      `SELECT ${LIST_COLUMNS} FROM tenant.price_lists WHERE organization_id = $1 AND id = (SELECT default_price_list_id FROM tenant.business_parties WHERE organization_id = $1 AND id = $2) AND ${usable}`,
      [context.organizationId, partyId, currency, date]);
    if (rows[0]) return { ...toList(rows[0]), basis: "customer" };
  }
  const { rows } = await client.query(
    `SELECT ${LIST_COLUMNS} FROM tenant.price_lists
      WHERE organization_id = $1 AND is_default AND price_list_type = 'sales' AND status = 'active' AND currency_code = $2
        AND (valid_from IS NULL OR valid_from <= $3::date) AND (valid_to IS NULL OR valid_to >= $3::date)`,
    [context.organizationId, currency, date]);
  return rows[0] ? { ...toList(rows[0]), basis: "default" } : null;
}

// How many base units one `uomId` holds for the item, or null without a conversion (the shared conversion service).
export async function unitFactor(client, context, itemId, uomId, baseUomId) {
  if (!uomId || uomId === baseUomId) return 1;
  const resolved = await resolveItemUnit(client, context.organizationId, itemId, uomId, { allowInactive: true });
  return resolved.ok ? Number(resolved.unit.factor) : null;
}

const ENTRY_FOR = `SELECT id, rate FROM tenant.price_list_items
  WHERE organization_id = $1 AND price_list_id = $2 AND item_id = $3 AND uom_id = $4 AND status = 'active'
    AND (valid_from IS NULL OR valid_from <= $5::date) AND (valid_to IS NULL OR valid_to >= $5::date)
  ORDER BY valid_from DESC NULLS LAST LIMIT 1`;

// The price comes from the price list only — an item carries no price of its own. Without a matching row the price is missing and the
// user enters one.
// input: priceList (from resolveSalesPriceList, or null), itemId,
// uomId (the document's unit; base unit when empty), documentDate.
// Returns { listPrice (a decimal string, per `uomId`), source, entryId,
// priceList, uomId, factor, missing, message }.
export async function resolveSalesPrice(client, context, { priceList = null, itemId, uomId = null, documentDate = today() } = {}) {
  const item = (await client.query(`SELECT id, code, name, uom_id FROM tenant.items WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, requireUuid(itemId, "Product")])).rows[0];
  if (!item) throw new PriceListError(404, "Product not found.", "PRODUCT_NOT_FOUND");
  const unit = uomId || item.uom_id;
  const factor = await unitFactor(client, context, item.id, unit, item.uom_id);
  if (factor === null) throw new PriceListError(409, `${item.name} has no conversion to its base unit for this unit.`, "SALES_UOM_NO_CONVERSION");
  const date = text(documentDate).slice(0, 10) || today();
  const result = (listPrice, source, entryId = null) => ({ listPrice: String(listPrice), source, entryId, priceList, uomId: unit, factor, missing: false, message: null });
  if (priceList) {
    const exact = (await client.query(ENTRY_FOR, [context.organizationId, priceList.id, item.id, unit, date])).rows[0];
    if (exact) return result(exact.rate, PRICE_SOURCES.priceList, exact.id);
    if (unit !== item.uom_id) {
      const base = (await client.query(ENTRY_FOR, [context.organizationId, priceList.id, item.id, item.uom_id, date])).rows[0];
      if (base) return result(Number(base.rate) * factor, PRICE_SOURCES.priceListBaseUnit, base.id);
    }
  }
  return {
    listPrice: "0", source: PRICE_SOURCES.missing, entryId: null, priceList, uomId: unit, factor, missing: true,
    message: priceList ? `No price found for ${item.name} in ${priceList.name}.` : `No price found for ${item.name}: there is no price list for this currency.`,
  };
}
