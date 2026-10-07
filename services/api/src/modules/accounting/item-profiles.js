// Item accounting profiles: Finance's named sets of accounts for items.
//   Inventory profile    inventory asset and receipt clearing (goods received not invoiced)
//   Accounting profile   cost of goods sold, expense, revenue and purchase price variance
// An item category suggests profiles; an item keeps the profiles it was given, and postings for the item use the profile's account
// for that purpose (an item-specific account mapping still comes first). Only Finance changes the accounts in a profile.
import { AccountingError, hasPermission, optionalUuid, text, uuid } from "./core.js";

export const ITEM_PROFILE_KINDS = Object.freeze([
  { code: "inventory", label: "Inventory profile" },
  { code: "accounting", label: "Accounting profile" },
]);
// Mapping key -> the profile column that answers it.
export const ITEM_PROFILE_ACCOUNTS = Object.freeze({
  inventory: { kind: "inventory", column: "inventory_account_id", field: "inventoryAccountId", label: "Inventory asset" },
  grni: { kind: "inventory", column: "clearing_account_id", field: "clearingAccountId", label: "Receipt clearing (GRNI)" },
  cogs: { kind: "accounting", column: "cogs_account_id", field: "cogsAccountId", label: "Cost of goods sold" },
  expense: { kind: "accounting", column: "expense_account_id", field: "expenseAccountId", label: "Expense" },
  revenue: { kind: "accounting", column: "revenue_account_id", field: "revenueAccountId", label: "Revenue" },
  purchase_price_variance: { kind: "accounting", column: "variance_account_id", field: "varianceAccountId", label: "Purchase price variance" },
});
const FIELDS_BY_KIND = Object.freeze({
  inventory: Object.values(ITEM_PROFILE_ACCOUNTS).filter((entry) => entry.kind === "inventory"),
  accounting: Object.values(ITEM_PROFILE_ACCOUNTS).filter((entry) => entry.kind === "accounting"),
});
const MANAGE = "accounting.settings.manage";
const fail = (status, message, code, field) => Object.assign(new AccountingError(status, message, code), field ? { details: { issues: [{ field, message }] } } : {});

const canView = (context) => ["accounting.view", MANAGE, "products.view"].some((permission) => hasPermission(context, permission));

const SELECT = `
  SELECT profile.*, ${Object.values(ITEM_PROFILE_ACCOUNTS).map((entry) => `${entry.column.replace("_id", "")}.code || ' · ' || ${entry.column.replace("_id", "")}.name AS ${entry.column.replace("_id", "_label")}`).join(", ")},
         (SELECT count(*) FROM tenant.items item WHERE item.organization_id = profile.organization_id AND (item.inventory_profile_id = profile.id OR item.accounting_profile_id = profile.id))::int AS item_count,
         (SELECT count(*) FROM tenant.item_groups category WHERE category.organization_id = profile.organization_id
            AND (category.default_inventory_profile_id = profile.id OR category.default_accounting_profile_id = profile.id))::int AS category_count
    FROM tenant.accounting_item_profiles profile
    ${Object.values(ITEM_PROFILE_ACCOUNTS).map((entry) => `LEFT JOIN tenant.accounting_accounts ${entry.column.replace("_id", "")} ON ${entry.column.replace("_id", "")}.organization_id = profile.organization_id AND ${entry.column.replace("_id", "")}.id = profile.${entry.column}`).join("\n    ")}`;

function toProfile(row) {
  const kind = row.profile_kind;
  return {
    id: row.id, kind, kindLabel: ITEM_PROFILE_KINDS.find((entry) => entry.code === kind)?.label ?? kind, code: row.code, name: row.name, description: row.description,
    status: row.status, isActive: row.status === "active", version: Number(row.version),
    accounts: FIELDS_BY_KIND[kind].map((entry) => ({ key: Object.keys(ITEM_PROFILE_ACCOUNTS).find((key) => ITEM_PROFILE_ACCOUNTS[key] === entry), field: entry.field,
      label: entry.label, accountId: row[entry.column] ?? null, account: row[entry.column.replace("_id", "_label")] ?? null })),
    ...Object.fromEntries(FIELDS_BY_KIND[kind].map((entry) => [entry.field, row[entry.column] ?? null])),
    itemCount: Number(row.item_count ?? 0), categoryCount: Number(row.category_count ?? 0), updatedAt: row.updated_at,
  };
}

export async function listItemProfiles(client, context, { kind = null, includeInactive = true } = {}) {
  if (!canView(context)) throw fail(403, "You do not have permission to view item profiles.", "PERMISSION_DENIED");
  const values = [context.organizationId];
  let where = "";
  if (kind) { values.push(String(kind)); where += ` AND profile.profile_kind = $${values.length}`; }
  if (!includeInactive) where += " AND profile.status = 'active'";
  const { rows } = await client.query(`${SELECT} WHERE profile.organization_id = $1${where} ORDER BY profile.profile_kind, lower(profile.name)`, values);
  return rows.map(toProfile);
}

export async function getItemProfile(client, context, profileId) {
  if (!canView(context)) throw fail(403, "You do not have permission to view item profiles.", "PERMISSION_DENIED");
  const row = (await client.query(`${SELECT} WHERE profile.organization_id = $1 AND profile.id = $2`, [context.organizationId, uuid(profileId, "Profile")])).rows[0];
  if (!row) throw fail(404, "Profile not found.", "ITEM_PROFILE_NOT_FOUND");
  return toProfile(row);
}

async function checkAccounts(client, context, kind, values) {
  for (const entry of FIELDS_BY_KIND[kind]) {
    const accountId = values[entry.field];
    if (!accountId) continue;
    const account = (await client.query(`SELECT is_group, status FROM tenant.accounting_accounts WHERE organization_id = $1 AND id = $2`, [context.organizationId, accountId])).rows[0];
    if (!account || account.status !== "active") throw fail(400, `${entry.label}: choose an active account.`, "ITEM_PROFILE_ACCOUNT_INVALID", entry.field);
    if (account.is_group) throw fail(400, `${entry.label}: choose a posting account, not a group.`, "ITEM_PROFILE_ACCOUNT_INVALID", entry.field);
  }
}

function normalize(input, kind) {
  const values = { code: text(input.code, 60).toUpperCase(), name: text(input.name, 120), description: text(input.description, 1000) || null };
  for (const entry of FIELDS_BY_KIND[kind]) values[entry.field] = optionalUuid(input[entry.field], entry.label);
  return values;
}

// input: { kind: "inventory" | "accounting", code, name, description, and the kind's accounts (inventoryAccountId, clearingAccountId |
// cogsAccountId, expenseAccountId, revenueAccountId, varianceAccountId) }
export async function createItemProfile(client, context, input = {}) {
  if (!hasPermission(context, MANAGE)) throw fail(403, "You do not have permission to manage item profiles.", "PERMISSION_DENIED");
  const kind = text(input.kind);
  if (!FIELDS_BY_KIND[kind]) throw fail(400, "Choose an inventory or an accounting profile.", "ITEM_PROFILE_VALIDATION", "kind");
  const values = normalize(input, kind);
  if (!/^[A-Z0-9][A-Z0-9._/-]{0,39}$/.test(values.code)) throw fail(400, "Enter a short code, such as RAW-MAT.", "ITEM_PROFILE_VALIDATION", "code");
  if (!values.name) throw fail(400, "Enter the profile name.", "ITEM_PROFILE_VALIDATION", "name");
  if (!FIELDS_BY_KIND[kind].some((entry) => values[entry.field])) throw fail(400, "Choose at least one account.", "ITEM_PROFILE_VALIDATION", FIELDS_BY_KIND[kind][0].field);
  await checkAccounts(client, context, kind, values);
  if ((await client.query(`SELECT 1 FROM tenant.accounting_item_profiles WHERE organization_id = $1 AND upper(code) = $2`, [context.organizationId, values.code])).rows[0])
    throw fail(409, `${values.code} already exists.`, "ITEM_PROFILE_DUPLICATE", "code");
  const columns = ["organization_id", "profile_kind", "code", "name", "description", ...FIELDS_BY_KIND[kind].map((entry) => entry.column), "created_by", "updated_by"];
  const params = [context.organizationId, kind, values.code, values.name, values.description, ...FIELDS_BY_KIND[kind].map((entry) => values[entry.field]), context.userId ?? null, context.userId ?? null];
  const row = (await client.query(`INSERT INTO tenant.accounting_item_profiles (${columns.join(", ")}) VALUES (${params.map((_value, index) => `$${index + 1}`).join(", ")}) RETURNING id`, params)).rows[0];
  return getItemProfile(client, context, row.id);
}

// input: name, description and the accounts; expectedVersion refuses a change made on top of someone else's. Items posting through the
// profile post to the new accounts from now on; journals already posted are not touched.
export async function updateItemProfile(client, context, profileId, input = {}) {
  if (!hasPermission(context, MANAGE)) throw fail(403, "You do not have permission to manage item profiles.", "PERMISSION_DENIED");
  const current = (await client.query(`SELECT * FROM tenant.accounting_item_profiles WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, uuid(profileId, "Profile")])).rows[0];
  if (!current) throw fail(404, "Profile not found.", "ITEM_PROFILE_NOT_FOUND");
  if (input.expectedVersion !== undefined && input.expectedVersion !== null && Number(input.expectedVersion) !== Number(current.version))
    throw fail(409, "Someone else changed this profile. Reload it.", "ITEM_PROFILE_VERSION_CONFLICT");
  const kind = current.profile_kind;
  const merged = { code: current.code, name: current.name, description: current.description,
    ...Object.fromEntries(FIELDS_BY_KIND[kind].map((entry) => [entry.field, current[entry.column]])) };
  for (const key of ["name", "description", ...FIELDS_BY_KIND[kind].map((entry) => entry.field)]) if (Object.hasOwn(input, key)) merged[key] = input[key];
  const values = normalize(merged, kind);
  if (!values.name) throw fail(400, "Enter the profile name.", "ITEM_PROFILE_VALIDATION", "name");
  if (!FIELDS_BY_KIND[kind].some((entry) => values[entry.field])) throw fail(400, "Choose at least one account.", "ITEM_PROFILE_VALIDATION", FIELDS_BY_KIND[kind][0].field);
  await checkAccounts(client, context, kind, values);
  const sets = ["name = $3", "description = $4", ...FIELDS_BY_KIND[kind].map((entry, index) => `${entry.column} = $${index + 5}`)];
  await client.query(`UPDATE tenant.accounting_item_profiles SET ${sets.join(", ")}, version = version + 1, updated_by = $${FIELDS_BY_KIND[kind].length + 5}, updated_at = now()
     WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, current.id, values.name, values.description, ...FIELDS_BY_KIND[kind].map((entry) => values[entry.field]), context.userId ?? null]);
  return getItemProfile(client, context, current.id);
}

// An inactive profile is not offered for new items or categories; items already using it keep posting through it.
export async function setItemProfileStatus(client, context, profileId, status) {
  if (!hasPermission(context, MANAGE)) throw fail(403, "You do not have permission to manage item profiles.", "PERMISSION_DENIED");
  if (!["active", "inactive"].includes(status)) throw fail(400, "Choose Active or Inactive.", "ITEM_PROFILE_VALIDATION", "status");
  const updated = (await client.query(`UPDATE tenant.accounting_item_profiles SET status = $3, version = version + 1, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING id`,
    [context.organizationId, uuid(profileId, "Profile"), status, context.userId ?? null])).rows[0];
  if (!updated) throw fail(404, "Profile not found.", "ITEM_PROFILE_NOT_FOUND");
  return getItemProfile(client, context, updated.id);
}

// The account an item's profile gives for a mapping key, or null.
export async function itemProfileAccount(client, organizationId, itemId, mappingKey) {
  const target = ITEM_PROFILE_ACCOUNTS[mappingKey];
  if (!target || !itemId) return null;
  const row = (await client.query(
    `SELECT account.id AS account_id, account.code, account.name, account.account_type, account.account_class
       FROM tenant.items item
       JOIN tenant.accounting_item_profiles profile ON profile.organization_id = item.organization_id
            AND profile.id = ${target.kind === "inventory" ? "item.inventory_profile_id" : "item.accounting_profile_id"}
       JOIN tenant.accounting_accounts account ON account.organization_id = profile.organization_id AND account.id = profile.${target.column}
      WHERE item.organization_id = $1 AND item.id = $2 AND account.status = 'active'`, [organizationId, itemId])).rows[0];
  return row ?? null;
}
