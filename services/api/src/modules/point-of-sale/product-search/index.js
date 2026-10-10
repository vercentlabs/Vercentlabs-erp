// Product Search (POS, migration 0084): find the right product and add it to the sale in seconds — by name, SKU, barcode or category —
// knowing whether it can be sold here and now, at which price, in which unit, and whether there is stock.
//
// One product identity: everything is read from the shared Item Master (items, barcodes, categories, variants as items of their own, units),
// prices from the shared price lists through the resolver Sales uses, stock from Inventory's eligible positions at the outlet's selling
// warehouse (and the terminal's selling location). Search reads the canonical records through their own indexes, so there is no copy to
// fall behind: a product disabled a second ago cannot be sold from an old result, and every add and checkout checks again.
//
// Ranking is deterministic, never guessed: exact barcode, exact SKU, exact name, SKU prefix (or an earlier SKU), name prefix, every word
// complete, every word partial, then a limited typo-tolerant match (never auto-selected). Within a rank, products this outlet can sell come
// first; then name and id, a stable order the cursor pages through without gaps or repeats.
//
// The context (company, outlet, terminal, cashier, session) is resolved on the server from the person and their open session or cart; an
// outlet is only ever used after its access is verified. Cost, margin and supplier data are never read here.
import { decimal, formatDecimal, mul, div } from "../../../core/decimal.js";
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess } from "../shared/access-control.js";
import { USABLE_ROW } from "../../stock/index.js";
import { itemUnits, normalizeQuantityToBase } from "../../products/uom.js";
import { expandUpcE, validGtinCheckDigit } from "../../products/validation.js";
import { resolveSalesPriceList } from "../../sales/price-lists/resolver.js";
import { applyCustomerPricingRules } from "../assortment-pricing-customer-and-cart/cart-pricing.js";

const MAX_TERM = 100;
const MAX_BARCODE = 64;
const DEFAULT_PAGE = 24;
const MAX_PAGE = 30;
const QUICK_LIMIT = 12;
const SLOW_SEARCH_MS = 350;
const SLOW_BARCODE_MS = 150;
const SUPPORTED_TYPES = new Set(["product", "service", "consumable"]);

export const POS_PRODUCT_MESSAGES = Object.freeze({
  POS_PRODUCT_NOT_FOUND: "Product not found. Try another name or code.",
  POS_PRODUCT_INACTIVE: "This product is no longer available for sale.",
  POS_PRODUCT_NOT_SELLABLE: "This product cannot be sold at POS.",
  POS_PRODUCT_OUTLET_RESTRICTED: "This product is not available at this store.",
  POS_PRODUCT_OUT_OF_STOCK: "This product is out of stock.",
  POS_PRODUCT_INSUFFICIENT_STOCK: "Not enough stock for this quantity.",
  POS_PRODUCT_PRICE_MISSING: "Selling price is not set.",
  POS_PRODUCT_BARCODE_AMBIGUOUS: "Multiple products match this barcode.",
  POS_PRODUCT_UOM_INVALID: "This unit cannot be used for the product.",
  POS_PRODUCT_SELECTION_REQUIRED: "Choose a variant or required tracking details.",
  POS_PRODUCT_CHANGED: "Product details changed. Please review.",
  POS_SEARCH_UNAVAILABLE: "Search is temporarily unavailable. Please retry.",
  POS_SESSION_REQUIRED: "Open a POS session to add products.",
  POS_PERMISSION_DENIED: "You do not have permission for this action.",
});
const BARCODE_NOT_FOUND = "Product not found. Search by name or SKU.";
const BARCODE_INVALID = "Barcode could not be read. Please scan again.";

// What a scanner sent, as the barcode: transport characters (line ends, tabs, other control characters) and surrounding spaces dropped,
// nothing else changed — leading zeros, letters and their case stay.
export function cleanScannedValue(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

const STATUS_OF = {
  POS_PRODUCT_NOT_FOUND: 404, POS_PRODUCT_INACTIVE: 409, POS_PRODUCT_NOT_SELLABLE: 409, POS_PRODUCT_OUTLET_RESTRICTED: 409, POS_PRODUCT_OUT_OF_STOCK: 409,
  POS_PRODUCT_INSUFFICIENT_STOCK: 409, POS_PRODUCT_PRICE_MISSING: 409, POS_PRODUCT_BARCODE_AMBIGUOUS: 409, POS_PRODUCT_UOM_INVALID: 400,
  POS_PRODUCT_SELECTION_REQUIRED: 409, POS_PRODUCT_CHANGED: 409, POS_SEARCH_UNAVAILABLE: 503, POS_SESSION_REQUIRED: 409, POS_PERMISSION_DENIED: 403,
};
export function posProductError(code, details = {}, message = POS_PRODUCT_MESSAGES[code]) {
  const error = posError(STATUS_OF[code] ?? 409, message, code);
  error.details = details;
  return error;
}

const privileged = (context) => Boolean(context.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug)));
const can = (context, permission) => privileged(context) || Boolean(context.permissions?.includes(permission));
const clean = (value, max) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const escapeLike = (value) => value.replace(/[\\%_]/g, (character) => `\\${character}`);
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const trimZeros = (value) => (value.includes(".") ? value.replace(/\.?0+$/, "") : value);
const asText = (value) => trimZeros(formatDecimal(value));

// ------------------------------------------------------------------ context

const SETTINGS_DEFAULTS = Object.freeze({
  assortment_policy: "all_sellable", show_stock_status: true, show_exact_stock_if_authorized: true, low_stock_threshold: "5", suggest_frequent_products: true, version: 0,
});

async function loadOutletSettings(client, organizationId, storeId) {
  const row = (await client.query(`SELECT * FROM tenant.pos_outlet_product_settings WHERE organization_id = $1 AND store_id = $2`, [organizationId, storeId])).rows[0];
  const categories = (await client.query(`SELECT category_id FROM tenant.pos_outlet_assortment_categories WHERE organization_id = $1 AND store_id = $2`,
    [organizationId, storeId])).rows.map((entry) => entry.category_id);
  return { ...SETTINGS_DEFAULTS, ...(row ?? {}), categoryIds: categories };
}

// A category and every category below it.
async function withDescendants(client, organizationId, categoryIds) {
  if (!categoryIds.length) return [];
  const { rows } = await client.query(
    `WITH RECURSIVE tree AS (
       SELECT id FROM tenant.item_groups WHERE organization_id = $1 AND id = ANY($2::uuid[])
       UNION SELECT child.id FROM tenant.item_groups child JOIN tree ON child.parent_id = tree.id WHERE child.organization_id = $1)
     SELECT id FROM tree`, [organizationId, categoryIds]);
  return rows.map((row) => row.id);
}

// Who is selling where: from the cart, else the person's open session, else (to look things up for an outlet they may work at) the outlet
// asked for. Every path verifies outlet access.
export async function resolvePosProductContext(client, context, { cartId = null, outletId = null } = {}) {
  requirePermission(context, "pos.view");
  let source = null;
  if (cartId) {
    source = (await client.query(
      `SELECT cart.id AS cart_id, cart.store_id, cart.terminal_id, cart.shift_id, cart.customer_id, cart.status AS cart_status, shift.status AS shift_status
         FROM tenant.pos_carts cart JOIN tenant.pos_shifts shift ON shift.organization_id = cart.organization_id AND shift.id = cart.shift_id
        WHERE cart.organization_id = $1 AND cart.id = $2`, [context.organizationId, cartId])).rows[0];
    if (!source) throw posError(404, "POS cart was not found.", "POS_CART_NOT_FOUND");
  } else {
    const session = (await client.query(
      `SELECT id AS shift_id, store_id, terminal_id, status AS shift_status FROM tenant.pos_shifts
        WHERE organization_id = $1 AND cashier_user_id = $2 AND status = 'open' ORDER BY opened_at DESC NULLS LAST LIMIT 1`,
      [context.organizationId, context.userId])).rows[0];
    if (session && (!outletId || outletId === session.store_id)) source = session;
    else if (outletId) source = { store_id: outletId, terminal_id: null, shift_id: null, shift_status: null };
    else throw posProductError("POS_SESSION_REQUIRED");
  }
  await assertPosStoreAccess(client, context, source.store_id, source.terminal_id);
  const outlet = (await client.query(
    `SELECT outlet.id, outlet.code, outlet.name, outlet.active, outlet.warehouse_id, outlet.price_list_id, outlet.currency_code,
            COALESCE(terminal.selling_location_id, outlet.selling_location_id) AS location_id
       FROM tenant.pos_stores outlet
       LEFT JOIN tenant.pos_terminals terminal ON terminal.organization_id = outlet.organization_id AND terminal.id = $3
      WHERE outlet.organization_id = $1 AND outlet.id = $2`, [context.organizationId, source.store_id, source.terminal_id])).rows[0];
  if (!outlet) throw posError(404, "POS outlet was not found.", "POS_STORE_NOT_FOUND");
  const settings = await loadOutletSettings(client, context.organizationId, outlet.id);
  const assortment = settings.assortment_policy === "selected_categories" ? await withDescendants(client, context.organizationId, settings.categoryIds) : null;
  let priceList = null;
  if (outlet.price_list_id) {
    try { priceList = await resolveSalesPriceList(client, context, { priceListId: outlet.price_list_id, currencyCode: outlet.currency_code }); } catch { priceList = null; }
  }
  const policy = (await client.query(`SELECT allow_negative_stock FROM tenant.pos_settings WHERE organization_id = $1`, [context.organizationId])).rows[0];
  return {
    organizationId: context.organizationId, outlet, settings, assortment, priceList, currency: outlet.currency_code.trim(),
    cartId: source.cart_id ?? null, terminalId: source.terminal_id ?? null, shiftId: source.shift_id ?? null, sessionOpen: source.shift_status === "open",
    customerId: source.customer_id ?? null, allowNegativeStock: Boolean(policy?.allow_negative_stock),
    showQuantity: Boolean(settings.show_exact_stock_if_authorized) && can(context, "stock.view"),
  };
}

// ------------------------------------------------------------------ reading products

const ITEM_COLUMNS = `item.id, item.code, item.name, item.item_type, item.track_inventory, item.tracking_type, item.uom_id, item.sales_uom_id, item.status,
  item.lifecycle_status, item.is_sellable, item.is_variant_template, item.parent_item_id, item.variant_attributes, item.image_attachment_id, item.version,
  item.sales_description, item.brand, COALESCE(item.group_id, parent.group_id) AS category_id, category.name AS category_name, parent.name AS parent_name`;
const ITEM_JOINS = `LEFT JOIN tenant.items parent ON parent.organization_id = item.organization_id AND parent.id = item.parent_item_id
  LEFT JOIN tenant.item_groups category ON category.organization_id = item.organization_id AND category.id = COALESCE(item.group_id, parent.group_id)`;

async function loadItems(client, organizationId, itemIds) {
  if (!itemIds.length) return [];
  const { rows } = await client.query(`SELECT ${ITEM_COLUMNS} FROM tenant.items item ${ITEM_JOINS} WHERE item.organization_id = $1 AND item.id = ANY($2::uuid[])`,
    [organizationId, itemIds]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return itemIds.map((id) => byId.get(id)).filter(Boolean);
}

const isStockItem = (item) => item.track_inventory && item.item_type !== "service";

// Units, prices and stock for a page of items, in a few batched queries. `entries` = [{ item, uomId? }].
async function decorate(client, context, ctx, entries) {
  if (!entries.length) return [];
  const org = ctx.organizationId;
  const itemIds = [...new Set(entries.map((entry) => entry.item.id))];
  const wantedUnit = (entry) => entry.uomId || entry.item.sales_uom_id || entry.item.uom_id;
  // Conversion factors to the base unit: the item's own conversions first, the shared standard conversions otherwise.
  const conversions = (await client.query(
    `SELECT item_id, from_uom_id, conversion_factor::text AS factor, sales_enabled FROM tenant.item_uom_conversions
      WHERE organization_id = $1 AND item_id = ANY($2::uuid[]) AND status = 'active'`, [org, itemIds])).rows;
  const conversionOf = new Map(conversions.map((row) => [`${row.item_id}:${row.from_uom_id}`, row]));
  const units = new Map();
  for (const entry of entries) {
    const uomId = wantedUnit(entry);
    const key = `${entry.item.id}:${uomId}`;
    if (units.has(key)) continue;
    if (uomId === entry.item.uom_id) { units.set(key, { uomId, factor: decimal(1), ok: true }); continue; }
    const own = conversionOf.get(key);
    if (own) { units.set(key, { uomId, factor: decimal(own.factor.match(/^\d+(?:\.\d{1,6})?/)?.[0] ?? "0"), ok: own.sales_enabled }); continue; }
    const standard = (await itemUnits(client, org, entry.item.id)).find((unit) => unit.uomId === uomId && unit.isActive && unit.sales);
    units.set(key, standard ? { uomId, factor: decimal(standard.factor), ok: true } : { uomId, factor: decimal(1), ok: false });
  }
  const uomIds = [...new Set([...units.values()].map((unit) => unit.uomId).concat(entries.map((entry) => entry.item.uom_id)))];
  const uomRows = (await client.query(`SELECT id, code, name, symbol FROM tenant.units_of_measure WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [org, uomIds])).rows;
  const uomOf = new Map(uomRows.map((row) => [row.id, row]));

  // Prices valid today on the outlet's price list: the unit's own price, else the base unit's price scaled by the conversion.
  const prices = new Map();
  if (ctx.priceList) {
    const { rows } = await client.query(
      `SELECT DISTINCT ON (item_id, uom_id) id, item_id, uom_id, rate::text AS rate FROM tenant.price_list_items
        WHERE organization_id = $1 AND price_list_id = $2 AND item_id = ANY($3::uuid[]) AND status = 'active'
          AND (valid_from IS NULL OR valid_from <= current_date) AND (valid_to IS NULL OR valid_to >= current_date)
        ORDER BY item_id, uom_id, valid_from DESC NULLS LAST`, [org, ctx.priceList.id, itemIds]);
    for (const row of rows) prices.set(`${row.item_id}:${row.uom_id}`, row);
  }

  // Eligible stock at the outlet's selling warehouse (and the terminal's selling location when it has one), in the base unit: on hand less
  // reserved, never held, quarantined, damaged, expired or blocked stock. Another warehouse's stock never counts.
  const stockIds = [...new Set(entries.filter((entry) => isStockItem(entry.item)).map((entry) => entry.item.id))];
  const available = new Map();
  const reorderAt = new Map();
  if (stockIds.length) {
    const values = [org, ctx.outlet.warehouse_id, stockIds];
    if (ctx.outlet.location_id) values.push(ctx.outlet.location_id);
    const { rows } = await client.query(
      `SELECT balance.item_id, COALESCE(sum(CASE WHEN ${USABLE_ROW} THEN greatest(balance.quantity - balance.reserved_quantity, 0) ELSE 0 END), 0)::text AS available
         FROM tenant.stock_balances balance
         LEFT JOIN tenant.warehouse_locations location ON location.organization_id = balance.organization_id AND location.id = balance.warehouse_location_id
         LEFT JOIN tenant.stock_batches batch ON batch.organization_id = balance.organization_id AND batch.id = balance.batch_id
        WHERE balance.organization_id = $1 AND balance.warehouse_id = $2 AND balance.item_id = ANY($3::uuid[])${ctx.outlet.location_id ? " AND balance.warehouse_location_id = $4" : ""}
        GROUP BY balance.item_id`, values);
    for (const row of rows) available.set(row.item_id, decimal(row.available));
    const reorder = await client.query(
      `SELECT item_id, reorder_level_base_quantity::text AS level FROM tenant.inventory_reorder_rules
        WHERE organization_id = $1 AND warehouse_id = $2 AND item_id = ANY($3::uuid[]) AND enabled`, [org, ctx.outlet.warehouse_id, stockIds]);
    for (const row of reorder.rows) reorderAt.set(row.item_id, decimal(row.level));
  }

  const out = [];
  for (const entry of entries) {
    const { item } = entry;
    const unit = units.get(`${item.id}:${wantedUnit(entry)}`);
    const uom = uomOf.get(unit.uomId);
    let price = null;
    let priceEntry = null;
    if (ctx.priceList && unit.ok) {
      const exact = prices.get(`${item.id}:${unit.uomId}`);
      const base = prices.get(`${item.id}:${item.uom_id}`);
      if (exact) { price = decimal(exact.rate); priceEntry = exact.id; }
      else if (base) { price = mul(decimal(base.rate), unit.factor); priceEntry = base.id; }
      if (price !== null && ctx.customerId) price = await applyCustomerPricingRules(client, context, { price_list_id: ctx.priceList.id }, ctx.customerId, item.id, item.category_id, decimal(1), price);
    }
    const tracked = isStockItem(item);
    const availableBase = tracked ? (available.get(item.id) ?? decimal(0)) : null;
    const availableUnits = tracked ? div(availableBase, unit.factor) : null;
    let stockStatus = tracked ? "in_stock" : "not_tracked";
    if (tracked) {
      if (availableUnits < decimal(1)) stockStatus = "out_of_stock";
      else if (reorderAt.has(item.id) ? availableBase <= reorderAt.get(item.id) : availableUnits <= decimal(ctx.settings.low_stock_threshold)) stockStatus = "low_stock";
    }
    const visibleHere = !ctx.assortment || ctx.assortment.includes(item.category_id);
    let reason = null;
    if (item.status !== "active" || item.lifecycle_status !== "active") reason = "POS_PRODUCT_INACTIVE";
    else if (!item.is_sellable || !SUPPORTED_TYPES.has(item.item_type)) reason = "POS_PRODUCT_NOT_SELLABLE";
    else if (item.is_variant_template) reason = "POS_PRODUCT_SELECTION_REQUIRED";
    else if (!visibleHere) reason = "POS_PRODUCT_OUTLET_RESTRICTED";
    else if (!unit.ok || !uom) reason = "POS_PRODUCT_UOM_INVALID";
    else if (price === null) reason = "POS_PRODUCT_PRICE_MISSING";
    else if (stockStatus === "out_of_stock" && !ctx.allowNegativeStock) reason = "POS_PRODUCT_OUT_OF_STOCK";
    const variantLabel = item.parent_item_id ? Object.values(item.variant_attributes ?? {}).map(String).filter(Boolean).join(" / ") || null : null;
    out.push({
      itemId: item.id, variantId: item.parent_item_id ? item.id : null, parentItemId: item.parent_item_id ?? null, parentName: item.parent_name ?? null, variantLabel,
      sku: item.code, name: item.name, brand: item.brand ?? null, description: item.sales_description ?? null,
      imageUrl: item.image_attachment_id ? `/api/pos/products/${item.id}/image` : null,
      categoryId: item.category_id ?? null, categoryName: item.category_name ?? null, itemType: item.track_inventory || item.item_type === "service" ? item.item_type : "non_stock",
      isVariantGroup: Boolean(item.is_variant_template),
      saleUomId: unit.uomId, saleUomCode: uom?.code ?? null, saleUomName: uom?.name ?? null, uomFactor: asText(unit.factor),
      barcodeMatchType: entry.matchType ?? null, matchRank: entry.rank ?? null,
      displayPrice: price === null ? null : asText(price), currency: ctx.currency, taxInclusive: Boolean(ctx.priceList?.taxInclusive),
      // Unavailable for another reason trumps stock; with stock status hidden, only "out of stock" (which blocks adding) is still said.
      stockStatus: reason && reason !== "POS_PRODUCT_OUT_OF_STOCK" ? "unavailable" : ctx.settings.show_stock_status || stockStatus === "out_of_stock" ? stockStatus : null,
      availableQuantity: ctx.showQuantity && tracked ? asText(availableUnits) : null,
      requiresTracking: item.tracking_type === "batch" || item.tracking_type === "serial" ? item.tracking_type : null,
      isSellableNow: reason === null,
      unavailableReason: reason ? { code: reason, message: POS_PRODUCT_MESSAGES[reason] } : null,
      catalogVersion: Number(item.version),
      // The exact base quantity, only for the server's own add-to-cart check (never sent to a screen).
      ...(ctx.internal ? { availableBase } : {}),
      priceQuoteVersion: price === null ? null : `${ctx.priceList.id}:${priceEntry}:${asText(price)}:${new Date().toISOString().slice(0, 10)}`,
    });
  }
  return out;
}

// ------------------------------------------------------------------ diagnostics

async function recordEvent(client, context, ctx, eventType, { text = null, resultCount = null, durationMs = null, errorCode = null } = {}) {
  try {
    await client.query(
      `INSERT INTO tenant.pos_product_search_events (organization_id, store_id, terminal_id, user_id, event_type, search_text, result_count, duration_ms, error_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [context.organizationId, ctx?.outlet?.id ?? null, ctx?.terminalId ?? null, context.userId ?? null, eventType, text ? String(text).slice(0, 100) : null, resultCount,
        durationMs === null ? null : Math.round(durationMs), errorCode]);
  } catch { /* diagnostics never break a sale */ }
}

// ------------------------------------------------------------------ search

const encodeCursor = (row) => Buffer.from(JSON.stringify([row.rank, row.visible_rank, row.sort_name, row.id])).toString("base64url");
function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const [rank, visibleRank, sortName, id] = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
    if (!Number.isInteger(rank) || !Number.isInteger(visibleRank) || typeof sortName !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { rank, visibleRank, sortName, id };
  } catch { return null; }
}

// input: query, categoryId, cursor, limit, cartId, outletId. Returns { products, nextCursor, outlet, unavailable? }.
export async function searchPosProducts(client, context, input = {}) {
  const ctx = await resolvePosProductContext(client, context, { cartId: input.cartId ?? null, outletId: input.outletId ?? null });
  const started = Date.now();
  const term = clean(input.query, MAX_TERM);
  const lower = term.toLowerCase();
  const upper = term.toUpperCase();
  const limit = Math.min(Math.max(Number(input.limit) || DEFAULT_PAGE, 1), MAX_PAGE);
  const cursor = decodeCursor(input.cursor);
  const textSearch = term.length >= 2;
  const words = textSearch ? lower.split(" ").filter(Boolean).slice(0, 8) : [];
  let categoryIds = null;
  if (input.categoryId) categoryIds = await withDescendants(client, ctx.organizationId, [input.categoryId]);
  // Parameters are added as they are used, so every one has a type Postgres can infer.
  const values = [];
  const p = (value, cast = "") => { values.push(value); return `$${values.length}${cast}`; };
  const org = p(ctx.organizationId);
  // A variant without its own category takes its group's; the parent is read only for variant rows.
  const parentOf = (column) => `(SELECT parent.${column} FROM tenant.items parent WHERE parent.organization_id = item.organization_id AND parent.id = item.parent_item_id)`;
  const categoryOf = `COALESCE(item.group_id, CASE WHEN item.parent_item_id IS NULL THEN NULL ELSE ${parentOf("group_id")} END)`;
  const assortment = p(ctx.assortment, "::uuid[]");
  const visible = `(item.status = 'active' AND item.lifecycle_status = 'active' AND item.is_sellable AND NOT item.is_variant_template
    AND item.item_type IN ('product', 'service', 'consumable') AND (${assortment} IS NULL OR ${categoryOf} = ANY(${assortment})))`;
  const categoryFilter = categoryIds ? `AND ${categoryOf} = ANY(${p(categoryIds, "::uuid[]")})` : "";
  const columns = "item.id, item.organization_id, item.name, item.normalized_sku, item.status, item.lifecycle_status, item.is_sellable, item.is_variant_template, item.item_type, item.group_id, item.parent_item_id";
  let rankSql = "0";
  let matchSql = visible;
  let prelude = "";
  let source = "tenant.items item";
  if (term) {
    // Candidate rows first, each arm answerable from its own index — the exact barcode, the exact and earlier SKU, the SKU prefix, names
    // holding every word (trigram), variants through their group's name — carrying the columns ranking needs, so nothing is joined back.
    const code = p(upper, "::text");
    const skuPrefix = p(`${escapeLike(upper)}%`, "::text");
    const arms = [
      `SELECT ${columns} FROM tenant.items item WHERE item.organization_id = ${org} AND item.id IN (SELECT item_id FROM barcode UNION SELECT item_id FROM old_sku)`,
      `SELECT ${columns} FROM tenant.items item WHERE item.organization_id = ${org} AND item.normalized_sku LIKE ${skuPrefix} ESCAPE '\\'`,
    ];
    const ranks = ["WHEN item.id IN (SELECT item_id FROM barcode) THEN 1", `WHEN item.normalized_sku = ${code} THEN 2`];
    const textMatch = [`item.normalized_sku LIKE ${skuPrefix} ESCAPE '\\'`];
    if (textSearch) {
      const name = p(lower, "::text");
      const namePrefix = p(`${escapeLike(lower)}%`, "::text");
      const complete = p(words.map((word) => `\\m${escapeRegex(word)}\\M`), "::text[]");
      const partial = p(words.map((word) => `%${escapeLike(word)}%`), "::text[]");
      const wordLikes = words.map((word) => `lower(item.name) LIKE ${p(`%${escapeLike(word)}%`, "::text")} ESCAPE '\\'`);
      arms.push(`SELECT ${columns} FROM tenant.items item WHERE item.organization_id = ${org} AND ${wordLikes.join(" AND ")}`,
        `SELECT ${columns} FROM tenant.items item WHERE item.organization_id = ${org} AND item.parent_item_id IN (
           SELECT template.id FROM tenant.items template WHERE template.organization_id = ${org} AND template.is_variant_template AND lower(template.name) LIKE ANY(${partial}))`);
      const withParent = `(CASE WHEN item.parent_item_id IS NULL THEN false ELSE lower(COALESCE(${parentOf("name")}, '') || ' ' || item.name)`;
      ranks.push(`WHEN lower(item.name) = ${name} THEN 3`, `WHEN item.normalized_sku LIKE ${skuPrefix} ESCAPE '\\' OR item.id IN (SELECT item_id FROM old_sku) THEN 4`,
        `WHEN lower(item.name) LIKE ${namePrefix} ESCAPE '\\' THEN 5`,
        `WHEN lower(item.name) ~ ALL(${complete}) OR ${withParent} ~ ALL(${complete}) END) THEN 6`,
        `WHEN lower(item.name) LIKE ALL(${partial}) OR ${withParent} LIKE ALL(${partial}) END) THEN 7`);
      textMatch.push(`lower(item.name) LIKE ALL(${partial})`, `${withParent} LIKE ALL(${partial}) END)`);
    } else {
      ranks.push(`WHEN item.normalized_sku LIKE ${skuPrefix} ESCAPE '\\' OR item.id IN (SELECT item_id FROM old_sku) THEN 4`);
    }
    prelude = `WITH barcode AS MATERIALIZED (SELECT identifier.item_id, identifier.uom_id FROM tenant.item_identifiers identifier
                   WHERE identifier.organization_id = ${org} AND identifier.status = 'active' AND upper(identifier.value) = ${code}),
      old_sku AS MATERIALIZED (SELECT DISTINCT item_id FROM tenant.item_sku_history WHERE organization_id = ${org} AND normalized_old_sku = ${code}),
      candidates AS MATERIALIZED (${arms.join(" UNION ")})`;
    source = "candidates item";
    rankSql = `CASE ${ranks.join(" ")} ELSE 8 END`;
    matchSql = `(item.id IN (SELECT item_id FROM barcode) OR item.normalized_sku = ${code} OR item.id IN (SELECT item_id FROM old_sku) OR (${visible} AND (${textMatch.join(" OR ")})))`;
  }
  const cursorSql = cursor
    ? `WHERE (ranked.rank, ranked.visible_rank, ranked.sort_name, ranked.id) > (${p(cursor.rank, "::int")}, ${p(cursor.visibleRank, "::int")}, ${p(cursor.sortName, "::text")}, ${p(cursor.id, "::uuid")})`
    : "";
  const sql = `${prelude}
    SELECT ranked.id, ranked.sort_name, ranked.visible_rank, ranked.rank, ${term ? "(SELECT barcode.uom_id FROM barcode WHERE barcode.item_id = ranked.id LIMIT 1)" : "NULL::uuid"} AS barcode_uom_id
      FROM (
      SELECT item.id, lower(item.name) AS sort_name, CASE WHEN ${visible} THEN 0 ELSE 1 END AS visible_rank, ${rankSql} AS rank
        FROM ${source}
       WHERE item.organization_id = ${org} AND NOT item.is_variant_template ${categoryFilter} AND ${matchSql}
    ) ranked ${cursorSql}
    ORDER BY ranked.rank, ranked.visible_rank, ranked.sort_name, ranked.id
    LIMIT ${p(limit + 1, "::int")}`;
  let rows;
  await client.query("SAVEPOINT pos_product_search");
  try {
    rows = (await client.query(sql, values)).rows;
    // Typo tolerance, limited: only when the words found nothing, only close names (similarity), ranked last, never auto-selected and never
    // paged — within a small time budget: when it runs out there are simply no suggestions.
    if (!cursor && textSearch && term.length >= 4 && rows.length === 0) {
      const previous = (await client.query("SELECT current_setting('statement_timeout') AS value")).rows[0].value;
      await client.query("SAVEPOINT pos_product_typo");
      try {
      await client.query("SELECT set_config('statement_timeout', '150', true)");
      const { rows: near } = await client.query(
        `SELECT item.id, lower(item.name) AS sort_name, NULL::uuid AS barcode_uom_id, 0 AS visible_rank, 8 AS rank
           FROM tenant.items item ${ITEM_JOINS}
          WHERE item.organization_id = $1 AND lower(item.name) % $2 AND similarity(lower(item.name), $2) >= 0.4 AND NOT (item.id = ANY($3::uuid[]))
            AND item.status = 'active' AND item.lifecycle_status = 'active' AND item.is_sellable AND NOT item.is_variant_template
            AND item.item_type IN ('product', 'service', 'consumable') AND ($4::uuid[] IS NULL OR COALESCE(item.group_id, parent.group_id) = ANY($4::uuid[]))
            AND ($5::uuid[] IS NULL OR COALESCE(item.group_id, parent.group_id) = ANY($5::uuid[]))
          ORDER BY similarity(lower(item.name), $2) DESC, lower(item.name), item.id LIMIT $6`,
        [ctx.organizationId, lower, rows.map((row) => row.id), ctx.assortment, categoryIds, limit - rows.length]);
      rows = [...rows, ...near];
      await client.query("RELEASE SAVEPOINT pos_product_typo");
      } catch {
        await client.query("ROLLBACK TO SAVEPOINT pos_product_typo");
      }
      await client.query("SELECT set_config('statement_timeout', $1, true)", [previous]);
    }
    await client.query("RELEASE SAVEPOINT pos_product_search");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT pos_product_search");
    await recordEvent(client, context, ctx, "search_error", { text: term, errorCode: String(error.code ?? "unknown").slice(0, 40), durationMs: Date.now() - started });
    return { products: [], nextCursor: null, outlet: outletSummary(ctx), unavailable: { code: "POS_SEARCH_UNAVAILABLE", message: POS_PRODUCT_MESSAGES.POS_SEARCH_UNAVAILABLE } };
  }
  const page = rows.slice(0, limit);
  const items = new Map((await loadItems(client, ctx.organizationId, page.map((row) => row.id))).map((item) => [item.id, item]));
  const products = await decorate(client, context, ctx, page.filter((row) => items.has(row.id)).map((row) => ({
    item: items.get(row.id), uomId: row.barcode_uom_id ?? null, rank: row.rank, matchType: row.rank === 1 ? "barcode" : row.rank === 2 ? "sku" : null,
  })));
  const durationMs = Date.now() - started;
  if (durationMs > SLOW_SEARCH_MS) await recordEvent(client, context, ctx, "slow_search", { text: term, resultCount: products.length, durationMs });
  return { products, nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null, outlet: outletSummary(ctx), sessionOpen: ctx.sessionOpen };
}

const outletSummary = (ctx) => ({ id: ctx.outlet.id, code: ctx.outlet.code, name: ctx.outlet.name, currency: ctx.currency, showStockStatus: Boolean(ctx.settings.show_stock_status),
  showQuantity: ctx.showQuantity, priceList: ctx.priceList ? { id: ctx.priceList.id, name: ctx.priceList.name, taxInclusive: ctx.priceList.taxInclusive } : null });

// ------------------------------------------------------------------ barcode

// Exact, deterministic barcode resolution: the value as scanned (a string — leading zeros kept), against the Item Master's active barcodes
// and, for a code typed at the scanner, exact SKUs. One product: { status: "matched", product, autoAdd }. Several: "ambiguous" (never an
// arbitrary pick). A variant group's barcode: "selection_required" with its variants. Nothing: "not_found". Misses and ambiguities are logged.
//
// Barcode Scanning rules: the value is kept as a string (leading zeros and letters as they are; only transport characters — line ends, tabs,
// control characters, surrounding spaces — are dropped). A 12-, 13- or 14-digit GTIN matches the same number in its other spellings (UPC-A =
// EAN-13 with a leading 0 = GTIN-14), and a UPC-E that matches nothing exactly is written out as its UPC-A — explicit GS1 rules, never
// fuzzy. A removed barcode is "inactive"; an unmatched EAN / UPC whose check digit is wrong was misread ("invalid").
// input: barcode, cartId / outletId (or ctx, already resolved), quiet (the caller logs its own diagnostics).
export async function lookupPosProductByBarcode(client, context, input = {}) {
  const ctx = input.ctx ?? await resolvePosProductContext(client, context, { cartId: input.cartId ?? null, outletId: input.outletId ?? null });
  const started = Date.now();
  const barcode = cleanScannedValue(input.barcode);
  const log = (type, details) => (input.quiet ? undefined : recordEvent(client, context, ctx, type, details));
  if (!barcode || barcode.length > MAX_BARCODE) {
    await log("barcode_not_found", { text: barcode.slice(0, 100), resultCount: 0, errorCode: "POS_BARCODE_INVALID" });
    return { status: "invalid", code: "POS_BARCODE_INVALID", message: BARCODE_INVALID, barcode, outlet: outletSummary(ctx) };
  }
  const gtinKey = /^\d{12,14}$/.test(barcode) ? barcode.padStart(14, "0") : null;
  const { rows } = await client.query(
    `SELECT identifier.item_id, identifier.uom_id, 'barcode' AS match_type FROM tenant.item_identifiers identifier
      WHERE identifier.organization_id = $1 AND identifier.status = 'active' AND upper(identifier.value) = upper($2)
     UNION ALL
     SELECT identifier.item_id, identifier.uom_id, 'barcode' FROM tenant.item_identifiers identifier
      WHERE identifier.organization_id = $1 AND identifier.status = 'active' AND $3::text IS NOT NULL AND identifier.gtin_key = $3
     UNION ALL
     SELECT item.id, NULL::uuid, 'sku' FROM tenant.items item WHERE item.organization_id = $1 AND item.normalized_sku = upper(btrim($2))`,
    [ctx.organizationId, barcode, gtinKey]);
  const upcA = rows.length ? null : expandUpcE(barcode);
  if (upcA) {
    rows.push(...(await client.query(`SELECT item_id, uom_id, 'barcode' AS match_type FROM tenant.item_identifiers WHERE organization_id = $1 AND status = 'active' AND gtin_key = $2`,
      [ctx.organizationId, upcA.padStart(14, "0")])).rows);
  }
  const byItem = new Map();
  for (const row of rows) if (!byItem.has(row.item_id)) byItem.set(row.item_id, row);
  const finish = async (result) => {
    const durationMs = Date.now() - started;
    if (durationMs > SLOW_BARCODE_MS) await log("slow_barcode", { text: barcode, resultCount: byItem.size, durationMs });
    return { ...result, barcode, outlet: outletSummary(ctx) };
  };
  if (!byItem.size) {
    const removed = (await client.query(`SELECT 1 FROM tenant.item_identifiers WHERE organization_id = $1 AND status = 'removed' AND upper(value) = upper($2) LIMIT 1`,
      [ctx.organizationId, barcode])).rows[0];
    if (removed) {
      await log("barcode_not_found", { text: barcode, resultCount: 0, errorCode: "POS_BARCODE_INACTIVE", durationMs: Date.now() - started });
      return finish({ status: "inactive", code: "POS_BARCODE_INACTIVE", message: "This barcode is no longer active." });
    }
    if (/^(\d{8}|\d{12}|\d{13})$/.test(barcode) && !validGtinCheckDigit(barcode) && !expandUpcE(barcode)) {
      await log("barcode_not_found", { text: barcode, resultCount: 0, errorCode: "POS_BARCODE_INVALID", durationMs: Date.now() - started });
      return finish({ status: "invalid", code: "POS_BARCODE_INVALID", message: BARCODE_INVALID });
    }
    await log("barcode_not_found", { text: barcode, resultCount: 0, durationMs: Date.now() - started });
    return finish({ status: "not_found", code: "POS_PRODUCT_NOT_FOUND", message: BARCODE_NOT_FOUND });
  }
  const items = await loadItems(client, ctx.organizationId, [...byItem.keys()]);
  const entries = items.map((item) => ({ item, uomId: byItem.get(item.id).uom_id, matchType: byItem.get(item.id).match_type, rank: byItem.get(item.id).match_type === "barcode" ? 1 : 2 }));
  if (entries.length > 1) {
    await log("barcode_ambiguous", { text: barcode, resultCount: entries.length, durationMs: Date.now() - started });
    return finish({ status: "ambiguous", code: "POS_PRODUCT_BARCODE_AMBIGUOUS", message: POS_PRODUCT_MESSAGES.POS_PRODUCT_BARCODE_AMBIGUOUS,
      candidates: await decorate(client, context, ctx, entries) });
  }
  const [entry] = entries;
  if (entry.item.is_variant_template) {
    return finish({ status: "selection_required", code: "POS_PRODUCT_SELECTION_REQUIRED", message: POS_PRODUCT_MESSAGES.POS_PRODUCT_SELECTION_REQUIRED,
      product: (await decorate(client, context, ctx, [entry]))[0], variants: await variantsOf(client, context, ctx, entry.item.id) });
  }
  const [product] = await decorate(client, context, ctx, [entry]);
  return finish({ status: "matched", product, autoAdd: product.isSellableNow, message: product.unavailableReason?.message ?? null });
}

async function variantsOf(client, context, ctx, templateId) {
  const ids = (await client.query(`SELECT id FROM tenant.items WHERE organization_id = $1 AND parent_item_id = $2 ORDER BY lower(name), id LIMIT 100`,
    [ctx.organizationId, templateId])).rows.map((row) => row.id);
  return decorate(client, context, ctx, (await loadItems(client, ctx.organizationId, ids)).map((item) => ({ item })));
}

// ------------------------------------------------------------------ details, categories, quick products

// One product for selection: what search shows, plus every unit it may be sold in (each with its own price and stock) and, for a variant
// group or a variant, the variants.
export async function getPosProductDetails(client, context, itemId, input = {}) {
  const ctx = await resolvePosProductContext(client, context, { cartId: input.cartId ?? null, outletId: input.outletId ?? null });
  const [item] = await loadItems(client, ctx.organizationId, [itemId]);
  if (!item) throw posProductError("POS_PRODUCT_NOT_FOUND");
  const [product] = await decorate(client, context, ctx, [{ item }]);
  const saleUnits = item.is_variant_template ? [] : (await itemUnits(client, ctx.organizationId, item.id)).filter((unit) => unit.isActive && unit.sales);
  const units = await decorate(client, context, ctx, saleUnits.map((unit) => ({ item, uomId: unit.uomId })));
  const variants = item.is_variant_template ? await variantsOf(client, context, ctx, item.id) : item.parent_item_id ? await variantsOf(client, context, ctx, item.parent_item_id) : [];
  return { product, units, variants, outlet: outletSummary(ctx) };
}

// The shared Item Categories this outlet sells from (all active ones, or the chosen categories with their subcategories and the path above
// them), flat with their parents so the screen can walk All products → Beverages → Soft drinks.
export async function listPosProductCategories(client, context, input = {}) {
  const ctx = await resolvePosProductContext(client, context, { cartId: input.cartId ?? null, outletId: input.outletId ?? null });
  const { rows } = await client.query(
    `SELECT id, name, parent_id, sort_order FROM tenant.item_groups WHERE organization_id = $1 AND status = 'active' ORDER BY sort_order, lower(name), id`, [ctx.organizationId]);
  let allowed = null;
  if (ctx.assortment) {
    allowed = new Set(ctx.assortment);
    const parentOf = new Map(rows.map((row) => [row.id, row.parent_id]));
    for (const id of ctx.assortment) for (let parent = parentOf.get(id); parent && !allowed.has(parent); parent = parentOf.get(parent)) allowed.add(parent);
  }
  return { categories: rows.filter((row) => !allowed || allowed.has(row.id)).map((row) => ({ id: row.id, name: row.name, parentId: row.parent_id ?? null, sortOrder: row.sort_order })),
    outlet: outletSummary(ctx) };
}

// The outlet's quick tiles: its shortlist in order, then (when the outlet allows it) what sold most there in the last 30 days, up to 12. The
// same eligibility, price and stock rules as search; products no longer sellable drop off by themselves. Only counts are read from past
// sales — never who bought what.
export async function getPosQuickProducts(client, context, input = {}) {
  const ctx = await resolvePosProductContext(client, context, { cartId: input.cartId ?? null, outletId: input.outletId ?? null });
  const configured = (await client.query(
    `SELECT item_id, uom_id FROM tenant.pos_quick_products WHERE organization_id = $1 AND store_id = $2 AND is_active ORDER BY sort_order, created_at, id LIMIT $3`,
    [ctx.organizationId, ctx.outlet.id, QUICK_LIMIT])).rows.map((row) => ({ ...row, source: "configured" }));
  let picks = configured;
  if (ctx.settings.suggest_frequent_products && picks.length < QUICK_LIMIT) {
    const frequent = (await client.query(
      `SELECT line.item_id, line.uom_id FROM tenant.pos_sale_lines line
         JOIN tenant.pos_sales sale ON sale.organization_id = line.organization_id AND sale.id = line.sale_id
        WHERE line.organization_id = $1 AND sale.store_id = $2 AND sale.status = 'completed' AND sale.completed_at >= now() - interval '30 days'
        GROUP BY line.item_id, line.uom_id ORDER BY count(*) DESC, sum(line.quantity) DESC, line.item_id LIMIT 40`, [ctx.organizationId, ctx.outlet.id])).rows;
    const seen = new Set(picks.map((pick) => pick.item_id));
    for (const row of frequent) if (!seen.has(row.item_id)) { seen.add(row.item_id); picks.push({ ...row, source: "frequent" }); }
  }
  const items = new Map((await loadItems(client, ctx.organizationId, [...new Set(picks.map((pick) => pick.item_id))])).map((item) => [item.id, item]));
  const decorated = await decorate(client, context, ctx, picks.filter((pick) => items.has(pick.item_id)).map((pick) => ({ item: items.get(pick.item_id), uomId: pick.uom_id })));
  const products = decorated.map((product, index) => ({ ...product, source: picks.filter((pick) => items.has(pick.item_id))[index].source }))
    .filter((product) => !["POS_PRODUCT_INACTIVE", "POS_PRODUCT_NOT_SELLABLE", "POS_PRODUCT_OUTLET_RESTRICTED"].includes(product.unavailableReason?.code)).slice(0, QUICK_LIMIT);
  return { products, outlet: outletSummary(ctx) };
}

// ------------------------------------------------------------------ selection (used by the cart)

// Is this exact product, in this unit and quantity, sellable at this cart's outlet right now? Read fresh from the Item Master, the price
// list and Inventory — never from a search result. `alreadyInCartBase` is the base quantity of the same product already on the cart, so
// stock covers the whole line. Returns the unit, factor and base quantity to snapshot on the line, or throws the stable reason.
export async function validatePosProductSelection(client, context, ctx, { itemId, uomId = null, quantity = 1, alreadyInCartBase = decimal(0), skipStock = false }) {
  const [item] = await loadItems(client, ctx.organizationId, [itemId]);
  if (!item) throw posProductError("POS_PRODUCT_NOT_FOUND");
  if (item.is_variant_template) throw posProductError("POS_PRODUCT_SELECTION_REQUIRED", { itemId, variants: (await variantsOf(client, context, ctx, item.id)).map((variant) => variant.itemId) });
  const [product] = await decorate(client, context, { ...ctx, settings: { ...ctx.settings, show_stock_status: true }, allowNegativeStock: true, internal: true }, [{ item, uomId }]);
  const reason = product.unavailableReason?.code;
  if (reason) throw posProductError(reason, { itemId, uomId: product.saleUomId });
  const normalized = await normalizeQuantityToBase(client, ctx.organizationId, item.id, product.saleUomId, String(quantity), { purpose: "sales" });
  if (!normalized.ok) throw posProductError("POS_PRODUCT_UOM_INVALID", { itemId, uomId: product.saleUomId, reason: normalized.reason }, normalized.message);
  const factor = decimal(product.uomFactor);
  if (!skipStock && isStockItem(item) && !ctx.allowNegativeStock) {
    const availableBase = product.availableBase ?? decimal(0);
    const needed = normalized.baseQuantity + alreadyInCartBase;
    if (availableBase < factor) throw posProductError("POS_PRODUCT_OUT_OF_STOCK", { itemId });
    if (availableBase < needed) throw posProductError("POS_PRODUCT_INSUFFICIENT_STOCK", { itemId, available: asText(div(availableBase, factor)), uom: product.saleUomCode });
  }
  return { item, product, uomId: product.saleUomId, factor, quantity: normalized.quantity, baseQuantity: normalized.baseQuantity };
}


// ------------------------------------------------------------------ outlet configuration

const MANAGE = "pos.outlets.manage_inventory";

// The outlet's product settings, its assortment categories and quick products, for the outlet's Products tab.
export async function getPosOutletProductSettings(client, context, outletId) {
  if (!can(context, "pos.outlets.view") && !can(context, "pos.view")) throw posProductError("POS_PERMISSION_DENIED");
  const outlet = (await client.query(`SELECT id, code, name FROM tenant.pos_stores WHERE organization_id = $1 AND id = $2`, [context.organizationId, outletId])).rows[0];
  if (!outlet) throw posError(404, "POS outlet was not found.", "POS_STORE_NOT_FOUND");
  const settings = await loadOutletSettings(client, context.organizationId, outletId);
  const categories = (await client.query(`SELECT id, name, parent_id FROM tenant.item_groups WHERE organization_id = $1 AND id = ANY($2::uuid[]) ORDER BY lower(name)`,
    [context.organizationId, settings.categoryIds])).rows.map((row) => ({ id: row.id, name: row.name, parentId: row.parent_id }));
  const quick = (await client.query(
    `SELECT quick.id, quick.item_id, quick.uom_id, quick.sort_order, item.code, item.name, item.status, item.lifecycle_status, item.is_sellable, uom.code AS uom_code
       FROM tenant.pos_quick_products quick
       JOIN tenant.items item ON item.organization_id = quick.organization_id AND item.id = quick.item_id
       LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = quick.organization_id AND uom.id = quick.uom_id
      WHERE quick.organization_id = $1 AND quick.store_id = $2 ORDER BY quick.sort_order, quick.created_at, quick.id`, [context.organizationId, outletId])).rows;
  // Every active shared category, to choose the assortment from.
  const allCategories = (await client.query(`SELECT id, name, parent_id FROM tenant.item_groups WHERE organization_id = $1 AND status = 'active' ORDER BY sort_order, lower(name), id`,
    [context.organizationId])).rows.map((row) => ({ id: row.id, name: row.name, parentId: row.parent_id }));
  return {
    outlet,
    allCategories,
    settings: {
      assortmentPolicy: settings.assortment_policy, categoryIds: settings.categoryIds, categories, showStockStatus: Boolean(settings.show_stock_status),
      showExactStock: Boolean(settings.show_exact_stock_if_authorized), lowStockThreshold: asText(decimal(settings.low_stock_threshold)),
      suggestFrequent: Boolean(settings.suggest_frequent_products), version: Number(settings.version),
    },
    quickProducts: quick.map((row) => ({ id: row.id, itemId: row.item_id, uomId: row.uom_id, uomCode: row.uom_code, sku: row.code, name: row.name, sortOrder: row.sort_order,
      sellable: row.status === "active" && row.lifecycle_status === "active" && row.is_sellable })),
    capabilities: { edit: can(context, MANAGE) },
  };
}

async function outletHistory(client, context, outletId, summary, changes) {
  await client.query(`INSERT INTO tenant.pos_store_history (organization_id, store_id, event_type, summary, changes, actor_user_id) VALUES ($1, $2, 'inventory_changed', $3, $4, $5)`,
    [context.organizationId, outletId, summary, JSON.stringify(changes), context.userId ?? null]);
}

// input: expectedVersion, assortmentPolicy, categoryIds, showStockStatus, showExactStock, lowStockThreshold, suggestFrequent.
export async function updatePosOutletProductSettings(client, context, outletId, input = {}) {
  if (!can(context, MANAGE)) throw posProductError("POS_PERMISSION_DENIED");
  const current = await getPosOutletProductSettings(client, context, outletId);
  if (input.expectedVersion != null && Number(input.expectedVersion) !== current.settings.version)
    throw posError(409, "These settings changed since you opened them. Reload and try again.", "POS_PRODUCT_SETTINGS_VERSION_CONFLICT");
  const policy = input.assortmentPolicy ?? current.settings.assortmentPolicy;
  if (!["all_sellable", "selected_categories"].includes(policy)) throw validation("assortmentPolicy", "Choose every sellable product or selected categories.");
  const categoryIds = [...new Set(input.categoryIds ?? current.settings.categoryIds)];
  if (policy === "selected_categories" && !categoryIds.length) throw validation("categoryIds", "Choose at least one category this outlet sells.");
  if (categoryIds.length) {
    const found = (await client.query(`SELECT count(*)::int AS n FROM tenant.item_groups WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [context.organizationId, categoryIds])).rows[0].n;
    if (found !== categoryIds.length) throw validation("categoryIds", "A chosen category was not found.");
  }
  const threshold = String(input.lowStockThreshold ?? current.settings.lowStockThreshold);
  if (!/^\d{1,9}(\.\d{1,6})?$/.test(threshold)) throw validation("lowStockThreshold", "Enter the low-stock level as zero or more.");
  const next = {
    assortmentPolicy: policy, showStockStatus: input.showStockStatus ?? current.settings.showStockStatus, showExactStock: input.showExactStock ?? current.settings.showExactStock,
    lowStockThreshold: threshold, suggestFrequent: input.suggestFrequent ?? current.settings.suggestFrequent,
  };
  await client.query(
    `INSERT INTO tenant.pos_outlet_product_settings (organization_id, store_id, assortment_policy, show_stock_status, show_exact_stock_if_authorized, low_stock_threshold,
       suggest_frequent_products, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
     ON CONFLICT (organization_id, store_id) DO UPDATE SET assortment_policy = EXCLUDED.assortment_policy, show_stock_status = EXCLUDED.show_stock_status,
       show_exact_stock_if_authorized = EXCLUDED.show_exact_stock_if_authorized, low_stock_threshold = EXCLUDED.low_stock_threshold,
       suggest_frequent_products = EXCLUDED.suggest_frequent_products, updated_by = EXCLUDED.updated_by, updated_at = now(),
       version = tenant.pos_outlet_product_settings.version + 1`,
    [context.organizationId, outletId, next.assortmentPolicy, Boolean(next.showStockStatus), Boolean(next.showExactStock), threshold, Boolean(next.suggestFrequent), context.userId ?? null]);
  await client.query(`DELETE FROM tenant.pos_outlet_assortment_categories WHERE organization_id = $1 AND store_id = $2 AND NOT (category_id = ANY($3::uuid[]))`,
    [context.organizationId, outletId, policy === "selected_categories" ? categoryIds : []]);
  if (policy === "selected_categories") {
    await client.query(
      `INSERT INTO tenant.pos_outlet_assortment_categories (organization_id, store_id, category_id, created_by) SELECT $1, $2, id, $4 FROM unnest($3::uuid[]) AS id
       ON CONFLICT DO NOTHING`, [context.organizationId, outletId, categoryIds, context.userId ?? null]);
  }
  const changed = Object.fromEntries(Object.entries(next).filter(([key, value]) => String(value) !== String(current.settings[key])));
  if (policy === "selected_categories" && JSON.stringify([...categoryIds].sort()) !== JSON.stringify([...current.settings.categoryIds].sort())) changed.categoryIds = categoryIds;
  if (Object.keys(changed).length) await outletHistory(client, context, outletId, "Product search settings changed", changed);
  return getPosOutletProductSettings(client, context, outletId);
}

// Replace the outlet's quick products (in order, at most 12): each an active, sellable product of the Item Master and optionally a unit it
// is sold in.
export async function setPosQuickProducts(client, context, outletId, entries = []) {
  if (!can(context, MANAGE)) throw posProductError("POS_PERMISSION_DENIED");
  await getPosOutletProductSettings(client, context, outletId);
  if (!Array.isArray(entries) || entries.length > QUICK_LIMIT) throw validation("products", `Choose at most ${QUICK_LIMIT} quick products.`);
  const seen = new Set();
  for (const [index, entry] of entries.entries()) {
    const key = `${entry.itemId}:${entry.uomId ?? ""}`;
    if (seen.has(key)) throw validation(`products.${index}`, "A product is listed twice.");
    seen.add(key);
    const item = (await client.query(`SELECT id, name, status, lifecycle_status, is_sellable, is_variant_template FROM tenant.items WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, entry.itemId])).rows[0];
    if (!item) throw validation(`products.${index}`, "A chosen product was not found.");
    if (item.status !== "active" || item.lifecycle_status !== "active" || !item.is_sellable || item.is_variant_template)
      throw validation(`products.${index}`, `${item.name} cannot be sold, so it cannot be a quick product.`);
    if (entry.uomId) {
      const unit = (await itemUnits(client, context.organizationId, item.id)).find((candidate) => candidate.uomId === entry.uomId && candidate.isActive && candidate.sales);
      if (!unit) throw validation(`products.${index}`, `That unit cannot be used to sell ${item.name}.`);
    }
  }
  await client.query(`DELETE FROM tenant.pos_quick_products WHERE organization_id = $1 AND store_id = $2`, [context.organizationId, outletId]);
  for (const [index, entry] of entries.entries()) {
    await client.query(`INSERT INTO tenant.pos_quick_products (organization_id, store_id, item_id, uom_id, sort_order, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $6)`,
      [context.organizationId, outletId, entry.itemId, entry.uomId ?? null, index, context.userId ?? null]);
  }
  await outletHistory(client, context, outletId, `Quick products set (${entries.length})`, { quickProducts: entries.map((entry) => entry.itemId) });
  return getPosOutletProductSettings(client, context, outletId);
}

function validation(field, message) {
  const error = posError(400, message, "VALIDATION_FAILED");
  error.details = { issues: [{ field, message }] };
  return error;
}

// The problems with the products on a cart right now: no longer sellable here (inactive, not sellable, not at this outlet, unpriced unless the
// line's price was overridden) or not enough eligible stock for all its lines together. [{ code, message, itemId }]
export async function collectPosCartProductIssues(client, context, cartId) {
  const ctx = await resolvePosProductContext(client, context, { cartId });
  const { rows } = await client.query(
    `SELECT item_id, sum(COALESCE(base_quantity, quantity))::text AS needed, bool_or(price_override) AS overridden FROM tenant.pos_cart_lines
      WHERE organization_id = $1 AND cart_id = $2 GROUP BY item_id`, [ctx.organizationId, cartId]);
  if (!rows.length) return [];
  const items = await loadItems(client, ctx.organizationId, rows.map((row) => row.item_id));
  const products = await decorate(client, context, { ...ctx, allowNegativeStock: true, internal: true }, items.map((item) => ({ item })));
  const issues = [];
  for (const [index, product] of products.entries()) {
    const row = rows.find((candidate) => candidate.item_id === product.itemId);
    const reason = product.unavailableReason?.code;
    if (reason && !(reason === "POS_PRODUCT_PRICE_MISSING" && row.overridden) && reason !== "POS_PRODUCT_UOM_INVALID") {
      issues.push({ code: reason, itemId: product.itemId, message: `${product.name}: ${POS_PRODUCT_MESSAGES[reason]}` });
    } else if (!ctx.allowNegativeStock && isStockItem(items[index]) && product.availableBase < decimal(row.needed)) {
      issues.push({ code: "POS_PRODUCT_INSUFFICIENT_STOCK", itemId: product.itemId, message: `${product.name}: ${POS_PRODUCT_MESSAGES.POS_PRODUCT_INSUFFICIENT_STOCK}` });
    }
  }
  return issues;
}

// Before a card, UPI or wallet payment starts: is every product on the cart still sellable here, with enough eligible stock for all its
// lines together? Checked again, atomically with the stock issue, when the sale completes.
export async function assertPosCartProductsSellable(client, context, cartId) {
  const [first] = await collectPosCartProductIssues(client, context, cartId);
  if (first) throw posProductError(first.code, { itemId: first.itemId }, first.message);
}
