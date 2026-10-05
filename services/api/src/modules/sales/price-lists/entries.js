// The prices on a price list. Each entry is a price for one product or
// service in one unit, optionally for a period. Two active entries for the
// same product and unit may not be valid on the same day, so the price on
// any date is never ambiguous; a future price is a second entry that starts
// when the first ends.
import { requirePriceListPermission } from "./access.js";
import { PRICE_LIST_PERMISSIONS, PriceListError, has, optionalDate, requireUuid, text, today } from "./constants.js";
import { recordPriceListHistory } from "./history.js";
import { loadPriceListRow } from "./records.js";

const MAX_PRICE = 1_000_000_000_000;
const NO_PERMISSION = "You do not have permission to change prices.";

const ENTRY_SELECT = `
  SELECT entry.*, entry.valid_from::text AS valid_from_text, entry.valid_to::text AS valid_to_text,
         item.code AS item_code, item.name AS item_name, item.sku AS item_sku, item.item_type, item.status AS item_status, item.uom_id AS base_uom_id,
         category.name AS category_name, uom.code AS uom_code, uom.name AS uom_name, variant.sku AS variant_sku,
         updater.full_name AS updated_by_name
    FROM tenant.price_list_items entry
    JOIN tenant.items item ON item.organization_id = entry.organization_id AND item.id = entry.item_id
    LEFT JOIN tenant.item_groups category ON category.organization_id = item.organization_id AND category.id = item.group_id
    LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = entry.organization_id AND uom.id = entry.uom_id
    LEFT JOIN tenant.item_variants variant ON variant.organization_id = entry.organization_id AND variant.id = entry.variant_id
    LEFT JOIN public.users updater ON updater.id = entry.updated_by`;

function toEntry(row) {
  const date = today();
  const validFrom = row.valid_from_text ?? null;
  const validTo = row.valid_to_text ?? null;
  const state = row.status !== "active" ? "inactive" : validTo && validTo < date ? "expired" : validFrom && validFrom > date ? "future" : "current";
  return {
    id: row.id,
    productId: row.item_id,
    productCode: row.item_code,
    productName: row.item_name,
    sku: row.variant_sku ?? row.item_sku,
    isService: row.item_type === "service",
    productActive: row.item_status === "active",
    categoryName: row.category_name ?? null,
    uomId: row.uom_id,
    uomCode: row.uom_code,
    uomName: row.uom_name,
    isBaseUnit: row.uom_id === row.base_uom_id,
    unitPrice: Number(row.rate),
    validFrom,
    validTo,
    state,
    isActive: row.status === "active",
    updatedByName: row.updated_by_name ?? null,
    updatedAt: row.updated_at,
  };
}

// filters: search (product code, name, SKU, category, unit), state
// (current | future | expired | inactive | all; default: everything active),
// limit, offset.
export async function listPriceListEntries(client, context, priceListId, filters = {}) {
  requirePriceListPermission(context, PRICE_LIST_PERMISSIONS.view, "You do not have permission to view price lists.");
  const list = await loadPriceListRow(client, context, priceListId);
  const values = [context.organizationId, list.id];
  const where = ["entry.organization_id = $1", "entry.price_list_id = $2"];
  if (text(filters.search)) {
    values.push(`%${text(filters.search).toLowerCase().replace(/[\\%_]/g, "\\$&")}%`);
    where.push(`lower(concat_ws(' ', item.code, item.name, item.sku, variant.sku, category.name, uom.code, uom.name)) LIKE $${values.length}`);
  }
  const state = text(filters.state) || "active";
  if (state === "inactive") where.push("entry.status = 'inactive'");
  else if (state !== "all") where.push("entry.status = 'active'");
  if (state === "current") where.push("(entry.valid_from IS NULL OR entry.valid_from <= current_date) AND (entry.valid_to IS NULL OR entry.valid_to >= current_date)");
  if (state === "future") where.push("entry.valid_from > current_date");
  if (state === "expired") where.push("entry.valid_to < current_date");
  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const { rows } = await client.query(
    `${ENTRY_SELECT.replace("SELECT entry.*", "SELECT count(*) OVER () AS total_count, entry.*")} WHERE ${where.join(" AND ")}
      ORDER BY lower(item.name), uom.code, entry.valid_from NULLS FIRST LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  return { entries: rows.map(toEntry), total: Number(rows[0]?.total_count ?? 0), limit, offset };
}

async function loadEntry(client, context, priceListId, entryId) {
  const { rows } = await client.query(`${ENTRY_SELECT} WHERE entry.organization_id = $1 AND entry.price_list_id = $2 AND entry.id = $3`,
    [context.organizationId, priceListId, requireUuid(entryId, "Price")]);
  if (!rows[0]) throw new PriceListError(404, "Price not found.", "SALES_PRICE_LIST_ENTRY_NOT_FOUND");
  return rows[0];
}

const issue = (field, message, code = "SALES_PRICE_LIST_VALIDATION", status = 400) => new PriceListError(status, message, code, { issues: [{ field, message }] });

function readPrice(value) {
  if (value === null || value === undefined || text(value) === "") throw issue("unitPrice", "Enter the price.");
  const price = Number(text(value).replace(/[,\s₹$€£]/g, ""));
  if (!Number.isFinite(price) || price < 0 || price > MAX_PRICE) throw issue("unitPrice", "Enter a price of zero or more.");
  return price;
}

// The product must be an active, sellable product of this organisation, and
// the unit its base unit or one it converts to.
async function checkProductAndUnit(client, context, itemId, uomId) {
  const item = (await client.query(`SELECT id, code, name, uom_id, status, is_sellable FROM tenant.items WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, requireUuid(itemId, "Product")])).rows[0];
  if (!item) throw issue("productId", "Choose a product or service from the catalogue.");
  if (item.status !== "active") throw issue("productId", `${item.name} is inactive.`);
  if (!item.is_sellable) throw issue("productId", `${item.name} is not sold, so it cannot be on a sales price list.`);
  const unit = uomId ? requireUuid(uomId, "Unit") : item.uom_id;
  if (unit !== item.uom_id) {
    const { rows } = await client.query(
      `SELECT 1 FROM tenant.item_uom_conversions WHERE organization_id = $1 AND item_id = $2 AND status = 'active'
          AND ((from_uom_id = $3 AND to_uom_id = $4) OR (from_uom_id = $4 AND to_uom_id = $3)) LIMIT 1`,
      [context.organizationId, item.id, unit, item.uom_id]);
    if (!rows[0]) throw issue("uomId", `${item.name} has no conversion between this unit and its base unit. Add one on the product first.`);
  }
  return { item, uomId: unit };
}

// Refuses a price that would be valid on the same day as another active
// price for the same product and unit.
async function assertNoOverlap(client, context, priceListId, itemId, uomId, validFrom, validTo, exceptId = null) {
  const { rows } = await client.query(
    `SELECT entry.id, entry.rate, entry.valid_from::text AS valid_from, entry.valid_to::text AS valid_to
       FROM tenant.price_list_items entry
      WHERE entry.organization_id = $1 AND entry.price_list_id = $2 AND entry.item_id = $3 AND entry.uom_id = $4 AND entry.variant_id IS NULL AND entry.status = 'active'
        AND ($7::uuid IS NULL OR entry.id <> $7)
        AND COALESCE(entry.valid_from, '-infinity'::date) <= COALESCE($6::date, 'infinity'::date)
        AND COALESCE(entry.valid_to, 'infinity'::date) >= COALESCE($5::date, '-infinity'::date)
      LIMIT 1`,
    [context.organizationId, priceListId, itemId, uomId, validFrom, validTo, exceptId]);
  if (rows[0]) {
    const span = [rows[0].valid_from ? `from ${rows[0].valid_from}` : null, rows[0].valid_to ? `until ${rows[0].valid_to}` : null].filter(Boolean).join(" ") || "with no end date";
    throw new PriceListError(409, `This product already has a price of ${Number(rows[0].rate)} in this unit ${span}. End that price first, or give this one dates that do not overlap.`,
      "SALES_PRICE_LIST_ENTRY_OVERLAP", { issues: [{ field: "validFrom", message: "Overlaps another price." }], overlappingEntryId: rows[0].id });
  }
}

// input: productId, uomId (base unit when empty), unitPrice, validFrom, validTo.
export async function addPrice(client, context, priceListId, input = {}, { historyEvent = "price_added" } = {}) {
  requirePriceListPermission(context, PRICE_LIST_PERMISSIONS.managePrices, NO_PERMISSION);
  const list = await loadPriceListRow(client, context, priceListId, { lock: true });
  const { item, uomId } = await checkProductAndUnit(client, context, input.productId, input.uomId);
  const unitPrice = readPrice(input.unitPrice);
  const validFrom = optionalDate(input.validFrom, "validFrom", "Valid from");
  const validTo = optionalDate(input.validTo, "validTo", "Valid until");
  if (validFrom && validTo && validFrom > validTo) throw issue("validTo", "Valid until must be on or after valid from.");
  await assertNoOverlap(client, context, list.id, item.id, uomId, validFrom, validTo);
  const { rows } = await client.query(
    `INSERT INTO tenant.price_list_items (organization_id, price_list_id, item_id, uom_id, minimum_quantity, rate, valid_from, valid_to, status, created_by, updated_by)
     VALUES ($1, $2, $3, $4, 1, $5, $6, $7, 'active', $8, $8) RETURNING id`,
    [context.organizationId, list.id, item.id, uomId, unitPrice, validFrom, validTo, context.userId ?? null],
  );
  const entry = toEntry(await loadEntry(client, context, list.id, rows[0].id));
  if (historyEvent)
    await recordPriceListHistory(client, context, list.id, historyEvent, `${item.code}: ${unitPrice} per ${entry.uomCode}${validFrom ? ` from ${validFrom}` : ""}${validTo ? ` until ${validTo}` : ""}`,
      { entryId: entry.id, itemId: item.id, changes: { unitPrice: { from: null, to: unitPrice }, uom: entry.uomCode, validFrom, validTo } });
  return entry;
}

// input: unitPrice, validFrom, validTo. The product and unit of a price do
// not change: add a new price instead.
export async function updatePrice(client, context, priceListId, entryId, input = {}, { historyEvent = "price_changed" } = {}) {
  requirePriceListPermission(context, PRICE_LIST_PERMISSIONS.managePrices, NO_PERMISSION);
  const list = await loadPriceListRow(client, context, priceListId, { lock: true });
  const current = toEntry(await loadEntry(client, context, list.id, entryId));
  if (!current.isActive) throw new PriceListError(409, "This price was removed. Add a new price instead.", "SALES_PRICE_LIST_ENTRY_INACTIVE");
  if (has(input, "productId") || has(input, "uomId")) throw new PriceListError(409, "The product and unit of a price cannot change. Add a new price instead.", "SALES_PRICE_LIST_FIELD_GOVERNED");
  const next = {
    unitPrice: has(input, "unitPrice") ? readPrice(input.unitPrice) : current.unitPrice,
    validFrom: has(input, "validFrom") ? optionalDate(input.validFrom, "validFrom", "Valid from") : current.validFrom,
    validTo: has(input, "validTo") ? optionalDate(input.validTo, "validTo", "Valid until") : current.validTo,
  };
  if (next.validFrom && next.validTo && next.validFrom > next.validTo) throw issue("validTo", "Valid until must be on or after valid from.");
  const changed = Object.keys(next).filter((field) => String(next[field] ?? "") !== String(current[field] ?? ""));
  if (!changed.length) return current;
  await assertNoOverlap(client, context, list.id, current.productId, current.uomId, next.validFrom, next.validTo, current.id);
  await client.query(`UPDATE tenant.price_list_items SET rate = $4, valid_from = $5, valid_to = $6, updated_by = $7, updated_at = now() WHERE organization_id = $1 AND price_list_id = $2 AND id = $3`,
    [context.organizationId, list.id, current.id, next.unitPrice, next.validFrom, next.validTo, context.userId ?? null]);
  const labels = { unitPrice: "Price", validFrom: "Valid from", validTo: "Valid until" };
  if (historyEvent)
    await recordPriceListHistory(client, context, list.id, historyEvent, `${current.productCode} (${current.uomCode}): ${changed.map((field) => `${labels[field]} ${current[field] ?? "none"} → ${next[field] ?? "none"}`).join(", ")}`,
      { entryId: current.id, itemId: current.productId, changes: Object.fromEntries(changed.map((field) => [field, { label: labels[field], from: current[field] ?? null, to: next[field] ?? null }])) });
  return toEntry(await loadEntry(client, context, list.id, current.id));
}

// Ends a price on a date (by default yesterday, so today it no longer applies).
export async function expirePrice(client, context, priceListId, entryId, input = {}) {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const endsOn = optionalDate(input.validTo, "validTo", "End date") ?? yesterday;
  const current = toEntry(await loadEntry(client, context, requireUuid(priceListId, "Price list"), entryId));
  if (current.validFrom && endsOn < current.validFrom) throw issue("validTo", "A price cannot end before it starts. Remove it instead.");
  const updated = await updatePrice(client, context, priceListId, entryId, { validTo: endsOn }, { historyEvent: null });
  await recordPriceListHistory(client, context, priceListId, "price_expired", `${current.productCode} (${current.uomCode}): price ${current.unitPrice} ends on ${endsOn}`,
    { entryId: current.id, itemId: current.productId, changes: { validTo: { from: current.validTo, to: endsOn } } });
  return updated;
}

// Takes a price off the list. It is kept, inactive, with its history.
export async function removePrice(client, context, priceListId, entryId) {
  requirePriceListPermission(context, PRICE_LIST_PERMISSIONS.managePrices, NO_PERMISSION);
  const list = await loadPriceListRow(client, context, priceListId, { lock: true });
  const current = toEntry(await loadEntry(client, context, list.id, entryId));
  if (!current.isActive) return current;
  await client.query(`UPDATE tenant.price_list_items SET status = 'inactive', updated_by = $4, updated_at = now() WHERE organization_id = $1 AND price_list_id = $2 AND id = $3`,
    [context.organizationId, list.id, current.id, context.userId ?? null]);
  await recordPriceListHistory(client, context, list.id, "price_removed", `${current.productCode} (${current.uomCode}) removed: was ${current.unitPrice}`,
    { entryId: current.id, itemId: current.productId, changes: { unitPrice: { from: current.unitPrice, to: null } } });
  return toEntry(await loadEntry(client, context, list.id, current.id));
}

// The history of one product's prices on this list.
export async function getProductPriceHistory(client, context, priceListId, productId) {
  requirePriceListPermission(context, PRICE_LIST_PERMISSIONS.view, "You do not have permission to view price lists.");
  const list = await loadPriceListRow(client, context, priceListId);
  const { rows } = await client.query(`${ENTRY_SELECT} WHERE entry.organization_id = $1 AND entry.price_list_id = $2 AND entry.item_id = $3 ORDER BY uom.code, entry.valid_from NULLS FIRST, entry.created_at`,
    [context.organizationId, list.id, requireUuid(productId, "Product")]);
  return rows.map(toEntry);
}

