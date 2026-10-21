// Schemes and special rates (Sales audit M3): the rules the pricing engine applies on top of the price list.
//
//   fixed_rate        a special rate for a customer (or customer type, or everyone) on a product or category: "Lumen pays 92 a box"
//   discount_percent  a discount, optionally from a quantity: a slab "2% from 100 cases" is a rule with minimum quantity 100
//   discount_amount   so much off each base unit
//   free_goods        buy N, get F free: of the same product, or another one
//
// Quantities are in the product's base unit. Rules of different priorities apply one after another; among those of one priority only the
// best fit applies (the highest slab reached, then the most specific), so slabs of a scheme share a priority. A rule is valid on the
// document's date. Seen with the price lists; created and changed by whoever manages prices.
import { PRICE_LIST_PERMISSIONS, PriceListError } from "../price-lists/constants.js";
import { priceListCan, requirePriceListPermission } from "../price-lists/access.js";

const TYPES = Object.freeze({
  fixed_rate: "Special rate",
  discount_percent: "Discount %",
  discount_amount: "Discount per unit",
  free_goods: "Free goods",
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const has = (input, key) => Object.prototype.hasOwnProperty.call(input, key);
const invalid = (field, message) => new PriceListError(400, message, "SALES_PRICING_RULE_INVALID", { issues: [{ field, message }] });
const day = (value) => (value instanceof Date
  ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
  : value ? String(value).slice(0, 10) : null);

const SELECT = `SELECT rule.*, party.display_name AS party_name, item.name AS item_name, item.code AS item_code, item_group.name AS item_group_name,
       price_list.name AS price_list_name, free.name AS free_item_name, free.code AS free_item_code, base.code AS base_uom_code,
       (SELECT count(*) FROM tenant.sales_order_lines line WHERE line.scheme_rule_id = rule.id)::int
         + (SELECT count(*) FROM tenant.sales_quotation_lines line WHERE line.scheme_rule_id = rule.id)::int AS free_line_count
  FROM tenant.sales_pricing_rules rule
  LEFT JOIN tenant.business_parties party ON party.id = rule.party_id
  LEFT JOIN tenant.items item ON item.id = rule.item_id
  LEFT JOIN tenant.units_of_measure base ON base.id = item.uom_id
  LEFT JOIN tenant.item_groups item_group ON item_group.id = rule.item_group_id
  LEFT JOIN tenant.price_lists price_list ON price_list.id = rule.price_list_id
  LEFT JOIN tenant.items free ON free.id = COALESCE(rule.free_item_id, CASE WHEN rule.adjustment_type = 'free_goods' THEN rule.item_id END)`;

function toRule(row, today) {
  const validFrom = day(row.valid_from);
  const validTo = day(row.valid_to);
  const value = Number(row.adjustment_value);
  const minimum = Number(row.minimum_quantity);
  const unit = row.base_uom_code ? ` ${row.base_uom_code}` : "";
  const what = row.item_name ? row.item_name : row.item_group_name ? `${row.item_group_name} (category)` : "Every product";
  const offer = row.adjustment_type === "free_goods"
    ? `Buy ${minimum}${unit}, get ${Number(row.free_quantity)} ${row.free_item_name ?? ""} free`.trim()
    : row.adjustment_type === "fixed_rate" ? `Rate ${value} per base unit`
      : row.adjustment_type === "discount_percent" ? `${value}% off` : `${value} off per base unit`;
  return {
    id: row.id, code: row.code, name: row.name, priority: row.priority, status: row.status, isActive: row.status === "active",
    adjustmentType: row.adjustment_type, typeLabel: TYPES[row.adjustment_type] ?? row.adjustment_type, adjustmentValue: value,
    partyId: row.party_id, partyName: row.party_name ?? null, partyType: row.party_type ?? null,
    itemId: row.item_id, itemName: row.item_name ?? null, itemCode: row.item_code ?? null, itemGroupId: row.item_group_id, itemGroupName: row.item_group_name ?? null,
    priceListId: row.price_list_id, priceListName: row.price_list_name ?? null,
    minimumQuantity: minimum, freeItemId: row.free_item_id, freeItemName: row.free_item_name ?? null, freeQuantity: row.free_quantity == null ? null : Number(row.free_quantity),
    validFrom, validTo, reason: row.reason ?? null,
    isCurrent: row.status === "active" && (!validFrom || validFrom <= today) && (!validTo || validTo >= today),
    who: row.party_name ?? (row.party_type === "customer" ? "Customers" : row.party_type === "prospect" ? "Prospects" : "Everyone"),
    what, summary: `${offer}${minimum > 0 && row.adjustment_type !== "free_goods" ? ` from ${minimum}${unit}` : ""}`,
    usedOnLines: row.free_line_count,
    updatedAt: row.updated_at,
  };
}

const companyToday = async (client) => (await client.query("SELECT tenant.company_today()::text AS today")).rows[0].today;

// filters: { search, status (active|inactive), type, partyId, itemId }
export async function listPricingRules(client, context, filters = {}) {
  requirePriceListPermission(context, PRICE_LIST_PERMISSIONS.view, "You do not have permission to view pricing rules.");
  const values = [context.organizationId];
  const where = ["rule.organization_id = $1"];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  if (["active", "inactive"].includes(filters.status)) where.push(`rule.status = ${bind(filters.status)}`);
  if (TYPES[filters.type]) where.push(`rule.adjustment_type = ${bind(filters.type)}`);
  if (UUID.test(String(filters.partyId ?? ""))) where.push(`rule.party_id = ${bind(filters.partyId)}`);
  if (UUID.test(String(filters.itemId ?? ""))) where.push(`(rule.item_id = ${bind(filters.itemId)} OR rule.free_item_id = $${values.length})`);
  const search = text(filters.search, 100).toLowerCase();
  if (search)
    where.push(`lower(concat_ws(' ', rule.code, rule.name, party.display_name, item.name, item.code, item_group.name)) LIKE ${bind(`%${search.replace(/[\\%_]/g, "\\$&")}%`)}`);
  const rows = (await client.query(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY rule.status, rule.priority, rule.code LIMIT 1000`, values)).rows;
  const today = await companyToday(client);
  return {
    rules: rows.map((row) => toRule(row, today)),
    types: Object.entries(TYPES).map(([code, label]) => ({ code, label })),
    capabilities: { view: true, manage: priceListCan(context, PRICE_LIST_PERMISSIONS.managePrices) },
  };
}

export async function getPricingRule(client, context, ruleId) {
  requirePriceListPermission(context, PRICE_LIST_PERMISSIONS.view, "You do not have permission to view pricing rules.");
  if (!UUID.test(String(ruleId ?? ""))) throw new PriceListError(404, "Pricing rule not found.", "SALES_PRICING_RULE_NOT_FOUND");
  const row = (await client.query(`${SELECT} WHERE rule.organization_id = $1 AND rule.id = $2`, [context.organizationId, ruleId])).rows[0];
  if (!row) throw new PriceListError(404, "Pricing rule not found.", "SALES_PRICING_RULE_NOT_FOUND");
  return toRule(row, await companyToday(client));
}

// Reads and checks the rule's fields; `existing` is the stored row when changing one.
async function readRule(client, context, input, existing = null) {
  const pick = (key, column) => (has(input, key) ? input[key] : existing?.[column]);
  const rule = {
    name: text(pick("name", "name"), 120),
    adjustmentType: String(pick("adjustmentType", "adjustment_type") ?? ""),
    adjustmentValue: Number(pick("adjustmentValue", "adjustment_value") ?? 0),
    partyId: pick("partyId", "party_id") || null,
    partyType: pick("partyType", "party_type") || null,
    itemId: pick("itemId", "item_id") || null,
    itemGroupId: pick("itemGroupId", "item_group_id") || null,
    priceListId: pick("priceListId", "price_list_id") || null,
    minimumQuantity: Number(pick("minimumQuantity", "minimum_quantity") ?? 0),
    freeItemId: pick("freeItemId", "free_item_id") || null,
    freeQuantity: pick("freeQuantity", "free_quantity"),
    validFrom: day(pick("validFrom", "valid_from")) || null,
    validTo: day(pick("validTo", "valid_to")) || null,
    reason: text(pick("reason", "reason"), 1000) || null,
    priority: pick("priority", "priority"),
  };
  if (!rule.name) throw invalid("name", "Name the scheme or rate.");
  if (!TYPES[rule.adjustmentType]) throw invalid("adjustmentType", "Choose what the rule gives: a special rate, a discount or free goods.");
  const free = rule.adjustmentType === "free_goods";
  if (free) rule.adjustmentValue = 0;
  if (!Number.isFinite(rule.adjustmentValue) || rule.adjustmentValue < 0) throw invalid("adjustmentValue", "Enter a value of 0 or more.");
  if (rule.adjustmentType === "discount_percent" && (rule.adjustmentValue <= 0 || rule.adjustmentValue > 100)) throw invalid("adjustmentValue", "Enter a discount between 0 and 100%.");
  if (["fixed_rate", "discount_amount"].includes(rule.adjustmentType) && rule.adjustmentValue <= 0) throw invalid("adjustmentValue", "Enter the rate or the amount off.");
  if (!Number.isFinite(rule.minimumQuantity) || rule.minimumQuantity < 0) throw invalid("minimumQuantity", "Enter a quantity of 0 or more.");
  if (rule.partyId && rule.partyType) rule.partyType = null;
  if (rule.partyType && !["customer", "prospect", "both"].includes(rule.partyType)) throw invalid("partyType", "Choose who the rule is for.");
  if (rule.itemId && rule.itemGroupId) throw invalid("itemGroupId", "A rule is for one product or one category, not both.");
  if (rule.adjustmentType === "fixed_rate" && !rule.itemId) throw invalid("itemId", "A special rate is for one product.");
  if (free) {
    rule.freeQuantity = Number(rule.freeQuantity);
    if (!(rule.minimumQuantity > 0)) throw invalid("minimumQuantity", "Enter how many must be bought.");
    if (!(rule.freeQuantity > 0)) throw invalid("freeQuantity", "Enter how many are given free.");
    if (!rule.freeItemId && !rule.itemId) throw invalid("freeItemId", "Choose the free product (a category scheme needs one).");
  } else {
    rule.freeItemId = null;
    rule.freeQuantity = null;
  }
  for (const [field, value] of [["validFrom", rule.validFrom], ["validTo", rule.validTo]])
    if (value && !DATE.test(value)) throw invalid(field, "Enter a date.");
  if (rule.validFrom && rule.validTo && rule.validFrom > rule.validTo) throw invalid("validTo", "The end date is before the start date.");
  const priority = rule.priority === undefined || rule.priority === null || rule.priority === "" ? (rule.adjustmentType === "fixed_rate" ? 100 : 200) : Number(rule.priority);
  if (!Number.isInteger(priority) || priority < 1 || priority > 10000) throw invalid("priority", "Priority is a whole number from 1 to 10000.");
  rule.priority = priority;
  const one = async (sql, value) => (await client.query(sql, [context.organizationId, value])).rows[0];
  for (const [field, value] of [["partyId", rule.partyId], ["itemId", rule.itemId], ["itemGroupId", rule.itemGroupId], ["priceListId", rule.priceListId], ["freeItemId", rule.freeItemId]])
    if (value && !UUID.test(String(value))) throw invalid(field, "Choose from the list.");
  if (rule.partyId && !(await one(`SELECT 1 FROM tenant.business_parties WHERE organization_id = $1 AND id = $2 AND party_type IN ('customer', 'prospect', 'both')`, rule.partyId)))
    throw invalid("partyId", "Choose a customer.");
  if (rule.itemId && !(await one(`SELECT 1 FROM tenant.items WHERE organization_id = $1 AND id = $2 AND is_sellable`, rule.itemId))) throw invalid("itemId", "Choose a product that is sold.");
  if (rule.freeItemId && !(await one(`SELECT 1 FROM tenant.items WHERE organization_id = $1 AND id = $2 AND is_sellable`, rule.freeItemId))) throw invalid("freeItemId", "Choose a product that is sold.");
  if (rule.itemGroupId && !(await one(`SELECT 1 FROM tenant.item_groups WHERE organization_id = $1 AND id = $2`, rule.itemGroupId))) throw invalid("itemGroupId", "Choose a category.");
  if (rule.priceListId && !(await one(`SELECT 1 FROM tenant.price_lists WHERE organization_id = $1 AND id = $2 AND price_list_type = 'sales'`, rule.priceListId)))
    throw invalid("priceListId", "Choose a sales price list.");
  return rule;
}

const COLUMNS = Object.freeze({
  name: "name", adjustmentType: "adjustment_type", adjustmentValue: "adjustment_value", partyId: "party_id", partyType: "party_type", itemId: "item_id",
  itemGroupId: "item_group_id", priceListId: "price_list_id", minimumQuantity: "minimum_quantity", freeItemId: "free_item_id", freeQuantity: "free_quantity",
  validFrom: "valid_from", validTo: "valid_to", reason: "reason", priority: "priority",
});

// input: the fields above, and an optional code (else the next SR-0001).
export async function createPricingRule(client, context, input = {}) {
  requirePriceListPermission(context, PRICE_LIST_PERMISSIONS.managePrices, "You do not have permission to set up schemes and rates.");
  const rule = await readRule(client, context, input);
  let code = text(input.code, 40).toUpperCase();
  if (!code) {
    const next = (await client.query(
      `SELECT COALESCE(max(substring(code FROM '^SR-([0-9]+)$')::int), 0) + 1 AS next FROM tenant.sales_pricing_rules WHERE organization_id = $1`, [context.organizationId])).rows[0].next;
    code = `SR-${String(next).padStart(4, "0")}`;
  }
  if ((await client.query("SELECT 1 FROM tenant.sales_pricing_rules WHERE organization_id = $1 AND code = $2", [context.organizationId, code])).rows[0])
    throw invalid("code", `The code ${code} is already used.`);
  const columns = Object.keys(COLUMNS);
  const row = (await client.query(
    `INSERT INTO tenant.sales_pricing_rules (organization_id, code, ${columns.map((key) => COLUMNS[key]).join(", ")}, status, created_by, updated_by)
     VALUES ($1, $2, ${columns.map((_key, index) => `$${index + 3}`).join(", ")}, 'active', $${columns.length + 3}, $${columns.length + 3}) RETURNING id`,
    [context.organizationId, code, ...columns.map((key) => rule[key]), context.userId ?? null])).rows[0];
  return getPricingRule(client, context, row.id);
}

// Changes a rule. Documents already priced keep their prices (each line keeps the rules it was priced with).
export async function updatePricingRule(client, context, ruleId, input = {}) {
  requirePriceListPermission(context, PRICE_LIST_PERMISSIONS.managePrices, "You do not have permission to set up schemes and rates.");
  const existing = (await client.query("SELECT * FROM tenant.sales_pricing_rules WHERE organization_id = $1 AND id = $2 FOR UPDATE", [context.organizationId, ruleId])).rows[0];
  if (!existing) throw new PriceListError(404, "Pricing rule not found.", "SALES_PRICING_RULE_NOT_FOUND");
  const rule = await readRule(client, context, input, existing);
  const columns = Object.keys(COLUMNS);
  await client.query(
    `UPDATE tenant.sales_pricing_rules SET ${columns.map((key, index) => `${COLUMNS[key]} = $${index + 3}`).join(", ")}, updated_by = $${columns.length + 3}, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, existing.id, ...columns.map((key) => rule[key]), context.userId ?? null]);
  return getPricingRule(client, context, existing.id);
}

// Switches a rule on or off; a rule never used on a free line can also be deleted.
export async function setPricingRuleStatus(client, context, ruleId, action) {
  requirePriceListPermission(context, PRICE_LIST_PERMISSIONS.managePrices, "You do not have permission to set up schemes and rates.");
  const rule = await getPricingRule(client, context, ruleId);
  if (action === "delete") {
    if (rule.usedOnLines > 0) throw new PriceListError(409, "Free goods were given under this scheme. Switch it off instead of deleting it.", "SALES_PRICING_RULE_IN_USE");
    await client.query("DELETE FROM tenant.sales_pricing_rules WHERE organization_id = $1 AND id = $2", [context.organizationId, rule.id]);
    return { deleted: true };
  }
  if (!["activate", "deactivate"].includes(action)) throw new PriceListError(400, "Choose activate, deactivate or delete.", "SALES_PRICING_RULE_INVALID");
  await client.query("UPDATE tenant.sales_pricing_rules SET status = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2",
    [context.organizationId, rule.id, action === "activate" ? "active" : "inactive", context.userId ?? null]);
  return getPricingRule(client, context, rule.id);
}
