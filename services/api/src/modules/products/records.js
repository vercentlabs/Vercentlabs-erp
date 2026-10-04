// The product and service record: create, read, list, update, activate,
// deactivate and delete. A product is one tenant.items row, the same record
// Inventory, Procurement, Manufacturing and POS use, so there is never a
// second copy of an item to keep in step.
//
// Each group of fields has its own permission: ordinary details (Edit),
// the default sales price (Edit Pricing), HSN / SAC and tax category
// (Edit Tax), type, base unit, SKU, barcode and code (Edit Inventory), and
// costs (Edit Cost). Changing what an item fundamentally is (its type or base
// unit) is refused once it has been used.
import { nextDocumentNumber } from "../../core/platform/numbering/index.js";
import { canViewProductCost, productCan, productCapabilities, requireProductPermission } from "./access.js";
import { PRODUCT_NUMBER_DOCUMENT_TYPE, PRODUCT_PERMISSIONS, PRODUCT_TYPE_SQL, PRODUCT_VIEWS, ProductError, productTypeLabel, productTypeOf } from "./constants.js";
import { findDuplicateProducts } from "./duplicates.js";
import { recordProductHistory } from "./history.js";
import { PRODUCT_COLUMNS, PRODUCT_FIELD_LABELS, assertValidProduct, has, isUuid, normalizeProductInput, requireUuid, text } from "./validation.js";

const num = (value) => (value === null || value === undefined ? null : Number(value));

export const PRODUCT_SELECT = `
  SELECT item.*, ${PRODUCT_TYPE_SQL("item")} AS product_type,
         category.name AS category_name, parent.name AS category_parent_name,
         base.code AS base_uom_code, base.name AS base_uom_name, sales_uom.code AS sales_uom_code, sales_uom.name AS sales_uom_name,
         purchase_uom.code AS purchase_uom_code, purchase_uom.name AS purchase_uom_name,
         tax.name AS tax_category_name, tax_rate.rate AS gst_rate, cess.rate AS cess_rate,
         sales_factor.factor AS sales_uom_factor, purchase_factor.factor AS purchase_uom_factor,
         creator.full_name AS created_by_name, updater.full_name AS updated_by_name
    FROM tenant.items item
    LEFT JOIN tenant.item_groups category ON category.organization_id = item.organization_id AND category.id = item.group_id
    LEFT JOIN tenant.item_groups parent ON parent.organization_id = category.organization_id AND parent.id = category.parent_id
    LEFT JOIN tenant.units_of_measure base ON base.organization_id = item.organization_id AND base.id = item.uom_id
    LEFT JOIN tenant.units_of_measure sales_uom ON sales_uom.organization_id = item.organization_id AND sales_uom.id = item.sales_uom_id
    LEFT JOIN tenant.units_of_measure purchase_uom ON purchase_uom.organization_id = item.organization_id AND purchase_uom.id = item.purchase_uom_id
    LEFT JOIN tenant.tax_categories tax ON tax.organization_id = item.organization_id AND tax.id = item.tax_category_id
    LEFT JOIN LATERAL (
      SELECT rate FROM tenant.tax_rates r WHERE r.organization_id = item.organization_id AND r.tax_category_id = item.tax_category_id AND r.status = 'active'
         AND r.tax_type IN ('gst', 'igst') AND (r.effective_from IS NULL OR r.effective_from <= current_date) AND (r.effective_to IS NULL OR r.effective_to >= current_date)
       ORDER BY r.tax_type = 'gst' DESC, r.effective_from DESC NULLS LAST LIMIT 1) tax_rate ON true
    LEFT JOIN LATERAL (
      SELECT rate FROM tenant.tax_rates r WHERE r.organization_id = item.organization_id AND r.tax_category_id = item.tax_category_id AND r.status = 'active' AND r.tax_type = 'cess'
         AND (r.effective_from IS NULL OR r.effective_from <= current_date) AND (r.effective_to IS NULL OR r.effective_to >= current_date) LIMIT 1) cess ON true
    LEFT JOIN LATERAL (
      SELECT conversion_factor AS factor FROM tenant.item_uom_conversions c WHERE c.organization_id = item.organization_id AND c.item_id = item.id AND c.status = 'active'
         AND c.from_uom_id = item.sales_uom_id AND c.to_uom_id = item.uom_id LIMIT 1) sales_factor ON true
    LEFT JOIN LATERAL (
      SELECT conversion_factor AS factor FROM tenant.item_uom_conversions c WHERE c.organization_id = item.organization_id AND c.item_id = item.id AND c.status = 'active'
         AND c.from_uom_id = item.purchase_uom_id AND c.to_uom_id = item.uom_id LIMIT 1) purchase_factor ON true
    LEFT JOIN public.users creator ON creator.id = item.created_by
    LEFT JOIN public.users updater ON updater.id = item.updated_by`;

export function toProduct(row, { cost = false } = {}) {
  const type = row.product_type ?? productTypeOf(row);
  const product = {
    id: row.id,
    code: row.code,
    name: row.name,
    type,
    typeLabel: productTypeLabel(type),
    isService: type === "service",
    categoryId: row.group_id,
    categoryName: row.category_name ? (row.category_parent_name ? `${row.category_parent_name} › ${row.category_name}` : row.category_name) : null,
    description: row.description,
    salesDescription: row.sales_description,
    purchaseDescription: row.purchase_description,
    sku: row.sku,
    barcode: row.barcode,
    baseUomId: row.uom_id,
    baseUom: row.base_uom_code ? { code: row.base_uom_code, name: row.base_uom_name } : null,
    salesUomId: row.sales_uom_id ?? row.uom_id,
    salesUom: row.sales_uom_code ? { code: row.sales_uom_code, name: row.sales_uom_name } : row.base_uom_code ? { code: row.base_uom_code, name: row.base_uom_name } : null,
    salesUomFactor: row.sales_uom_id && row.sales_uom_id !== row.uom_id ? num(row.sales_uom_factor) : 1,
    purchaseUomId: row.purchase_uom_id ?? row.uom_id,
    purchaseUom: row.purchase_uom_code ? { code: row.purchase_uom_code, name: row.purchase_uom_name } : row.base_uom_code ? { code: row.base_uom_code, name: row.base_uom_name } : null,
    purchaseUomFactor: row.purchase_uom_id && row.purchase_uom_id !== row.uom_id ? num(row.purchase_uom_factor) : 1,
    isSellable: row.is_sellable,
    isPurchasable: row.is_purchasable,
    inventoryTracked: row.track_inventory,
    trackingType: row.tracking_type,
    allowNegativeStock: row.allow_negative_stock,
    valuationMethod: row.valuation_method,
    hsnSacCode: row.hsn_sac_code,
    hsnSacLabel: type === "service" ? "SAC" : "HSN",
    taxCategoryId: row.tax_category_id,
    taxCategoryName: row.tax_category_name ?? null,
    gstRate: num(row.gst_rate),
    cessRate: num(row.cess_rate),
    defaultSalesPrice: num(row.sales_price) ?? 0,
    imageAttachmentId: row.image_attachment_id,
    status: row.status,
    isActive: row.status === "active",
    createdByName: row.created_by_name ?? null,
    createdAt: row.created_at,
    updatedByName: row.updated_by_name ?? null,
    updatedAt: row.updated_at,
  };
  if (cost) {
    product.defaultPurchaseCost = num(row.purchase_price) ?? 0;
    product.standardCost = num(row.standard_cost) ?? 0;
  }
  return product;
}

// ------------------------------------------------------------------ read

export async function loadProductRow(client, context, productId, { lock = false } = {}) {
  const { rows } = await client.query(
    `${PRODUCT_SELECT} WHERE item.organization_id = $1 AND item.id = $2${lock ? " FOR UPDATE OF item" : ""}`,
    [context.organizationId, requireUuid(productId, "Product")],
  );
  if (!rows[0]) throw new ProductError(404, "Product not found.", "PRODUCT_NOT_FOUND");
  return rows[0];
}

export async function getProduct(client, context, productId) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.view, "You do not have permission to view products.");
  const cost = canViewProductCost(context);
  return { ...toProduct(await loadProductRow(client, context, productId), { cost }), capabilities: productCapabilities(context) };
}

// ------------------------------------------------------------------ list

const SORT_COLUMNS = Object.freeze({
  code: "item.code", name: "lower(item.name)", type: "product_type", category: "lower(category.name)", defaultSalesPrice: "item.sales_price",
  createdAt: "item.created_at", updatedAt: "item.updated_at",
});
const VIEW_SQL = Object.freeze({
  products: "item.item_type <> 'service'",
  services: "item.item_type = 'service'",
  stock: "item.item_type <> 'service' AND item.track_inventory",
  non_stock: "item.item_type <> 'service' AND NOT item.track_inventory",
  inactive: "item.status = 'inactive'",
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
  if (text(filters.search)) {
    const term = bind(like(filters.search));
    where.push(`lower(concat_ws(' ', item.code, item.name, item.sku, item.barcode, item.hsn_sac_code, category.name)) LIKE ${term}`);
  }
  if (["stock", "non_stock", "service"].includes(filters.type)) where.push(`${PRODUCT_TYPE_SQL("item")} = ${bind(filters.type)}`);
  if (filters.categoryId === "none") where.push("item.group_id IS NULL");
  else if (isUuid(filters.categoryId)) where.push(`(item.group_id = ${bind(filters.categoryId)} OR category.parent_id = $${values.length})`);
  if (filters.status === "active" || filters.status === "inactive") where.push(`item.status = ${bind(filters.status)}`);
  for (const [filter, column] of [["sellable", "is_sellable"], ["purchasable", "is_purchasable"], ["inventoryTracked", "track_inventory"]]) {
    if (yes(filters[filter])) where.push(`item.${column}`);
    if (no(filters[filter])) where.push(`NOT item.${column}`);
  }
  if (text(filters.hsnSac) === "missing") where.push("(item.hsn_sac_code IS NULL OR item.hsn_sac_code = '')");
  else if (text(filters.hsnSac)) where.push(`item.hsn_sac_code LIKE ${bind(`${text(filters.hsnSac).replace(/[\\%_]/g, "\\$&")}%`)}`);
  if (filters.taxCategoryId === "none") where.push("item.tax_category_id IS NULL");
  else if (isUuid(filters.taxCategoryId)) where.push(`item.tax_category_id = ${bind(filters.taxCategoryId)}`);
  return { values, sql: `WHERE ${where.join(" AND ")}` };
}

// filters: view, search, type, categoryId, status, sellable, purchasable,
// inventoryTracked, hsnSac, taxCategoryId, sort, direction, limit, offset.
export async function listProducts(client, context, filters = {}) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.view, "You do not have permission to view products.");
  const cost = canViewProductCost(context);
  const { values, sql } = buildProductListWhere(context, filters);
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const sortKey = SORT_COLUMNS[filters.sort] ? filters.sort : "name";
  const direction = filters.direction === "desc" ? "DESC" : filters.direction === "asc" ? "ASC" : ["createdAt", "updatedAt"].includes(sortKey) ? "DESC" : "ASC";
  const { rows } = await client.query(
    `${PRODUCT_SELECT.replace("SELECT item.*", "SELECT count(*) OVER () AS total_count, item.*")} ${sql}
      ORDER BY ${SORT_COLUMNS[sortKey]} ${direction} NULLS LAST, item.code LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  return {
    products: rows.map((row) => toProduct(row, { cost })),
    total: Number(rows[0]?.total_count ?? 0),
    limit,
    offset,
    views: PRODUCT_VIEWS,
    showsCost: cost,
    capabilities: productCapabilities(context),
  };
}

// ------------------------------------------------------------------ write helpers

// The category, units and tax category must be this organisation's and in use.
async function assertReferences(client, context, next) {
  const organizationId = context.organizationId;
  const one = async (sql, value) => (await client.query(sql, [organizationId, value])).rows[0];
  const issue = (field, message) => { throw new ProductError(400, message, "PRODUCT_VALIDATION", { issues: [{ field, message }] }); };
  if (next.categoryId && !(await one(`SELECT 1 FROM tenant.item_groups WHERE organization_id = $1 AND id = $2 AND status = 'active'`, next.categoryId))) issue("categoryId", "Choose an active category.");
  for (const field of ["baseUomId", "salesUomId", "purchaseUomId"])
    if (next[field] && !(await one(`SELECT 1 FROM tenant.units_of_measure WHERE organization_id = $1 AND id = $2 AND status = 'active'`, next[field]))) issue(field, "Choose an active unit of measure.");
  if (next.taxCategoryId && !(await one(`SELECT 1 FROM tenant.tax_categories WHERE organization_id = $1 AND id = $2 AND status = 'active'`, next.taxCategoryId))) issue("taxCategoryId", "Choose an active tax category.");
  if (next.imageAttachmentId && !(await one(`SELECT 1 FROM public.attachments WHERE organization_id = $1 AND id = $2 AND entity_type = 'products.item' AND is_current AND archived_at IS NULL AND mime_type LIKE 'image/%'`, next.imageAttachmentId)))
    issue("imageAttachmentId", "Choose an image uploaded to this product.");
}

// Code, SKU and barcode are unique; refused with the product that has them.
async function assertUnique(client, context, candidate, exceptId = null) {
  const duplicates = await findDuplicateProducts(client, context, candidate, { excludeId: exceptId });
  const strong = duplicates.matches.filter((match) => match.strength === "strong");
  if (strong.length) {
    const match = strong[0];
    const field = match.reasons[0].signal;
    const message = `${PRODUCT_FIELD_LABELS[field] ?? field} ${candidate[field]} already belongs to ${match.name} (${match.code}).`;
    throw new ProductError(409, message, "PRODUCT_DUPLICATE", { issues: [{ field, message }], matches: duplicates.matches });
  }
  return duplicates;
}

// Has the item been used anywhere? Returns the names of what uses it.
const USES = Object.freeze([
  ["quotations", "SELECT 1 FROM tenant.sales_quotation_lines WHERE organization_id = $1 AND item_id = $2"],
  ["sales orders", "SELECT 1 FROM tenant.sales_order_lines WHERE organization_id = $1 AND item_id = $2"],
  ["invoices", "SELECT 1 FROM tenant.accounting_customer_invoice_lines WHERE organization_id = $1 AND item_id = $2"],
  ["supplier bills", "SELECT 1 FROM tenant.accounting_vendor_bill_lines WHERE organization_id = $1 AND item_id = $2"],
  ["purchase orders", "SELECT 1 FROM tenant.procurement_purchase_order_lines WHERE organization_id = $1 AND item_id = $2"],
  ["goods receipts", "SELECT 1 FROM tenant.procurement_receipt_lines WHERE organization_id = $1 AND item_id = $2"],
  ["stock movements", "SELECT 1 FROM tenant.stock_movements WHERE organization_id = $1 AND item_id = $2"],
  ["stock balances", "SELECT 1 FROM tenant.stock_balances WHERE organization_id = $1 AND item_id = $2"],
  ["bills of materials", "SELECT 1 FROM tenant.manufacturing_boms WHERE organization_id = $1 AND item_id = $2 UNION ALL SELECT 1 FROM tenant.manufacturing_bom_components WHERE organization_id = $1 AND item_id = $2"],
  ["work orders", "SELECT 1 FROM tenant.manufacturing_work_orders WHERE organization_id = $1 AND item_id = $2"],
  ["POS sales", "SELECT 1 FROM tenant.pos_sale_lines WHERE organization_id = $1 AND item_id = $2"],
  ["opportunities", "SELECT 1 FROM tenant.crm_opportunity_items WHERE organization_id = $1 AND item_id = $2"],
  ["price lists", "SELECT 1 FROM tenant.price_list_items WHERE organization_id = $1 AND item_id = $2"],
  ["variants", "SELECT 1 FROM tenant.item_variants WHERE organization_id = $1 AND item_id = $2"],
]);

export async function productUses(client, context, itemId, { only = null } = {}) {
  const found = [];
  for (const [label, sql] of USES) {
    if (only && !only.includes(label)) continue;
    if ((await client.query(`SELECT 1 FROM (${sql}) used LIMIT 1`, [context.organizationId, itemId])).rows[0]) found.push(label);
  }
  return found;
}
const TRANSACTIONS = ["quotations", "sales orders", "invoices", "supplier bills", "purchase orders", "goods receipts", "stock movements", "stock balances", "work orders", "POS sales"];
const STOCK = ["stock movements", "stock balances"];

// Keeps the item's conversion "1 {uom} = factor base units" in step with the form.
async function saveConversion(client, context, itemId, baseUomId, uomId, factor) {
  if (!uomId || uomId === baseUomId || factor === null || factor === undefined) return;
  await client.query(
    `INSERT INTO tenant.item_uom_conversions (organization_id, item_id, from_uom_id, to_uom_id, conversion_factor, status, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, 'active', $6, $6)
     ON CONFLICT (organization_id, item_id, from_uom_id, to_uom_id) DO UPDATE SET conversion_factor = EXCLUDED.conversion_factor, status = 'active', updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [context.organizationId, itemId, uomId, baseUomId, factor, context.userId ?? null],
  );
}

async function hasConversion(client, context, itemId, uomId, baseUomId) {
  if (!itemId || !uomId || uomId === baseUomId) return true;
  return Boolean((await client.query(
    `SELECT 1 FROM tenant.item_uom_conversions WHERE organization_id = $1 AND item_id = $2 AND status = 'active'
        AND ((from_uom_id = $3 AND to_uom_id = $4) OR (from_uom_id = $4 AND to_uom_id = $3)) LIMIT 1`,
    [context.organizationId, itemId, uomId, baseUomId])).rows[0]);
}

// item_type and track_inventory for a product type. A goods item keeps its
// finer item_type (consumable, asset) when it stays goods.
function storedType(type, currentItemType = null) {
  if (type === "service") return { itemType: "service", trackInventory: false };
  const goods = currentItemType && currentItemType !== "service" ? currentItemType : "product";
  return { itemType: goods, trackInventory: type === "stock" };
}

// Field -> the permission it needs beyond Edit.
const FIELD_PERMISSION = Object.freeze({
  defaultSalesPrice: [PRODUCT_PERMISSIONS.editPricing, "You do not have permission to change default prices."],
  hsnSacCode: [PRODUCT_PERMISSIONS.editTax, "You do not have permission to change the tax classification."],
  taxCategoryId: [PRODUCT_PERMISSIONS.editTax, "You do not have permission to change the tax classification."],
  type: [PRODUCT_PERMISSIONS.editInventory, "You do not have permission to change inventory configuration."],
  baseUomId: [PRODUCT_PERMISSIONS.editInventory, "You do not have permission to change inventory configuration."],
  sku: [PRODUCT_PERMISSIONS.editInventory, "You do not have permission to change inventory configuration."],
  barcode: [PRODUCT_PERMISSIONS.editInventory, "You do not have permission to change inventory configuration."],
  code: [PRODUCT_PERMISSIONS.editInventory, "You do not have permission to change the product code."],
  trackingType: [PRODUCT_PERMISSIONS.editInventory, "You do not have permission to change inventory configuration."],
  allowNegativeStock: [PRODUCT_PERMISSIONS.editInventory, "You do not have permission to change inventory configuration."],
  valuationMethod: [PRODUCT_PERMISSIONS.editInventory, "You do not have permission to change inventory configuration."],
  defaultPurchaseCost: [PRODUCT_PERMISSIONS.editCost, "You do not have permission to change costs."],
  standardCost: [PRODUCT_PERMISSIONS.editCost, "You do not have permission to change costs."],
});

// ------------------------------------------------------------------ create

// input: type, code (generated when empty), name, category, descriptions,
// units (with salesUomFactor / purchaseUomFactor when they differ from the
// base unit), flags, SKU, barcode, HSN / SAC, tax category, prices, status.
export async function createProduct(client, context, input = {}, { origin = "manual" } = {}) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.create, "You do not have permission to create products.");
  const normalized = normalizeProductInput({ type: "stock", isSellable: true, isPurchasable: true, ...input });
  for (const field of ["defaultPurchaseCost", "standardCost"]) if (normalized[field]) requireProductPermission(context, ...FIELD_PERMISSION[field]);
  const candidate = { ...normalized, salesUomIdConverts: false, purchaseUomIdConverts: false };
  if (!candidate.salesUomId) candidate.salesUomId = candidate.baseUomId;
  if (!candidate.purchaseUomId) candidate.purchaseUomId = candidate.baseUomId;
  assertValidProduct(normalized, candidate);
  const status = text(input.status) || "active";
  if (!["active", "inactive"].includes(status)) throw new ProductError(400, "Choose Active or Inactive.", "PRODUCT_VALIDATION", { issues: [{ field: "status", message: "Choose Active or Inactive." }] });
  await assertReferences(client, context, candidate);
  if (!candidate.code) candidate.code = await nextDocumentNumber(client, { organizationId: context.organizationId }, { documentType: PRODUCT_NUMBER_DOCUMENT_TYPE });
  await assertUnique(client, context, candidate);

  const stored = storedType(candidate.type);
  const columns = ["organization_id", "code", "item_type", "track_inventory", "status", "created_by", "updated_by"];
  const values = [context.organizationId, candidate.code, stored.itemType, stored.trackInventory, status, context.userId ?? null, context.userId ?? null];
  for (const [field, column] of Object.entries(PRODUCT_COLUMNS)) {
    if (field === "code") continue;
    const value = candidate[field];
    if (value !== null && value !== undefined) { columns.push(column); values.push(value); }
  }
  const { rows } = await client.query(
    `INSERT INTO tenant.items (${columns.join(", ")}) VALUES (${values.map((_value, index) => `$${index + 1}`).join(", ")}) RETURNING id`,
    values,
  );
  const id = rows[0].id;
  await saveConversion(client, context, id, candidate.baseUomId, candidate.salesUomId, normalized.salesUomFactor);
  await saveConversion(client, context, id, candidate.baseUomId, candidate.purchaseUomId, normalized.purchaseUomFactor);
  if (normalized.imageAttachmentId) await client.query(`UPDATE tenant.items SET image_attachment_id = $3 WHERE organization_id = $1 AND id = $2`, [context.organizationId, id, normalized.imageAttachmentId]);
  await recordProductHistory(client, context, id, origin === "import" ? "imported" : "created", `${productTypeLabel(candidate.type)} ${candidate.code} created`, { type: candidate.type, origin });
  return getProduct(client, context, id);
}

// ------------------------------------------------------------------ update

const SHOWN = Object.freeze({
  categoryId: "categoryName", baseUomId: "baseUom", salesUomId: "salesUom", purchaseUomId: "purchaseUom", taxCategoryId: "taxCategoryName", type: "typeLabel",
});
const shown = (product, field) => {
  const value = product[SHOWN[field] ?? field];
  return value && typeof value === "object" ? value.code : value ?? null;
};

export async function updateProduct(client, context, productId, input = {}) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.edit, "You do not have permission to edit products.");
  if (has(input, "status")) throw new ProductError(409, "Use Activate or Deactivate to change the status.", "PRODUCT_FIELD_GOVERNED");
  const row = await loadProductRow(client, context, productId, { lock: true });
  const before = toProduct(row, { cost: true });
  const normalized = normalizeProductInput(input);
  // Leaving the sales or purchase unit empty means the base unit.
  for (const field of ["salesUomId", "purchaseUomId"]) if (has(normalized, field) && !normalized[field]) normalized[field] = normalized.baseUomId ?? before.baseUomId;
  const fields = [...Object.keys(PRODUCT_COLUMNS), "type", "imageAttachmentId"];
  const changed = fields.filter((field) => has(normalized, field) && String(normalized[field] ?? "") !== String(before[field] ?? ""));
  const factorChanged = ["salesUomFactor", "purchaseUomFactor"].filter((field) => has(normalized, field) && normalized[field] !== null && Number(normalized[field]) !== Number(before[field] ?? 0));
  if (!changed.length && !factorChanged.length) return getProduct(client, context, row.id);
  for (const field of changed) if (FIELD_PERMISSION[field]) requireProductPermission(context, ...FIELD_PERMISSION[field]);
  if (factorChanged.length) requireProductPermission(context, PRODUCT_PERMISSIONS.editInventory, "You do not have permission to change unit conversions.");

  const candidate = { ...before, ...Object.fromEntries(changed.map((field) => [field, normalized[field]])) };
  // What an item is cannot change under its history.
  if (changed.includes("type")) {
    const stockUses = await productUses(client, context, row.id, { only: STOCK });
    if (before.type === "stock" && stockUses.length)
      throw new ProductError(409, `This item has ${stockUses.join(" and ")}, so it must stay a Stock Item. Deactivate it and create a new product instead.`, "PRODUCT_TYPE_LOCKED");
    if (candidate.type === "service" || before.type === "service") {
      const used = await productUses(client, context, row.id, { only: TRANSACTIONS });
      if (used.length) throw new ProductError(409, `This item is already used on ${used.join(", ")}, so it cannot change between goods and service.`, "PRODUCT_TYPE_LOCKED");
    }
    if (candidate.type === "service" && row.tracking_type !== "none")
      throw new ProductError(409, "This item is batch or serial tracked in Inventory and cannot become a service.", "PRODUCT_TYPE_LOCKED");
  }
  if (changed.some((field) => ["trackingType", "valuationMethod"].includes(field))) {
    const stockUses = await productUses(client, context, row.id, { only: STOCK });
    if (stockUses.length) throw new ProductError(409, `This item has ${stockUses.join(" and ")}, so its tracking and valuation method can no longer change.`, "PRODUCT_INVENTORY_LOCKED");
  }
  if (changed.includes("baseUomId")) {
    const used = await productUses(client, context, row.id, { only: TRANSACTIONS });
    if (used.length) throw new ProductError(409, `This item is already used on ${used.join(", ")}, so its base unit cannot change. Every quantity recorded so far is in ${before.baseUom?.code}.`, "PRODUCT_UOM_LOCKED");
  }
  // A service carries no SKU or barcode: becoming one clears them.
  if (candidate.type === "service" && before.type !== "service") { candidate.sku = null; candidate.barcode = null; }
  candidate.salesUomIdConverts = await hasConversion(client, context, row.id, candidate.salesUomId, candidate.baseUomId);
  candidate.purchaseUomIdConverts = await hasConversion(client, context, row.id, candidate.purchaseUomId, candidate.baseUomId);
  assertValidProduct(normalized, candidate);
  await assertReferences(client, context, Object.fromEntries(changed.map((field) => [field, normalized[field]])));

  if (changed.some((field) => ["code", "sku", "barcode"].includes(field)) || changed.includes("name"))
    await assertUnique(client, context, { code: candidate.code, sku: candidate.sku, barcode: candidate.barcode }, row.id);

  const sets = ["updated_by = $3", "updated_at = now()"];
  const values = [context.organizationId, row.id, context.userId ?? null];
  const set = (column, value) => { values.push(value); sets.push(`${column} = $${values.length}`); };
  for (const field of changed) {
    if (field === "type") {
      const stored = storedType(candidate.type, row.item_type);
      set("item_type", stored.itemType);
      set("track_inventory", stored.trackInventory);
    } else if (field === "imageAttachmentId") set("image_attachment_id", normalized.imageAttachmentId);
    else set(PRODUCT_COLUMNS[field], normalized[field]);
  }
  // A service carries no stock identity.
  if (candidate.type === "service") for (const column of ["sku", "barcode"]) if (row[column]) set(column, null);
  await client.query(`UPDATE tenant.items SET ${sets.join(", ")} WHERE organization_id = $1 AND id = $2`, values);
  await saveConversion(client, context, row.id, candidate.baseUomId, candidate.salesUomId, normalized.salesUomFactor);
  await saveConversion(client, context, row.id, candidate.baseUomId, candidate.purchaseUomId, normalized.purchaseUomFactor);

  const after = toProduct(await loadProductRow(client, context, row.id), { cost: true });
  const changes = Object.fromEntries([...changed, ...factorChanged].map((field) => [field, { label: PRODUCT_FIELD_LABELS[field] ?? field, from: shown(before, field), to: shown(after, field) }]));
  // Cost values are recorded without the amounts, so the history does not reveal them.
  for (const field of ["defaultPurchaseCost", "standardCost"]) if (changes[field]) changes[field] = { label: PRODUCT_FIELD_LABELS[field], sensitive: true };
  await recordProductHistory(client, context, row.id, "updated", `${[...changed, ...factorChanged].map((field) => PRODUCT_FIELD_LABELS[field] ?? field).join(", ")} changed`, changes);
  return getProduct(client, context, row.id);
}

// ------------------------------------------------------------------ status, delete

async function setStatus(client, context, productId, status, reason) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.activate, "You do not have permission to activate or deactivate products.");
  const row = await loadProductRow(client, context, productId, { lock: true });
  if (row.status === status) throw new ProductError(409, `This product is already ${status}.`, "PRODUCT_STATUS_UNCHANGED");
  await client.query(`UPDATE tenant.items SET status = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id, status, context.userId ?? null]);
  const note = text(reason).slice(0, 300);
  await recordProductHistory(client, context, row.id, status === "active" ? "activated" : "deactivated", `${status === "active" ? "Activated" : "Deactivated"}${note ? `: ${note}` : ""}`, { from: row.status, to: status, reason: note || null });
  return getProduct(client, context, row.id);
}

// An inactive product stays on every document and report; it cannot be
// chosen on new ones.
export const deactivateProduct = (client, context, productId, input = {}) => setStatus(client, context, productId, "inactive", input.reason);
export const activateProduct = (client, context, productId, input = {}) => setStatus(client, context, productId, "active", input.reason);

// Only a product that has never been used can be deleted.
export async function deleteProduct(client, context, productId) {
  requireProductPermission(context, PRODUCT_PERMISSIONS.delete, "You do not have permission to delete products.");
  const row = await loadProductRow(client, context, productId, { lock: true });
  const used = await productUses(client, context, row.id);
  if (used.length) throw new ProductError(409, `This product is used on ${used.join(", ")}. Deactivate it instead of deleting it.`, "PRODUCT_IN_USE", { references: used });
  await client.query("SAVEPOINT product_delete");
  try {
    await client.query(`DELETE FROM tenant.item_uom_conversions WHERE organization_id = $1 AND item_id = $2`, [context.organizationId, row.id]);
    await client.query(`DELETE FROM tenant.items WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id]);
    await client.query("RELEASE SAVEPOINT product_delete");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT product_delete");
    if (error?.code === "23503") throw new ProductError(409, "This product is used by other records. Deactivate it instead of deleting it.", "PRODUCT_IN_USE");
    throw error;
  }
  return { deleted: true };
}

export { productCan };
