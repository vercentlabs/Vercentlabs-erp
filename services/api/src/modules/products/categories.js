// Item categories: the one hierarchy Sales, Procurement, Inventory, Finance and reporting share (tenant.item_groups, shown as
// Categories). An item has one primary category. A category:
//   * sits under one parent, at any depth, ordered among its siblings; it is never its own ancestor (also enforced by the database);
//   * may restrict which item types it holds (stock / non-stock / service), never wider than its parent;
//   * suggests defaults for new items — valuation method, inventory profile and accounting profile (Finance's), tax profile and HSN /
//     SAC — inherited from the nearest ancestor that sets one, else the company default. Defaults are copied onto an item when it is
//     created (or when it explicitly adopts them): changing a category never rewrites existing items;
//   * never holds stock, value or prices: counts, stock and value are read from items and Inventory.
// A used category is deactivated, not deleted; moving a category or reclassifying an item is a classification change only.
import { USABLE_ROW } from "../stock/index.js";
import { canViewProductCost, canViewProductStock, productCan, requireProductPermission } from "./access.js";
import { PRODUCT_PERMISSIONS, PRODUCT_TYPES, PRODUCT_TYPE_SQL, ProductError, VALUATION_METHODS, valuationLabel } from "./constants.js";
import { SKU_PATTERN, has, isUuid, requireUuid, text } from "./validation.js";

const VALUATION = new Set(VALUATION_METHODS.map((entry) => entry.code));
const TYPE_CODES = PRODUCT_TYPES.map((entry) => entry.code);
const TYPE_LABELS = new Map(PRODUCT_TYPES.map((entry) => [entry.code, entry.label]));
const P = PRODUCT_PERMISSIONS;
const LABELS = Object.freeze({
  code: "Code", name: "Name", description: "Description", sortOrder: "Sort order", allowedItemTypes: "Allowed item types", iconAttachmentId: "Icon",
  defaultValuationMethod: "Default valuation method", defaultInventoryProfileId: "Default inventory profile", defaultAccountingProfileId: "Default accounting profile",
  defaultTaxCategoryId: "Default tax profile", defaultHsnSacCode: "Default HSN / SAC", parentId: "Parent category", skuPrefix: "SKU prefix",
});
const COLUMNS = Object.freeze({
  code: "code", name: "name", description: "description", sortOrder: "sort_order", allowedItemTypes: "allowed_item_types", iconAttachmentId: "icon_attachment_id",
  defaultValuationMethod: "default_valuation_method", defaultInventoryProfileId: "default_inventory_profile_id", defaultAccountingProfileId: "default_accounting_profile_id",
  defaultTaxCategoryId: "default_tax_category_id", defaultHsnSacCode: "default_hsn_sac_code", skuPrefix: "sku_prefix",
});
// Each group of category defaults and the permission it needs beyond Manage Categories.
const FIELD_PERMISSION = Object.freeze({
  defaultValuationMethod: [P.categoryInventoryDefaults, "You do not have permission to change a category's inventory defaults."],
  defaultInventoryProfileId: [P.categoryInventoryDefaults, "You do not have permission to change a category's inventory defaults."],
  defaultAccountingProfileId: [P.categoryAccountingDefaults, "You do not have permission to change a category's accounting defaults."],
  defaultTaxCategoryId: [P.categoryTaxDefaults, "You do not have permission to change a category's tax defaults."],
  defaultHsnSacCode: [P.categoryTaxDefaults, "You do not have permission to change a category's tax defaults."],
});
// The defaults a category passes down, with the column that holds each.
const DEFAULTS = Object.freeze([
  { field: "valuationMethod", column: "default_valuation_method", label: "Valuation method" },
  { field: "inventoryProfileId", column: "default_inventory_profile_id", label: "Inventory profile" },
  { field: "accountingProfileId", column: "default_accounting_profile_id", label: "Accounting profile" },
  { field: "taxCategoryId", column: "default_tax_category_id", label: "Tax profile" },
  { field: "hsnSacCode", column: "default_hsn_sac_code", label: "HSN / SAC" },
]);
const issue = (field, message, code = "CATEGORY_VALIDATION", status = 400) => new ProductError(status, message, code, { issues: [{ field, message }] });
const ZERO = "00000000-0000-0000-0000-000000000000";

// ------------------------------------------------------------------ the tree

// Every category of the organization with its direct counts; the hierarchy is assembled in memory (a catalogue holds hundreds of
// categories, not millions).
async function loadAll(client, context) {
  const { rows } = await client.query(
    `SELECT category.*, tax.name AS default_tax_category_name, inv.name AS default_inventory_profile_name, acc.name AS default_accounting_profile_name,
            (SELECT count(*) FROM tenant.items item WHERE item.organization_id = category.organization_id AND item.group_id = category.id)::int AS direct_items,
            (SELECT count(*) FROM tenant.items item WHERE item.organization_id = category.organization_id AND item.group_id = category.id AND item.lifecycle_status = 'active')::int AS direct_active_items
       FROM tenant.item_groups category
       LEFT JOIN tenant.tax_categories tax ON tax.organization_id = category.organization_id AND tax.id = category.default_tax_category_id
       LEFT JOIN tenant.accounting_item_profiles inv ON inv.organization_id = category.organization_id AND inv.id = category.default_inventory_profile_id
       LEFT JOIN tenant.accounting_item_profiles acc ON acc.organization_id = category.organization_id AND acc.id = category.default_accounting_profile_id
      WHERE category.organization_id = $1`, [context.organizationId]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const children = new Map();
  for (const row of rows) children.set(row.parent_id ?? null, [...(children.get(row.parent_id ?? null) ?? []), row]);
  for (const list of children.values()) list.sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name));
  const ancestors = (id) => {
    const chain = [];
    let cursor = byId.get(id)?.parent_id ?? null;
    while (cursor && chain.length < 60) { const row = byId.get(cursor); if (!row) break; chain.unshift(row); cursor = row.parent_id; }
    return chain;
  };
  const descendants = (id) => {
    const found = [];
    const walk = (parent, depth) => { for (const row of children.get(parent) ?? []) { found.push(row); if (depth < 60) walk(row.id, depth + 1); } };
    walk(id, 0);
    return found;
  };
  // The item types a category may hold: the intersection of its own restriction and every ancestor's.
  const allowedTypes = (id) => {
    let allowed = [...TYPE_CODES];
    for (const row of [...ancestors(id), byId.get(id)].filter(Boolean)) if (row.allowed_item_types?.length) allowed = allowed.filter((type) => row.allowed_item_types.includes(type));
    return allowed;
  };
  return { rows, byId, children, ancestors, descendants, allowedTypes };
}

function toCategory(row, tree) {
  const chain = tree.ancestors(row.id);
  const descendants = tree.descendants(row.id);
  const subtree = [row, ...descendants];
  return {
    id: row.id, code: row.code, name: row.name, description: row.description, parentId: row.parent_id, parentName: row.parent_id ? tree.byId.get(row.parent_id)?.name ?? null : null,
    path: [...chain.map((entry) => entry.name), row.name].join(" › "), depth: chain.length,
    breadcrumb: [...chain, row].map((entry) => ({ id: entry.id, code: entry.code, name: entry.name })),
    status: row.status, isActive: row.status === "active", sortOrder: Number(row.sort_order ?? 0), iconAttachmentId: row.icon_attachment_id ?? null,
    allowedItemTypes: row.allowed_item_types ?? null, effectiveItemTypes: tree.allowedTypes(row.id),
    allowedItemTypesLabel: row.allowed_item_types?.length ? row.allowed_item_types.map((type) => TYPE_LABELS.get(type)).join(", ") : "All item types",
    defaultValuationMethod: row.default_valuation_method, defaultValuationLabel: row.default_valuation_method ? valuationLabel(row.default_valuation_method) : null,
    defaultInventoryProfileId: row.default_inventory_profile_id, defaultInventoryProfileName: row.default_inventory_profile_name ?? null,
    defaultAccountingProfileId: row.default_accounting_profile_id, defaultAccountingProfileName: row.default_accounting_profile_name ?? null,
    defaultTaxCategoryId: row.default_tax_category_id, defaultTaxCategoryName: row.default_tax_category_name ?? null, defaultHsnSacCode: row.default_hsn_sac_code,
    skuPrefix: row.sku_prefix ?? null,
    childCount: (tree.children.get(row.id) ?? []).length, descendantCount: descendants.length,
    directItems: Number(row.direct_items ?? 0), directActiveItems: Number(row.direct_active_items ?? 0),
    totalItems: subtree.reduce((sum, entry) => sum + Number(entry.direct_items ?? 0), 0),
    totalActiveItems: subtree.reduce((sum, entry) => sum + Number(entry.direct_active_items ?? 0), 0),
    version: Number(row.version ?? 1), createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

async function record(client, context, categoryId, eventType, summary, changes = {}) {
  await client.query(
    `INSERT INTO tenant.item_category_history (organization_id, category_id, event_type, summary, changes, actor_user_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp())`,
    [context.organizationId, categoryId, eventType, String(summary).slice(0, 500), JSON.stringify(changes), context.userId ?? null]);
}
// Recorded on both categories when an item moves between them.
export async function recordCategoryItemChange(client, context, { itemCode, fromCategoryId, toCategoryId, fromName, toName }) {
  if (fromCategoryId) await record(client, context, fromCategoryId, "updated", `Item ${itemCode} moved to ${toName ?? "no category"}`, { kind: "item_removed", item: itemCode, to: toName ?? null });
  if (toCategoryId) await record(client, context, toCategoryId, "updated", `Item ${itemCode} assigned${fromName ? ` (from ${fromName})` : ""}`, { kind: "item_assigned", item: itemCode, from: fromName ?? null });
}

// filters: includeInactive (default true), status, search (code, name, description, parent path), parentId ("root" for the top level),
// hasItems / hasChildren ("yes" | "no"), profileId (an inventory or accounting default). The tree in order: parents before children,
// siblings by sort order then name.
export async function listItemCategories(client, context, filters = {}) {
  requireProductPermission(context, P.view, "You do not have permission to view categories.");
  const tree = await loadAll(client, context);
  const ordered = [];
  const walk = (parentId, depth) => { for (const row of tree.children.get(parentId) ?? []) { ordered.push(row); if (depth < 60) walk(row.id, depth + 1); } };
  walk(null, 0);
  const term = text(filters.search).toLowerCase();
  const includeInactive = filters.includeInactive !== false;
  return ordered.map((row) => toCategory(row, tree)).filter((entry) =>
    (includeInactive || entry.isActive) && (!filters.status || filters.status === "all" || entry.status === filters.status)
    && (!term || `${entry.code} ${entry.path} ${entry.description ?? ""}`.toLowerCase().includes(term))
    && (!filters.parentId || (filters.parentId === "root" ? !entry.parentId : entry.parentId === filters.parentId))
    && (!filters.hasItems || (filters.hasItems === "yes" ? entry.totalItems > 0 : entry.totalItems === 0))
    && (!filters.hasChildren || (filters.hasChildren === "yes" ? entry.childCount > 0 : entry.childCount === 0))
    && (!filters.profileId || entry.defaultInventoryProfileId === filters.profileId || entry.defaultAccountingProfileId === filters.profileId));
}
export const getItemCategoryTree = listItemCategories;

async function loadOne(client, context, categoryId, { lock = false } = {}) {
  const id = requireUuid(categoryId, "Category");
  if (lock) {
    const locked = (await client.query(`SELECT id FROM tenant.item_groups WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, id])).rows[0];
    if (!locked) throw new ProductError(404, "Category not found.", "CATEGORY_NOT_FOUND");
  }
  const tree = await loadAll(client, context);
  const row = tree.byId.get(id);
  if (!row) throw new ProductError(404, "Category not found.", "CATEGORY_NOT_FOUND");
  return { row, tree };
}

export async function getItemCategoryAncestors(client, context, categoryId) {
  requireProductPermission(context, P.view, "You do not have permission to view categories.");
  const { row, tree } = await loadOne(client, context, categoryId);
  return tree.ancestors(row.id).map((entry) => toCategory(entry, tree));
}
export async function getItemCategoryDescendants(client, context, categoryId) {
  requireProductPermission(context, P.view, "You do not have permission to view categories.");
  const { row, tree } = await loadOne(client, context, categoryId);
  return tree.descendants(row.id).map((entry) => toCategory(entry, tree));
}
export async function getCategoryBreadcrumb(client, context, categoryId) {
  return (await getItemCategory(client, context, categoryId, { history: false })).breadcrumb;
}

// ------------------------------------------------------------------ defaults

// The company's own defaults, used when no category in the chain sets one.
async function companyDefaults(client, context) {
  const row = (await client.query(`SELECT costing_method FROM tenant.stock_settings WHERE organization_id = $1`, [context.organizationId])).rows[0];
  return { valuationMethod: row?.costing_method ?? "moving_average" };
}

// What a new item in the category receives and where each value comes from: the category itself, the nearest ancestor that sets it,
// or the company default. { field: { value, source: "category" | "parent" | "company" | null, fromId, fromName } }.
export async function resolveCategoryDefaults(client, context, categoryId) {
  const company = await companyDefaults(client, context);
  const resolved = Object.fromEntries(DEFAULTS.map((entry) => [entry.field, { value: company[entry.field] ?? null, source: company[entry.field] ? "company" : null, fromId: null, fromName: null }]));
  if (!isUuid(categoryId)) return resolved;
  const tree = await loadAll(client, context);
  const own = tree.byId.get(categoryId);
  if (!own) return resolved;
  for (const entry of DEFAULTS) {
    const chain = [own, ...tree.ancestors(own.id).reverse()];
    const holder = chain.find((row) => row[entry.column]);
    if (holder) resolved[entry.field] = { value: holder[entry.column], source: holder.id === own.id ? "category" : "parent", fromId: holder.id, fromName: holder.name };
  }
  return resolved;
}

// Refuses a category that cannot hold an item of `type`: not this organization's, inactive (unless allowInactive), or restricted.
export async function validateItemCategoryAssignment(client, context, categoryId, type, { allowInactive = false } = {}) {
  const tree = await loadAll(client, context);
  const row = tree.byId.get(categoryId);
  if (!row) throw issue("categoryId", "Choose a category from this organization.", "PRODUCT_VALIDATION");
  if (row.status !== "active" && !allowInactive) throw issue("categoryId", "Choose an active category.", "PRODUCT_VALIDATION");
  const allowed = tree.allowedTypes(row.id);
  if (type && !allowed.includes(type))
    throw issue("categoryId", `${row.name} holds ${allowed.map((code) => TYPE_LABELS.get(code)).join(" and ") || "no items"} only, not a ${TYPE_LABELS.get(type)}.`, "CATEGORY_TYPE_NOT_ALLOWED", 409);
  return { allowed, name: row.name };
}

// ------------------------------------------------------------------ read one

export async function getItemCategory(client, context, categoryId, { history = true } = {}) {
  requireProductPermission(context, P.view, "You do not have permission to view categories.");
  const { row, tree } = await loadOne(client, context, categoryId);
  const category = toCategory(row, tree);
  const defaults = await resolveCategoryDefaults(client, context, row.id);
  const names = await defaultNames(client, context, defaults);
  category.resolvedDefaults = Object.fromEntries(Object.entries(defaults).map(([field, entry]) => [field, { ...entry, label: names[field] ?? entry.value }]));
  category.children = (tree.children.get(row.id) ?? []).map((child) => toCategory(child, tree));
  if (history) category.history = await getCategoryActivity(client, context, row.id);
  return category;
}

async function defaultNames(client, context, defaults) {
  const names = {};
  if (defaults.valuationMethod.value) names.valuationMethod = valuationLabel(defaults.valuationMethod.value);
  for (const field of ["inventoryProfileId", "accountingProfileId"]) if (defaults[field].value)
    names[field] = (await client.query(`SELECT code || ' · ' || name AS name FROM tenant.accounting_item_profiles WHERE organization_id = $1 AND id = $2`, [context.organizationId, defaults[field].value])).rows[0]?.name ?? null;
  if (defaults.taxCategoryId.value)
    names.taxCategoryId = (await client.query(`SELECT name FROM tenant.tax_categories WHERE organization_id = $1 AND id = $2`, [context.organizationId, defaults.taxCategoryId.value])).rows[0]?.name ?? null;
  if (defaults.hsnSacCode.value) names.hsnSacCode = defaults.hsnSacCode.value;
  return names;
}

export async function getCategoryActivity(client, context, categoryId) {
  requireProductPermission(context, P.view, "You do not have permission to view categories.");
  return (await client.query(
    `SELECT history.id, history.event_type, history.summary, history.changes, history.created_at, actor.full_name AS actor_name FROM tenant.item_category_history history
       LEFT JOIN public.users actor ON actor.id = history.actor_user_id WHERE history.organization_id = $1 AND history.category_id = $2 ORDER BY history.created_at DESC, history.id DESC LIMIT 300`,
    [context.organizationId, requireUuid(categoryId, "Category")])).rows
    .map((row) => ({ id: row.id, eventType: row.event_type, kind: row.changes?.kind ?? row.event_type, summary: row.summary, changes: row.changes, createdAt: row.created_at, actorName: row.actor_name }));
}

// ------------------------------------------------------------------ write

function normalize(input) {
  const out = {};
  if (has(input, "code")) out.code = text(input.code).toUpperCase() || null;
  for (const field of ["name", "description"]) if (has(input, field)) out[field] = text(input[field]).replace(/\s+/g, " ") || null;
  for (const field of ["defaultTaxCategoryId", "defaultInventoryProfileId", "defaultAccountingProfileId", "iconAttachmentId"]) if (has(input, field)) out[field] = text(input[field]) || null;
  if (has(input, "defaultValuationMethod")) out.defaultValuationMethod = text(input.defaultValuationMethod).toLowerCase() || null;
  if (has(input, "defaultHsnSacCode")) out.defaultHsnSacCode = text(input.defaultHsnSacCode).replace(/\s/g, "") || null;
  // A prefix for the SKUs generated for this category's items (an existing item's SKU never changes with it).
  if (has(input, "skuPrefix")) out.skuPrefix = text(input.skuPrefix).normalize("NFKC").toUpperCase() || null;
  if (has(input, "sortOrder")) out.sortOrder = input.sortOrder === null || text(input.sortOrder) === "" ? 0 : Number(input.sortOrder);
  if (has(input, "allowedItemTypes")) {
    // Every type, or none listed, means no restriction.
    const list = Array.isArray(input.allowedItemTypes) ? [...new Set(input.allowedItemTypes.map((type) => text(type).toLowerCase()).filter(Boolean))] : [];
    out.allowedItemTypes = list.some((type) => !TYPE_CODES.includes(type)) ? list : list.length && list.length < TYPE_CODES.length ? TYPE_CODES.filter((type) => list.includes(type)) : null;
  }
  return out;
}

async function validate(client, context, values, { categoryId = null, parentId = null, tree }) {
  if (!values.name) throw issue("name", "Enter the category name.");
  if (!values.code) throw issue("code", "Enter a short code, such as PUMPS.");
  if (values.code.length > 40 || !SKU_PATTERN.test(values.code)) throw issue("code", "Use up to 40 letters, numbers, dots, dashes or slashes.");
  if (values.name.length > 160) throw issue("name", "Must be 160 characters or fewer.");
  if (!Number.isInteger(values.sortOrder ?? 0) || Math.abs(values.sortOrder ?? 0) > 100000) throw issue("sortOrder", "Enter a whole number.");
  if (values.allowedItemTypes?.some((type) => !TYPE_CODES.includes(type))) throw issue("allowedItemTypes", "Choose Stock Item, Non-Stock Item or Service.");
  if (values.defaultValuationMethod && !VALUATION.has(values.defaultValuationMethod)) throw issue("defaultValuationMethod", "Choose Moving average or FIFO.");
  if (values.skuPrefix && !/^[A-Z0-9]{1,12}$/.test(values.skuPrefix)) throw issue("skuPrefix", "Use 1 to 12 letters or digits, such as PUMP.");
  if (values.defaultHsnSacCode && !/^[0-9]{4}([0-9]{2}){0,2}$/.test(values.defaultHsnSacCode)) throw issue("defaultHsnSacCode", "Enter a 4, 6 or 8-digit HSN or a 6-digit SAC.");
  const active = async (sql, id, field, message) => { if (id && !(isUuid(id) && (await client.query(sql, [context.organizationId, id])).rows[0])) throw issue(field, message); };
  await active(`SELECT 1 FROM tenant.tax_categories WHERE organization_id = $1 AND id = $2 AND status = 'active'`, values.defaultTaxCategoryId, "defaultTaxCategoryId", "Choose an active tax profile.");
  await active(`SELECT 1 FROM tenant.accounting_item_profiles WHERE organization_id = $1 AND id = $2 AND status = 'active' AND profile_kind = 'inventory'`, values.defaultInventoryProfileId, "defaultInventoryProfileId", "Choose an active inventory profile.");
  await active(`SELECT 1 FROM tenant.accounting_item_profiles WHERE organization_id = $1 AND id = $2 AND status = 'active' AND profile_kind = 'accounting'`, values.defaultAccountingProfileId, "defaultAccountingProfileId", "Choose an active accounting profile.");
  await active(`SELECT 1 FROM public.attachments WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL AND mime_type LIKE 'image/%'`, values.iconAttachmentId, "iconAttachmentId", "Choose an uploaded image.");
  if (parentId) {
    const parent = tree.byId.get(parentId);
    if (!parent) throw issue("parentId", "Choose a parent category from this organization.");
    if (parent.status !== "active") throw issue("parentId", "Choose an active parent category.");
    // A sub-category may narrow its parent's item types, never widen them.
    const parentAllowed = tree.allowedTypes(parent.id);
    if (values.allowedItemTypes?.some((type) => !parentAllowed.includes(type)))
      throw issue("allowedItemTypes", `${parent.name} holds ${parentAllowed.map((code) => TYPE_LABELS.get(code)).join(" and ")} only; a sub-category cannot allow more.`);
  }
  const clash = (await client.query(`SELECT name FROM tenant.item_groups WHERE organization_id = $1 AND upper(code) = $2 AND ($3::uuid IS NULL OR id <> $3)`,
    [context.organizationId, values.code, categoryId])).rows[0];
  if (clash) throw issue("code", `Code ${values.code} is already used by ${clash.name}.`, "CATEGORY_DUPLICATE", 409);
  const sibling = (await client.query(
    `SELECT code FROM tenant.item_groups WHERE organization_id = $1 AND COALESCE(parent_id, $2::uuid) = COALESCE($3::uuid, $2::uuid) AND lower(btrim(name)) = lower(btrim($4)) AND ($5::uuid IS NULL OR id <> $5)`,
    [context.organizationId, ZERO, parentId, values.name, categoryId])).rows[0];
  if (sibling) throw issue("name", `${parentId ? tree.byId.get(parentId)?.name : "The top level"} already has a category named ${values.name} (${sibling.code}).`, "CATEGORY_SIBLING_DUPLICATE", 409);
}

// Items in a category's subtree that a narrower set of item types would leave out.
async function incompatibleItems(client, context, tree, categoryId, allowed) {
  const ids = [categoryId, ...tree.descendants(categoryId).map((row) => row.id)];
  return (await client.query(
    `SELECT item.code FROM tenant.items item WHERE item.organization_id = $1 AND item.group_id = ANY($2::uuid[]) AND NOT (${PRODUCT_TYPE_SQL("item")} = ANY($3::text[]))
      ORDER BY item.code LIMIT 5`, [context.organizationId, ids, allowed])).rows;
}

// A database refusal reads like the application's own (two people saving at once).
async function guarded(client, run) {
  await client.query("SAVEPOINT category_write");
  try {
    const result = await run();
    await client.query("RELEASE SAVEPOINT category_write");
    return result;
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT category_write");
    if (error?.code === "23505") throw issue(error.constraint === "item_groups_sibling_name_uidx" ? "name" : "code", "Another category with this code or name was just saved. Reload and try again.", "CATEGORY_DUPLICATE", 409);
    if (error?.code === "23514" && /hierarchy|parent_not_self/.test(error.constraint ?? "")) throw issue("parentId", error.message, "CATEGORY_HIERARCHY", 409);
    throw error;
  }
}

// input: { code, name, parentId, description, sortOrder, allowedItemTypes, iconAttachmentId, defaultValuationMethod,
// defaultInventoryProfileId, defaultAccountingProfileId, defaultTaxCategoryId, defaultHsnSacCode }
export async function createItemCategory(client, context, input = {}) {
  requireProductPermission(context, P.manageCategories, "You do not have permission to manage item categories.");
  const values = normalize(input);
  for (const [field, rule] of Object.entries(FIELD_PERMISSION)) if (values[field]) requireProductPermission(context, ...rule);
  const parentId = text(input.parentId) || null;
  if (parentId && !isUuid(parentId)) throw issue("parentId", "Choose from the list.");
  const tree = await loadAll(client, context);
  await validate(client, context, values, { parentId, tree });
  const fields = Object.keys(COLUMNS).filter((field) => values[field] !== undefined && values[field] !== null);
  const row = await guarded(client, async () => (await client.query(
    `INSERT INTO tenant.item_groups (organization_id, parent_id, ${fields.map((field) => COLUMNS[field]).join(", ")}, status, created_by, updated_by)
     VALUES ($1, $2, ${fields.map((_field, index) => `$${index + 3}`).join(", ")}, 'active', $${fields.length + 3}, $${fields.length + 3}) RETURNING id`,
    [context.organizationId, parentId, ...fields.map((field) => values[field]), context.userId ?? null])).rows[0]);
  await record(client, context, row.id, "created", `Category ${values.code} created${parentId ? ` under ${tree.byId.get(parentId).name}` : ""}`, { name: values.name, parent: parentId ? tree.byId.get(parentId).name : null });
  if (parentId) await record(client, context, parentId, "updated", `Sub-category ${values.name} (${values.code}) added`, { kind: "child_added", child: values.code });
  return getItemCategory(client, context, row.id);
}

const shown = (field, value) => (field === "allowedItemTypes" ? (value?.length ? value.map((type) => TYPE_LABELS.get(type)).join(", ") : "All") : value ?? null);

// input: any field of createItemCategory except parentId (use moveItemCategory); expectedVersion refuses a change made on top of
// someone else's. Items already in the category keep their own settings: defaults only apply to items created afterwards.
export async function updateItemCategory(client, context, categoryId, input = {}) {
  requireProductPermission(context, P.manageCategories, "You do not have permission to manage item categories.");
  const { row, tree } = await loadOne(client, context, categoryId, { lock: true });
  if (has(input, "parentId") && (text(input.parentId) || null) !== (row.parent_id ?? null)) throw new ProductError(409, "Use Move to change a category's parent.", "CATEGORY_FIELD_GOVERNED");
  if (has(input, "expectedVersion") && input.expectedVersion !== null && Number(input.expectedVersion) !== Number(row.version))
    throw new ProductError(409, "Someone else changed this category after you opened it. Reload it.", "CATEGORY_VERSION_CONFLICT");
  const before = toCategory(row, tree);
  const changes = normalize(input);
  const changed = Object.keys(changes).filter((field) => COLUMNS[field] && JSON.stringify(changes[field] ?? null) !== JSON.stringify(before[field] ?? null));
  if (!changed.length) return getItemCategory(client, context, row.id);
  for (const field of changed) if (FIELD_PERMISSION[field]) requireProductPermission(context, ...FIELD_PERMISSION[field]);
  const values = { ...before, ...Object.fromEntries(changed.map((field) => [field, changes[field]])) };
  await validate(client, context, values, { categoryId: row.id, parentId: row.parent_id, tree });
  if (changed.includes("allowedItemTypes") && values.allowedItemTypes?.length) {
    const parentAllowed = row.parent_id ? tree.allowedTypes(row.parent_id) : TYPE_CODES;
    const allowed = values.allowedItemTypes.filter((type) => parentAllowed.includes(type));
    const blocked = await incompatibleItems(client, context, tree, row.id, allowed);
    if (blocked.length) throw issue("allowedItemTypes", `Items ${blocked.map((entry) => entry.code).join(", ")} in this category or below are of another type. Move them first.`, "CATEGORY_TYPES_IN_USE", 409);
    const widerChild = tree.descendants(row.id).find((child) => child.allowed_item_types?.some((type) => !allowed.includes(type)));
    if (widerChild) throw issue("allowedItemTypes", `Sub-category ${widerChild.name} allows types this category would not. Narrow it first.`, "CATEGORY_TYPES_IN_USE", 409);
  }
  const params = [context.organizationId, row.id, context.userId ?? null];
  const sets = changed.map((field) => { params.push(changes[field]); return `${COLUMNS[field]} = $${params.length}`; });
  await guarded(client, () => client.query(`UPDATE tenant.item_groups SET ${sets.join(", ")}, updated_by = $3, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND id = $2`, params));
  const defaultsChanged = changed.filter((field) => FIELD_PERMISSION[field]);
  await record(client, context, row.id, "updated", `${changed.map((field) => LABELS[field]).join(", ")} changed${defaultsChanged.length ? " (new items only; existing items keep their settings)" : ""}`,
    Object.fromEntries(changed.map((field) => [field, { label: LABELS[field], from: shown(field, before[field]), to: shown(field, changes[field]) }])));
  return getItemCategory(client, context, row.id);
}

// Moves a category (with its sub-categories and items) under another parent, or to the top level: a classification change only — no
// item, stock, cost or document changes. Refused when the new parent is the category itself or one of its descendants, or when the new
// parent's item types would exclude items below.
export async function moveItemCategory(client, context, categoryId, input = {}) {
  requireProductPermission(context, P.manageCategories, "You do not have permission to move item categories.");
  const parentId = text(input.parentId) || null;
  if (parentId && !isUuid(parentId)) throw issue("parentId", "Choose from the list.");
  // One hierarchy change at a time per organization: two simultaneous moves cannot together complete a cycle.
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('item_groups_hierarchy:' || $1::text))`, [context.organizationId]);
  const { row, tree } = await loadOne(client, context, categoryId, { lock: true });
  if (has(input, "expectedVersion") && input.expectedVersion !== null && Number(input.expectedVersion) !== Number(row.version))
    throw new ProductError(409, "Someone else changed this category after you opened it. Reload it.", "CATEGORY_VERSION_CONFLICT");
  if ((row.parent_id ?? null) === parentId) return getItemCategory(client, context, row.id);
  if (parentId === row.id) throw issue("parentId", "A category cannot be its own parent.", "CATEGORY_HIERARCHY", 409);
  if (parentId && tree.descendants(row.id).some((entry) => entry.id === parentId))
    throw issue("parentId", "The selected parent is already a descendant of this category.", "CATEGORY_HIERARCHY", 409);
  const parent = parentId ? tree.byId.get(parentId) : null;
  if (parentId && !parent) throw issue("parentId", "Choose a parent category from this organization.");
  if (parent && parent.status !== "active") throw issue("parentId", "Choose an active parent category.");
  if (parent) {
    const parentAllowed = tree.allowedTypes(parent.id);
    if (row.allowed_item_types?.some((type) => !parentAllowed.includes(type)))
      throw issue("parentId", `${parent.name} holds ${parentAllowed.map((code) => TYPE_LABELS.get(code)).join(" and ")} only; this category allows more.`, "CATEGORY_TYPES_IN_USE", 409);
    const blocked = await incompatibleItems(client, context, tree, row.id, parentAllowed);
    if (blocked.length) throw issue("parentId", `${parent.name} does not allow items ${blocked.map((entry) => entry.code).join(", ")} below this category.`, "CATEGORY_TYPES_IN_USE", 409);
  }
  const sibling = (await client.query(
    `SELECT code FROM tenant.item_groups WHERE organization_id = $1 AND COALESCE(parent_id, $2::uuid) = COALESCE($3::uuid, $2::uuid) AND lower(btrim(name)) = lower(btrim($4)) AND id <> $5`,
    [context.organizationId, ZERO, parentId, row.name, row.id])).rows[0];
  if (sibling) throw issue("parentId", `${parent?.name ?? "The top level"} already has a category named ${row.name}.`, "CATEGORY_SIBLING_DUPLICATE", 409);
  const oldPath = toCategory(row, tree).path;
  await guarded(client, () => client.query(`UPDATE tenant.item_groups SET parent_id = $3, updated_by = $4, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, parentId, context.userId ?? null]));
  const moved = await getItemCategory(client, context, row.id, { history: false });
  const reason = text(input.reason).slice(0, 300) || null;
  await record(client, context, row.id, "updated", `Moved from ${oldPath} to ${moved.path}${reason ? `: ${reason}` : ""}`,
    { kind: "moved", parentId: { label: "Parent category", from: row.parent_id ? tree.byId.get(row.parent_id).name : "Top level", to: parent?.name ?? "Top level" }, reason });
  if (row.parent_id) await record(client, context, row.parent_id, "updated", `Sub-category ${row.name} moved out to ${parent?.name ?? "the top level"}`, { kind: "child_removed", child: row.code });
  if (parentId) await record(client, context, parentId, "updated", `Sub-category ${row.name} moved in`, { kind: "child_added", child: row.code });
  return getItemCategory(client, context, row.id);
}

// Deactivate: only once its active sub-categories and active items have been moved or deactivated, so no active stock hides under an
// inactive branch. Reactivate: only under an active parent. Items are never changed.
export async function setItemCategoryStatus(client, context, categoryId, status, input = {}) {
  requireProductPermission(context, P.manageCategories, "You do not have permission to manage item categories.");
  if (!["active", "inactive"].includes(status)) throw issue("status", "Choose Active or Inactive.");
  const { row, tree } = await loadOne(client, context, categoryId, { lock: true });
  if (row.status === status) throw new ProductError(409, `This category is already ${status}.`, "CATEGORY_STATUS_UNCHANGED");
  if (status === "inactive") {
    if ((tree.children.get(row.id) ?? []).some((child) => child.status === "active")) throw new ProductError(409, "Deactivate or move its active sub-categories first.", "CATEGORY_HAS_CHILDREN");
    const active = Number(row.direct_active_items);
    if (active > 0) throw new ProductError(409, `${active} active item${active === 1 ? " is" : "s are"} in this category. Move or deactivate ${active === 1 ? "it" : "them"} first.`, "CATEGORY_HAS_ITEMS");
  }
  if (status === "active" && row.parent_id && tree.byId.get(row.parent_id)?.status !== "active")
    throw new ProductError(409, "Its parent category is inactive. Activate the parent first.", "CATEGORY_PARENT_INACTIVE");
  await client.query(`UPDATE tenant.item_groups SET status = $3, updated_by = $4, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, status, context.userId ?? null]);
  const note = text(input.reason).slice(0, 300);
  await record(client, context, row.id, status === "active" ? "activated" : "deactivated", `${status === "active" ? "Reactivated" : "Deactivated"}${note ? `: ${note}` : ""}`, { from: row.status, to: status });
  return getItemCategory(client, context, row.id);
}

// Only a category nothing refers to can be deleted; the deletion itself is recorded.
export async function deleteItemCategory(client, context, categoryId, input = {}) {
  requireProductPermission(context, P.deleteCategories, "You do not have permission to delete item categories.");
  const { row } = await loadOne(client, context, categoryId, { lock: true });
  const uses = [];
  for (const [label, sql] of [
    ["items", "SELECT 1 FROM tenant.items WHERE organization_id = $1 AND group_id = $2"],
    ["sub-categories", "SELECT 1 FROM tenant.item_groups WHERE organization_id = $1 AND parent_id = $2"],
    ["account mappings", "SELECT 1 FROM tenant.accounting_account_mappings WHERE organization_id = $1 AND item_group_id = $2"],
    ["pricing rules", "SELECT 1 FROM tenant.sales_pricing_rules WHERE organization_id = $1 AND item_group_id = $2"],
  ]) if ((await client.query(`${sql} LIMIT 1`, [context.organizationId, row.id])).rows[0]) uses.push(label);
  if (uses.length) throw new ProductError(409, `This category is used by ${uses.join(", ")}. Deactivate it instead, or move its items first.`, "CATEGORY_IN_USE", { references: uses });
  const reason = text(input.reason).slice(0, 300) || null;
  await client.query(`INSERT INTO tenant.item_category_deletions (organization_id, category_id, code, name, parent_id, reason, deleted_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [context.organizationId, row.id, row.code, row.name, row.parent_id, reason, context.userId ?? null]);
  if (row.parent_id) await record(client, context, row.parent_id, "updated", `Sub-category ${row.name} (${row.code}) deleted`, { kind: "child_deleted", child: row.code });
  await client.query(`DELETE FROM tenant.item_groups WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id]);
  return { deleted: true };
}
export const deleteUnusedItemCategory = deleteItemCategory;

// Moves every item of a category to another, one by one through the item reclassification, so each move is checked and recorded.
export async function reassignCategoryItems(client, context, categoryId, input = {}) {
  requireProductPermission(context, P.reclassify, "You do not have permission to reclassify items.");
  const { row: source } = await loadOne(client, context, categoryId);
  const { row: target } = await loadOne(client, context, input.targetCategoryId);
  if (source.id === target.id) throw issue("targetCategoryId", "Choose a different category.");
  if (target.status !== "active") throw issue("targetCategoryId", "Choose an active category.");
  const { reclassifyItem } = await import("./records.js");
  const items = (await client.query(`SELECT id, code FROM tenant.items WHERE organization_id = $1 AND group_id = $2 ORDER BY code`, [context.organizationId, source.id])).rows;
  const failed = [];
  let moved = 0;
  for (const item of items) {
    await client.query("SAVEPOINT category_move");
    try {
      await reclassifyItem(client, context, item.id, { categoryId: target.id, reason: text(input.reason) || null });
      await client.query("RELEASE SAVEPOINT category_move");
      moved += 1;
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT category_move");
      if (!error?.status || error.status >= 500) throw error;
      failed.push({ itemId: item.id, code: item.code, message: error.message });
    }
  }
  return { moved, failed };
}

// ------------------------------------------------------------------ items and stock of a category

// The category's items: directly assigned, or (includeDescendants) in its whole subtree.
export async function getCategoryItems(client, context, categoryId, { includeDescendants = false, limit = 200, offset = 0 } = {}) {
  requireProductPermission(context, P.view, "You do not have permission to view categories.");
  const { row } = await loadOne(client, context, categoryId);
  const { listProducts } = await import("./records.js");
  return listProducts(client, context, { categoryId: row.id, includeSubcategories: includeDescendants ? "yes" : "no", limit, offset, sort: "code" });
}

// On hand, reserved, available (and value, with View Cost) of the category's items, by warehouse — read from Inventory's balances.
export async function getCategoryStockSummary(client, context, categoryId, { includeDescendants = true } = {}) {
  requireProductPermission(context, P.viewStock, "You do not have permission to view stock.");
  const { row, tree } = await loadOne(client, context, categoryId);
  const ids = includeDescendants ? [row.id, ...tree.descendants(row.id).map((entry) => entry.id)] : [row.id];
  const cost = canViewProductCost(context);
  const { rows } = await client.query(
    `SELECT warehouse.id, warehouse.name, sum(balance.quantity) AS on_hand, sum(balance.reserved_quantity) AS reserved,
            sum(CASE WHEN ${USABLE_ROW} THEN greatest(balance.quantity - balance.reserved_quantity, 0) ELSE 0 END) AS available, sum(balance.quantity * balance.average_cost) AS value
       FROM tenant.stock_balances balance
       JOIN tenant.items item ON item.organization_id = balance.organization_id AND item.id = balance.item_id
       JOIN tenant.warehouses warehouse ON warehouse.organization_id = balance.organization_id AND warehouse.id = balance.warehouse_id
       LEFT JOIN tenant.warehouse_locations location ON location.organization_id = balance.organization_id AND location.id = balance.warehouse_location_id
       LEFT JOIN tenant.stock_batches batch ON batch.organization_id = balance.organization_id AND batch.id = balance.batch_id
      WHERE balance.organization_id = $1 AND item.group_id = ANY($2::uuid[])
      GROUP BY warehouse.id, warehouse.name ORDER BY warehouse.name`, [context.organizationId, ids]);
  const round = (value) => Math.round(Number(value ?? 0) * 1e6) / 1e6;
  const warehouses = rows.map((entry) => ({ warehouseId: entry.id, name: entry.name, onHand: round(entry.on_hand), reserved: round(entry.reserved), available: round(entry.available),
    ...(cost ? { value: round(entry.value) } : {}) }));
  const sum = (field) => round(warehouses.reduce((total, entry) => total + entry[field], 0));
  return { includeDescendants, warehouses, totals: { onHand: sum("onHand"), reserved: sum("reserved"), available: sum("available"), ...(cost ? { value: sum("value") } : {}) } };
}
export async function getCategoryInventoryValue(client, context, categoryId) {
  if (!canViewProductCost(context)) throw new ProductError(403, "You do not have permission to view inventory value.", "PERMISSION_DENIED");
  return (await getCategoryStockSummary(client, context, categoryId)).totals.value;
}

// ------------------------------------------------------------------ reports

// Each report is a figure per item, read from the module that owns it, rolled up the category tree. Items without a category are
// shown on their own.
const POSTED = "('posted', 'partially_paid', 'paid', 'overdue', 'disputed')";
const REPORTS = Object.freeze({
  items: { title: "Items by category", unit: "count", needs: P.view, dated: false,
    sql: `SELECT item.group_id, count(*) AS value FROM tenant.items item WHERE item.organization_id = $1 GROUP BY item.group_id` },
  stock: { title: "Stock quantity by category", unit: "quantity", needs: P.viewStock, dated: false,
    sql: `SELECT item.group_id, sum(balance.quantity) AS value FROM tenant.stock_balances balance JOIN tenant.items item ON item.organization_id = balance.organization_id AND item.id = balance.item_id
           WHERE balance.organization_id = $1 GROUP BY item.group_id` },
  value: { title: "Inventory value by category", unit: "money", needs: P.viewCost, dated: false,
    sql: `SELECT item.group_id, sum(balance.quantity * balance.average_cost) AS value FROM tenant.stock_balances balance JOIN tenant.items item ON item.organization_id = balance.organization_id AND item.id = balance.item_id
           WHERE balance.organization_id = $1 GROUP BY item.group_id` },
  purchases: { title: "Purchase spend by category", unit: "money", needs: P.viewCost, dated: true,
    sql: `SELECT item.group_id, sum(line.net_amount * COALESCE(NULLIF(bill.exchange_rate, 0), 1)) AS value FROM tenant.accounting_vendor_bill_lines line
            JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = line.organization_id AND bill.id = line.vendor_bill_id
            JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
           WHERE line.organization_id = $1 AND bill.bill_type = 'bill' AND bill.status IN ${POSTED}
             AND ($2::date IS NULL OR bill.bill_date >= $2::date) AND ($3::date IS NULL OR bill.bill_date <= $3::date) GROUP BY item.group_id` },
  purchase_returns: { title: "Purchase returns by category", unit: "quantity", needs: P.view, dated: true,
    sql: `SELECT item.group_id, sum(line.base_quantity) AS value FROM tenant.purchase_return_lines line
            JOIN tenant.purchase_returns purchase_return ON purchase_return.organization_id = line.organization_id AND purchase_return.id = line.purchase_return_id
            JOIN tenant.goods_receipt_lines receipt_line ON receipt_line.organization_id = line.organization_id AND receipt_line.id = line.goods_receipt_line_id
            JOIN tenant.items item ON item.organization_id = receipt_line.organization_id AND item.id = receipt_line.product_id
           WHERE line.organization_id = $1 AND purchase_return.document_status = 'posted'
             AND ($2::date IS NULL OR purchase_return.return_date >= $2::date) AND ($3::date IS NULL OR purchase_return.return_date <= $3::date) GROUP BY item.group_id` },
  sales: { title: "Sales by category", unit: "money", needs: P.view, dated: true,
    sql: `SELECT item.group_id, sum(line.net_amount * COALESCE(NULLIF(invoice.exchange_rate, 0), 1)) AS value FROM tenant.accounting_customer_invoice_lines line
            JOIN tenant.accounting_customer_invoices invoice ON invoice.organization_id = line.organization_id AND invoice.id = line.customer_invoice_id
            JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
           WHERE line.organization_id = $1 AND invoice.invoice_type = 'invoice' AND invoice.status IN ${POSTED}
             AND ($2::date IS NULL OR invoice.invoice_date >= $2::date) AND ($3::date IS NULL OR invoice.invoice_date <= $3::date) GROUP BY item.group_id` },
  cogs: { title: "Cost of goods sold by category", unit: "money", needs: P.viewCost, dated: true,
    sql: `SELECT item.group_id, sum(-movement.quantity * movement.unit_cost) AS value FROM tenant.stock_movements movement
            JOIN tenant.items item ON item.organization_id = movement.organization_id AND item.id = movement.item_id
           WHERE movement.organization_id = $1 AND movement.quantity < 0 AND movement.movement_type = 'issue' AND movement.reference_type IN ('sales_delivery', 'pos_sale')
             AND ($2::date IS NULL OR movement.occurred_at >= $2::date) AND ($3::date IS NULL OR movement.occurred_at < $3::date + 1) GROUP BY item.group_id` },
  movements: { title: "Stock movement by category", unit: "quantity", needs: P.viewStock, dated: true,
    sql: `SELECT item.group_id, sum(CASE WHEN movement.quantity > 0 THEN movement.quantity ELSE 0 END) AS value, sum(CASE WHEN movement.quantity < 0 THEN -movement.quantity ELSE 0 END) AS outflow
            FROM tenant.stock_movements movement JOIN tenant.items item ON item.organization_id = movement.organization_id AND item.id = movement.item_id
           WHERE movement.organization_id = $1 AND ($2::date IS NULL OR movement.occurred_at >= $2::date) AND ($3::date IS NULL OR movement.occurred_at < $3::date + 1) GROUP BY item.group_id` },
});
export const CATEGORY_REPORTS = Object.freeze(Object.entries(REPORTS).map(([key, entry]) => ({ key, title: entry.title, unit: entry.unit, dated: entry.dated })));

// filters: from, to (for dated reports). The tree in order, each category with its own figure and its whole subtree's.
export async function getCategoryReport(client, context, reportKey, filters = {}) {
  const report = REPORTS[reportKey];
  if (!report) throw new ProductError(404, "Unknown report.", "CATEGORY_REPORT_UNKNOWN");
  requireProductPermission(context, report.needs, "You do not have permission to see this report.");
  const date = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")) ? String(value) : null);
  const figures = (await client.query(report.sql, report.dated ? [context.organizationId, date(filters.from), date(filters.to)] : [context.organizationId])).rows;
  const own = new Map(figures.map((row) => [row.group_id ?? null, { value: Number(row.value ?? 0), outflow: Number(row.outflow ?? 0) }]));
  const tree = await loadAll(client, context);
  const categories = await listItemCategories(client, context, {});
  const rows = categories.map((category) => {
    const subtree = [category.id, ...tree.descendants(category.id).map((entry) => entry.id)];
    const total = subtree.reduce((sum, id) => sum + (own.get(id)?.value ?? 0), 0);
    return { categoryId: category.id, code: category.code, name: category.name, path: category.path, depth: category.depth, isActive: category.isActive,
      direct: own.get(category.id)?.value ?? 0, total,
      ...(reportKey === "movements" ? { directOut: own.get(category.id)?.outflow ?? 0, totalOut: subtree.reduce((sum, id) => sum + (own.get(id)?.outflow ?? 0), 0) } : {}) };
  });
  return { key: reportKey, title: report.title, unit: report.unit, rows, uncategorized: own.get(null)?.value ?? 0,
    grandTotal: [...own.values()].reduce((sum, entry) => sum + entry.value, 0) };
}

export { canViewProductStock, productCan };
