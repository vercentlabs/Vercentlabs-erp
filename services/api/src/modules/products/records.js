// The item record: create, read, list, update, activate, deactivate and
// delete. An item is one tenant.items row, the same record Sales,
// Procurement, Inventory, Manufacturing and POS use, so there is never a
// second copy of an item to keep in step.
//
// Each group of fields has its own permission: ordinary details (Edit),
// HSN / SAC and tax category (Edit Tax), type and base unit (Edit Inventory),
// the SKU (Change SKU, through sku.js), sales / purchase units (Manage Units), tracking and expiry
// (Configure Tracking), valuation (Configure Accounting) and standard cost
// (Edit Cost). What an item fundamentally is — its type, base unit, tracking
// and valuation — cannot change under its history. Quantities, costs and
// prices are never fields of the item: stock comes from Inventory, prices
// from price lists and purchase orders.
import { USABLE_ROW } from "../stock/index.js";
import { canViewProductCost, canViewProductStock, productCan, productCapabilities, requireProductPermission } from "./access.js";
import {
  LIFECYCLE, LIFECYCLE_LABELS, PRODUCT_PERMISSIONS, PRODUCT_TYPE_SQL, PRODUCT_VIEWS, ProductError, productTypeLabel, productTypeOf, trackingLabel,
  valuationLabel,
} from "./constants.js";
import { findDuplicateProducts } from "./duplicates.js";
import { recordProductHistory } from "./history.js";
import { addIdentifiersForNewItem } from "./identifiers.js";
import { recordCategoryItemChange, resolveCategoryDefaults, validateItemCategoryAssignment } from "./categories.js";
import { changeItemSku, generateItemSku, normalizeSku, resolveNewItemSku } from "./sku.js";
import { recordUomHistory, validateUomConversion } from "./conversions.js";
import { resolveItemUnit, standardUnitFactor } from "./uom.js";
import { PRODUCT_COLUMNS, PRODUCT_FIELD_LABELS, assertValidProduct, has, isUuid, normalizeProductInput, requireUuid, text } from "./validation.js";

const num = (value) => (value === null || value === undefined ? null : Number(value));
const issueError = (field, message, code = "PRODUCT_VALIDATION", status = 400) => new ProductError(status, message, code, { issues: [{ field, message }] });

export const PRODUCT_SELECT = `
  SELECT item.*, ${PRODUCT_TYPE_SQL("item")} AS product_type,
         category.name AS category_name, category_chain.breadcrumb AS category_breadcrumb,
         inventory_profile.code || ' · ' || inventory_profile.name AS inventory_profile_name, accounting_profile.code || ' · ' || accounting_profile.name AS accounting_profile_name,
         base.code AS base_uom_code, base.name AS base_uom_name, base.decimal_places AS base_uom_decimals,
         sales_uom.code AS sales_uom_code, sales_uom.name AS sales_uom_name, purchase_uom.code AS purchase_uom_code, purchase_uom.name AS purchase_uom_name,
         weight_uom.code AS weight_uom_code, dimension_uom.code AS dimension_uom_code,
         tax.name AS tax_category_name, tax_rate.rate AS gst_rate, NULLIF(tax_rate.cess_rate, 0) AS cess_rate,
         sales_factor.factor AS sales_uom_factor, purchase_factor.factor AS purchase_uom_factor,
         parent.code AS parent_code, parent.name AS parent_name,
         (SELECT count(*) FROM tenant.items variant WHERE variant.organization_id = item.organization_id AND variant.parent_item_id = item.id)::int AS variant_count,
         creator.full_name AS created_by_name, updater.full_name AS updated_by_name,
         (SELECT array_agg(history.old_sku ORDER BY history.changed_at DESC) FROM tenant.item_sku_history history
           WHERE history.organization_id = item.organization_id AND history.item_id = item.id) AS previous_skus
    FROM tenant.items item
    LEFT JOIN tenant.item_groups category ON category.organization_id = item.organization_id AND category.id = item.group_id
    -- The category's path from the top: [{ id, name }, …].
    LEFT JOIN LATERAL (
      WITH RECURSIVE chain AS (
        SELECT node.id, node.name, node.parent_id, 0 AS depth FROM tenant.item_groups node WHERE node.organization_id = item.organization_id AND node.id = item.group_id
        UNION ALL
        SELECT up.id, up.name, up.parent_id, chain.depth + 1 FROM tenant.item_groups up JOIN chain ON up.id = chain.parent_id WHERE up.organization_id = item.organization_id AND chain.depth < 50)
      SELECT jsonb_agg(jsonb_build_object('id', chain.id, 'name', chain.name) ORDER BY chain.depth DESC) AS breadcrumb FROM chain) category_chain ON true
    LEFT JOIN tenant.accounting_item_profiles inventory_profile ON inventory_profile.organization_id = item.organization_id AND inventory_profile.id = item.inventory_profile_id
    LEFT JOIN tenant.accounting_item_profiles accounting_profile ON accounting_profile.organization_id = item.organization_id AND accounting_profile.id = item.accounting_profile_id
    LEFT JOIN tenant.units_of_measure base ON base.organization_id = item.organization_id AND base.id = item.uom_id
    LEFT JOIN tenant.units_of_measure sales_uom ON sales_uom.organization_id = item.organization_id AND sales_uom.id = item.sales_uom_id
    LEFT JOIN tenant.units_of_measure purchase_uom ON purchase_uom.organization_id = item.organization_id AND purchase_uom.id = item.purchase_uom_id
    LEFT JOIN tenant.units_of_measure weight_uom ON weight_uom.organization_id = item.organization_id AND weight_uom.id = item.weight_uom_id
    LEFT JOIN tenant.units_of_measure dimension_uom ON dimension_uom.organization_id = item.organization_id AND dimension_uom.id = item.dimension_uom_id
    LEFT JOIN tenant.tax_categories tax ON tax.organization_id = item.organization_id AND tax.id = item.tax_category_id
    LEFT JOIN tenant.items parent ON parent.organization_id = item.organization_id AND parent.id = item.parent_item_id
    -- The rate the category charges today.
    LEFT JOIN LATERAL (
      SELECT r.rate, r.cess_rate FROM tenant.tax_rates r WHERE r.organization_id = item.organization_id AND r.tax_category_id = item.tax_category_id AND r.status = 'active'
         AND r.effective_from <= current_date AND (r.effective_to IS NULL OR r.effective_to >= current_date)
       ORDER BY r.effective_from DESC LIMIT 1) tax_rate ON true
    LEFT JOIN LATERAL (
      SELECT conversion_factor AS factor FROM tenant.item_uom_conversions c WHERE c.organization_id = item.organization_id AND c.item_id = item.id AND c.status = 'active'
         AND c.from_uom_id = item.sales_uom_id AND c.to_uom_id = item.uom_id LIMIT 1) sales_factor ON true
    LEFT JOIN LATERAL (
      SELECT conversion_factor AS factor FROM tenant.item_uom_conversions c WHERE c.organization_id = item.organization_id AND c.item_id = item.id AND c.status = 'active'
         AND c.from_uom_id = item.purchase_uom_id AND c.to_uom_id = item.uom_id LIMIT 1) purchase_factor ON true
    LEFT JOIN public.users creator ON creator.id = item.created_by
    LEFT JOIN public.users updater ON updater.id = item.updated_by`;

// The stock columns the list adds for callers who may see stock: read from Inventory's balances, never stored on the item.
const STOCK_COLUMNS = `,
    (SELECT COALESCE(sum(balance.quantity), 0) FROM tenant.stock_balances balance WHERE balance.organization_id = item.organization_id AND balance.item_id = item.id) AS stock_on_hand,
    (SELECT COALESCE(sum(CASE WHEN ${USABLE_ROW} THEN balance.quantity - balance.reserved_quantity ELSE 0 END), 0) FROM tenant.stock_balances balance
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = balance.organization_id AND location.id = balance.warehouse_location_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id = balance.organization_id AND batch.id = balance.batch_id
      WHERE balance.organization_id = item.organization_id AND balance.item_id = item.id) AS stock_available`;

const unit = (code, name, decimals) => (code ? { code, name: name ?? code, ...(decimals === undefined ? {} : { decimalPlaces: decimals === null ? null : Number(decimals) }) } : null);

export function toProduct(row, { cost = false, stock = false } = {}) {
  const type = row.product_type ?? productTypeOf(row);
  const lifecycle = row.lifecycle_status ?? row.status;
  const dimensions = [row.length, row.width, row.height].every((value) => value !== null && value !== undefined) ? Number(row.length) * Number(row.width) * Number(row.height) : null;
  const product = {
    id: row.id,
    code: row.code,
    sku: row.code,
    skuGenerationMode: row.sku_generation_mode ?? "manual",
    skuChangedAt: row.sku_changed_at ?? null,
    previousSkus: row.previous_skus ?? [],
    name: row.name,
    type,
    typeLabel: productTypeLabel(type),
    isService: type === "service",
    lifecycleStatus: lifecycle,
    lifecycleLabel: LIFECYCLE_LABELS[lifecycle] ?? lifecycle,
    status: row.status,
    isActive: lifecycle === LIFECYCLE.active,
    isDraft: lifecycle === LIFECYCLE.draft,
    categoryId: row.group_id,
    categoryName: row.category_breadcrumb ? row.category_breadcrumb.map((entry) => entry.name).join(" › ") : row.category_name ?? null,
    categoryBreadcrumb: row.category_breadcrumb ?? [],
    description: row.description,
    salesDescription: row.sales_description,
    purchaseDescription: row.purchase_description,
    brand: row.brand ?? null,
    manufacturerName: row.manufacturer_name ?? null,
    manufacturerPartNumber: row.manufacturer_part_number ?? null,
    barcode: row.barcode,
    baseUomId: row.uom_id,
    baseUom: unit(row.base_uom_code, row.base_uom_name, row.base_uom_decimals),
    salesUomId: row.sales_uom_id ?? row.uom_id,
    salesUom: unit(row.sales_uom_code, row.sales_uom_name) ?? unit(row.base_uom_code, row.base_uom_name),
    salesUomFactor: row.sales_uom_id && row.sales_uom_id !== row.uom_id ? num(row.sales_uom_factor) : 1,
    purchaseUomId: row.purchase_uom_id ?? row.uom_id,
    purchaseUom: unit(row.purchase_uom_code, row.purchase_uom_name) ?? unit(row.base_uom_code, row.base_uom_name),
    purchaseUomFactor: row.purchase_uom_id && row.purchase_uom_id !== row.uom_id ? num(row.purchase_uom_factor) : 1,
    isSellable: row.is_sellable,
    isPurchasable: row.is_purchasable,
    inventoryTracked: row.track_inventory,
    trackingType: row.tracking_type,
    trackingLabel: trackingLabel(row.tracking_type),
    requiresExpiryDate: Boolean(row.requires_expiry_date),
    shelfLifeDays: row.shelf_life_days ?? null,
    allowNegativeStock: row.allow_negative_stock,
    valuationMethod: row.valuation_method,
    valuationLabel: valuationLabel(row.valuation_method),
    inventoryProfileId: row.inventory_profile_id ?? null,
    inventoryProfileName: row.inventory_profile_name ?? null,
    accountingProfileId: row.accounting_profile_id ?? null,
    accountingProfileName: row.accounting_profile_name ?? null,
    hsnSacCode: row.hsn_sac_code,
    hsnSacLabel: type === "service" ? "SAC" : "HSN",
    taxCategoryId: row.tax_category_id,
    taxCategoryName: row.tax_category_name ?? null,
    gstRate: num(row.gst_rate),
    cessRate: num(row.cess_rate),
    netWeight: num(row.net_weight),
    grossWeight: num(row.gross_weight),
    weightUomId: row.weight_uom_id ?? null,
    weightUom: row.weight_uom_code ?? null,
    length: num(row.length),
    width: num(row.width),
    height: num(row.height),
    dimensionUomId: row.dimension_uom_id ?? null,
    dimensionUom: row.dimension_uom_code ?? null,
    volume: dimensions,
    parentItemId: row.parent_item_id ?? null,
    parent: row.parent_item_id ? { id: row.parent_item_id, code: row.parent_code, name: row.parent_name } : null,
    isVariantTemplate: Boolean(row.is_variant_template),
    variantAttributes: row.variant_attributes ?? {},
    variantCount: Number(row.variant_count ?? 0),
    imageAttachmentId: row.image_attachment_id,
    version: Number(row.version ?? 1),
    createdByName: row.created_by_name ?? null,
    createdAt: row.created_at,
    updatedByName: row.updated_by_name ?? null,
    updatedAt: row.updated_at,
    activatedAt: row.activated_at ?? null,
  };
  if (cost) product.standardCost = num(row.standard_cost) ?? 0;
  if (stock && type === "stock") { product.onHand = num(row.stock_on_hand) ?? 0; product.available = num(row.stock_available) ?? 0; }
  return product;
}

// ------------------------------------------------------------------ read

export async function loadProductRow(client, context, productId, { lock = false } = {}) {
  const { rows } = await client.query(
    `${PRODUCT_SELECT} WHERE item.organization_id = $1 AND item.id = $2${lock ? " FOR UPDATE OF item" : ""}`,
    [context.organizationId, requireUuid(productId, "Item")],
  );
  if (!rows[0]) throw new ProductError(404, "Item not found.", "PRODUCT_NOT_FOUND");
  return rows[0];
}

export async function getProduct(client, context, productId) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.view, "You do not have permission to view items.");
  return { ...toProduct(await loadProductRow(client, context, productId), { cost: canViewProductCost(context) }), capabilities: productCapabilities(context) };
}

// ------------------------------------------------------------------ list

const SORT_COLUMNS = Object.freeze({
  code: "item.code", name: "lower(item.name)", type: "product_type", category: "lower(category.name)", brand: "lower(item.brand)", createdAt: "item.created_at",
  updatedAt: "item.updated_at",
});
const VIEW_SQL = Object.freeze({
  stock: "item.item_type <> 'service' AND item.track_inventory",
  non_stock: "item.item_type <> 'service' AND NOT item.track_inventory AND NOT item.is_variant_template",
  services: "item.item_type = 'service'",
  batch: "item.tracking_type = 'batch'",
  serial: "item.tracking_type = 'serial'",
  templates: "item.is_variant_template",
  draft: "item.lifecycle_status = 'draft'",
  inactive: "item.lifecycle_status = 'inactive'",
  // Kept for the Sales lens.
  products: "item.item_type <> 'service'",
});
const yes = (value) => value === true || value === "true" || value === "yes";
const no = (value) => value === false || value === "false" || value === "no";
const like = (value) => `%${text(value).toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;

// The WHERE clause shared by the list and the export.
export function buildProductListWhere(context, filters = {}) {
  const values = [context.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = ["item.organization_id = $1"];
  const view = text(filters.view) || "all";
  if (VIEW_SQL[view]) where.push(VIEW_SQL[view]);
  let rank = null;
  if (text(filters.search)) {
    const term = bind(like(filters.search));
    const exact = bind(normalizeSku(filters.search));
    const prefix = bind(`${normalizeSku(filters.search).replace(/[\\%_]/g, "\\$&")}%`);
    const identifier = (condition) => `EXISTS (SELECT 1 FROM tenant.item_identifiers identifier WHERE identifier.organization_id = item.organization_id AND identifier.item_id = item.id
                  AND identifier.status = 'active' AND ${condition})`;
    const previous = (condition) => `EXISTS (SELECT 1 FROM tenant.item_sku_history history WHERE history.organization_id = item.organization_id AND history.item_id = item.id AND ${condition})`;
    // Name, SKU, any live barcode / identifier, category, brand, manufacturer, part number, HSN / SAC, and the SKUs the item had before.
    where.push(`(lower(concat_ws(' ', item.code, item.name, item.hsn_sac_code, category.name, item.brand, item.manufacturer_name, item.manufacturer_part_number)) LIKE ${term}
      OR ${identifier(`lower(identifier.value) LIKE ${term}`)} OR ${previous(`history.normalized_old_sku LIKE ${prefix}`)})`);
    rank = `CASE WHEN item.normalized_sku = ${exact} THEN 1 WHEN ${identifier(`upper(identifier.value) = ${exact}`)} THEN 2 WHEN item.normalized_sku LIKE ${prefix} THEN 3
      WHEN lower(item.name) LIKE ${term} THEN 4 WHEN lower(item.manufacturer_part_number) LIKE ${term} THEN 5 WHEN ${previous(`history.normalized_old_sku LIKE ${prefix}`)} THEN 6
      WHEN lower(category.name) LIKE ${term} THEN 7 ELSE 8 END`;
    rank = { sql: rank, previous: `(SELECT history.old_sku FROM tenant.item_sku_history history WHERE history.organization_id = item.organization_id AND history.item_id = item.id
      AND history.normalized_old_sku LIKE ${prefix} ORDER BY history.changed_at DESC LIMIT 1)` };
  }
  if (["stock", "non_stock", "service"].includes(filters.type)) where.push(`${PRODUCT_TYPE_SQL("item")} = ${bind(filters.type)}`);
  if (filters.categoryId === "none") where.push("item.group_id IS NULL");
  // A category includes its sub-categories, however deep, unless includeSubcategories is "no".
  else if (isUuid(filters.categoryId) && no(filters.includeSubcategories)) where.push(`item.group_id = ${bind(filters.categoryId)}`);
  else if (isUuid(filters.categoryId)) where.push(`item.group_id IN (WITH RECURSIVE tree AS (SELECT id FROM tenant.item_groups WHERE organization_id = $1 AND id = ${bind(filters.categoryId)}
      UNION SELECT child.id FROM tenant.item_groups child JOIN tree ON child.parent_id = tree.id WHERE child.organization_id = $1) SELECT id FROM tree)`);
  if (["draft", "active", "inactive"].includes(filters.status)) where.push(`item.lifecycle_status = ${bind(filters.status)}`);
  for (const [filter, column] of [["sellable", "is_sellable"], ["purchasable", "is_purchasable"], ["inventoryTracked", "track_inventory"]]) {
    if (yes(filters[filter])) where.push(`item.${column}`);
    if (no(filters[filter])) where.push(`NOT item.${column}`);
  }
  if (["none", "batch", "serial"].includes(filters.trackingType)) where.push(`item.tracking_type = ${bind(filters.trackingType)}`);
  if (text(filters.brand)) where.push(`lower(item.brand) = lower(${bind(text(filters.brand))})`);
  if (text(filters.hsnSac) === "missing") where.push("(item.hsn_sac_code IS NULL OR item.hsn_sac_code = '')");
  else if (text(filters.hsnSac)) where.push(`item.hsn_sac_code LIKE ${bind(`${text(filters.hsnSac).replace(/[\\%_]/g, "\\$&")}%`)}`);
  if (filters.taxCategoryId === "none") where.push("item.tax_category_id IS NULL");
  else if (isUuid(filters.taxCategoryId)) where.push(`item.tax_category_id = ${bind(filters.taxCategoryId)}`);
  if (isUuid(filters.parentItemId)) where.push(`item.parent_item_id = ${bind(filters.parentItemId)}`);
  return { values, sql: `WHERE ${where.join(" AND ")}`, rank };
}

// Why a searched item matched, by its rank.
const MATCHED_BY = Object.freeze({ 1: "sku", 2: "barcode", 3: "sku_prefix", 4: "name", 5: "part_number", 6: "previous_sku", 7: "category", 8: "other" });

// filters: view, search, type, categoryId, status (draft | active | inactive), sellable, purchasable, inventoryTracked, trackingType, brand, hsnSac,
// taxCategoryId, parentItemId, sort, direction, limit, offset.
export async function listProducts(client, context, filters = {}) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.view, "You do not have permission to view items.");
  const cost = canViewProductCost(context);
  const stock = canViewProductStock(context);
  const { values, sql, rank } = buildProductListWhere(context, filters);
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const sortKey = SORT_COLUMNS[filters.sort] ? filters.sort : "name";
  const direction = filters.direction === "desc" ? "DESC" : filters.direction === "asc" ? "ASC" : ["createdAt", "updatedAt"].includes(sortKey) ? "DESC" : "ASC";
  const ranked = rank ? `, ${rank.sql} AS search_rank, ${rank.previous} AS matched_previous_sku` : "";
  const select = PRODUCT_SELECT.replace("SELECT item.*", `SELECT count(*) OVER () AS total_count, item.*${stock ? STOCK_COLUMNS : ""}${ranked}`);
  // A search lists the best matches first: the exact SKU, then the barcode, SKU prefix, name, part number, previous SKU and category.
  const { rows } = await client.query(`${select} ${sql} ORDER BY ${rank ? "search_rank, " : ""}${SORT_COLUMNS[sortKey]} ${direction} NULLS LAST, item.code LIMIT ${limit} OFFSET ${offset}`, values);
  return {
    products: rows.map((row) => ({
      ...toProduct(row, { cost, stock }),
      ...(rank ? { matchedBy: MATCHED_BY[row.search_rank] ?? "other", matchedPreviousSku: Number(row.search_rank) === 6 ? row.matched_previous_sku : null } : {}),
    })),
    total: Number(rows[0]?.total_count ?? 0),
    limit,
    offset,
    views: PRODUCT_VIEWS,
    showsCost: cost,
    showsStock: stock,
    capabilities: productCapabilities(context),
  };
}

// ------------------------------------------------------------------ write helpers

// The category, units and tax category must be this organisation's and in use.
async function assertReferences(client, context, next) {
  const organizationId = context.organizationId;
  const one = async (sql, value) => (await client.query(sql, [organizationId, value])).rows[0];
  if (next.categoryId && !(await one(`SELECT 1 FROM tenant.item_groups WHERE organization_id = $1 AND id = $2 AND status = 'active'`, next.categoryId)))
    throw issueError("categoryId", "Choose an active category.");
  const units = {};
  for (const field of ["baseUomId", "salesUomId", "purchaseUomId", "weightUomId", "dimensionUomId"]) {
    if (!next[field]) continue;
    const row = await one(`SELECT category, decimal_places FROM tenant.units_of_measure WHERE organization_id = $1 AND id = $2 AND status = 'active'`, next[field]);
    if (!row) throw issueError(field, "Choose an active unit of measure.");
    units[field] = row;
  }
  if (units.weightUomId && units.weightUomId.category !== "weight") throw issueError("weightUomId", "Choose a unit of weight, such as Kilogram.");
  if (units.dimensionUomId && units.dimensionUomId.category !== "length") throw issueError("dimensionUomId", "Choose a unit of length, such as Centimetre.");
  for (const [field, kind] of [["inventoryProfileId", "inventory"], ["accountingProfileId", "accounting"]])
    if (next[field] && !(await client.query(`SELECT 1 FROM tenant.accounting_item_profiles WHERE organization_id = $1 AND id = $2 AND status = 'active' AND profile_kind = $3`,
      [organizationId, next[field], kind])).rows[0]) throw issueError(field, `Choose an active ${kind} profile.`);
  if (next.taxCategoryId) {
    // A tax category may be for goods (HSN) or services (SAC) only.
    const category = await one(`SELECT applies_to FROM tenant.tax_categories WHERE organization_id = $1 AND id = $2 AND status = 'active'`, next.taxCategoryId);
    if (!category) throw issueError("taxCategoryId", "Choose an active tax category.");
    if (category.applies_to === "goods" && next.type === "service") throw issueError("taxCategoryId", "This tax category is for goods. Choose one for services.");
    if (category.applies_to === "services" && next.type !== "service") throw issueError("taxCategoryId", "This tax category is for services. Choose one for goods.");
  }
}

// A serial-numbered item is counted in whole units: its base unit allows no decimals.
async function assertSerialUnit(client, context, candidate) {
  if (candidate.trackingType !== "serial" || !candidate.baseUomId) return;
  const row = (await client.query(`SELECT code, decimal_places FROM tenant.units_of_measure WHERE organization_id = $1 AND id = $2`, [context.organizationId, candidate.baseUomId])).rows[0];
  if (row && Number(row.decimal_places) > 0)
    throw issueError("trackingType", `A serial-numbered item is counted in whole units, but ${row.code} allows decimals. Choose a whole-number base unit, such as Piece.`);
}

// SKU and barcodes are unique; refused with the item that has them.
async function assertUnique(client, context, candidate, exceptId = null) {
  const duplicates = await findDuplicateProducts(client, context, candidate, { excludeId: exceptId });
  const strong = duplicates.matches.filter((match) => match.strength === "strong");
  if (strong.length) {
    const match = strong[0];
    const field = match.reasons[0].signal === "sku" ? "code" : match.reasons[0].signal;
    const value = field === "barcode" ? match.reasons[0].value ?? candidate.barcode : candidate[field];
    const message = `${PRODUCT_FIELD_LABELS[field] ?? field} ${value} already belongs to ${match.name} (${match.code}).`;
    throw new ProductError(409, message, "PRODUCT_DUPLICATE", { issues: [{ field, message }], matches: duplicates.matches });
  }
  return duplicates;
}

// Has the item been used anywhere? Returns the names of what uses it.
const USES = Object.freeze([
  ["quotations", "SELECT 1 FROM tenant.sales_quotation_lines WHERE organization_id = $1 AND item_id = $2"],
  ["sales orders", "SELECT 1 FROM tenant.sales_order_lines WHERE organization_id = $1 AND item_id = $2"],
  ["deliveries", "SELECT 1 FROM tenant.sales_delivery_lines line JOIN tenant.sales_order_lines order_line ON order_line.organization_id = line.organization_id AND order_line.id = line.sales_order_line_id WHERE line.organization_id = $1 AND order_line.item_id = $2"],
  ["invoices", "SELECT 1 FROM tenant.accounting_customer_invoice_lines WHERE organization_id = $1 AND item_id = $2"],
  ["supplier bills", "SELECT 1 FROM tenant.accounting_vendor_bill_lines WHERE organization_id = $1 AND item_id = $2"],
  ["purchase orders", "SELECT 1 FROM tenant.purchase_order_lines WHERE organization_id = $1 AND product_id = $2"],
  ["supplier quotations", "SELECT 1 FROM tenant.supplier_quotation_lines WHERE organization_id = $1 AND item_id = $2"],
  ["goods receipts", "SELECT 1 FROM tenant.goods_receipt_lines WHERE organization_id = $1 AND product_id = $2"],
  ["stock movements", "SELECT 1 FROM tenant.stock_movements WHERE organization_id = $1 AND item_id = $2"],
  ["stock balances", "SELECT 1 FROM tenant.stock_balances WHERE organization_id = $1 AND item_id = $2"],
  ["bills of materials", "SELECT 1 FROM tenant.manufacturing_boms WHERE organization_id = $1 AND item_id = $2 UNION ALL SELECT 1 FROM tenant.manufacturing_bom_components WHERE organization_id = $1 AND item_id = $2"],
  ["work orders", "SELECT 1 FROM tenant.manufacturing_work_orders WHERE organization_id = $1 AND item_id = $2"],
  ["POS sales", "SELECT 1 FROM tenant.pos_sale_lines WHERE organization_id = $1 AND item_id = $2"],
  ["opportunities", "SELECT 1 FROM tenant.crm_opportunity_items WHERE organization_id = $1 AND item_id = $2"],
  ["price lists", "SELECT 1 FROM tenant.price_list_items WHERE organization_id = $1 AND item_id = $2"],
  ["variants", "SELECT 1 FROM tenant.items WHERE organization_id = $1 AND parent_item_id = $2"],
]);

export async function productUses(client, context, itemId, { only = null } = {}) {
  const found = [];
  for (const [label, sql] of USES) {
    if (only && !only.includes(label)) continue;
    if ((await client.query(`SELECT 1 FROM (${sql}) used LIMIT 1`, [context.organizationId, itemId])).rows[0]) found.push(label);
  }
  return found;
}
const TRANSACTIONS = ["quotations", "sales orders", "deliveries", "invoices", "supplier bills", "purchase orders", "goods receipts", "stock movements", "stock balances", "work orders", "POS sales"];
const STOCK = ["stock movements", "stock balances", "goods receipts"];

// Keeps the item's conversion "1 {uom} = factor base units" in step with the form.
// The conversion a create or edit gives a default unit: checked like any other (dimension, precision, serial), never needed for a unit
// with a standard conversion to the base (G for an item in KG). A factor that changes an existing conversion on an item already used must
// be acknowledged (documents and stock keep the old one).
async function saveConversion(client, context, itemId, baseUomId, uomId, factor, { acknowledgeHistory = false } = {}) {
  if (!uomId || uomId === baseUomId || factor === null || factor === undefined) return;
  if (await standardUnitFactor(client, context.organizationId, baseUomId, uomId)) return;
  const checked = await validateUomConversion(client, context, itemId, { uomId, factor: String(factor) });
  const existing = (await client.query(`SELECT conversion_factor FROM tenant.item_uom_conversions WHERE organization_id = $1 AND item_id = $2 AND from_uom_id = $3 AND to_uom_id = $4 AND status = 'active'`,
    [context.organizationId, itemId, uomId, baseUomId])).rows[0];
  if (existing && Number(existing.conversion_factor) === Number(checked.factor)) return;
  if (existing && !acknowledgeHistory && (await productUses(client, context, itemId, { only: TRANSACTIONS })).length)
    throw new ProductError(409, "This item is already on documents. Change its conversion under Units & Identifiers, where the effect on documents is confirmed.", "PRODUCT_CONVERSION_CONFIRM",
      { requiresAcknowledgement: true });
  factor = checked.factor;
  await client.query(
    `INSERT INTO tenant.item_uom_conversions (organization_id, item_id, from_uom_id, to_uom_id, conversion_factor, status, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, 'active', $6, $6)
     ON CONFLICT (organization_id, item_id, from_uom_id, to_uom_id) DO UPDATE SET conversion_factor = EXCLUDED.conversion_factor, status = 'active', updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [context.organizationId, itemId, uomId, baseUomId, factor, context.userId ?? null],
  );
}

// Whether the item can already be counted in the unit (its own conversion or a standard one).
async function hasConversion(client, context, itemId, uomId, baseUomId) {
  if (!uomId || uomId === baseUomId) return true;
  if (await standardUnitFactor(client, context.organizationId, baseUomId, uomId)) return true;
  if (!itemId) return false;
  return (await resolveItemUnit(client, context.organizationId, itemId, uomId)).ok;
}

// item_type and track_inventory for an item type. A goods item keeps its
// finer item_type (consumable, asset) when it stays goods.
function storedType(type, currentItemType = null) {
  if (type === "service") return { itemType: "service", trackInventory: false };
  const goods = currentItemType && currentItemType !== "service" ? currentItemType : "product";
  return { itemType: goods, trackInventory: type === "stock" };
}

// Field -> the permission it needs beyond Edit.
const INVENTORY = [PRODUCT_PERMISSIONS.editInventory, "You do not have permission to change inventory configuration."];
const TRACKING = [PRODUCT_PERMISSIONS.configureTracking, "You do not have permission to configure batch, serial and expiry tracking."];
const ACCOUNTING = [PRODUCT_PERMISSIONS.configureAccounting, "You do not have permission to configure inventory accounting."];
const DEFAULT_UNITS = [PRODUCT_PERMISSIONS.changeDefaultUoms, "You do not have permission to change default units."];
const CONVERSIONS = [PRODUCT_PERMISSIONS.changeUomConversions, "You do not have permission to change unit conversions."];
const TAX = [PRODUCT_PERMISSIONS.editTax, "You do not have permission to change the tax classification."];
const FIELD_PERMISSION = Object.freeze({
  type: INVENTORY, baseUomId: INVENTORY, code: [PRODUCT_PERMISSIONS.changeSku, "You do not have permission to change SKUs."],
  salesUomId: DEFAULT_UNITS, purchaseUomId: DEFAULT_UNITS, salesUomFactor: CONVERSIONS, purchaseUomFactor: CONVERSIONS,
  trackingType: TRACKING, requiresExpiryDate: TRACKING, shelfLifeDays: TRACKING, allowNegativeStock: TRACKING,
  valuationMethod: ACCOUNTING, inventoryProfileId: ACCOUNTING, accountingProfileId: ACCOUNTING,
  categoryId: [PRODUCT_PERMISSIONS.reclassify, "You do not have permission to reclassify items."], standardCost: [PRODUCT_PERMISSIONS.editCost, "You do not have permission to change costs."],
  hsnSacCode: TAX, taxCategoryId: TAX,
});

// What a category gives a new item, resolved through its ancestors to the company default: valuation method, inventory and accounting
// profiles, tax profile and HSN / SAC.
async function categoryDefaults(client, context, categoryId) {
  if (!isUuid(categoryId)) return {};
  const resolved = await resolveCategoryDefaults(client, context, categoryId);
  return Object.fromEntries(Object.entries(resolved).map(([field, entry]) => [field, entry.value]));
}

// What an item needs before it is used on transactions.
export function activationIssues(product) {
  const issues = [];
  const issue = (field, message) => issues.push({ field, message });
  if (!text(product.name)) issue("name", "Enter the item name.");
  if (!product.code) issue("code", "Give the item a SKU.");
  if (!product.baseUomId) issue("baseUomId", "Choose the base unit of measure.");
  if (product.type === "stock" && !product.categoryId) issue("categoryId", "A stock item needs a category.");
  if (!product.isVariantTemplate && !product.isSellable && !product.isPurchasable && product.type !== "stock")
    issue("isSellable", "Make the item sellable or purchasable, or it can never be used.");
  if (product.salesUomId && product.salesUomId !== product.baseUomId && !product.salesUomFactor) issue("salesUomId", "Give the sales unit's conversion to the base unit.");
  if (product.purchaseUomId && product.purchaseUomId !== product.baseUomId && !product.purchaseUomFactor) issue("purchaseUomId", "Give the purchase unit's conversion to the base unit.");
  return issues;
}

// A database uniqueness clash (two people saving the same SKU or barcode at once) reads like the duplicate check's own refusal.
async function guardedWrite(client, savepoint, run) {
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    const result = await run();
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    if (error?.code === "23505") {
      const field = /identifier/.test(error.constraint ?? "") ? "barcode" : "code";
      throw issueError(field, field === "barcode" ? "This barcode was just given to another item." : "This SKU was just given to another item.", "PRODUCT_DUPLICATE", 409);
    }
    throw error;
  }
}

// ------------------------------------------------------------------ create

// input: type, code (the SKU; generated when empty), name, category, descriptions, brand / manufacturer / part number, units (with
// salesUomFactor / purchaseUomFactor when they differ from the base unit), flags, tracking and expiry, valuation, HSN / SAC, tax category,
// physical details, barcode (the primary) and alternateBarcodes, isVariantTemplate, status: "draft" | "active" (default) | "inactive".
export async function createProduct(client, context, input = {}, { origin = "manual", parent = null } = {}) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.create, "You do not have permission to create items.");
  const status = text(input.status) || LIFECYCLE.active;
  if (!Object.values(LIFECYCLE).includes(status)) throw issueError("status", "Choose Draft, Active or Inactive.");
  const defaults = await categoryDefaults(client, context, text(input.categoryId));
  const normalized = normalizeProductInput({
    type: "stock", isSellable: true, isPurchasable: true,
    ...Object.fromEntries(Object.entries(defaults).filter(([field, value]) => value && !has(input, field))),
    ...input,
  });
  if (normalized.standardCost) requireProductPermission(context, ...FIELD_PERMISSION.standardCost);
  // Profiles chosen by hand are accounting configuration; a variant copies its template, which is not a choice.
  if (!parent) for (const field of ["inventoryProfileId", "accountingProfileId"]) if (has(input, field) && input[field]) requireProductPermission(context, ...FIELD_PERMISSION[field]);
  // A service carries no inventory profile, even when its category suggests one.
  if (normalized.type === "service" && !has(input, "inventoryProfileId")) normalized.inventoryProfileId = null;
  const barcodes = [normalized.barcode, ...(Array.isArray(input.alternateBarcodes) ? input.alternateBarcodes : [])].map((value) => text(value).replace(/\s/g, "")).filter(Boolean);
  if (barcodes.length) requireProductPermission(context, PRODUCT_PERMISSIONS.manageIdentifiers, "You do not have permission to manage barcodes.");
  const template = input.isVariantTemplate === true && !parent;
  const candidate = {
    ...normalized, salesUomIdConverts: await hasConversion(client, context, null, normalized.salesUomId, normalized.baseUomId),
    purchaseUomIdConverts: await hasConversion(client, context, null, normalized.purchaseUomId, normalized.baseUomId), isVariantTemplate: template,
    ...(template ? { isSellable: false, isPurchasable: false, trackingType: "none" } : {}),
  };
  if (template && candidate.type === "stock") candidate.type = "non_stock";
  if (!candidate.salesUomId) candidate.salesUomId = candidate.baseUomId;
  if (!candidate.purchaseUomId) candidate.purchaseUomId = candidate.baseUomId;
  assertValidProduct(normalized, candidate);
  await assertReferences(client, context, candidate);
  if (candidate.categoryId) await validateItemCategoryAssignment(client, context, candidate.categoryId, candidate.type);
  await assertSerialUnit(client, context, candidate);
  // The SKU follows the organization's numbering: typed (checked: free, never another item's) or generated on save.
  const sku = await resolveNewItemSku(client, context, candidate.code);
  candidate.code = sku.code ?? null;
  // A SKU or barcode that is taken is refused before anything else about readiness.
  if (candidate.code) await assertUnique(client, context, { code: candidate.code, name: candidate.name });
  for (const barcode of barcodes) await assertUnique(client, context, { barcode });
  if (new Set(barcodes.map((value) => value.toUpperCase())).size !== barcodes.length) throw issueError("barcode", "The same barcode is given twice.");
  if (status === LIFECYCLE.active) {
    const issues = activationIssues({ ...candidate, salesUomFactor: candidate.salesUomId === candidate.baseUomId ? 1 : normalized.salesUomFactor,
      purchaseUomFactor: candidate.purchaseUomId === candidate.baseUomId ? 1 : normalized.purchaseUomFactor, code: candidate.code ?? "generated" });
    if (issues.length) throw new ProductError(400, issues[0].message, "PRODUCT_NOT_READY", { issues });
  }
  const generated = sku.generate ? await generateItemSku(client, context, { categoryId: candidate.categoryId }) : null;
  if (generated) candidate.code = generated.sku;

  const stored = storedType(candidate.type);
  const columns = ["organization_id", "code", "item_type", "track_inventory", "lifecycle_status", "status", "is_variant_template", "sku_generation_mode", "sku_sequence_reference",
    "created_by", "updated_by"];
  const values = [context.organizationId, candidate.code, stored.itemType, stored.trackInventory, status, status === LIFECYCLE.active ? "active" : "inactive", template,
    generated ? "automatic" : "manual", generated?.reference ?? null, context.userId ?? null, context.userId ?? null];
  if (status === LIFECYCLE.active) { columns.push("activated_at", "activated_by"); values.push(new Date(), context.userId ?? null); }
  if (parent) { columns.push("parent_item_id"); values.push(parent.id); }
  for (const [field, column] of Object.entries(PRODUCT_COLUMNS)) {
    if (field === "code") continue;
    const value = candidate[field];
    if (value !== null && value !== undefined) { columns.push(column); values.push(field === "variantAttributes" ? JSON.stringify(value) : value); }
  }
  const insert = () => guardedWrite(client, "item_create", async () => {
    const { rows } = await client.query(`INSERT INTO tenant.items (${columns.join(", ")}) VALUES (${values.map((_value, index) => `$${index + 1}`).join(", ")}) RETURNING id`, values);
    await addIdentifiersForNewItem(client, context, rows[0].id, barcodes);
    return rows[0].id;
  });
  let id;
  for (let attempt = 0; ; attempt += 1) {
    try { id = await insert(); break; } catch (error) {
      // Someone else saved this generated SKU by hand at the same moment: take the next number.
      if (!generated || attempt >= 4 || error?.code !== "PRODUCT_DUPLICATE" || error.details?.issues?.[0]?.field !== "code") throw error;
      const next = await generateItemSku(client, context, { categoryId: candidate.categoryId });
      candidate.code = next.sku;
      values[1] = next.sku;
      values[columns.indexOf("sku_sequence_reference")] = next.reference;
    }
  }
  await saveConversion(client, context, id, candidate.baseUomId, candidate.salesUomId, normalized.salesUomFactor);
  await saveConversion(client, context, id, candidate.baseUomId, candidate.purchaseUomId, normalized.purchaseUomFactor);
  await recordUomHistory(client, context, id, "base_set", { uomId: candidate.baseUomId, to: { baseUomId: candidate.baseUomId, purchaseUomId: candidate.purchaseUomId, salesUomId: candidate.salesUomId } });
  const label = template ? "Variant template" : parent ? "Variant" : productTypeLabel(candidate.type);
  await recordProductHistory(client, context, id, origin === "import" ? "imported" : "created", `${label} ${candidate.code} created${status === LIFECYCLE.draft ? " as a draft" : ""}`,
    { type: candidate.type, origin, lifecycle: status, sku: { value: candidate.code, assigned: generated ? "generated" : "typed", reference: generated?.reference ?? null },
      ...(parent ? { parent: parent.code } : {}) });
  if (status === LIFECYCLE.active) await recordProductHistory(client, context, id, "activated", "Activated", { from: null, to: "active" });
  return getProduct(client, context, id);
}

// ------------------------------------------------------------------ update

const SHOWN = Object.freeze({
  categoryId: "categoryName", baseUomId: "baseUom", salesUomId: "salesUom", purchaseUomId: "purchaseUom", taxCategoryId: "taxCategoryName", type: "typeLabel",
  trackingType: "trackingLabel", valuationMethod: "valuationLabel", weightUomId: "weightUom", dimensionUomId: "dimensionUom",
});
const shown = (product, field) => {
  const value = product[SHOWN[field] ?? field];
  if (value && typeof value === "object" && !Array.isArray(value)) return value.code ?? JSON.stringify(value);
  return value ?? null;
};
const same = (left, right) => (left && typeof left === "object") || (right && typeof right === "object") ? JSON.stringify(left ?? {}) === JSON.stringify(right ?? {}) : String(left ?? "") === String(right ?? "");


// Fields an item does not have, refused by name so a caller learns where they live.
const STOCK_FIELDS = ["onHand", "quantityOnHand", "available", "reserved", "incoming", "outgoing", "openingQuantity"];
const PRICE_FIELDS = ["salesPrice", "purchasePrice", "defaultSalesPrice", "defaultPurchaseCost", "averageCost", "lastPurchasePrice", "inventoryValue"];

// input: any item field; expectedVersion (the version the form was loaded with) refuses a change made on top of someone else's.
export async function updateProduct(client, context, productId, input = {}) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.edit, "You do not have permission to edit items.");
  for (const field of ["status", "lifecycleStatus"]) if (has(input, field)) throw new ProductError(409, "Use Activate or Deactivate to change the status.", "PRODUCT_FIELD_GOVERNED");
  for (const field of ["barcode", "alternateBarcodes"]) if (has(input, field)) throw new ProductError(409, "Barcodes are managed under Units & Identifiers.", "PRODUCT_FIELD_GOVERNED");
  for (const field of STOCK_FIELDS)
    if (has(input, field)) throw new ProductError(409, "Stock is not an item field. Change it with a goods receipt, opening stock, adjustment, transfer or return.", "PRODUCT_STOCK_NOT_EDITABLE");
  for (const field of PRICE_FIELDS)
    if (has(input, field)) throw new ProductError(409, "Prices are not item fields: sales prices live in price lists, purchase prices on purchase orders, costs in Inventory valuation.", "PRODUCT_PRICE_NOT_EDITABLE");
  for (const field of ["parentItemId", "isVariantTemplate"]) if (has(input, field)) throw new ProductError(409, "Use Create Variant to add a variant.", "PRODUCT_FIELD_GOVERNED");
  const row = await loadProductRow(client, context, productId, { lock: true });
  if (has(input, "expectedVersion") && input.expectedVersion !== null && Number(input.expectedVersion) !== Number(row.version))
    throw new ProductError(409, "Someone else changed this item after you opened it. Reload it and make your change again.", "PRODUCT_VERSION_CONFLICT");
  const before = toProduct(row, { cost: true });
  const normalized = normalizeProductInput(input);
  delete normalized.barcode;
  // Leaving the sales or purchase unit empty means the base unit.
  for (const field of ["salesUomId", "purchaseUomId"]) if (has(normalized, field) && !normalized[field]) normalized[field] = normalized.baseUomId ?? before.baseUomId;
  const fields = [...Object.keys(PRODUCT_COLUMNS), "type"];
  let changed = fields.filter((field) => has(normalized, field) && !same(normalized[field], before[field]));
  // A new SKU is a SKU change: checked, recorded in the SKU history and the old SKU kept reserved.
  const newSku = changed.includes("code") ? normalized.code : null;
  if (newSku !== null) {
    changed = changed.filter((field) => field !== "code");
    if (!changed.length && !["salesUomFactor", "purchaseUomFactor"].some((field) => has(normalized, field))) return changeItemSku(client, context, row.id, { sku: newSku });
  }
  const factorChanged = ["salesUomFactor", "purchaseUomFactor"].filter((field) => has(normalized, field) && normalized[field] !== null && Number(normalized[field]) !== Number(before[field] ?? 0));
  if (!changed.length && !factorChanged.length) return getProduct(client, context, row.id);
  for (const field of [...changed, ...factorChanged]) if (FIELD_PERMISSION[field]) requireProductPermission(context, ...FIELD_PERMISSION[field]);
  // An item's units are configured by whoever manages units; changing a default or a factor also needs its own permission.
  if ([...changed, ...factorChanged].some((field) => ["salesUomId", "purchaseUomId", "salesUomFactor", "purchaseUomFactor"].includes(field)))
    requireProductPermission(context, PRODUCT_PERMISSIONS.manageUnits, "You do not have permission to change an item's units.");
  if (changed.includes("variantAttributes") && !before.parentItemId) throw issueError("variantAttributes", "Only a variant has variant attributes.");
  if (before.isVariantTemplate && ((changed.includes("type") && normalized.type === "stock") || (changed.includes("trackingType") && normalized.trackingType !== "none")
      || (changed.includes("isSellable") && normalized.isSellable) || (changed.includes("isPurchasable") && normalized.isPurchasable)))
    throw new ProductError(409, "A variant template is never stocked, bought or sold; its variants are.", "PRODUCT_TEMPLATE_LOCKED");

  const candidate = { ...before, ...Object.fromEntries(changed.map((field) => [field, normalized[field]])) };
  // A new base unit (only before the item is used): its old conversions are retired, so a default purchase or sales unit not chosen in the
  // same edit falls back to the new base unit.
  if (changed.includes("baseUomId")) for (const field of ["salesUomId", "purchaseUomId"]) {
    if (changed.includes(field)) continue;
    candidate[field] = candidate.baseUomId; normalized[field] = candidate.baseUomId;
    if (before[field] !== candidate.baseUomId) changed.push(field);
  }
  // What an item is cannot change under its history.
  if (changed.includes("type")) {
    const stockUses = await productUses(client, context, row.id, { only: ["stock movements", "stock balances"] });
    if (before.type === "stock" && stockUses.length)
      throw new ProductError(409, `This item has ${stockUses.join(" and ")}, so it must stay a Stock Item. Deactivate it and create a new item instead.`, "PRODUCT_TYPE_LOCKED");
    if (candidate.type === "service" || before.type === "service") {
      const used = await productUses(client, context, row.id, { only: TRANSACTIONS });
      if (used.length) throw new ProductError(409, `This item is already used on ${used.join(", ")}, so it cannot change between goods and service.`, "PRODUCT_TYPE_LOCKED");
    }
    if (candidate.type === "service" && row.tracking_type !== "none" && !changed.includes("trackingType"))
      throw new ProductError(409, "This item is batch or serial tracked in Inventory and cannot become a service.", "PRODUCT_TYPE_LOCKED");
  }
  if (changed.some((field) => ["trackingType", "valuationMethod"].includes(field))) {
    const stockUses = await productUses(client, context, row.id, { only: STOCK });
    if (stockUses.length)
      throw new ProductError(409, `This item has ${stockUses.join(" and ")}, so its ${changed.includes("trackingType") ? "tracking mode" : "valuation method"} can no longer change in an ordinary edit.`,
        changed.includes("trackingType") ? "PRODUCT_TRACKING_LOCKED" : "PRODUCT_VALUATION_LOCKED");
  }
  if (changed.includes("baseUomId")) {
    const used = await productUses(client, context, row.id, { only: TRANSACTIONS });
    if (used.length) throw new ProductError(409, `This item is already used on ${used.join(", ")}, so its base unit cannot change. Every quantity recorded so far is in ${before.baseUom?.code}.`, "PRODUCT_UOM_LOCKED");
  }
  // The category must hold the item's type; moving between categories never changes the item's profiles, valuation or tax.
  if ((changed.includes("categoryId") || changed.includes("type")) && candidate.categoryId)
    await validateItemCategoryAssignment(client, context, candidate.categoryId, candidate.type, { allowInactive: !changed.includes("categoryId") });
  if (candidate.isActive && changed.includes("categoryId") && candidate.type === "stock" && !candidate.categoryId) throw issueError("categoryId", "A stock item needs a category.");
  candidate.salesUomIdConverts = await hasConversion(client, context, row.id, candidate.salesUomId, candidate.baseUomId);
  candidate.purchaseUomIdConverts = await hasConversion(client, context, row.id, candidate.purchaseUomId, candidate.baseUomId);
  // An item no longer batch-tracked cannot keep requiring expiry dates or a shelf life.
  if (candidate.trackingType !== "batch" && changed.includes("trackingType")) {
    if (candidate.requiresExpiryDate && !changed.includes("requiresExpiryDate")) { candidate.requiresExpiryDate = false; normalized.requiresExpiryDate = false; changed.push("requiresExpiryDate"); }
  }
  if (!candidate.requiresExpiryDate && candidate.shelfLifeDays && !changed.includes("shelfLifeDays")) { candidate.shelfLifeDays = null; normalized.shelfLifeDays = null; changed.push("shelfLifeDays"); }
  if (candidate.type === "service" && candidate.trackingType !== "none" && !changed.includes("trackingType")) { candidate.trackingType = "none"; normalized.trackingType = "none"; changed.push("trackingType"); }
  assertValidProduct(normalized, candidate);
  // The type decides which tax categories fit, so a type change rechecks the tax category.
  await assertReferences(client, context, { ...Object.fromEntries(changed.map((field) => [field, normalized[field]])),
    ...(changed.includes("type") && candidate.taxCategoryId ? { taxCategoryId: candidate.taxCategoryId } : {}), type: candidate.type });
  if (changed.some((field) => ["trackingType", "baseUomId"].includes(field))) await assertSerialUnit(client, context, candidate);
  if (changed.includes("code") || changed.includes("name")) await assertUnique(client, context, { code: candidate.code, name: candidate.name }, row.id);

  const sets = ["updated_by = $3", "updated_at = now()", "version = version + 1"];
  const values = [context.organizationId, row.id, context.userId ?? null];
  const set = (column, value) => { values.push(value); sets.push(`${column} = $${values.length}`); };
  for (const field of changed) {
    if (field === "type") {
      const stored = storedType(candidate.type, row.item_type);
      set("item_type", stored.itemType);
      set("track_inventory", stored.trackInventory);
    } else set(PRODUCT_COLUMNS[field], field === "variantAttributes" ? JSON.stringify(normalized[field]) : normalized[field]);
  }
  await guardedWrite(client, "item_update", () => client.query(`UPDATE tenant.items SET ${sets.join(", ")} WHERE organization_id = $1 AND id = $2`, values));
  await saveConversion(client, context, row.id, candidate.baseUomId, candidate.salesUomId, normalized.salesUomFactor, { acknowledgeHistory: input.acknowledgeHistory === true });
  await saveConversion(client, context, row.id, candidate.baseUomId, candidate.purchaseUomId, normalized.purchaseUomFactor, { acknowledgeHistory: input.acknowledgeHistory === true });
  for (const [field, purpose, label] of [["purchaseUomId", "purchase", "Default purchase unit"], ["salesUomId", "sales", "Default sales unit"]]) {
    if (!changed.includes(field) && !changed.includes("baseUomId")) continue;
    const resolved = await resolveItemUnit(client, context.organizationId, row.id, candidate[field] || candidate.baseUomId, { purpose });
    if (!resolved.ok) throw issueError(field, `${label}: ${resolved.message}`, "PRODUCT_DEFAULT_UOM_INVALID", 409);
  }
  if (changed.includes("baseUomId"))
    await recordUomHistory(client, context, row.id, "base_changed", { uomId: candidate.baseUomId, from: { unit: before.baseUom?.code ?? null }, to: { unit: (await resolveItemUnit(client, context.organizationId, row.id, candidate.baseUomId)).unit?.code ?? null } });
  for (const [field, event] of [["purchaseUomId", "purchase_default_changed"], ["salesUomId", "sales_default_changed"]])
    if (changed.includes(field)) await recordUomHistory(client, context, row.id, event, { uomId: candidate[field], from: { unit: shown(before, field) }, to: { unitId: candidate[field] } });

  if (newSku !== null) await changeItemSku(client, context, row.id, { sku: newSku });
  const after = toProduct(await loadProductRow(client, context, row.id), { cost: true });
  if (changed.includes("categoryId"))
    await recordCategoryItemChange(client, context, { itemCode: after.code, fromCategoryId: before.categoryId, toCategoryId: after.categoryId, fromName: before.categoryName, toName: after.categoryName });
  const changes = Object.fromEntries([...changed, ...factorChanged].map((field) => [field, { label: PRODUCT_FIELD_LABELS[field] ?? field, from: shown(before, field), to: shown(after, field) }]));
  // Cost is recorded without the amounts, so the history does not reveal it.
  if (changes.standardCost) changes.standardCost = { label: PRODUCT_FIELD_LABELS.standardCost, sensitive: true };
  await recordProductHistory(client, context, row.id, "updated", `${[...changed, ...factorChanged].map((field) => PRODUCT_FIELD_LABELS[field] ?? field).join(", ")} changed`, changes);
  return getProduct(client, context, row.id);
}

// ------------------------------------------------------------------ reclassification

const ADOPTABLE = Object.freeze([
  ["valuationMethod", "Valuation method"], ["inventoryProfileId", "Inventory profile"], ["accountingProfileId", "Accounting profile"], ["taxCategoryId", "Tax profile"],
  ["hsnSacCode", "HSN / SAC"],
]);

// What moving the item to `categoryId` would suggest: each default of the new category that differs from the item's own setting, with
// where it comes from. Nothing is changed.
export async function previewReclassification(client, context, productId, categoryId) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.view, "You do not have permission to view items.");
  const item = toProduct(await loadProductRow(client, context, productId));
  await validateItemCategoryAssignment(client, context, requireUuid(categoryId, "Category"), item.type);
  const resolved = await resolveCategoryDefaults(client, context, categoryId);
  const differences = ADOPTABLE.filter(([field]) => !(item.type === "service" && field === "inventoryProfileId") && !(item.type !== "stock" && field === "valuationMethod"))
    .filter(([field]) => resolved[field]?.value && String(resolved[field].value) !== String(item[field] ?? ""))
    .map(([field, label]) => ({ field, label, current: item[field] ?? null, suggested: resolved[field].value, source: resolved[field].source, fromName: resolved[field].fromName }));
  return { itemId: item.id, categoryId, differences };
}

// Moves the item to another category: a classification change only — no stock, cost, valuation, tax or profile changes, and no
// document is touched. adoptDefaults (true, or a list of fields) also takes the new category's defaults, each through the item's own
// rules and permissions (valuation is fixed once stock has moved).
export async function reclassifyItem(client, context, productId, input = {}) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.reclassify, "You do not have permission to reclassify items.");
  const row = await loadProductRow(client, context, productId, { lock: true });
  if (has(input, "expectedVersion") && input.expectedVersion !== null && Number(input.expectedVersion) !== Number(row.version))
    throw new ProductError(409, "Someone else changed this item after you opened it. Reload it and make your change again.", "PRODUCT_VERSION_CONFLICT");
  const before = toProduct(row);
  const categoryId = requireUuid(input.categoryId, "Category");
  await validateItemCategoryAssignment(client, context, categoryId, before.type);
  if (categoryId !== before.categoryId) {
    await client.query(`UPDATE tenant.items SET group_id = $3, updated_by = $4, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, row.id, categoryId, context.userId ?? null]);
    const after = toProduct(await loadProductRow(client, context, row.id));
    const reason = text(input.reason).slice(0, 300) || null;
    await recordProductHistory(client, context, row.id, "updated", `Reclassified from ${before.categoryName ?? "no category"} to ${after.categoryName}${reason ? `: ${reason}` : ""}`,
      { categoryId: { label: "Category", from: before.categoryName, to: after.categoryName }, reason });
    await recordCategoryItemChange(client, context, { itemCode: after.code, fromCategoryId: before.categoryId, toCategoryId: categoryId, fromName: before.categoryName, toName: after.categoryName });
  }
  const preview = await previewReclassification(client, context, row.id, categoryId);
  const wanted = input.adoptDefaults === true ? preview.differences.map((entry) => entry.field) : Array.isArray(input.adoptDefaults) ? input.adoptDefaults : [];
  const adopt = Object.fromEntries(preview.differences.filter((entry) => wanted.includes(entry.field)).map((entry) => [entry.field, entry.suggested]));
  const product = Object.keys(adopt).length ? await updateProduct(client, context, row.id, adopt) : await getProduct(client, context, row.id);
  return { product, newDefaults: preview.differences.filter((entry) => !Object.hasOwn(adopt, entry.field)) };
}

// ------------------------------------------------------------------ lifecycle, delete

// What stands between the item and Active: an empty list means it can be activated.
export async function validateItemForActivation(client, context, productId) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.view, "You do not have permission to view items.");
  const product = toProduct(await loadProductRow(client, context, productId));
  const issues = activationIssues(product);
  return { ready: issues.length === 0, issues };
}

// Draft or Inactive -> Active. Activating checks the item is complete; reactivating an inactive item is the same permission.
export async function activateProduct(client, context, productId, input = {}) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.activate, "You do not have permission to activate items.");
  const row = await loadProductRow(client, context, productId, { lock: true });
  if (row.lifecycle_status === LIFECYCLE.active) throw new ProductError(409, "This item is already active.", "PRODUCT_STATUS_UNCHANGED");
  const product = toProduct(row);
  const issues = activationIssues(product);
  if (issues.length) throw new ProductError(400, issues[0].message, "PRODUCT_NOT_READY", { issues });
  const reactivated = row.lifecycle_status === LIFECYCLE.inactive;
  await client.query(
    `UPDATE tenant.items SET lifecycle_status = 'active', activated_at = COALESCE(activated_at, now()), activated_by = COALESCE(activated_by, $4), updated_by = $4, updated_at = now(), version = version + 1
      WHERE organization_id = $1 AND id = $2 AND lifecycle_status = $3`, [context.organizationId, row.id, row.lifecycle_status, context.userId ?? null]);
  const note = text(input.reason).slice(0, 300);
  await recordProductHistory(client, context, row.id, "activated", `${reactivated ? "Reactivated" : "Activated"}${note ? `: ${note}` : ""}`, { from: row.lifecycle_status, to: "active", reason: note || null });
  return getProduct(client, context, row.id);
}

// Active -> Inactive. The item stays on every document, report and stock balance; its stock can still be returned, transferred, adjusted or
// disposed of. It is no longer offered on new transactions.
export async function deactivateProduct(client, context, productId, input = {}) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.activate, "You do not have permission to deactivate items.");
  const row = await loadProductRow(client, context, productId, { lock: true });
  if (row.lifecycle_status === LIFECYCLE.inactive) throw new ProductError(409, "This item is already inactive.", "PRODUCT_STATUS_UNCHANGED");
  if (row.lifecycle_status === LIFECYCLE.draft) throw new ProductError(409, "A draft item is not in use: delete it instead.", "PRODUCT_DRAFT");
  await client.query(`UPDATE tenant.items SET lifecycle_status = 'inactive', updated_by = $3, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, context.userId ?? null]);
  const note = text(input.reason).slice(0, 300);
  await recordProductHistory(client, context, row.id, "deactivated", `Deactivated${note ? `: ${note}` : ""}`, { from: "active", to: "inactive", reason: note || null });
  return getProduct(client, context, row.id);
}

// Only an item that has never been used can be deleted.
export async function deleteProduct(client, context, productId) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.delete, "You do not have permission to delete items.");
  const row = await loadProductRow(client, context, productId, { lock: true });
  const used = await productUses(client, context, row.id);
  if (used.length) throw new ProductError(409, `This item is used on ${used.join(", ")}. Deactivate it instead of deleting it.`, "PRODUCT_IN_USE", { references: used });
  await client.query("SAVEPOINT product_delete");
  try {
    for (const table of ["item_uom_conversions", "item_identifiers"]) await client.query(`DELETE FROM tenant.${table} WHERE organization_id = $1 AND item_id = $2`, [context.organizationId, row.id]);
    await client.query(`DELETE FROM tenant.items WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id]);
    await client.query("RELEASE SAVEPOINT product_delete");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT product_delete");
    if (error?.code === "23503") throw new ProductError(409, "This item is used by other records. Deactivate it instead of deleting it.", "PRODUCT_IN_USE");
    throw error;
  }
  return { deleted: true };
}

export { productCan };
