// Price list formulas (Sales report Phase 3): a list's prices worked out by rules instead of typed one by one — cost plus 25%, the
// distributor list less 10%, rounded to end in 9. The first rule (by order) that matches a product decides its price: one for a product
// comes before one for its category, which comes before one for all products. "Work out prices" writes the results as the list's prices,
// changing a price in place (its history keeps the old one) or adding it; a product a rule cannot price (no cost, not on the other list)
// is left as it is and reported. Documents keep reading fixed prices, so a formula never changes a quotation already made.
import { requirePriceListPermission } from "./access.js";
import { PRICE_LIST_PERMISSIONS, PriceListError, today } from "./constants.js";
import { addPrice, updatePrice } from "./entries.js";
import { loadPriceListRow } from "./records.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROUNDING = Object.freeze({ none: "As worked out", whole: "Whole rupees", end_9: "Ending in 9", end_99: "Ending in .99" });
const invalid = (message, field) => new PriceListError(400, message, "SALES_PRICE_FORMULA_INVALID", { field });

export function roundPrice(value, rounding) {
  const price = Math.max(0, Number(value));
  if (rounding === "whole") return Math.round(price);
  if (rounding === "end_9") return Math.max(9, Math.ceil((price + 1) / 10) * 10 - 1);
  if (rounding === "end_99") return Math.max(0.99, Math.ceil(price + 0.01) - 0.01);
  return Math.round(price * 100) / 100;
}

const view = (row) => ({
  id: row.id, sequence: row.sequence, appliesTo: row.applies_to, itemGroupId: row.item_group_id, categoryName: row.category_name ?? null, itemId: row.item_id,
  productName: row.product_name ?? null, base: row.base, basePriceListId: row.base_price_list_id, basePriceListName: row.base_list_name ?? null, percent: Number(row.percent),
  rounding: row.rounding, roundingLabel: ROUNDING[row.rounding],
  description: `${row.base === "cost" ? "Cost" : row.base_list_name ?? "Other list"} ${Number(row.percent) >= 0 ? "+" : "−"} ${Math.abs(Number(row.percent))}%${row.rounding !== "none" ? `, ${ROUNDING[row.rounding].toLowerCase()}` : ""}`,
});

const SELECT = `
  SELECT formula.*, category.name AS category_name, item.name AS product_name, base.name AS base_list_name
    FROM tenant.price_list_formulas formula
    LEFT JOIN tenant.item_groups category ON category.id = formula.item_group_id
    LEFT JOIN tenant.items item ON item.id = formula.item_id
    LEFT JOIN tenant.price_lists base ON base.id = formula.base_price_list_id`;

export async function listPriceListFormulas(client, context, priceListId) {
  requirePriceListPermission(context, PRICE_LIST_PERMISSIONS.view, "You do not have permission to view price lists.");
  const list = await loadPriceListRow(client, context, priceListId);
  const rows = (await client.query(`${SELECT} WHERE formula.organization_id = $1 AND formula.price_list_id = $2 ORDER BY formula.sequence, formula.created_at`,
    [context.organizationId, list.id])).rows;
  return { formulas: rows.map(view) };
}

// input: { appliesTo: all | category | product, itemGroupId?, itemId?, base: cost | list, basePriceListId?, percent, rounding }
export async function addPriceListFormula(client, context, priceListId, input = {}) {
  requirePriceListPermission(context, PRICE_LIST_PERMISSIONS.managePrices, "You do not have permission to change price lists.");
  const list = await loadPriceListRow(client, context, priceListId, { lock: true });
  const appliesTo = ["all", "category", "product"].includes(input.appliesTo) ? input.appliesTo : null;
  if (!appliesTo) throw invalid("Choose what the rule prices.", "appliesTo");
  const one = async (sql, value) => (await client.query(sql, [context.organizationId, value])).rows[0];
  if (appliesTo === "category" && !(UUID.test(String(input.itemGroupId ?? "")) && await one("SELECT 1 FROM tenant.item_groups WHERE organization_id = $1 AND id = $2", input.itemGroupId)))
    throw invalid("Choose the category.", "itemGroupId");
  if (appliesTo === "product" && !(UUID.test(String(input.itemId ?? "")) && await one("SELECT 1 FROM tenant.items WHERE organization_id = $1 AND id = $2 AND is_sellable", input.itemId)))
    throw invalid("Choose a product that is sold.", "itemId");
  const base = ["cost", "list"].includes(input.base) ? input.base : null;
  if (!base) throw invalid("Choose what the price starts from.", "base");
  if (base === "list") {
    if (input.basePriceListId === list.id) throw invalid("A list cannot work out its prices from itself.", "basePriceListId");
    const other = UUID.test(String(input.basePriceListId ?? "")) ? await one("SELECT currency_code FROM tenant.price_lists WHERE organization_id = $1 AND id = $2", input.basePriceListId) : null;
    if (!other) throw invalid("Choose the price list it starts from.", "basePriceListId");
    if (String(other.currency_code).trim() !== String(list.currency_code).trim()) throw invalid("The other list must be in the same currency.", "basePriceListId");
  }
  const percent = Number(input.percent ?? 0);
  if (!Number.isFinite(percent) || percent < -99 || percent > 1000) throw invalid("Enter a percentage from −99 to 1000.", "percent");
  const rounding = ROUNDING[input.rounding] ? input.rounding : "none";
  const sequence = (await client.query("SELECT COALESCE(max(sequence), 0) + 10 AS next FROM tenant.price_list_formulas WHERE organization_id = $1 AND price_list_id = $2",
    [context.organizationId, list.id])).rows[0].next;
  const row = (await client.query(
    `INSERT INTO tenant.price_list_formulas (organization_id, price_list_id, sequence, applies_to, item_group_id, item_id, base, base_price_list_id, percent, rounding, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [context.organizationId, list.id, sequence, appliesTo, appliesTo === "category" ? input.itemGroupId : null, appliesTo === "product" ? input.itemId : null, base,
      base === "list" ? input.basePriceListId : null, percent, rounding, context.userId ?? null])).rows[0];
  const created = (await client.query(`${SELECT} WHERE formula.id = $1`, [row.id])).rows[0];
  return { formula: view(created) };
}

export async function deletePriceListFormula(client, context, priceListId, formulaId) {
  requirePriceListPermission(context, PRICE_LIST_PERMISSIONS.managePrices, "You do not have permission to change price lists.");
  const list = await loadPriceListRow(client, context, priceListId, { lock: true });
  const removed = await client.query("DELETE FROM tenant.price_list_formulas WHERE organization_id = $1 AND price_list_id = $2 AND id = $3 RETURNING id",
    [context.organizationId, list.id, UUID.test(String(formulaId ?? "")) ? formulaId : null]);
  if (!removed.rows[0]) throw new PriceListError(404, "Rule not found.", "SALES_PRICE_FORMULA_NOT_FOUND");
  return { deleted: true };
}

// Works out every sellable product's price by the rules. options: { apply? } — without it, nothing is written (a preview).
// Returns { changes: [{ itemId, name, from, to, rule }], skipped: [{ itemId, name, reason }], applied }.
export async function workOutPriceListPrices(client, context, priceListId, options = {}) {
  requirePriceListPermission(context, PRICE_LIST_PERMISSIONS.managePrices, "You do not have permission to change price lists.");
  const list = await loadPriceListRow(client, context, priceListId, { lock: Boolean(options.apply) });
  const formulas = (await client.query(`${SELECT} WHERE formula.organization_id = $1 AND formula.price_list_id = $2 ORDER BY formula.sequence, formula.created_at`,
    [context.organizationId, list.id])).rows;
  if (!formulas.length) throw new PriceListError(409, "Add a rule first.", "SALES_PRICE_FORMULA_NONE");
  const day = today();
  const items = (await client.query(
    `SELECT item.id, item.name, item.group_id, item.standard_cost, COALESCE(item.sales_uom_id, item.uom_id) AS uom_id FROM tenant.items item
      WHERE item.organization_id = $1 AND item.status = 'active' AND item.is_sellable AND NOT item.is_variant_template AND item.system_role IS NULL ORDER BY item.name`,
    [context.organizationId])).rows;
  // Each product's current open price on a list, at its sales unit and from one piece.
  const pricesOn = async (listId) => new Map((await client.query(
    `SELECT DISTINCT ON (entry.item_id) entry.item_id, entry.id, entry.rate, entry.uom_id FROM tenant.price_list_items entry
      WHERE entry.organization_id = $1 AND entry.price_list_id = $2 AND entry.status = 'active' AND entry.minimum_quantity <= 1
        AND (entry.valid_from IS NULL OR entry.valid_from <= $3::date) AND (entry.valid_to IS NULL OR entry.valid_to >= $3::date)
      ORDER BY entry.item_id, entry.valid_from DESC NULLS LAST`, [context.organizationId, listId, day])).rows.map((row) => [row.item_id, row]));
  const own = await pricesOn(list.id);
  const bases = new Map();
  for (const formula of formulas) if (formula.base === "list" && !bases.has(formula.base_price_list_id)) bases.set(formula.base_price_list_id, await pricesOn(formula.base_price_list_id));
  const ruleFor = (item) => formulas.find((formula) => formula.applies_to === "product" && formula.item_id === item.id)
    ?? formulas.find((formula) => formula.applies_to === "category" && formula.item_group_id === item.group_id)
    ?? formulas.find((formula) => formula.applies_to === "all");
  const changes = [];
  const skipped = [];
  for (const item of items) {
    const rule = ruleFor(item);
    if (!rule) continue;
    const start = rule.base === "cost" ? Number(item.standard_cost ?? 0) : Number(bases.get(rule.base_price_list_id)?.get(item.id)?.rate ?? 0);
    if (!(start > 0)) { skipped.push({ itemId: item.id, name: item.name, reason: rule.base === "cost" ? "No cost on the product." : `Not on ${rule.base_list_name}.` }); continue; }
    const price = roundPrice(start * (1 + Number(rule.percent) / 100), rule.rounding);
    const current = own.get(item.id);
    if (current && Math.abs(Number(current.rate) - price) < 0.005) continue;
    changes.push({ itemId: item.id, name: item.name, from: current ? Number(current.rate) : null, to: price, rule: view(rule).description, entryId: current?.id ?? null, uomId: current?.uom_id ?? item.uom_id });
  }
  if (options.apply) {
    for (const change of changes) {
      if (change.entryId) await updatePrice(client, context, list.id, change.entryId, { unitPrice: change.to });
      else await addPrice(client, context, list.id, { productId: change.itemId, uomId: change.uomId, unitPrice: change.to });
    }
  }
  return { changes: changes.map(({ entryId: _entry, uomId: _uom, ...rest }) => rest), skipped, applied: Boolean(options.apply) };
}
