// The price list: create, read, list, update, set as default, activate,
// deactivate, delete and copy. A price list has one currency and says
// whether its prices include tax; at most one active list per currency is
// the default used when a customer has no price list of its own.
import { priceListCan, priceListCapabilities, requirePriceListPermission } from "./access.js";
import { PRICE_LIST_PERMISSIONS, PriceListError, has, optionalDate, requireUuid, text, today } from "./constants.js";
import { recordPriceListHistory } from "./history.js";

const CODE = /^[A-Z0-9][A-Z0-9._-]{1,39}$/;
const FIELD_LABELS = Object.freeze({ code: "Code", name: "Name", description: "Description", currencyCode: "Currency", taxInclusive: "Tax mode", validFrom: "Valid from", validTo: "Valid until" });

export const PRICE_LIST_SELECT = `
  SELECT list.*, list.valid_from::text AS valid_from_text, list.valid_to::text AS valid_to_text,
         creator.full_name AS created_by_name, updater.full_name AS updated_by_name,
         (SELECT count(*)::int FROM tenant.price_list_items entry WHERE entry.organization_id = list.organization_id AND entry.price_list_id = list.id AND entry.status = 'active') AS entry_count,
         (SELECT count(DISTINCT entry.item_id)::int FROM tenant.price_list_items entry WHERE entry.organization_id = list.organization_id AND entry.price_list_id = list.id AND entry.status = 'active') AS product_count,
         (SELECT count(*)::int FROM tenant.business_parties party WHERE party.organization_id = list.organization_id AND party.default_price_list_id = list.id) AS customer_count
    FROM tenant.price_lists list
    LEFT JOIN public.users creator ON creator.id = list.created_by
    LEFT JOIN public.users updater ON updater.id = list.updated_by`;

export function toPriceList(row) {
  const validFrom = row.valid_from_text ?? null;
  const validTo = row.valid_to_text ?? null;
  const date = today();
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    currencyCode: row.currency_code?.trim() ?? null,
    taxInclusive: row.tax_inclusive,
    taxModeLabel: row.tax_inclusive ? "Tax inclusive" : "Tax exclusive",
    validFrom,
    validTo,
    isCurrent: (!validFrom || validFrom <= date) && (!validTo || validTo >= date),
    isDefault: row.is_default,
    status: row.status,
    isActive: row.status === "active",
    entryCount: row.entry_count ?? 0,
    productCount: row.product_count ?? 0,
    customerCount: row.customer_count ?? 0,
    createdByName: row.created_by_name ?? null,
    createdAt: row.created_at,
    updatedByName: row.updated_by_name ?? null,
    updatedAt: row.updated_at,
  };
}

export async function loadPriceListRow(client, context, priceListId, { lock = false } = {}) {
  const { rows } = await client.query(
    `${PRICE_LIST_SELECT} WHERE list.organization_id = $1 AND list.id = $2 AND list.price_list_type = 'sales'${lock ? " FOR UPDATE OF list" : ""}`,
    [context.organizationId, requireUuid(priceListId, "Price list")],
  );
  if (!rows[0]) throw new PriceListError(404, "Price list not found.", "SALES_PRICE_LIST_NOT_FOUND");
  return rows[0];
}

export async function getPriceList(client, context, priceListId) {
  requirePriceListPermission(context, PRICE_LIST_PERMISSIONS.view, "You do not have permission to view price lists.");
  return { ...toPriceList(await loadPriceListRow(client, context, priceListId)), capabilities: priceListCapabilities(context) };
}

// filters: search, status, currencyCode.
export async function listPriceLists(client, context, filters = {}) {
  requirePriceListPermission(context, PRICE_LIST_PERMISSIONS.view, "You do not have permission to view price lists.");
  const values = [context.organizationId];
  const where = ["list.organization_id = $1", "list.price_list_type = 'sales'"];
  if (text(filters.search)) { values.push(`%${text(filters.search).toLowerCase().replace(/[\\%_]/g, "\\$&")}%`); where.push(`lower(list.code || ' ' || list.name) LIKE $${values.length}`); }
  if (filters.status === "active" || filters.status === "inactive") { values.push(filters.status); where.push(`list.status = $${values.length}`); }
  if (/^[A-Z]{3}$/.test(text(filters.currencyCode).toUpperCase())) { values.push(text(filters.currencyCode).toUpperCase()); where.push(`list.currency_code = $${values.length}`); }
  const { rows } = await client.query(`${PRICE_LIST_SELECT} WHERE ${where.join(" AND ")} ORDER BY list.status = 'active' DESC, list.is_default DESC, lower(list.name) LIMIT 500`, values);
  const currencies = (await client.query(`SELECT code, name FROM tenant.currencies WHERE organization_id = $1 AND status = 'active' ORDER BY is_base DESC, code`, [context.organizationId])).rows;
  return {
    priceLists: rows.map(toPriceList),
    currencies: currencies.map((row) => ({ code: row.code.trim(), name: row.name })),
    capabilities: priceListCapabilities(context),
  };
}

// The price lists a document in this currency can use, for pickers.
export async function listUsablePriceLists(client, context, currencyCode = null, documentDate = today()) {
  const { rows } = await client.query(
    `SELECT id, code, name, currency_code, tax_inclusive, is_default FROM tenant.price_lists
      WHERE organization_id = $1 AND price_list_type = 'sales' AND status = 'active' AND ($2::text IS NULL OR currency_code = $2)
        AND (valid_from IS NULL OR valid_from <= $3::date) AND (valid_to IS NULL OR valid_to >= $3::date)
      ORDER BY is_default DESC, lower(name)`,
    [context.organizationId, currencyCode, documentDate],
  );
  return rows.map((row) => ({ id: row.id, code: row.code, name: row.name, currencyCode: row.currency_code.trim(), taxInclusive: row.tax_inclusive, isDefault: row.is_default }));
}

function normalize(input) {
  const out = {};
  if (has(input, "code")) out.code = text(input.code).toUpperCase().replace(/\s+/g, "-");
  if (has(input, "name")) out.name = text(input.name);
  if (has(input, "description")) out.description = text(input.description) || null;
  if (has(input, "currencyCode")) out.currencyCode = text(input.currencyCode).toUpperCase();
  if (has(input, "taxInclusive")) out.taxInclusive = input.taxInclusive === true || input.taxInclusive === "true";
  if (has(input, "validFrom")) out.validFrom = optionalDate(input.validFrom, "validFrom", "Valid from");
  if (has(input, "validTo")) out.validTo = optionalDate(input.validTo, "validTo", "Valid until");
  return out;
}

async function validate(client, context, candidate, normalized) {
  const issues = [];
  const issue = (field, message) => issues.push({ field, message });
  if (!CODE.test(candidate.code ?? "")) issue("code", "Enter a code of 2 to 40 letters, numbers, dots or dashes, such as PL-STANDARD-INR.");
  if (!text(candidate.name)) issue("name", "Enter the name.");
  if (text(candidate.name).length > 200) issue("name", "Must be 200 characters or fewer.");
  if (text(candidate.description).length > 2000) issue("description", "Must be 2000 characters or fewer.");
  if (!/^[A-Z]{3}$/.test(candidate.currencyCode ?? "")) issue("currencyCode", "Choose the currency.");
  if (candidate.validFrom && candidate.validTo && candidate.validFrom > candidate.validTo) issue("validTo", "Valid until must be on or after valid from.");
  if (issues.length) throw new PriceListError(400, issues[0].message, "SALES_PRICE_LIST_VALIDATION", { issues });
  if (has(normalized, "currencyCode")) {
    const currency = (await client.query(`SELECT 1 FROM tenant.currencies WHERE organization_id = $1 AND code = $2 AND status = 'active'`, [context.organizationId, candidate.currencyCode])).rows[0];
    if (!currency) throw new PriceListError(400, "Choose a currency your organization uses.", "SALES_PRICE_LIST_VALIDATION", { issues: [{ field: "currencyCode", message: "Choose a currency your organization uses." }] });
  }
  if (has(normalized, "code")) {
    const { rows } = await client.query(`SELECT name FROM tenant.price_lists WHERE organization_id = $1 AND upper(code) = $2 AND ($3::uuid IS NULL OR id <> $3)`,
      [context.organizationId, candidate.code, candidate.id ?? null]);
    if (rows[0]) throw new PriceListError(409, `The code ${candidate.code} is already used by ${rows[0].name}.`, "SALES_PRICE_LIST_CODE_DUPLICATE", { issues: [{ field: "code", message: "This code is already used." }] });
  }
}

// Documents and other records that refer to a price list.
const REFERENCES = Object.freeze([
  ["quotations", "SELECT 1 FROM tenant.sales_quotation_versions WHERE organization_id = $1 AND price_list_id = $2"],
  ["sales orders", "SELECT 1 FROM tenant.sales_order_versions WHERE organization_id = $1 AND price_list_id = $2"],
  ["opportunities", "SELECT 1 FROM tenant.crm_opportunity_items WHERE organization_id = $1 AND price_list_id = $2"],
  ["POS stores", "SELECT 1 FROM tenant.pos_stores WHERE organization_id = $1 AND price_list_id = $2"],
  ["customers", "SELECT 1 FROM tenant.business_parties WHERE organization_id = $1 AND default_price_list_id = $2"],
]);
const TRANSACTIONS = ["quotations", "sales orders"];

export async function priceListReferences(client, context, priceListId, { only = null } = {}) {
  const found = [];
  for (const [label, sql] of REFERENCES) {
    if (only && !only.includes(label)) continue;
    if ((await client.query(`${sql} LIMIT 1`, [context.organizationId, priceListId])).rows[0]) found.push(label);
  }
  return found;
}

// input: code, name, description, currencyCode, taxInclusive, validFrom, validTo, isDefault.
export async function createPriceList(client, context, input = {}, { historySummary = null } = {}) {
  requirePriceListPermission(context, PRICE_LIST_PERMISSIONS.create, "You do not have permission to create price lists.");
  const normalized = normalize({ taxInclusive: false, ...input });
  if (!normalized.currencyCode) {
    normalized.currencyCode = (await client.query(`SELECT base_currency FROM public.organizations WHERE id = $1`, [context.organizationId])).rows[0]?.base_currency?.trim();
  }
  await validate(client, context, normalized, { ...normalized, code: true, currencyCode: true });
  const { rows } = await client.query(
    `INSERT INTO tenant.price_lists (organization_id, code, name, description, price_list_type, currency_code, tax_inclusive, valid_from, valid_to, created_by, updated_by)
     VALUES ($1, $2, $3, $4, 'sales', $5, $6, $7, $8, $9, $9) RETURNING id`,
    [context.organizationId, normalized.code, normalized.name, normalized.description ?? null, normalized.currencyCode, normalized.taxInclusive, normalized.validFrom ?? null,
      normalized.validTo ?? null, context.userId ?? null],
  );
  const id = rows[0].id;
  await recordPriceListHistory(client, context, id, "created", historySummary ?? `Price list ${normalized.code} created`, {
    changes: { currencyCode: normalized.currencyCode, taxInclusive: normalized.taxInclusive },
  });
  // The first price list in a currency becomes its default.
  const others = (await client.query(`SELECT 1 FROM tenant.price_lists WHERE organization_id = $1 AND price_list_type = 'sales' AND currency_code = $2 AND is_default`,
    [context.organizationId, normalized.currencyCode])).rows[0];
  if (input.isDefault === true || (!others && priceListCan(context, PRICE_LIST_PERMISSIONS.setDefault))) await setDefaultPriceList(client, context, id);
  return getPriceList(client, context, id);
}

export async function updatePriceList(client, context, priceListId, input = {}) {
  requirePriceListPermission(context, PRICE_LIST_PERMISSIONS.edit, "You do not have permission to edit price lists.");
  for (const field of ["status", "isDefault"])
    if (has(input, field)) throw new PriceListError(409, "Use Activate, Deactivate or Set as default.", "SALES_PRICE_LIST_FIELD_GOVERNED");
  const row = await loadPriceListRow(client, context, priceListId, { lock: true });
  const before = toPriceList(row);
  const normalized = normalize(input);
  const changed = Object.keys(normalized).filter((field) => String(normalized[field] ?? "") !== String(before[field] ?? ""));
  if (!changed.length) return getPriceList(client, context, row.id);
  const candidate = { ...before, ...normalized };
  await validate(client, context, candidate, Object.fromEntries(changed.map((field) => [field, true])));
  // A list documents were priced from keeps its currency: create a new list instead.
  if (changed.includes("currencyCode")) {
    const used = await priceListReferences(client, context, row.id, { only: TRANSACTIONS });
    if (used.length) throw new PriceListError(409, `This price list was used on ${used.join(" and ")}, so its currency cannot change. Create a new ${candidate.currencyCode} price list instead.`, "SALES_PRICE_LIST_CURRENCY_LOCKED");
    if (row.is_default) {
      const clash = (await client.query(`SELECT name FROM tenant.price_lists WHERE organization_id = $1 AND price_list_type = 'sales' AND currency_code = $2 AND is_default AND id <> $3`,
        [context.organizationId, candidate.currencyCode, row.id])).rows[0];
      if (clash) throw new PriceListError(409, `${clash.name} is already the default ${candidate.currencyCode} price list.`, "SALES_PRICE_LIST_DEFAULT_CLASH");
    }
  }
  // Switching between tax-inclusive and tax-exclusive changes every new price.
  if (changed.includes("taxInclusive")) requirePriceListPermission(context, PRICE_LIST_PERMISSIONS.changeTaxMode, "You do not have permission to change the tax mode of a price list.");
  const columns = { code: "code", name: "name", description: "description", currencyCode: "currency_code", taxInclusive: "tax_inclusive", validFrom: "valid_from", validTo: "valid_to" };
  const values = [context.organizationId, row.id, context.userId ?? null];
  const sets = ["updated_by = $3", "updated_at = now()"];
  for (const field of changed) { values.push(normalized[field]); sets.push(`${columns[field]} = $${values.length}`); }
  await client.query(`UPDATE tenant.price_lists SET ${sets.join(", ")} WHERE organization_id = $1 AND id = $2`, values);
  const changes = Object.fromEntries(changed.map((field) => [field, {
    label: FIELD_LABELS[field],
    from: field === "taxInclusive" ? (before.taxInclusive ? "Tax inclusive" : "Tax exclusive") : before[field] ?? null,
    to: field === "taxInclusive" ? (normalized.taxInclusive ? "Tax inclusive" : "Tax exclusive") : normalized[field] ?? null,
  }]));
  await recordPriceListHistory(client, context, row.id, "updated", `${changed.map((field) => FIELD_LABELS[field]).join(", ")} changed`, { changes });
  return getPriceList(client, context, row.id);
}

// The default price list for its currency; the previous default stops being one.
export async function setDefaultPriceList(client, context, priceListId) {
  requirePriceListPermission(context, PRICE_LIST_PERMISSIONS.setDefault, "You do not have permission to set the default price list.");
  const row = await loadPriceListRow(client, context, priceListId, { lock: true });
  if (row.status !== "active") throw new PriceListError(409, "Only an active price list can be the default.", "SALES_PRICE_LIST_INACTIVE");
  if (row.is_default) return getPriceList(client, context, row.id);
  const previous = (await client.query(
    `UPDATE tenant.price_lists SET is_default = false, updated_by = $4, updated_at = now()
      WHERE organization_id = $1 AND price_list_type = 'sales' AND currency_code = $2 AND is_default AND id <> $3 RETURNING id, name`,
    [context.organizationId, row.currency_code, row.id, context.userId ?? null])).rows[0];
  await client.query(`UPDATE tenant.price_lists SET is_default = true, updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id, context.userId ?? null]);
  await recordPriceListHistory(client, context, row.id, "default_changed", `Default ${row.currency_code.trim()} price list${previous ? ` (was ${previous.name})` : ""}`, { changes: { previousDefaultId: previous?.id ?? null } });
  if (previous) await recordPriceListHistory(client, context, previous.id, "default_changed", `No longer the default: ${row.name} is`, { changes: { newDefaultId: row.id } });
  return getPriceList(client, context, row.id);
}

async function setStatus(client, context, priceListId, status, reason) {
  requirePriceListPermission(context, PRICE_LIST_PERMISSIONS.activate, "You do not have permission to activate or deactivate price lists.");
  const row = await loadPriceListRow(client, context, priceListId, { lock: true });
  if (row.status === status) throw new PriceListError(409, `This price list is already ${status}.`, "SALES_PRICE_LIST_STATUS_UNCHANGED");
  // Deactivating the default leaves the currency without one until another is chosen.
  await client.query(`UPDATE tenant.price_lists SET status = $3, is_default = CASE WHEN $3 = 'inactive' THEN false ELSE is_default END, updated_by = $4, updated_at = now()
                       WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id, status, context.userId ?? null]);
  const note = text(reason).slice(0, 300);
  await recordPriceListHistory(client, context, row.id, status === "active" ? "activated" : "deactivated",
    `${status === "active" ? "Activated" : "Deactivated"}${row.is_default && status === "inactive" ? " (was the default)" : ""}${note ? `: ${note}` : ""}`, { changes: { reason: note || null } });
  return getPriceList(client, context, row.id);
}
// An inactive price list stays on the documents priced from it but cannot be chosen for new ones.
export const deactivatePriceList = (client, context, priceListId, input = {}) => setStatus(client, context, priceListId, "inactive", input.reason);
export const activatePriceList = (client, context, priceListId, input = {}) => setStatus(client, context, priceListId, "active", input.reason);

// Only a price list nothing refers to can be deleted; its prices go with it.
export async function deletePriceList(client, context, priceListId) {
  requirePriceListPermission(context, PRICE_LIST_PERMISSIONS.activate, "You do not have permission to delete price lists.");
  const row = await loadPriceListRow(client, context, priceListId, { lock: true });
  const used = await priceListReferences(client, context, row.id);
  if (used.length) throw new PriceListError(409, `This price list is used by ${used.join(", ")}. Deactivate it instead of deleting it.`, "SALES_PRICE_LIST_IN_USE", { references: used });
  await client.query(`UPDATE tenant.sales_settings SET default_price_list_id = NULL WHERE organization_id = $1 AND default_price_list_id = $2`, [context.organizationId, row.id]);
  await client.query(`DELETE FROM tenant.price_lists WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id]);
  return { deleted: true };
}

// A new price list with the same prices, to change only what differs
// (Standard 2026 -> Standard 2027). input: code, name, and optionally
// description, validFrom, validTo, currencyCode is kept.
export async function copyPriceList(client, context, priceListId, input = {}) {
  requirePriceListPermission(context, PRICE_LIST_PERMISSIONS.create, "You do not have permission to create price lists.");
  requirePriceListPermission(context, PRICE_LIST_PERMISSIONS.managePrices, "You do not have permission to add prices.");
  const source = toPriceList(await loadPriceListRow(client, context, priceListId));
  const copy = await createPriceList(client, context, {
    code: input.code, name: input.name, description: has(input, "description") ? input.description : source.description, currencyCode: source.currencyCode,
    taxInclusive: source.taxInclusive, validFrom: has(input, "validFrom") ? input.validFrom : source.validFrom, validTo: has(input, "validTo") ? input.validTo : source.validTo,
  }, { historySummary: `Copied from ${source.code}` });
  // Only the prices valid today or later are copied; expired ones are history.
  const { rowCount } = await client.query(
    `INSERT INTO tenant.price_list_items (organization_id, price_list_id, item_id, variant_id, uom_id, minimum_quantity, rate, valid_from, valid_to, status, created_by, updated_by)
     SELECT organization_id, $3, item_id, variant_id, uom_id, 1, rate, valid_from, valid_to, 'active', $4, $4
       FROM tenant.price_list_items WHERE organization_id = $1 AND price_list_id = $2 AND status = 'active' AND (valid_to IS NULL OR valid_to >= current_date)`,
    [context.organizationId, source.id, copy.id, context.userId ?? null],
  );
  await recordPriceListHistory(client, context, copy.id, "copied", `${rowCount} prices copied from ${source.name}`, { changes: { sourceId: source.id, prices: rowCount } });
  await recordPriceListHistory(client, context, source.id, "copied", `Copied to ${copy.name}`, { changes: { copyId: copy.id } });
  return getPriceList(client, context, copy.id);
}
